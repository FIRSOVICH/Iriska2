"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const pool_1 = require("../db/pool");
const auth_1 = require("../middleware/auth");
const router = (0, express_1.Router)();
// POST /api/e2e/keys — регистрируем публичный ключ устройства
router.post('/keys', auth_1.auth, async (req, res) => {
    const { deviceId, publicKey, signature } = req.body;
    if (!deviceId || !publicKey)
        return res.status(400).json({ error: 'deviceId и publicKey обязательны' });
    await (0, pool_1.query)(`INSERT INTO e2e_keys (user_id, device_id, public_key) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, device_id) DO UPDATE SET public_key=$3, created_at=NOW()`, [req.userId, deviceId, publicKey]);
    res.json({ ok: true });
});
// GET /api/e2e/keys/:userId
router.get('/keys/:userId', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)('SELECT device_id, public_key, created_at FROM e2e_keys WHERE user_id=$1', [req.params.userId]);
    res.json(rows);
});
// POST /api/e2e/enable/:chatId — включаем E2E для чата
router.post('/enable/:chatId', auth_1.auth, async (req, res) => {
    const mem = await (0, pool_1.query)('SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2', [req.params.chatId, req.userId]);
    if (!mem.rows[0])
        return res.status(403).json({ error: 'Нет доступа' });
    await (0, pool_1.query)('UPDATE chats SET e2e_enabled=TRUE WHERE id=$1', [req.params.chatId]);
    res.json({ ok: true });
});
// POST /api/e2e/envelopes — загружаем зашифрованные ключи для получателей
router.post('/envelopes', auth_1.auth, async (req, res) => {
    const { messageId, envelopes } = req.body;
    if (!messageId || !envelopes?.length)
        return res.status(400).json({ error: 'messageId и envelopes обязательны' });
    for (const env of envelopes) {
        await (0, pool_1.query)(`INSERT INTO message_envelopes (message_id, recipient_id, encrypted_key) VALUES ($1,$2,$3)
       ON CONFLICT (message_id, recipient_id) DO UPDATE SET encrypted_key=$3`, [messageId, env.recipientId, env.encryptedKey]);
    }
    res.json({ ok: true });
});
// GET /api/e2e/envelopes/:msgId
router.get('/envelopes/:msgId', auth_1.auth, async (req, res) => {
    const { rows } = await (0, pool_1.query)('SELECT encrypted_key FROM message_envelopes WHERE message_id=$1 AND recipient_id=$2', [req.params.msgId, req.userId]);
    if (!rows[0])
        return res.status(404).json({ error: 'Конверт не найден' });
    res.json(rows[0]);
});
exports.default = router;
//# sourceMappingURL=e2e.js.map