import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';
import { query } from '../db/pool';
import { auth, AuthRequest } from '../middleware/auth';

const router = Router();

// Используем секунды вместо строк — обходит конфликт типов jsonwebtoken
function signAccess(userId: string): string {
  const secret: Secret = process.env.JWT_SECRET!;
  const opts: SignOptions = { expiresIn: 900 }; // 15 минут
  return jwt.sign({ sub: userId }, secret, opts);
}

function signRefresh(userId: string): string {
  const secret: Secret = process.env.JWT_REFRESH_SECRET!;
  const opts: SignOptions = { expiresIn: 2592000 }; // 30 дней
  return jwt.sign({ sub: userId }, secret, opts);
}

// POST /api/auth/register
router.post('/register', async (req: Request, res: Response) => {
  const { name, email, password, username } = req.body;
  if (!name || !email || !password || !username)
    return res.status(400).json({ error: 'Все поля обязательны' });
  if (password.length < 6)
    return res.status(400).json({ error: 'Пароль минимум 6 символов' });
  try {
    const existing = await query(
      'SELECT id FROM users WHERE email=$1 OR username=$2', [email, username]
    );
    if (existing.rows.length > 0)
      return res.status(409).json({ error: 'Email или username уже занят' });

    const hash = await bcrypt.hash(password, 12);
    const { rows } = await query(
      `INSERT INTO users (name, email, username)
       VALUES ($1,$2,$3) RETURNING id, name, username, email, created_at`,
      [name, email, username]
    );
    const user = rows[0];
    await query('INSERT INTO auth_credentials (user_id, password_hash) VALUES ($1,$2)', [user.id, hash]);
    await query('INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
    await query('INSERT INTO user_theme (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);

    const access  = signAccess(user.id);
    const refresh = signRefresh(user.id);
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [user.id, refresh, expiresAt]
    );

    // Первое достижение
    const ach = await query(`SELECT id FROM achievements WHERE name='Первое сообщение'`);
    if (ach.rows[0]) {
      await query(
        'INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [user.id, ach.rows[0].id]
      );
    }

    res.status(201).json({ user, access, refresh });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/auth/login
router.post('/login', async (req: Request, res: Response) => {
  const { email, password } = req.body;
  if (!email || !password)
    return res.status(400).json({ error: 'Email и пароль обязательны' });
  try {
    const { rows } = await query(
      `SELECT u.id, u.name, u.username, u.email, u.avatar_url, u.created_at, ac.password_hash
       FROM users u JOIN auth_credentials ac ON ac.user_id=u.id WHERE u.email=$1`,
      [email]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Неверный email или пароль' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Неверный email или пароль' });
    delete user.password_hash;

    const access  = signAccess(user.id);
    const refresh = signRefresh(user.id);
    const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)',
      [user.id, refresh, expiresAt]
    );
    res.json({ user, access, refresh });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Ошибка сервера' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', async (req: Request, res: Response) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Нет refreshToken' });
  try {
    const payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) as { sub: string };
    const { rows } = await query(
      'SELECT id FROM refresh_tokens WHERE token=$1 AND expires_at > NOW()', [refreshToken]
    );
    if (!rows[0]) return res.status(401).json({ error: 'Токен не найден или истёк' });
    const access = signAccess(payload.sub);
    res.json({ access });
  } catch {
    res.status(401).json({ error: 'Недействительный refresh-токен' });
  }
});

// POST /api/auth/logout
router.post('/logout', auth, async (req: AuthRequest, res: Response) => {
  const { refreshToken } = req.body;
  if (refreshToken) await query('DELETE FROM refresh_tokens WHERE token=$1', [refreshToken]);
  res.json({ ok: true });
});

export default router;
