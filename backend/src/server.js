import crypto from 'crypto';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import multer from 'multer';
import { config } from './config.js';
import { pool, initDb } from './db.js';
import { authenticate, hashPassword, signToken, verifyPassword } from './auth.js';
import { initBucket, minioClient } from './storage.js';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.maxFileSizeMb * 1024 * 1024
  }
});

app.set('trust proxy', true);
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors());
app.use(express.json());

function serializeUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.created_at
  };
}

function serializeFolder(folder) {
  return {
    id: folder.id,
    name: folder.name,
    parentId: folder.parent_id,
    createdAt: folder.created_at
  };
}

function serializeFile(file) {
  return {
    id: file.id,
    name: file.original_name,
    size: Number(file.size),
    mimeType: file.mime_type,
    parentFolderId: file.parent_folder_id,
    createdAt: file.created_at
  };
}

function serializeShare(share, origin) {
  return {
    id: share.id,
    fileId: share.file_id,
    fileName: share.original_name,
    token: share.token,
    expiresAt: share.expires_at,
    createdAt: share.created_at,
    url: `${origin}/share.html?token=${share.token}`
  };
}

function isTextLike(mimeType = '') {
  return mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('xml');
}

function getOrigin(req) {
  return `${req.protocol}://${req.get('host')}`;
}

function normalizeFolderId(value) {
  if (value === undefined || value === null || value === '' || value === 'root') {
    return null;
  }

  const folderId = Number(value);
  if (!Number.isInteger(folderId) || folderId <= 0) {
    throw new Error('folderId 非法');
  }

  return folderId;
}

function parseShareDays(value) {
  const days = Number(value ?? 7);
  if (!Number.isFinite(days)) {
    return 7;
  }

  return Math.min(Math.max(Math.round(days), 1), 365);
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ message: '需要管理员权限' });
  }

  return next();
}

async function getFolder(folderId, ownerId) {
  if (folderId === null) {
    return null;
  }

  const result = await pool.query(
    'SELECT * FROM folders WHERE id = $1 AND owner_id = $2 LIMIT 1',
    [folderId, ownerId]
  );

  return result.rows[0] || null;
}

