"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// ============================================================
//  stories.ts
// ============================================================
const express_1 = require("express");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const upload_1 = require("../utils/upload");
const storiesRouter = (0, express_1.Router)();
storiesRouter.get('/feed', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)(`SELECT s.*, u.name, u.username, u.avatar_url,
            (SELECT emoji FROM story_views WHERE story_id=s.id AND user_id=$1 LIMIT 1) as my_reaction,
            EXISTS(SELECT 1 FROM story_views WHERE story_id=s.id AND user_id=$1) as seen,
            (SELECT COUNT(*) FROM story_views WHERE story_id=s.id)::int as view_count
     FROM stories s
     JOIN users u ON u.id=s.user_id
     JOIN contacts c ON c.contact_id=s.user_id AND c.user_id=$1
     WHERE s.expires_at > NOW()
     ORDER BY s.created_at DESC`, [req.userId]);
    res.json(rows);
});
storiesRouter.post('/upload', auth_1.auth, upload_1.upload.single('file'), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: 'Файл не загружен' });
    const { type = 'image' } = req.body;
    const url = `/uploads/${req.file.filename}`;
    const { rows } = await (0, pool_1.query)(`INSERT INTO stories (user_id, type, media_url) VALUES ($1,$2,$3) RETURNING *`, [req.userId, type, url]);
    res.status(201).json(rows[0]);
});
storiesRouter.post('/text', auth_1.auth, async (req, res) => {
    const { text, bgColor, textColor } = req.body;
    if (!text)
        return res.status(400).json({ error: 'Текст обязателен' });
    const { rows } = await (0, pool_1.query)(`INSERT INTO stories (user_id, type, text, bg_color, text_color) VALUES ($1,'text',$2,$3,$4) RETURNING *`, [req.userId, text, bgColor || '#B87530', textColor || '#fff']);
    res.status(201).json(rows[0]);
});
storiesRouter.post('/:id/view', auth_1.auth, async (req, res) => {
    await (0, pool_1.query)('INSERT INTO story_views (story_id, user_id, emoji) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [req.params.id, req.userId, req.body.emoji || null]);
    res.json({ ok: true });
});
storiesRouter.get('/:id/viewers', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)(`SELECT sv.emoji, sv.viewed_at, u.id, u.name, u.avatar_url
     FROM story_views sv JOIN users u ON u.id=sv.user_id
     WHERE sv.story_id=$1 ORDER BY sv.viewed_at DESC`, [req.params.id]);
    res.json(rows);
});
storiesRouter.delete('/:id', auth_1.auth, async (req, res) => {
    await (0, pool_1.query)('DELETE FROM stories WHERE id=$1 AND user_id=$2', [req.params.id, req.userId]);
    res.json({ ok: true });
});
exports.default = storiesRouter;
//# sourceMappingURL=stories.js.map