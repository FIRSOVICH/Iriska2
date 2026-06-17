import { Router, Response } from 'express';
import { query } from '../db/pool';
import { auth, AuthRequest } from '../middleware/auth';
import { upload } from '../utils/upload';

const router = Router();

const MSG_SELECT = `
  SELECT m.id, m.chat_id, m.user_id, m.type, m.text, m.file_url, m.file_name,
         m.file_size, m.duration, m.reply_to_id, m.is_edited, m.is_deleted,
         m.self_destruct_after, m.no_forward, m.created_at, m.updated_at,
         u.name as user_name, u.username, u.avatar_url,
         (SELECT json_build_object('id',r.id,'text',r.text,'user_name',ru.name)
          FROM messages r JOIN users ru ON ru.id=r.user_id WHERE r.id=m.reply_to_id) as reply_to,
         COALESCE(json_agg(json_build_object('emoji',mr.emoji,'user_id',mr.user_id))
           FILTER (WHERE mr.id IS NOT NULL), '[]') as reactions
  FROM messages m
  JOIN users u ON u.id=m.user_id
  LEFT JOIN message_reactions mr ON mr.message_id=m.id
`;

// GET /api/chats/:id/messages
router.get('/:id/messages', auth, async (req: AuthRequest, res: Response) => {
  const { before, limit = 50 } = req.query;
  try {
    const isMember = await query('SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2', [req.params.id, req.userId]);
    if (!isMember.rows[0]) return res.status(403).json({ error: 'Нет доступа' });

    const conditions = [`m.chat_id=$1`];
    const vals: unknown[] = [req.params.id];
    if (before) { conditions.push(`m.created_at < $${vals.length + 1}`); vals.push(before); }

    const { rows } = await query(
      `${MSG_SELECT} WHERE ${conditions.join(' AND ')} AND m.is_deleted=FALSE
       GROUP BY m.id, u.name, u.username, u.avatar_url
       ORDER BY m.created_at DESC LIMIT $${vals.length + 1}`,
      [...vals, Number(limit)]
    );
    res.json(rows.reverse());
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

// POST /api/chats/:id/messages
router.post('/:id/messages', auth, async (req: AuthRequest, res: Response) => {
  const { type = 'text', text, replyToId } = req.body;
  if (!text && type === 'text') return res.status(400).json({ error: 'Текст обязателен' });
  try {
    const isMember = await query('SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2', [req.params.id, req.userId]);
    if (!isMember.rows[0]) return res.status(403).json({ error: 'Нет доступа' });

    const { rows } = await query(
      `INSERT INTO messages (chat_id, user_id, type, text, reply_to_id)
       VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [req.params.id, req.userId, type, text || null, replyToId || null]
    );
    // обновим updated_at чата
    await query('UPDATE chats SET updated_at=NOW() WHERE id=$1', [req.params.id]);

    const msg = await query(`${MSG_SELECT} WHERE m.id=$1 GROUP BY m.id,u.name,u.username,u.avatar_url`, [rows[0].id]);
    res.status(201).json(msg.rows[0]);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

// POST /api/chats/:id/messages/upload
router.post('/:id/messages/upload', auth, upload.single('file'), async (req: AuthRequest, res: Response) => {
  if (!req.file) return res.status(400).json({ error: 'Файл не загружен' });
  const { type = 'file', duration } = req.body;
  const url = `/uploads/${req.file.filename}`;
  try {
    const { rows } = await query(
      `INSERT INTO messages (chat_id, user_id, type, file_url, file_name, file_size, duration)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [req.params.id, req.userId, type, url, req.file.originalname, req.file.size, duration || null]
    );
    await query('UPDATE chats SET updated_at=NOW() WHERE id=$1', [req.params.id]);
    const msg = await query(`${MSG_SELECT} WHERE m.id=$1 GROUP BY m.id,u.name,u.username,u.avatar_url`, [rows[0].id]);
    res.status(201).json(msg.rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// PATCH /api/chats/:id/messages/:msgId
router.patch('/:id/messages/:msgId', auth, async (req: AuthRequest, res: Response) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'Текст обязателен' });
  try {
    const { rows } = await query(
      `UPDATE messages SET text=$1, is_edited=TRUE, updated_at=NOW()
       WHERE id=$2 AND user_id=$3 AND chat_id=$4 RETURNING *`,
      [text, req.params.msgId, req.userId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// DELETE /api/chats/:id/messages/:msgId
router.delete('/:id/messages/:msgId', auth, async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await query(
      `UPDATE messages SET is_deleted=TRUE, text=NULL, file_url=NULL, updated_at=NOW()
       WHERE id=$1 AND user_id=$2 AND chat_id=$3 RETURNING id`,
      [req.params.msgId, req.userId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Не найдено' });
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// POST /api/chats/:id/messages/read
router.post('/:id/messages/read', auth, async (req: AuthRequest, res: Response) => {
  const { upToMessageId } = req.body;
  try {
    // Отмечаем все сообщения до upToMessageId как прочитанные
    const { rows: toRead } = await query(
      `SELECT id FROM messages WHERE chat_id=$1 AND user_id != $2 AND is_deleted=FALSE
       AND created_at <= (SELECT created_at FROM messages WHERE id=$3)`,
      [req.params.id, req.userId, upToMessageId]
    );
    for (const m of toRead) {
      await query(
        'INSERT INTO message_reads (message_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [m.id, req.userId]
      );
    }
    res.json({ ok: true, count: toRead.length });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// POST /api/chats/:id/messages/:msgId/reactions
router.post('/:id/messages/:msgId/reactions', auth, async (req: AuthRequest, res: Response) => {
  const { emoji } = req.body;
  if (!emoji) return res.status(400).json({ error: 'emoji обязателен' });
  try {
    // Тогл: если уже есть — удаляем, нет — добавляем
    const existing = await query(
      'SELECT id FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
      [req.params.msgId, req.userId, emoji]
    );
    if (existing.rows[0]) {
      await query('DELETE FROM message_reactions WHERE id=$1', [existing.rows[0].id]);
      return res.json({ action: 'removed' });
    }
    await query(
      'INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)',
      [req.params.msgId, req.userId, emoji]
    );
    res.json({ action: 'added' });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

export default router;
