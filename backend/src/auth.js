import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { config } from './config.js';
import { pool } from './db.js';

export async function hashPassword(password) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

export function signToken(user) {
  return jwt.sign(
    {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    },
    config.jwtSecret,
    { expiresIn: '7d' }
  );
}

export function readToken(req) {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length);
  }

  if (typeof req.query.token === 'string' && req.query.token.trim()) {
    return req.query.token.trim();
  }

  return null;
}

export async function authenticate(req, res, next) {
  const token = readToken(req);

  if (!token) {
    return res.status(401).json({ message: '未登录或 token 缺失' });
  }

  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const result = await pool.query(
      `SELECT id, name, email, role, is_enabled, storage_quota_mb
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [Number(payload.sub)]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ message: '用户不存在，请重新登录' });
    }

    if (!user.is_enabled) {
      return res.status(403).json({ message: '账号已被禁用，请联系管理员' });
    }

    req.user = {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      isEnabled: user.is_enabled,
      storageQuotaMb: Number(user.storage_quota_mb)
    };

    return next();
  } catch {
    return res.status(401).json({ message: '登录状态失效，请重新登录' });
  }
}
