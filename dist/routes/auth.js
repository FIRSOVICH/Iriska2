"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const bcryptjs_1 = __importDefault(require("bcryptjs"));
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Используем секунды вместо строк — обходит конфликт типов jsonwebtoken
function signAccess(userId) {
    const secret = process.env.JWT_SECRET;
    const opts = { expiresIn: 900 }; // 15 минут
    return jsonwebtoken_1.default.sign({ sub: userId }, secret, opts);
}
function signRefresh(userId) {
    const secret = process.env.JWT_REFRESH_SECRET;
    const opts = { expiresIn: 2592000 }; // 30 дней
    return jsonwebtoken_1.default.sign({ sub: userId }, secret, opts);
}
// POST /api/auth/register
router.post('/register', async (req, res) => {
    const { name, email, password, username } = req.body;
    if (!name || !email || !password || !username)
        return res.status(400).json({ error: 'Все поля обязательны' });
    if (password.length < 6)
        return res.status(400).json({ error: 'Пароль минимум 6 символов' });
    try {
        const existing = await (0, pool_1.query)('SELECT id FROM users WHERE email=$1 OR username=$2', [email, username]);
        if (existing.rows.length > 0)
            return res.status(409).json({ error: 'Email или username уже занят' });
        const hash = await bcryptjs_1.default.hash(password, 12);
        const { rows } = await (0, pool_1.query)(`INSERT INTO users (name, email, username)
       VALUES ($1,$2,$3) RETURNING id, name, username, email, created_at`, [name, email, username]);
        const user = rows[0];
        await (0, pool_1.query)('INSERT INTO auth_credentials (user_id, password_hash) VALUES ($1,$2)', [user.id, hash]);
        await (0, pool_1.query)('INSERT INTO user_profiles (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
        await (0, pool_1.query)('INSERT INTO user_theme (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [user.id]);
        const access = signAccess(user.id);
        const refresh = signRefresh(user.id);
        const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
        await (0, pool_1.query)('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)', [user.id, refresh, expiresAt]);
        // Первое достижение
        const ach = await (0, pool_1.query)(`SELECT id FROM achievements WHERE name='Первое сообщение'`);
        if (ach.rows[0]) {
            await (0, pool_1.query)('INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [user.id, ach.rows[0].id]);
        }
        res.status(201).json({ user, access, refresh });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});
// POST /api/auth/login
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password)
        return res.status(400).json({ error: 'Email и пароль обязательны' });
    try {
        const { rows } = await (0, pool_1.query)(`SELECT u.id, u.name, u.username, u.email, u.avatar_url, u.created_at, ac.password_hash
       FROM users u JOIN auth_credentials ac ON ac.user_id=u.id WHERE u.email=$1`, [email]);
        if (!rows[0])
            return res.status(401).json({ error: 'Неверный email или пароль' });
        const user = rows[0];
        const ok = await bcryptjs_1.default.compare(password, user.password_hash);
        if (!ok)
            return res.status(401).json({ error: 'Неверный email или пароль' });
        delete user.password_hash;
        const access = signAccess(user.id);
        const refresh = signRefresh(user.id);
        const expiresAt = new Date(Date.now() + 30 * 24 * 3600 * 1000);
        await (0, pool_1.query)('INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1,$2,$3)', [user.id, refresh, expiresAt]);
        res.json({ user, access, refresh });
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});
// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
    const { refreshToken } = req.body;
    if (!refreshToken)
        return res.status(400).json({ error: 'Нет refreshToken' });
    try {
        const payload = jsonwebtoken_1.default.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
        const { rows } = await (0, pool_1.query)('SELECT id FROM refresh_tokens WHERE token=$1 AND expires_at > NOW()', [refreshToken]);
        if (!rows[0])
            return res.status(401).json({ error: 'Токен не найден или истёк' });
        const access = signAccess(payload.sub);
        res.json({ access });
    }
    catch {
        res.status(401).json({ error: 'Недействительный refresh-токен' });
    }
});
// POST /api/auth/logout
router.post('/logout', auth_1.auth, async (req, res) => {
    const { refreshToken } = req.body;
    if (refreshToken)
        await (0, pool_1.query)('DELETE FROM refresh_tokens WHERE token=$1', [refreshToken]);
    res.json({ ok: true });
});
exports.default = router;
//# sourceMappingURL=auth.js.map