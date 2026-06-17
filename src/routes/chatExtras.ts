import { Router, Response } from 'express';
import { query } from '../db/pool';
import { auth, AuthRequest } from '../middleware/auth';

const router = Router();

// ===== ОПРОСЫ =====
router.get('/:id/polls', auth, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    `SELECT p.*, json_agg(json_build_object(
      'id', po.id, 'text', po.text,
      'votes', (SELECT COUNT(*) FROM poll_votes WHERE option_id=po.id)::int,
      'voted', EXISTS(SELECT 1 FROM poll_votes WHERE option_id=po.id AND user_id=$2)
    ) ORDER BY po.sort_order) as options
     FROM polls p JOIN poll_options po ON po.poll_id=p.id
     WHERE p.chat_id=$1 GROUP BY p.id ORDER BY p.created_at DESC`,
    [req.params.id, req.userId]
  );
  res.json(rows);
});

router.post('/:id/polls', auth, async (req: AuthRequest, res: Response) => {
  const { question, options, isMultiple } = req.body;
  if (!question || !options?.length) return res.status(400).json({ error: 'question и options обязательны' });
  const { rows } = await query(
    `INSERT INTO polls (chat_id, created_by, question, is_multiple) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.id, req.userId, question, isMultiple || false]
  );
  const poll = rows[0];
  for (let i = 0; i < options.length; i++) {
    await query(
      'INSERT INTO poll_options (poll_id, text, sort_order) VALUES ($1,$2,$3)',
      [poll.id, options[i], i]
    );
  }
  res.status(201).json(poll);
});

router.post('/:id/polls/:pollId/vote', auth, async (req: AuthRequest, res: Response) => {
  const { optionIds } = req.body;
  if (!optionIds?.length) return res.status(400).json({ error: 'optionIds обязателен' });
  const poll = await query('SELECT * FROM polls WHERE id=$1', [req.params.pollId]);
  if (!poll.rows[0]) return res.status(404).json({ error: 'Опрос не найден' });
  if (poll.rows[0].is_closed) return res.status(400).json({ error: 'Опрос закрыт' });
  // Удаляем старые голоса
  await query('DELETE FROM poll_votes WHERE poll_id=$1 AND user_id=$2', [req.params.pollId, req.userId]);
  const toVote = poll.rows[0].is_multiple ? optionIds : [optionIds[0]];
  for (const oid of toVote) {
    await query(
      'INSERT INTO poll_votes (poll_id, option_id, user_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
      [req.params.pollId, oid, req.userId]
    );
  }
  res.json({ ok: true });
});

// ===== ЗАКРЕПЛЁННЫЕ =====
router.get('/:id/pins', auth, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    `SELECT pm.*, m.text, m.type, m.file_url, m.created_at as msg_at, u.name as pinned_by_name
     FROM pinned_messages pm
     JOIN messages m ON m.id=pm.message_id
     JOIN users u ON u.id=pm.pinned_by
     WHERE pm.chat_id=$1 ORDER BY pm.pinned_at DESC`,
    [req.params.id]
  );
  res.json(rows);
});

router.post('/:id/pins/:msgId', auth, async (req: AuthRequest, res: Response) => {
  await query(
    'INSERT INTO pinned_messages (chat_id, message_id, pinned_by) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING',
    [req.params.id, req.params.msgId, req.userId]
  );
  res.json({ ok: true });
});

router.delete('/:id/pins/:msgId', auth, async (req: AuthRequest, res: Response) => {
  await query('DELETE FROM pinned_messages WHERE chat_id=$1 AND message_id=$2', [req.params.id, req.params.msgId]);
  res.json({ ok: true });
});

// ===== ПОИСК =====
router.get('/:id/search', auth, async (req: AuthRequest, res: Response) => {
  const q = (req.query.q as string || '').trim();
  if (!q) return res.json([]);
  const { rows } = await query(
    `SELECT m.id, m.text, m.created_at, u.name as user_name
     FROM messages m JOIN users u ON u.id=m.user_id
     WHERE m.chat_id=$1 AND m.is_deleted=FALSE
       AND to_tsvector('russian', COALESCE(m.text,'')) @@ plainto_tsquery('russian', $2)
     ORDER BY m.created_at DESC LIMIT 50`,
    [req.params.id, q]
  );
  res.json(rows);
});

// ===== ЗАМЕТКИ =====
router.get('/:id/note', auth, async (req: AuthRequest, res: Response) => {
  const { rows } = await query('SELECT * FROM shared_notes WHERE chat_id=$1', [req.params.id]);
  res.json(rows[0] || { content: '' });
});

router.put('/:id/note', auth, async (req: AuthRequest, res: Response) => {
  const { content, diff } = req.body;
  const { rows } = await query(
    `INSERT INTO shared_notes (chat_id, content, updated_by) VALUES ($1,$2,$3)
     ON CONFLICT (chat_id) DO UPDATE SET content=$2, updated_by=$3, updated_at=NOW()
     RETURNING *`,
    [req.params.id, content, req.userId]
  );
  if (diff) {
    await query(
      'INSERT INTO note_history (note_id, user_id, diff) VALUES ($1,$2,$3)',
      [rows[0].id, req.userId, diff]
    );
  }
  res.json(rows[0]);
});

// ===== ТАЙМ-КАПСУЛЫ =====
router.post('/:id/capsule', auth, async (req: AuthRequest, res: Response) => {
  const { text, openAt } = req.body;
  if (!text || !openAt) return res.status(400).json({ error: 'text и openAt обязательны' });
  const { rows } = await query(
    `INSERT INTO time_capsules (chat_id, created_by, text, open_at) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.id, req.userId, text, openAt]
  );
  res.status(201).json(rows[0]);
});

router.get('/:id/capsules', auth, async (req: AuthRequest, res: Response) => {
  const { rows } = await query(
    `SELECT tc.*, u.name as creator_name,
            CASE WHEN NOW() >= tc.open_at THEN tc.text ELSE NULL END as revealed_text
     FROM time_capsules tc JOIN users u ON u.id=tc.created_by
     WHERE tc.chat_id=$1 ORDER BY tc.open_at ASC`,
    [req.params.id]
  );
  // Отмечаем открытые
  await query(
    'UPDATE time_capsules SET opened=TRUE WHERE chat_id=$1 AND open_at <= NOW() AND opened=FALSE',
    [req.params.id]
  );
  res.json(rows);
});

export default router;
