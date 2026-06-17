import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { query } from '../db/pool';
import { setOnline, setOffline, isOnline } from '../db/redis';
import { sendPushToUser } from '../routes/extras';

interface AuthSocket extends Socket {
  userId?: string;
  userName?: string;
}

export function setupSocket(io: Server) {
  // Middleware: проверяем JWT
  io.use((socket: AuthSocket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.query.token;
    if (!token) return next(new Error('Нет токена'));
    try {
      const payload = jwt.verify(token as string, process.env.JWT_SECRET!) as { sub: string };
      socket.userId = payload.sub;
      next();
    } catch {
      next(new Error('Недействительный токен'));
    }
  });

  io.on('connection', async (socket: AuthSocket) => {
    const userId = socket.userId!;
    console.log(`🔌 Подключился ${userId}`);

    // Сохраняем онлайн, присоединяемся к личной комнате
    await setOnline(userId, socket.id);
    socket.join(`user:${userId}`);

    // Присоединяемся к чатам пользователя
    const { rows: chats } = await query(
      'SELECT chat_id FROM chat_members WHERE user_id=$1', [userId]
    );
    for (const c of chats) socket.join(`chat:${c.chat_id}`);

    // Сообщаем контактам что онлайн
    const { rows: contacts } = await query(
      'SELECT contact_id FROM contacts WHERE user_id=$1', [userId]
    );
    for (const c of contacts) {
      io.to(`user:${c.contact_id}`).emit('user:presence', {
        userId, online: true, lastSeen: null
      });
    }

    // ===== СООБЩЕНИЯ =====
    socket.on('chat:send', async (data: {
      chatId: string; type?: string; text?: string; fileUrl?: string;
      replyToId?: string; e2eCiphertext?: string;
    }) => {
      try {
        const { chatId, type = 'text', text, fileUrl, replyToId, e2eCiphertext } = data;
        // Проверяем членство
        const mem = await query('SELECT 1 FROM chat_members WHERE chat_id=$1 AND user_id=$2', [chatId, userId]);
        if (!mem.rows[0]) return;

        const { rows } = await query(
          `INSERT INTO messages (chat_id, user_id, type, text, file_url, reply_to_id)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [chatId, userId, type, text || null, fileUrl || null, replyToId || null]
        );
        const msgId = rows[0].id;
        await query('UPDATE chats SET updated_at=NOW() WHERE id=$1', [chatId]);

        // Полная запись для эмита
        const { rows: full } = await query(
          `SELECT m.*, u.name as user_name, u.username, u.avatar_url FROM messages m
           JOIN users u ON u.id=m.user_id WHERE m.id=$1`,
          [msgId]
        );
        const msg = { ...full[0], e2eCiphertext };

        // Рассылаем всем в чате
        io.to(`chat:${chatId}`).emit('chat:message', msg);

        // Push оффлайн-участникам
        const { rows: members } = await query(
          'SELECT user_id FROM chat_members WHERE chat_id=$1 AND user_id != $2', [chatId, userId]
        );
        const { rows: sender } = await query('SELECT name FROM users WHERE id=$1', [userId]);
        for (const m of members) {
          if (!(await isOnline(m.user_id))) {
            await sendPushToUser(m.user_id, sender[0]?.name || 'Ириска', text || '📎 Файл', { chatId, msgId });
          }
        }

        // Достижения
        const { rows: count } = await query(
          'SELECT COUNT(*)::int as c FROM messages WHERE user_id=$1', [userId]
        );
        if (count[0].c === 1) await unlockAchievement(userId, 'Первое сообщение');
        if (count[0].c === 1000) await unlockAchievement(userId, 'Легенда чата');
        const hour = new Date().getHours();
        if (hour >= 0 && hour < 6) await unlockAchievement(userId, 'Полуночник');
        if (hour >= 5 && hour < 7) await unlockAchievement(userId, 'Ранняя пташка');
      } catch (e) {
        console.error('chat:send error', e);
      }
    });

    // ===== РЕДАКТИРОВАНИЕ =====
    socket.on('chat:edit', async ({ chatId, messageId, text }: { chatId: string; messageId: string; text: string }) => {
      const { rows } = await query(
        `UPDATE messages SET text=$1, is_edited=TRUE, updated_at=NOW()
         WHERE id=$2 AND user_id=$3 AND chat_id=$4 RETURNING id`,
        [text, messageId, userId, chatId]
      );
      if (rows[0]) io.to(`chat:${chatId}`).emit('chat:edited', { id: messageId, chatId, text });
    });

    // ===== УДАЛЕНИЕ =====
    socket.on('chat:delete', async ({ chatId, messageId }: { chatId: string; messageId: string }) => {
      const { rows } = await query(
        'UPDATE messages SET is_deleted=TRUE, text=NULL, updated_at=NOW() WHERE id=$1 AND user_id=$2 RETURNING id',
        [messageId, userId]
      );
      if (rows[0]) io.to(`chat:${chatId}`).emit('chat:deleted', { messageId, chatId });
    });

    // ===== TYPING =====
    let typingTimer: NodeJS.Timeout;
    socket.on('chat:typing', ({ chatId, isTyping }: { chatId: string; isTyping: boolean }) => {
      socket.to(`chat:${chatId}`).emit('chat:typing', { chatId, userId, isTyping });
      if (isTyping) {
        clearTimeout(typingTimer);
        typingTimer = setTimeout(() => {
          socket.to(`chat:${chatId}`).emit('chat:typing', { chatId, userId, isTyping: false });
        }, 5000);
      }
    });

    // ===== ПРОЧТЕНИЕ =====
    socket.on('chat:read', async ({ chatId, upToMessageId }: { chatId: string; upToMessageId: string }) => {
      try {
        const { rows } = await query(
          `SELECT id FROM messages WHERE chat_id=$1 AND user_id != $2 AND is_deleted=FALSE
           AND created_at <= (SELECT created_at FROM messages WHERE id=$3)`,
          [chatId, userId, upToMessageId]
        );
        for (const m of rows) {
          await query('INSERT INTO message_reads (message_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [m.id, userId]);
        }
        io.to(`chat:${chatId}`).emit('chat:read', { chatId, userId, upToMessageId });
      } catch {}
    });

    // ===== РЕАКЦИИ =====
    socket.on('chat:react', async ({ chatId, messageId, emoji }: { chatId: string; messageId: string; emoji: string }) => {
      try {
        const existing = await query(
          'SELECT id FROM message_reactions WHERE message_id=$1 AND user_id=$2 AND emoji=$3',
          [messageId, userId, emoji]
        );
        if (existing.rows[0]) {
          await query('DELETE FROM message_reactions WHERE id=$1', [existing.rows[0].id]);
        } else {
          await query('INSERT INTO message_reactions (message_id, user_id, emoji) VALUES ($1,$2,$3)', [messageId, userId, emoji]);
        }
        io.to(`chat:${chatId}`).emit('chat:reaction', { messageId, userId, emoji, action: existing.rows[0] ? 'removed' : 'added' });
      } catch {}
    });

    // ===== ТЫЧКИ (POKES) =====
    socket.on('iriska:poke', async ({ toId, type }: { toId: string; type: string }) => {
      const recent = await query(
        `SELECT id FROM pokes WHERE from_id=$1 AND to_id=$2 AND created_at > NOW()-INTERVAL'30 seconds'`,
        [userId, toId]
      );
      if (recent.rows[0]) return;
      const { rows: from } = await query('SELECT name FROM users WHERE id=$1', [userId]);
      await query('INSERT INTO pokes (from_id, to_id, type) VALUES ($1,$2,$3)', [userId, toId, type]);
      io.to(`user:${toId}`).emit('iriska:poke', { fromId: userId, fromName: from[0]?.name, type });
    });

    // ===== 1-на-1 ЗВОНКИ (WebRTC сигнализация) =====
    socket.on('call:offer', async ({ calleeId, type, chatId, offer }: any) => {
      const { rows } = await query(
        `INSERT INTO calls (chat_id, type, status) VALUES ($1,$2,'pending') RETURNING id`,
        [chatId || null, type || 'audio']
      );
      const callId = rows[0].id;
      await query('INSERT INTO call_participants (call_id, user_id) VALUES ($1,$2),($1,$3)', [callId, userId, calleeId]);
      const { rows: caller } = await query('SELECT name, avatar_url FROM users WHERE id=$1', [userId]);
      io.to(`user:${calleeId}`).emit('call:incoming', { callId, caller: { id: userId, ...caller[0] }, type: type || 'audio', offer });
      socket.emit('call:created', { callId });
    });

    socket.on('call:answer', async ({ callId, answer }: any) => {
      await query(`UPDATE calls SET status='active', started_at=NOW() WHERE id=$1`, [callId]);
      const { rows } = await query('SELECT user_id FROM call_participants WHERE call_id=$1 AND user_id != $2', [callId, userId]);
      if (rows[0]) io.to(`user:${rows[0].user_id}`).emit('call:answered', { callId, answer });
    });

    socket.on('call:ice', async ({ callId, candidate }: any) => {
      const { rows } = await query('SELECT user_id FROM call_participants WHERE call_id=$1 AND user_id != $2', [callId, userId]);
      if (rows[0]) io.to(`user:${rows[0].user_id}`).emit('call:ice', { callId, candidate });
    });

    socket.on('call:end', async ({ callId }: any) => {
      await query(`UPDATE calls SET status='ended', ended_at=NOW() WHERE id=$1`, [callId]);
      const { rows } = await query('SELECT user_id FROM call_participants WHERE call_id=$1', [callId]);
      for (const p of rows) io.to(`user:${p.user_id}`).emit('call:ended', { callId });
    });

    socket.on('call:decline', async ({ callId }: any) => {
      await query(`UPDATE calls SET status='declined', ended_at=NOW() WHERE id=$1`, [callId]);
      const { rows } = await query('SELECT user_id FROM call_participants WHERE call_id=$1 AND user_id != $2', [callId, userId]);
      if (rows[0]) io.to(`user:${rows[0].user_id}`).emit('call:declined', { callId });
    });

    socket.on('screen:start', ({ callId }: any) => {
      socket.broadcast.emit('screen:started', { userId, callId });
    });
    socket.on('screen:stop', ({ callId }: any) => {
      socket.broadcast.emit('screen:stopped', { userId, callId });
    });

    // ===== ОТКЛЮЧЕНИЕ =====
    socket.on('disconnect', async () => {
      await setOffline(userId);
      console.log(`🔌 Отключился ${userId}`);
      const { rows: ctcts } = await query(
        'SELECT contact_id FROM contacts WHERE user_id=$1', [userId]
      );
      for (const c of ctcts) {
        io.to(`user:${c.contact_id}`).emit('user:presence', {
          userId, online: false, lastSeen: Date.now()
        });
      }
    });
  });
}

async function unlockAchievement(userId: string, name: string) {
  try {
    const ach = await query('SELECT id FROM achievements WHERE name=$1', [name]);
    if (!ach.rows[0]) return;
    await query(
      'INSERT INTO user_achievements (user_id, achievement_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [userId, ach.rows[0].id]
    );
  } catch {}
}
