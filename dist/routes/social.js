"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// ===== ЛЕНТА / ИНВАЙТЫ =====
router.get('/feed', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)(`SELECT af.*, u.name as actor_name, u.avatar_url as actor_avatar
     FROM activity_feed af JOIN users u ON u.id=af.actor_id
     WHERE af.user_id=$1 ORDER BY af.created_at DESC LIMIT 50`, [req.userId]);
    res.json(rows);
});
router.post('/join/:inviteLink', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)('SELECT id FROM chats WHERE invite_code=$1', [req.params.inviteLink]);
    if (!rows[0])
        return res.status(404).json({ error: 'Ссылка не найдена' });
    await (0, pool_1.query)('INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [rows[0].id, req.userId]);
    res.json({ chat_id: rows[0].id });
});
exports.default = router;
//# sourceMappingURL=social.js.map