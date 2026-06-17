import { Router, Response } from 'express';
import { query } from '../db/pool';
import { auth, AuthRequest } from '../middleware/auth';

const router = Router();

// POST /api/e2e/keys — регистрируем публичный ключ устройства
router.post('/keys', auth, async (req: AuthRequest, res: Response) => {
  const { deviceId, publicKey, signature } = req.body;
  if (!deviceId || !publicKey) return res.status(400).json({ error: 'deviceId и publicKey обязательны' });
  await query(
    `INSERT INTO e2e_keys (user_id, device_id, public_key) VALUES ($1,$2,$3)
     ON CONFLICT (user_id, device_id) DO UPDATE SET public_key=$3, created_at=NOW()`,
    [req.userId, deviceId, publicKey]
  );
  res.json({ ok: true });
});

// GET /api/e2e/keys/:userId
router.get('/keys/:userId', auth, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    'SELECT device_id, public_key, created_at FROM e2e_keys WHERE user_id=$1',
    [req.params.userId]
  );
  res.json(rows);
});

// POST /api/e2e/enable/:chatId — включаем E2E для чата
router.post('/enable/:chatId', auth, async (req: AuthRequest, res: Response) => {
  const mem = await query('SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2', [req.params.chatId, req.userId]);
  if (!mem.rows[0]) return res.status(403).json({ error: 'Нет доступа' });
  await query('UPDATE chats SET e2e_enabled=TRUE WHERE id=$1', [req.params.chatId]);
  res.json({ ok: true });
});

// POST /api/e2e/envelopes — загружаем зашифрованные ключи для получателей
router.post('/envelopes', auth, async (req: AuthRequest, res: Response) => {
  const { messageId, envelopes } = req.body;
  if (!messageId || !envelopes?.length) return res.status(400).json({ error: 'messageId и envelopes обязательны' });
  for (const env of envelopes) {
    await query(
      `INSERT INTO message_envelopes (message_id, recipient_id, encrypted_key) VALUES ($1,$2,$3)
       ON CONFLICT (message_id, recipient_id) DO UPDATE SET encrypted_key=$3`,
      [messageId, env.recipientId, env.encryptedKey]
    );
  }
  res.json({ ok: true });
});

// GET /api/e2e/envelopes/:msgId
router.get('/envelopes/:msgId', auth, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    'SELECT encrypted_key FROM message_envelopes WHERE message_id=$1 AND recipient_id=$2',
    [req.params.msgId, req.userId]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Конверт не найден' });
  res.json(rows[0]);
});

export default router;
