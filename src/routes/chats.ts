import { Router, Response } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../db/pool';
import { auth, AuthRequest } from '../middleware/auth';

const router = Router();

// GET /api/chats
router.get('/', auth, async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await query(
      `SELECT c.id, c.type, c.name, c.avatar_url, c.e2e_enabled, c.invite_code,
              cm.role,
              (SELECT row_to_json(m) FROM (
                SELECT msg.id, msg.type, msg.text, msg.file_url, msg.user_id, msg.created_at,
                       u2.name as user_name
                FROM messages msg
                JOIN users u2 ON u2.id = msg.user_id
                WHERE msg.chat_id = c.id AND msg.is_deleted=FALSE
                ORDER BY msg.created_at DESC LIMIT 1
              ) m) as last_message,
              (SELECT COUNT(*) FROM messages msg2
               LEFT JOIN message_reads mr ON mr.message_id=msg2.id AND mr.user_id=$1
               WHERE msg2.chat_id=c.id AND msg2.user_id != $1 AND msg2.is_deleted=FALSE AND mr.id IS NULL
              )::int as unread_count,
              CASE WHEN c.type='dm' THEN (
                SELECT row_to_json(u3) FROM (
                  SELECT u3.id, u3.name, u3.username, u3.avatar_url
                  FROM chat_members cm2 JOIN users u3 ON u3.id=cm2.user_id
                  WHERE cm2.chat_id=c.id AND cm2.user_id != $1 LIMIT 1
                ) u3
              ) END as peer
       FROM chats c
       JOIN chat_members cm ON cm.chat_id=c.id AND cm.user_id=$1
       ORDER BY (SELECT created_at FROM messages WHERE chat_id=c.id AND is_deleted=FALSE ORDER BY created_at DESC LIMIT 1) DESC NULLS LAST`,
      [req.userId]
    );
    res.json(rows);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

// POST /api/chats/dm
router.post('/dm', auth, async (req: AuthRequest, res: Response) => {
  const { userId } = req.body;
  if (!userId) return res.status(400).json({ error: 'userId обязателен' });
  try {
    // Проверяем существующий DM
    const existing = await query(
      `SELECT c.id FROM chats c
       JOIN chat_members cm1 ON cm1.chat_id=c.id AND cm1.user_id=$1
       JOIN chat_members cm2 ON cm2.chat_id=c.id AND cm2.user_id=$2
       WHERE c.type='dm'
       LIMIT 1`,
      [req.userId, userId]
    );
    if (existing.rows[0]) return res.json(existing.rows[0]);

    const { rows } = await query(
      `INSERT INTO chats (type, created_by) VALUES ('dm', $1) RETURNING *`,
      [req.userId]
    );
    const chat = rows[0];
    await query('INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,$3),($1,$4,$3)',
      [chat.id, req.userId, 'member', userId]);
    res.status(201).json(chat);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

// POST /api/chats/group
router.post('/group', auth, async (req: AuthRequest, res: Response) => {
  const { name, memberIds, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Название обязательно' });
  try {
    const { rows } = await query(
      `INSERT INTO chats (type, name, description, created_by, invite_code)
       VALUES ('group', $1, $2, $3, $4) RETURNING *`,
      [name, description || null, req.userId, uuidv4().slice(0, 8).toUpperCase()]
    );
    const chat = rows[0];
    const ids = [req.userId, ...(memberIds || [])].filter((v, i, a) => a.indexOf(v) === i);
    for (const uid of ids) {
      const role = uid === req.userId ? 'owner' : 'member';
      await query('INSERT INTO chat_members (chat_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [chat.id, uid, role]);
    }
    res.status(201).json(chat);
  } catch (e) { console.error(e); res.status(500).json({ error: 'Ошибка' }); }
});

// GET /api/chats/:id
router.get('/:id', auth, async (req: AuthRequest, res: Response) => {
  try {
    const { rows } = await query(
      `SELECT c.*, cm.role,
              json_agg(json_build_object(
                'user_id', cm2.user_id, 'role', cm2.role, 'name', u.name, 'username', u.username, 'avatar_url', u.avatar_url
              )) as members
       FROM chats c
       JOIN chat_members cm ON cm.chat_id=c.id AND cm.user_id=$2
       JOIN chat_members cm2 ON cm2.chat_id=c.id
       JOIN users u ON u.id=cm2.user_id
       WHERE c.id=$1
       GROUP BY c.id, cm.role`,
      [req.params.id, req.userId]
    );
    if (!rows[0]) return res.status(404).json({ error: 'Не найден' });
    res.json(rows[0]);
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// POST /api/chats/:id/members
router.post('/:id/members', auth, async (req: AuthRequest, res: Response) => {
  const { userId } = req.body;
  try {
    const me = await query('SELECT role FROM chat_members WHERE chat_id=$1 AND user_id=$2', [req.params.id, req.userId]);
    if (!me.rows[0] || !['owner','admin'].includes(me.rows[0].role)) {
      return res.status(403).json({ error: 'Нет прав' });
    }
    await query('INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, userId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// DELETE /api/chats/:id/members/:userId
router.delete('/:id/members/:userId', auth, async (req: AuthRequest, res: Response) => {
  try {
    const me = await query('SELECT role FROM chat_members WHERE chat_id=$1 AND user_id=$2', [req.params.id, req.userId]);
    const isAdmin = me.rows[0] && ['owner','admin'].includes(me.rows[0].role);
    const isSelf = req.params.userId === req.userId;
    if (!isAdmin && !isSelf) return res.status(403).json({ error: 'Нет прав' });
    await query('DELETE FROM chat_members WHERE chat_id=$1 AND user_id=$2', [req.params.id, req.params.userId]);
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ error: 'Ошибка' }); }
});

// GET /api/chats/:id/invite
router.get('/:id/invite', auth, async (req: AuthRequest, res: Response) => {
  const { rows } = await query('SELECT invite_code FROM chats WHERE id=$1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Нет' });
  res.json({ code: rows[0].invite_code });
});

// POST /api/chats/:id/invite/reset
router.post('/:id/invite/reset', auth, async (req: AuthRequest, res: Response) => {
  const code = uuidv4().slice(0, 8).toUpperCase();
  await query('UPDATE chats SET invite_code=$1 WHERE id=$2', [code, req.params.id]);
  res.json({ code });
});

// GET /api/chats/:id/call-history
router.get('/:id/call-history', auth, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    `SELECT ca.*, json_agg(json_build_object('user_id',cp.user_id,'name',u.name)) as participants
     FROM calls ca
     JOIN call_participants cp ON cp.call_id=ca.id
     JOIN users u ON u.id=cp.user_id
     WHERE ca.chat_id=$1
     GROUP BY ca.id ORDER BY ca.created_at DESC LIMIT 50`,
    [req.params.id]
  );
  res.json(rows);
});

export default router;