async function getStorageStats(ownerId) {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count, COALESCE(SUM(size), 0)::bigint AS total_size
     FROM files
     WHERE owner_id = $1`,
    [ownerId]
  );

  return {
    count: Number(result.rows[0].count || 0),
    totalSize: Number(result.rows[0].total_size || 0)
  };
}

async function buildBreadcrumb(folderId, ownerId) {
  const breadcrumb = [{ id: null, name: '根目录' }];
  if (folderId === null) {
    return breadcrumb;
  }

  const chain = [];
  let currentId = folderId;

  while (currentId) {
    const folder = await getFolder(currentId, ownerId);
    if (!folder) {
      break;
    }

    chain.unshift({ id: folder.id, name: folder.name });
    currentId = folder.parent_id;
  }

  return breadcrumb.concat(chain);
}

async function getExplorerData(ownerId, folderId) {
  const currentFolder = await getFolder(folderId, ownerId);
  if (folderId !== null && !currentFolder) {
    return null;
  }

  const foldersResult = await pool.query(
    `SELECT id, name, parent_id, created_at
     FROM folders
     WHERE owner_id = $1 AND parent_id IS NOT DISTINCT FROM $2
     ORDER BY name ASC`,
    [ownerId, folderId]
  );

  const filesResult = await pool.query(
    `SELECT id, original_name, size, mime_type, parent_folder_id, created_at
     FROM files
     WHERE owner_id = $1 AND parent_folder_id IS NOT DISTINCT FROM $2
     ORDER BY original_name ASC`,
    [ownerId, folderId]
  );

  return {
    currentFolder: currentFolder ? serializeFolder(currentFolder) : null,
    breadcrumb: await buildBreadcrumb(folderId, ownerId),
    folders: foldersResult.rows.map(serializeFolder),
    files: filesResult.rows.map(serializeFile),
    stats: await getStorageStats(ownerId)
  };
}

async function findOwnedFile(fileId, ownerId) {
  const result = await pool.query(
    'SELECT * FROM files WHERE id = $1 AND owner_id = $2 LIMIT 1',
    [fileId, ownerId]
  );

  return result.rows[0] || null;
}

async function findActiveShare(token) {
  const result = await pool.query(
    `SELECT s.*, f.original_name, f.mime_type, f.size, f.bucket, f.object_key
     FROM shares s
     JOIN files f ON f.id = s.file_id
     WHERE s.token = $1
       AND (s.expires_at IS NULL OR s.expires_at > NOW())
     LIMIT 1`,
    [token]
  );

  return result.rows[0] || null;
}

function contentDisposition(type, filename) {
  const encoded = encodeURIComponent(filename);
  return `${type}; filename*=UTF-8''${encoded}`;
}

async function streamFile(res, file, disposition) {
  const stream = await minioClient.getObject(file.bucket, file.object_key);
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', contentDisposition(disposition, file.original_name));
  if (isTextLike(file.mime_type)) {
    res.setHeader('Content-Type', `${file.mime_type}; charset=utf-8`);
  }

  stream.on('error', (error) => {
    console.error(error);
    if (!res.headersSent) {
      res.status(500).end('文件流输出失败');
    }
  });

  stream.pipe(res);
}

app.get('/api/health', async (_req, res) => {
  const db = await pool.query('SELECT NOW() AS now');
  res.json({ ok: true, dbTime: db.rows[0].now });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password } = req.body ?? {};

  if (!name || !email || !password) {
    return res.status(400).json({ message: 'name、email、password 都是必填项' });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ message: '密码至少需要 6 位' });
  }

  const normalizedEmail = String(email).trim().toLowerCase();

  try {
    const userCountResult = await pool.query('SELECT COUNT(*)::int AS count FROM users');
    const isFirstUser = Number(userCountResult.rows[0].count) === 0;
    const role = isFirstUser ? 'admin' : 'user';
    const passwordHash = await hashPassword(String(password));

    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, role, created_at`,
      [String(name).trim(), normalizedEmail, passwordHash, role]
    );

    const user = result.rows[0];
    const token = signToken(user);
    return res.status(201).json({ token, user: serializeUser(user) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: '该邮箱已注册' });
    }

    console.error(error);
    return res.status(500).json({ message: '注册失败' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ message: 'email 和 password 必填' });
  }

  try {
    const result = await pool.query(
      'SELECT * FROM users WHERE email = $1 LIMIT 1',
      [String(email).trim().toLowerCase()]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: '邮箱或密码错误' });
    }

    const valid = await verifyPassword(String(password), user.password_hash);
    if (!valid) {
      return res.status(401).json({ message: '邮箱或密码错误' });
    }

    const token = signToken(user);
    return res.json({ token, user: serializeUser(user) });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: '登录失败' });
  }
});

app.get('/api/auth/me', authenticate, async (req, res) => {
  const result = await pool.query(
    'SELECT id, name, email, role, created_at FROM users WHERE id = $1 LIMIT 1',
    [req.user.id]
  );

  const user = result.rows[0];
  if (!user) {
    return res.status(404).json({ message: '用户不存在' });
  }

  return res.json({ user: serializeUser(user) });
});

app.get('/api/explorer', authenticate, async (req, res) => {
  try {
    const folderId = normalizeFolderId(req.query.folderId);
    const explorer = await getExplorerData(req.user.id, folderId);

    if (!explorer) {
      return res.status(404).json({ message: '目录不存在' });
    }

    return res.json(explorer);
  } catch (error) {
    if (error.message === 'folderId 非法') {
      return res.status(400).json({ message: error.message });
    }

    console.error(error);
    return res.status(500).json({ message: '读取目录失败' });
  }
});

