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

function serializeFile(file) {
  return {
    id: file.id,
    name: file.original_name,
    size: Number(file.size),
    mimeType: file.mime_type,
    createdAt: file.created_at
  };
}

function isTextLike(mimeType) {
  return mimeType.startsWith('text/') || mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('xml');
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
    const passwordHash = await hashPassword(String(password));
    const result = await pool.query(
      `INSERT INTO users (name, email, password_hash)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, role, created_at`,
      [String(name).trim(), normalizedEmail, passwordHash]
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
    const result = await pool.query('SELECT * FROM users WHERE email = $1 LIMIT 1', [String(email).trim().toLowerCase()]);
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

app.get('/api/files', authenticate, async (req, res) => {
  const result = await pool.query(
    `SELECT id, original_name, size, mime_type, created_at
     FROM files
     WHERE owner_id = $1
     ORDER BY created_at DESC`,
    [req.user.id]
  );

  const files = result.rows.map(serializeFile);
  const totalSize = files.reduce((sum, file) => sum + file.size, 0);
  return res.json({ files, stats: { count: files.length, totalSize } });
});

app.post('/api/files/upload', authenticate, upload.array('files', 20), async (req, res) => {
  const incomingFiles = req.files || [];

  if (!incomingFiles.length) {
    return res.status(400).json({ message: '请选择至少一个文件' });
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
        `INSERT INTO files (owner_id, original_name, stored_name, object_key, bucket, size, mime_type)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id, original_name, size, mime_type, created_at`,
        [req.user.id, file.originalname, file.originalname, objectKey, config.minio.bucket, file.size, file.mimetype || 'application/octet-stream']
      );

      uploaded.push(serializeFile(insert.rows[0]));
    }

    return res.status(201).json({ message: '上传成功', files: uploaded });
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: '上传失败' });
  }
});

async function findOwnedFile(fileId, ownerId) {
  const result = await pool.query('SELECT * FROM files WHERE id = $1 AND owner_id = $2 LIMIT 1', [fileId, ownerId]);
  return result.rows[0] || null;
}

function contentDisposition(type, filename) {
  const encoded = encodeURIComponent(filename);
  return `${type}; filename*=UTF-8''${encoded}`;
}

app.get('/api/files/:id/download', authenticate, async (req, res) => {
  const file = await findOwnedFile(Number(req.params.id), req.user.id);
  if (!file) {
    return res.status(404).json({ message: '文件不存在' });
  }

  try {
    const stream = await minioClient.getObject(file.bucket, file.object_key);
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition('attachment', file.original_name));
    stream.on('error', (error) => {
      console.error(error);
      if (!res.headersSent) {
        res.status(500).end('下载失败');
      }
    });
    return stream.pipe(res);
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
    const stream = await minioClient.getObject(file.bucket, file.object_key);
    res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
    res.setHeader('Content-Disposition', contentDisposition('inline', file.original_name));
    if (isTextLike(file.mime_type)) {
      res.setHeader('Content-Type', `${file.mime_type}; charset=utf-8`);
    }
    stream.on('error', (error) => {
      console.error(error);
      if (!res.headersSent) {
        res.status(500).end('预览失败');
      }
    });
    return stream.pipe(res);
  } catch (error) {
    console.error(error);
    return res.status(500).json({ message: '预览失败' });
  }
});

app.delete('/api/files/:id', authenticate, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query('SELECT * FROM files WHERE id = $1 AND owner_id = $2 LIMIT 1', [Number(req.params.id), req.user.id]);
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
