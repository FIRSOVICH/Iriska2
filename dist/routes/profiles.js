"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const upload_1 = require("../utils/upload");
const router = (0, express_1.Router)();
// GET /api/profiles/:userId
router.get('/:userId', auth_1.auth, async (req, res) => {
    try {
        const { rows } = await (0, pool_1.query)(`SELECT u.id, u.name, u.username, u.avatar_url, u.created_at,
              p.status_preset, p.mood, p.music_track, p.music_artist, p.game_name,
              p.hide_online, p.cover_url, p.bg_url, p.bio,
              json_agg(json_build_object(
                'name', a.name, 'icon', a.icon, 'rarity', a.rarity, 'unlocked_at', ua.unlocked_at
              )) FILTER (WHERE a.id IS NOT NULL) as achievements
       FROM users u
       LEFT JOIN user_profiles p ON p.user_id=u.id
       LEFT JOIN user_achievements ua ON ua.user_id=u.id
       LEFT JOIN achievements a ON a.id=ua.achievement_id
       WHERE u.id=$1
       GROUP BY u.id, p.user_id`, [req.params.userId]);
        if (!rows[0])
            return res.status(404).json({ error: 'Не найден' });
        res.json(rows[0]);
    }
    catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});
// PATCH /api/profiles/me
router.patch('/me', auth_1.auth, async (req, res) => {
    const { statusPreset, mood, musicTrack, musicArtist, gameName, hideOnline, bio } = req.body;
    const fields = [];
    const vals = [];
    let idx = 1;
    const map = {
        status_preset: statusPreset, mood, music_track: musicTrack,
        music_artist: musicArtist, game_name: gameName, hide_online: hideOnline, bio
    };
    for (const [col, val] of Object.entries(map)) {
        if (val !== undefined) {
            fields.push(`${col}=$${idx++}`);
            vals.push(val);
        }
    }
    if (!fields.length)
        return res.json({ ok: true });
    vals.push(req.userId);
    try {
        await (0, pool_1.query)(`INSERT INTO user_profiles (user_id) VALUES ($${idx}) ON CONFLICT (user_id) DO NOTHING`, [req.userId]);
        await (0, pool_1.query)(`UPDATE user_profiles SET ${fields.join(',')}, updated_at=NOW() WHERE user_id=$${idx}`, vals);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});
// POST /api/profiles/me/cover
router.post('/me/cover', auth_1.auth, upload_1.upload.single('cover'), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: 'Файл не загружен' });
    const url = `/uploads/${req.file.filename}`;
    await (0, pool_1.query)('INSERT INTO user_profiles (user_id, cover_url) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET cover_url=$2', [req.userId, url]);
    res.json({ cover_url: url });
});
// POST /api/profiles/me/bg
router.post('/me/bg', auth_1.auth, upload_1.upload.single('bg'), async (req, res) => {
    if (!req.file)
        return res.status(400).json({ error: 'Файл не загружен' });
    const url = `/uploads/${req.file.filename}`;
    await (0, pool_1.query)('INSERT INTO user_profiles (user_id, bg_url) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET bg_url=$2', [req.userId, url]);
    res.json({ bg_url: url });
});
// GET /api/profiles/me/theme
router.get('/me/theme', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)('SELECT * FROM user_theme WHERE user_id=$1', [req.userId]);
    res.json(rows[0] || {});
});
// PATCH /api/profiles/me/theme
router.patch('/me/theme', auth_1.auth, async (req, res) => {
    const { theme, font, accentColor, bubbleStyle, cozyMode, wallpaper } = req.body;
    try {
        await (0, pool_1.query)(`INSERT INTO user_theme (user_id, theme, font, accent_color, bubble_style, cozy_mode, wallpaper)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id) DO UPDATE SET
         theme=COALESCE($2, user_theme.theme),
         font=COALESCE($3, user_theme.font),
         accent_color=COALESCE($4, user_theme.accent_color),
         bubble_style=COALESCE($5, user_theme.bubble_style),
         cozy_mode=COALESCE($6, user_theme.cozy_mode),
         wallpaper=COALESCE($7, user_theme.wallpaper),
         updated_at=NOW()`, [req.userId, theme || null, font || null, accentColor || null, bubbleStyle || null, cozyMode || null, wallpaper ?? null]);
        res.json({ ok: true });
    }
    catch (e) {
        res.status(500).json({ error: 'Ошибка' });
    }
});
// GET /api/profiles/me/achievements
router.get('/me/achievements', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)(`SELECT a.id, a.name, a.description, a.icon, a.rarity, ua.unlocked_at
     FROM achievements a
     LEFT JOIN user_achievements ua ON ua.achievement_id=a.id AND ua.user_id=$1
     ORDER BY a.rarity DESC, a.name`, [req.userId]);
    res.json(rows);
});
exports.default = router;
//# sourceMappingURL=profiles.js.map