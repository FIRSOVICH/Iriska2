import 'dotenv/config';
import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';

import { connectRedis } from './db/redis';
import { setupSocket } from './socket';
import { setupSocketExtensions } from './socket/extensions';

import authRouter    from './routes/auth';
import usersRouter   from './routes/users';
import chatsRouter   from './routes/chats';
import messagesRouter from './routes/messages';
import profilesRouter from './routes/profiles';
import storiesRouter  from './routes/stories';
import pokesRouter    from './routes/pokes';
import chatExtrasRouter from './routes/chatExtras';
import socialRouter   from './routes/social';
import e2eRouter      from './routes/e2e';
import roomsRouter    from './routes/rooms';
import extrasRouter   from './routes/extras';

const app = express();
const server = http.createServer(app);

const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');

const io = new Server(server, {
  cors: { origin: origins, credentials: true },
  transports: ['websocket', 'polling'],
});

app.use(cors({ origin: origins, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(process.env.UPLOADS_DIR || path.join(__dirname, '../uploads')));

// Health
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));

// API роуты
app.use('/api/auth',      authRouter);
app.use('/api/users',     usersRouter);
app.use('/api/chats',     chatsRouter);
app.use('/api/chats',     messagesRouter);
app.use('/api/profiles',  profilesRouter);
app.use('/api/stories',   storiesRouter);
app.use('/api/pokes',     pokesRouter);
app.use('/api/chats',     chatExtrasRouter);
app.use('/api',           socialRouter);
app.use('/api/e2e',       e2eRouter);
app.use('/api/rooms',     roomsRouter);
app.use('/api',           extrasRouter);

// 404
app.use((_req, res) => res.status(404).json({ error: 'Не найдено' }));

// Error handler
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(500).json({ error: err.message || 'Ошибка сервера' });
});

// Socket.io
setupSocket(io);
setupSocketExtensions(io);

const PORT = Number(process.env.PORT) || 4000;

async function start() {
  await connectRedis();
  server.listen(PORT, () => {
    console.log(`\n🍬 Ириска сервер запущен на http://localhost:${PORT}`);
    console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
    console.log(`   DB:       ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
    console.log(`   Redis:    ${process.env.REDIS_URL}`);
  });
}

start().catch((e) => { console.error('Ошибка запуска:', e); process.exit(1); });

export { io };
