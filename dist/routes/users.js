"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const upload_1 = require("../utils/upload");
const router = (0, express_1.Router)();
// GET /api/users/me
router.get('/me', auth_1.auth, async (req, res) => {
    try {
        const { rows } = await (0, pool_1.query)(`SELECT u.id, u.name, u.username, u.email, u.avatar_url, u.created_at,
              p.status_preset, p.mood, p.music_track, p.music_artist, p.game_name,
              p.hide_online, p.bio, t.theme, t.font, t.accent_color, t.bubble_style, t.cozy_mode
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id=u.id
       LEFT JOIN user_theme t ON t.user_id=u.id
       WHERE u.id=$1`, [req.userId]);
        if (!rows[0])
            return res.status(404).json({ error: 'Пользователь не найден' });
        res.json(rows[0]);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Ошибка сервера' });
    }
});
// PATCH /api/users/me
router.patch('/me', auth_1.auth, async (req, res) => {
    const { name, bio, username } = req.body;
    try {
        const fields = [];
        const vals = [];
        let idx = 1;
        if (name) {
            fields.push(`name=$${idx++}`);
            vals.push(name);
        }
        if (username) {
            fields.push(`username=$${idx++}`);
            vals.push(username);
        }
        if (fields.length > 0) {
            fields.push(`updated_at=NOW()`);
            vals.push(req.userId);
            await (0, pool_1.query)(`UPDATE users SET ${fields.join(',')} WHERE id=$${idx}`, vals);
        }
        if (bio !== undefined) {
            await (0, pool_1.query)('INSERT INTO user_profiles (user_id, bio) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET bio=$2, updated_at=NOW()', [req.userId, bio]);
        }
        const { rows } = await (0, pool_1.query)('SELECT id,name,username,email,avatar_url FROM users WHERE id=$1', [req.userId]);
        res.json(rows[0]);
    }
    catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Ошибка' });
    }
});
// POST /api/users/me/avatar
router.post('/me/avatar', auth_1.auth, upload_1.upload.single('avatar'), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: 'Файл не загружен' });
    const url = `/uploads/${req.file.filename}`;
    await (0, pool_1.query)('UPDATE users SET avatar_url=$1 WHERE id=$2', [url, req.userId]);
    res.json({ avatar_url: url });
});
// GET /api/users/search?q=
router.get('/search', auth_1.auth, async (req, res) => {
    const q = (req.query.q || '').trim();
    if (!q)
        return res.json([]);
    try {
        const { rows } = await (0, pool_1.query)(`SELECT id, name, username, avatar_url
       FROM users
       WHERE (LOWER(name) LIKE $1 OR LOWER(username) LIKE $1) AND id != $2
       LIMIT 20`, [`%${q.toLowerCase()}%`, req.userId]);
        res.json(rows);
    }
    catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});
// GET /api/users/:id
router.get('/:id', auth_1.auth, async (req, res) => {
    try {
        const { rows } = await (0, pool_1.query)(`SELECT u.id, u.name, u.username, u.avatar_url, u.created_at,
              p.status_preset, p.mood, p.music_track, p.bio, p.hide_online
       FROM users u LEFT JOIN user_profiles p ON p.user_id=u.id WHERE u.id=$1`, [req.params.id]);
        if (!rows[0])
            return res.status(404).json({ error: 'Не найден' });
        const user = rows[0];
        if (user.hide_online) {
            delete user.status_preset;
        }
        res.json(user);
    }
    catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});
// GET /api/users/me/contacts
router.get('/me/contacts', auth_1.auth, async (req, res) => {
    try {
        const { rows } = await (0, pool_1.query)(`SELECT c.id, c.nickname, c.blocked, u.id as user_id, u.name, u.username, u.avatar_url,
              p.status_preset, p.mood, p.hide_online
       FROM contacts c
       JOIN users u ON u.id = c.contact_id
       LEFT JOIN user_profiles p ON p.user_id = u.id
       WHERE c.user_id=$1
       ORDER BY u.name`, [req.userId]);
        res.json(rows);
    }
    catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});
// POST /api/users/me/contacts
router.post('/me/contacts', auth_1.auth, async (req, res) => {
    const { contactId, nickname } = req.body;
    if (!contactId)
        return res.status(400).json({ error: 'contactId обязателен' });
    try {
        await (0, pool_1.query)('INSERT INTO contacts (user_id, contact_id, nickname) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.userId, contactId, nickname || null]);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});
// DELETE /api/users/me/contacts/:id
router.delete('/me/contacts/:id', auth_1.auth, async (req, res) => {
    await (0, pool_1.query)('DELETE FROM contacts WHERE user_id=$1 AND contact_id=$2', [req.userId, req.params.id]);
    res.json({ ok: true });
});
exports.default = router;
//# sourceMappingURL=users.js.map