import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { config } from '../config.js';
import { authenticate } from '../middlewares/auth.js';
import { writeAudit, clientIp } from '../services/audit.js';

const router = Router();

const PUBLIC_USER = `
SELECT id, username, password_hash, full_name, role, base_id, is_active
FROM users WHERE username = :username LIMIT 1`;

router.post('/login', async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password are required' });
    }

    const [[user]] = await query(PUBLIC_USER, { username });
    if (!user || !user.is_active) {
      await writeAudit({ action: 'LOGIN_FAILED', entity: 'auth', details: { username }, ip: clientIp(req) });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) {
      await writeAudit({ user, action: 'LOGIN_FAILED', entity: 'auth', ip: clientIp(req) });
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, full_name: user.full_name, role: user.role, base_id: user.base_id },
      config.jwtSecret,
      { expiresIn: config.jwtExpiresIn }
    );

    await writeAudit({ user, action: 'LOGIN', entity: 'auth', ip: clientIp(req) });

    const { password_hash: _pw, is_active: _a, ...safeUser } = user;
    res.json({ token, user: safeUser });
  } catch (err) {
    next(err);
  }
});

router.get('/me', authenticate, async (req, res) => {
  const [[user]] = await query(
    'SELECT id, username, full_name, role, base_id FROM users WHERE id = :id',
    { id: req.user.id }
  );
  if (!user) return res.status(401).json({ error: 'Account no longer exists' });
  res.json({ user });
});

export default router;