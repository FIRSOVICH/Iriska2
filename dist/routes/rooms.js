"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// GET /api/rooms
router.get('/', auth_1.auth, async (req, res) => {
    const type = req.query.type;
    const cond = type ? `AND r.type=$2` : '';
    const vals = type ? [true, type] : [true];
    const { rows } = await (0, pool_1.query)(`SELECT r.*, u.name as creator_name,
            (SELECT COUNT(*) FROM room_members WHERE room_id=r.id)::int as member_count
     FROM rooms r JOIN users u ON u.id=r.created_by
     WHERE r.is_active=$1 ${cond}
     ORDER BY r.created_at DESC`, vals);
    res.json(rows);
});
// POST /api/rooms
router.post('/', auth_1.auth, async (req, res) => {
    const { type, name, topic } = req.body;
    if (!type || !name)
        return res.status(400).json({ error: 'type и name обязательны' });
    const slug = name.toLowerCase().replace(/[^a-zа-я0-9]/gi, '-') + '-' + Math.random().toString(36).slice(2, 6);
    const { rows } = await (0, pool_1.query)(`INSERT INTO rooms (type, name, topic, slug, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [type, name, topic || null, slug, req.userId]);
    await (0, pool_1.query)('INSERT INTO room_members (room_id, user_id) VALUES ($1,$2)', [rows[0].id, req.userId]);
    res.status(201).json(rows[0]);
});
// POST /api/rooms/join/:slug
router.post('/join/:slug', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)('SELECT id FROM rooms WHERE slug=$1 AND is_active=TRUE', [req.params.slug]);
    if (!rows[0])
        return res.status(404).json({ error: 'Комната не найдена' });
    await (0, pool_1.query)('INSERT INTO room_members (room_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, req.userId]);
    res.json({ room_id: rows[0].id });
});
// GET /api/rooms/:id
router.get('/:id', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)(`SELECT r.*,
            json_agg(json_build_object('user_id',rm.user_id,'name',u.name,'avatar_url',u.avatar_url)) as members,
            (SELECT json_agg(json_build_object('id',m.id,'text',m.text,'user_name',u2.name,'created_at',m.created_at))
             FROM (SELECT * FROM room_messages WHERE room_id=r.id ORDER BY created_at DESC LIMIT 50) m
             JOIN users u2 ON u2.id=m.user_id) as messages
     FROM rooms r
     JOIN room_members rm ON rm.room_id=r.id
     JOIN users u ON u.id=rm.user_id
     WHERE r.id=$1
     GROUP BY r.id`, [req.params.id]);
    if (!rows[0])
        return res.status(404).json({ error: 'Нет' });
    res.json(rows[0]);
});
// POST /api/rooms/:id/leave
router.post('/:id/leave', auth_1.auth, async (req, res) => {
    await (0, pool_1.query)('DELETE FROM room_members WHERE room_id=$1 AND user_id=$2', [req.params.id, req.userId]);
    res.json({ ok: true });
});
// PATCH /api/rooms/:id/playback
router.patch('/:id/playback', auth_1.auth, async (req, res) => {
    await (0, pool_1.query)('UPDATE rooms SET playback_state=$1 WHERE id=$2', [req.body.state, req.params.id]);
    res.json({ ok: true });
});
// DELETE /api/rooms/:id
router.delete('/:id', auth_1.auth, async (req, res) => {
    await (0, pool_1.query)('UPDATE rooms SET is_active=FALSE WHERE id=$1 AND created_by=$2', [req.params.id, req.userId]);
    res.json({ ok: true });
});
exports.default = router;
//# sourceMappingURL=rooms.js.map