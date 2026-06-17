import { Router, Response } from 'express';
import { query } from '../db/pool';
import { auth, AuthRequest } from '../middleware/auth';

const router = Router();

// ===== ЛЕНТА / ИНВАЙТЫ =====
router.get('/feed', auth, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    `SELECT af.*, u.name as actor_name, u.avatar_url as actor_avatar
     FROM activity_feed af JOIN users u ON u.id=af.actor_id
     WHERE af.user_id=$1 ORDER BY af.created_at DESC LIMIT 50`,
    [req.userId]
  );
  res.json(rows);
});

router.post('/join/:inviteLink', auth, async (req: AuthRequest, res: Response) => {
  const { rows } = await query('SELECT id FROM chats WHERE invite_code=$1', [req.params.inviteLink]);
  if (!rows[0]) return res.status(404).json({ error: 'Ссылка не найдена' });
  await query(
    'INSERT INTO chat_members (chat_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
    [rows[0].id, req.userId]
  );
  res.json({ chat_id: rows[0].id });
});

export default router;
