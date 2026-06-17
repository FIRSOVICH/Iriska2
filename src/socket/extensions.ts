import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { query } from '../db/pool';

interface AuthSocket extends Socket { userId?: string; }

export function setupSocketExtensions(io: Server) {
  // Не добавляем второй middleware — уже добавлен в основном socket/index.ts
  // Слушаем на том же io, добавляем обработчики через on('connection')

  io.on('connection', (socket: AuthSocket) => {
    const userId = socket.userId;
    if (!userId) return;

    // ===== ГРУППОВЫЕ ЗВОНКИ (mesh WebRTC до 8 человек) =====
    socket.on('gcall:join', async ({ callId, chatId }: { callId: string; chatId: string }) => {
      socket.join(`gcall:${callId}`);
      await query(
        'INSERT INTO call_participants (call_id, user_id, joined_at) VALUES ($1,$2,NOW()) ON CONFLICT (call_id, user_id) DO UPDATE SET joined_at=NOW()',
        [callId, userId]
      );
      const { rows: user } = await query('SELECT id, name, avatar_url FROM users WHERE id=$1', [userId]);
      socket.to(`gcall:${callId}`).emit('gcall:peer_joined', { userId, user: user[0], callId });
    });

    socket.on('gcall:offer', ({ callId, toUserId, offer }: any) => {
      io.to(`user:${toUserId}`).emit('gcall:offer', { callId, fromUserId: userId, offer });
    });

    socket.on('gcall:answer', ({ callId, toUserId, answer }: any) => {
      io.to(`user:${toUserId}`).emit('gcall:answer', { callId, fromUserId: userId, answer });
    });

    socket.on('gcall:ice', ({ callId, toUserId, candidate }: any) => {
      io.to(`user:${toUserId}`).emit('gcall:ice', { callId, fromUserId: userId, candidate });
    });

    socket.on('gcall:leave', async ({ callId }: any) => {
      socket.leave(`gcall:${callId}`);
      await query('UPDATE call_participants SET left_at=NOW() WHERE call_id=$1 AND user_id=$2', [callId, userId]);
      io.to(`gcall:${callId}`).emit('gcall:peer_left', { userId, callId });
    });

    // ===== КОМНАТЫ =====
    socket.on('room:join', async ({ roomId }: { roomId: string }) => {
      socket.join(`room:${roomId}`);
      await query(
        'INSERT INTO room_members (room_id, user_id) VALUES ($1,$2) ON CONFLICT DO NOTHING',
        [roomId, userId]
      );
      const { rows: user } = await query('SELECT id, name, avatar_url FROM users WHERE id=$1', [userId]);
      io.to(`room:${roomId}`).emit('room:user_joined', { roomId, user: user[0] });

      // Отправляем текущий playback_state новому участнику
      const { rows: room } = await query('SELECT playback_state FROM rooms WHERE id=$1', [roomId]);
      if (room[0]) socket.emit('room:playback', { roomId, state: room[0].playback_state });
    });

    socket.on('room:leave', async ({ roomId }: any) => {
      socket.leave(`room:${roomId}`);
      await query('DELETE FROM room_members WHERE room_id=$1 AND user_id=$2', [roomId, userId]);
      io.to(`room:${roomId}`).emit('room:user_left', { roomId, userId });
    });

    socket.on('room:playback', async ({ roomId, state }: any) => {
      // Обновляем состояние в БД и рассылаем всем
      await query('UPDATE rooms SET playback_state=$1 WHERE id=$2', [JSON.stringify(state), roomId]);
      io.to(`room:${roomId}`).emit('room:playback', { roomId, state });
    });

    socket.on('room:message', async ({ roomId, text }: { roomId: string; text: string }) => {
      if (!text?.trim()) return;
      const { rows } = await query(
        'INSERT INTO room_messages (room_id, user_id, text) VALUES ($1,$2,$3) RETURNING *',
        [roomId, userId, text.trim()]
      );
      const { rows: user } = await query('SELECT name, avatar_url FROM users WHERE id=$1', [userId]);
      io.to(`room:${roomId}`).emit('room:message', {
        ...rows[0], user_name: user[0]?.name, avatar_url: user[0]?.avatar_url
      });
    });

    socket.on('room:react', ({ roomId, emoji }: any) => {
      io.to(`room:${roomId}`).emit('room:react', { userId, emoji });
    });

    // ===== ДЕМОНСТРАЦИЯ ЭКРАНА В ГРУППЕ =====
    socket.on('screen:start', ({ callId }: any) => {
      socket.to(`gcall:${callId}`).emit('screen:started', { userId });
    });

    socket.on('screen:stop', ({ callId }: any) => {
      socket.to(`gcall:${callId}`).emit('screen:stopped', { userId });
    });
  });
}
