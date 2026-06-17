"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// POST /api/pokes
router.post('/', auth_1.auth, async (req, res) => {
    const { toId, type } = req.body;
    if (!toId || !type)
        return res.status(400).json({ error: 'toId и type обязательны' });
    // Проверяем кулдаун 30 секунд
    const recent = await (0, pool_1.query)(`SELECT id FROM pokes WHERE from_id=$1 AND to_id=$2 AND created_at > NOW() - INTERVAL '30 seconds'`, [req.userId, toId]);
    if (recent.rows[0])
        return res.status(429).json({ error: 'Подождите 30 секунд' });
    const { rows } = await (0, pool_1.query)(`INSERT INTO pokes (from_id, to_id, type) VALUES ($1,$2,$3) RETURNING *`, [req.userId, toId, type]);
    res.status(201).json(rows[0]);
});
// GET /api/pokes/inbox
router.get('/inbox', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)(`SELECT p.*, u.name as from_name, u.avatar_url as from_avatar
     FROM pokes p JOIN users u ON u.id=p.from_id
     WHERE p.to_id=$1 ORDER BY p.created_at DESC LIMIT 50`, [req.userId]);
    res.json(rows);
});
// GET /api/pokes/inbox/count
router.get('/inbox/count', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)('SELECT COUNT(*)::int as count FROM pokes WHERE to_id=$1 AND seen=FALSE', [req.userId]);
    await (0, pool_1.query)('UPDATE pokes SET seen=TRUE WHERE to_id=$1 AND seen=FALSE', [req.userId]);
    res.json({ count: rows[0].count });
});
exports.default = router;
//# sourceMappingURL=pokes.js.map