app.get('/api/files', authenticate, async (req, res) => {
  const explorer = await getExplorerData(req.user.id, null);
  return res.json({ files: explorer.files, stats: explorer.stats });
});

app.post('/api/folders', authenticate, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) {
    return res.status(400).json({ message: '文件夹名称不能为空' });
  }

  let parentId;
  try {
    parentId = normalizeFolderId(req.body?.parentId);
  } catch {
    return res.status(400).json({ message: '父目录参数非法' });
  }

  const parentFolder = await getFolder(parentId, req.user.id);
  if (parentId !== null && !parentFolder) {
    return res.status(404).json({ message: '父目录不存在' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO folders (owner_id, parent_id, name)
       VALUES ($1, $2, $3)
       RETURNING id, owner_id, parent_id, name, created_at`,
      [req.user.id, parentId, name]
    );

    return res.status(201).json({ folder: serializeFolder(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: '同级目录下已存在同名文件夹' });
    }

    console.error(error);
    return res.status(500).json({ message: '创建文件夹失败' });
  }
});

app.patch('/api/folders/:id', authenticate, async (req, res) => {
  const folderId = Number(req.params.id);
  const name = String(req.body?.name || '').trim();

  if (!Number.isInteger(folderId) || folderId <= 0) {
    return res.status(400).json({ message: '目录 id 非法' });
  }

  if (!name) {
    return res.status(400).json({ message: '文件夹名称不能为空' });
  }

  const folder = await getFolder(folderId, req.user.id);
  if (!folder) {
    return res.status(404).json({ message: '目录不存在' });
  }

  try {
    const result = await pool.query(
      `UPDATE folders
       SET name = $1
       WHERE id = $2 AND owner_id = $3
       RETURNING id, owner_id, parent_id, name, created_at`,
      [name, folderId, req.user.id]
    );

    return res.json({ folder: serializeFolder(result.rows[0]) });
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: '同级目录下已存在同名文件夹' });
    }

    console.error(error);
    return res.status(500).json({ message: '重命名失败' });
  }
});

app.delete('/api/folders/:id', authenticate, async (req, res) => {
  const folderId = Number(req.params.id);
  if (!Number.isInteger(folderId) || folderId <= 0) {
    return res.status(400).json({ message: '目录 id 非法' });
  }

  const folder = await getFolder(folderId, req.user.id);
  if (!folder) {
    return res.status(404).json({ message: '目录不存在' });
  }

  const childFolderResult = await pool.query(
    'SELECT 1 FROM folders WHERE owner_id = $1 AND parent_id = $2 LIMIT 1',
    [req.user.id, folderId]
  );

  if (childFolderResult.rowCount > 0) {
    return res.status(400).json({ message: '该目录下还有子目录，暂不支持直接删除' });
  }

  const childFileResult = await pool.query(
    'SELECT 1 FROM files WHERE owner_id = $1 AND parent_folder_id = $2 LIMIT 1',
    [req.user.id, folderId]
  );

  if (childFileResult.rowCount > 0) {
    return res.status(400).json({ message: '该目录下还有文件，请先清空后再删除' });
  }

  await pool.query('DELETE FROM folders WHERE id = $1 AND owner_id = $2', [folderId, req.user.id]);
  return res.json({ message: '目录删除成功' });
});

app.post('/api/files/upload', authenticate, upload.array('files', 20), async (req, res) => {
  const incomingFiles = req.files || [];
  if (!incomingFiles.length) {
    return res.status(400).json({ message: '请选择至少一个文件' });
  }

  let folderId;
  try {
    folderId = normalizeFolderId(req.body?.folderId);
  } catch {
    return res.status(400).json({ message: '目标目录参数非法' });
  }

  const folder = await getFolder(folderId, req.user.id);
  if (folderId !== null && !folder) {
    return res.status(404).json({ message: '目标目录不存在' });
  }

  try {
    const uploaded = [];

    for (const file of incomingFiles) {
      const objectKey = `${req.user.id}/${Date.now()}-${crypto.randomUUID()}-${file.originalname}`;
      await minioClient.putObject(
        config.minio.bucket,
        objectKey,
        file.buffer,
        file.size,
        { 'Content-Type': file.mimetype }
      );

      const insert = await pool.query(
        `INSERT INTO files (owner_id, parent_folder_id, original_name, stored_name, object_key, bucket, size, mime_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING id, original_name, size, mime_type, parent_folder_id, created_at`,
        [
          req.user.id,
          folderId,
          file.originalname,
          file.originalname,
          objectKey,
          config.minio.bucket,
          file.size,
          file.mimetype || 'application/octet-stream'
        ]
      );

      uploaded.push(serializeFile(insert.rows[0]));
    }

    return res.status(201).json({ message: '上传成功', files: uploaded });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: '上传失败' });
  }
});

app.patch('/api/files/:id', authenticate, async (req, res) => {
  const fileId = Number(req.params.id);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    return res.status(400).json({ message: '文件 id 非法' });
  }

  const file = await findOwnedFile(fileId, req.user.id);
  if (!file) {
    return res.status(404).json({ message: '文件不存在' });
  }

  const nextName = req.body?.name !== undefined ? String(req.body.name).trim() : file.original_name;
  if (!nextName) {
    return res.status(400).json({ message: '文件名不能为空' });
  }

  let parentFolderId;
  try {
    parentFolderId = req.body?.parentFolderId !== undefined
      ? normalizeFolderId(req.body.parentFolderId)
      : file.parent_folder_id;
  } catch {
    return res.status(400).json({ message: '目标目录参数非法' });
  }

  const folder = await getFolder(parentFolderId, req.user.id);
  if (parentFolderId !== null && !folder) {
    return res.status(404).json({ message: '目标目录不存在' });
  }

  const result = await pool.query(
    `UPDATE files
     SET original_name = $1, stored_name = $2, parent_folder_id = $3
     WHERE id = $4 AND owner_id = $5
     RETURNING id, original_name, size, mime_type, parent_folder_id, created_at`,
    [nextName, nextName, parentFolderId, fileId, req.user.id]
  );

  return res.json({ file: serializeFile(result.rows[0]) });
});

app.post('/api/files/:id/share', authenticate, async (req, res) => {
  const fileId = Number(req.params.id);
  if (!Number.isInteger(fileId) || fileId <= 0) {
    return res.status(400).json({ message: '文件 id 非法' });
  }

  const file = await findOwnedFile(fileId, req.user.id);
  if (!file) {
    return res.status(404).json({ message: '文件不存在' });
  }

  const expiresAt = new Date(Date.now() + parseShareDays(req.body?.expiresInDays) * 24 * 60 * 60 * 1000);
  const token = crypto.randomBytes(18).toString('base64url');

  const result = await pool.query(
    `INSERT INTO shares (owner_id, file_id, token, expires_at)
     VALUES ($1, $2, $3, $4)
     RETURNING id, file_id, token, expires_at, created_at`,
    [req.user.id, fileId, token, expiresAt]
  );

  const row = {
    ...result.rows[0],
    original_name: file.original_name
  };

  return res.status(201).json({ share: serializeShare(row, getOrigin(req)) });
});

app.get('/api/shares', authenticate, async (req, res) => {
  const result = await pool.query(
    `SELECT s.id, s.file_id, s.token, s.expires_at, s.created_at, f.original_name
     FROM shares s
     JOIN files f ON f.id = s.file_id
     WHERE s.owner_id = $1
     ORDER BY s.created_at DESC`,
    [req.user.id]
  );

  return res.json({ shares: result.rows.map((row) => serializeShare(row, getOrigin(req))) });
});

app.delete('/api/shares/:id', authenticate, async (req, res) => {
  const shareId = Number(req.params.id);
  if (!Number.isInteger(shareId) || shareId <= 0) {
    return res.status(400).json({ message: '分享 id 非法' });
  }

  const result = await pool.query(
    'DELETE FROM shares WHERE id = $1 AND owner_id = $2 RETURNING id',
    [shareId, req.user.id]
  );

  if (!result.rowCount) {
    return res.status(404).json({ message: '分享不存在' });
  }

  return res.json({ message: '分享已撤销' });
});

app.get('/api/files/:id/download', authenticate, async (req, res) => {
  const file = await findOwnedFile(Number(req.params.id), req.user.id);
  if (!file) {
    return res.status(404).json({ message: '文件不存在' });
  }

  try {
    await streamFile(res, file, 'attachment');
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: '下载失败' });
  }
});

app.get('/api/files/:id/preview', authenticate, async (req, res) => {
  const file = await findOwnedFile(Number(req.params.id), req.user.id);
  if (!file) {
    return res.status(404).json({ message: '文件不存在' });
  }

  try {
    await streamFile(res, file, 'inline');
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: '预览失败' });
  }
});

app.delete('/api/files/:id', authenticate, async (req, res) => {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    const result = await client.query(
      'SELECT * FROM files WHERE id = $1 AND owner_id = $2 LIMIT 1',
      [Number(req.params.id), req.user.id]
    );

    const file = result.rows[0];
    if (!file) {
      await client.query('ROLLBACK');
      return res.status(404).json({ message: '文件不存在' });
    }

    await minioClient.removeObject(file.bucket, file.object_key);
    await client.query('DELETE FROM files WHERE id = $1', [file.id]);
    await client.query('COMMIT');
    return res.json({ message: '删除成功' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error(error);
    return res.status(500).json({ message: '删除失败' });
  } finally {
    client.release();
  }
});

app.get('/api/public/shares/:token', async (req, res) => {
  const share = await findActiveShare(req.params.token);
  if (!share) {
    return res.status(404).json({ message: '分享不存在或已过期' });
  }

  return res.json({
    share: {
      fileName: share.original_name,
      mimeType: share.mime_type,
      size: Number(share.size),
      expiresAt: share.expires_at,
      downloadUrl: `${getOrigin(req)}/api/public/shares/${share.token}/download`,
      previewUrl: `${getOrigin(req)}/api/public/shares/${share.token}/preview`
    }
  });
});

app.get('/api/public/shares/:token/download', async (req, res) => {
  const share = await findActiveShare(req.params.token);
  if (!share) {
    return res.status(404).json({ message: '分享不存在或已过期' });
  }

  try {
    await streamFile(res, share, 'attachment');
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: '下载失败' });
  }
});

app.get('/api/public/shares/:token/preview', async (req, res) => {
  const share = await findActiveShare(req.params.token);
  if (!share) {
    return res.status(404).json({ message: '分享不存在或已过期' });
  }

  try {
    await streamFile(res, share, 'inline');
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: '预览失败' });
  }
});

app.get('/api/admin/users', authenticate, requireAdmin, async (_req, res) => {
  const result = await pool.query(
    `SELECT u.id, u.name, u.email, u.role, u.created_at,
            COUNT(f.id)::int AS file_count,
            COALESCE(SUM(f.size), 0)::bigint AS total_size
     FROM users u
     LEFT JOIN files f ON f.owner_id = u.id
     GROUP BY u.id
     ORDER BY u.created_at ASC`
  );

  const users = result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    createdAt: row.created_at,
    fileCount: Number(row.file_count || 0),
    totalSize: Number(row.total_size || 0)
  }));

  return res.json({ users });
});

app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ message: `单文件大小不能超过 ${config.maxFileSizeMb}MB` });
  }

  console.error(error);
  return res.status(500).json({ message: '服务内部错误' });
});

async function main() {
  await initDb();
  await initBucket();
  app.listen(config.port, () => {
    console.log(`self-drive api listening on :${config.port}`);
  });
}

main().catch((error) => {
  console.error('Failed to start server', error);
  process.exit(1);
});
