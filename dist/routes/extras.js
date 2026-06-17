"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendPushToUser = sendPushToUser;
const express_1 = require("express");
const web_push_1 = __importDefault(require("web-push"));
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// Инициализация VAPID
if (process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY) {
    web_push_1.default.setVapidDetails(`mailto:${process.env.VAPID_EMAIL || 'push@iriska.app'}`, process.env.VAPID_PUBLIC_KEY, process.env.VAPID_PRIVATE_KEY);
}
// ===== МОМЕНТЫ =====
router.get('/moments', auth_1.auth, async (req, res) => {
    const now = new Date();
    // Год назад
    const yearAgo = await (0, pool_1.query)(`SELECT m.id, m.text, m.created_at, u.name as peer_name
     FROM messages m JOIN users u ON u.id=m.user_id
     WHERE m.user_id=$1 AND m.is_deleted=FALSE
       AND m.created_at BETWEEN NOW()-INTERVAL'1 year'-INTERVAL'3 days' AND NOW()-INTERVAL'1 year'+INTERVAL'3 days'
     ORDER BY RANDOM() LIMIT 5`, [req.userId]);
    // Месяц назад
    const monthAgo = await (0, pool_1.query)(`SELECT m.id, m.text, m.created_at
     FROM messages m WHERE m.user_id=$1 AND m.is_deleted=FALSE
       AND m.created_at BETWEEN NOW()-INTERVAL'30 days'-INTERVAL'1 day' AND NOW()-INTERVAL'30 days'+INTERVAL'1 day'
     ORDER BY RANDOM() LIMIT 5`, [req.userId]);
    // Топ по реакциям
    const top = await (0, pool_1.query)(`SELECT m.id, m.text, m.created_at, COUNT(mr.id)::int as reaction_count
     FROM messages m JOIN message_reactions mr ON mr.message_id=m.id
     WHERE m.user_id=$1 AND m.is_deleted=FALSE
       AND m.created_at > NOW()-INTERVAL'365 days'
     GROUP BY m.id HAVING COUNT(mr.id)>=3
     ORDER BY reaction_count DESC LIMIT 10`, [req.userId]);
    res.json({ year_ago: yearAgo.rows, month_ago: monthAgo.rows, top_reactions: top.rows });
});
router.get('/moments/unseen', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)('SELECT COUNT(*)::int as count FROM moments WHERE user_id=$1 AND seen=FALSE', [req.userId]);
    res.json({ count: rows[0].count });
});
// ===== PWA PUSH =====
router.get('/push/vapid', (_req, res) => {
    res.json({ publicKey: process.env.VAPID_PUBLIC_KEY || '' });
});
router.post('/push/subscribe', auth_1.auth, async (req, res) => {
    const { endpoint, keys } = req.body;
    if (!endpoint || !keys)
        return res.status(400).json({ error: 'endpoint и keys обязательны' });
    await (0, pool_1.query)(`INSERT INTO push_subscriptions (user_id, endpoint, keys) VALUES ($1,$2,$3)
     ON CONFLICT (endpoint) DO UPDATE SET keys=$3`, [req.userId, endpoint, JSON.stringify(keys)]);
    res.json({ ok: true });
});
router.post('/push/unsubscribe', auth_1.auth, async (req, res) => {
    await (0, pool_1.query)('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2', [req.body.endpoint, req.userId]);
    res.json({ ok: true });
});
// ===== БУНКЕР =====
router.post('/bunker/:chatId', auth_1.auth, async (req, res) => {
    const { destructSec, noForward } = req.body;
    await (0, pool_1.query)(`INSERT INTO bunker_sessions (chat_id, destruct_sec, no_forward, created_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (chat_id) DO UPDATE SET destruct_sec=$2, no_forward=$3`, [req.params.chatId, destructSec || 30, noForward ?? true, req.userId]);
    await (0, pool_1.query)('UPDATE chats SET updated_at=NOW() WHERE id=$1', [req.params.chatId]);
    res.json({ ok: true });
});
router.delete('/bunker/:chatId', auth_1.auth, async (req, res) => {
    await (0, pool_1.query)('DELETE FROM bunker_sessions WHERE chat_id=$1 AND created_by=$2', [req.params.chatId, req.userId]);
    res.json({ ok: true });
});
router.get('/bunker/:chatId', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)('SELECT * FROM bunker_sessions WHERE chat_id=$1', [req.params.chatId]);
    res.json(rows[0] || null);
});
// Экспортируем sendPushToUser для использования в socket
async function sendPushToUser(userId, title, body, data = {}) {
    if (!process.env.VAPID_PUBLIC_KEY)
        return;
    try {
        const { rows } = await (0, pool_1.query)('SELECT endpoint, keys FROM push_subscriptions WHERE user_id=$1', [userId]);
        for (const sub of rows) {
            try {
                await web_push_1.default.sendNotification({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify({ title, body, data }));
            }
            catch (e) {
                if (e.statusCode === 410) {
                    await (0, pool_1.query)('DELETE FROM push_subscriptions WHERE endpoint=$1', [sub.endpoint]);
                }
            }
        }
    }
    catch { }
}
exports.default = router;
//# sourceMappingURL=extras.js.map