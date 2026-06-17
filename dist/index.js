"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.io = void 0;
require("dotenv/config");
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http"));
const socket_io_1 = require("socket.io");
const cors_1 = __importDefault(require("cors"));
const path_1 = __importDefault(require("path"));
const redis_1 = require("./db/redis");
const socket_1 = require("./socket");
const extensions_1 = require("./socket/extensions");
const auth_1 = __importDefault(require("./routes/auth"));
const users_1 = __importDefault(require("./routes/users"));
const chats_1 = __importDefault(require("./routes/chats"));
const messages_1 = __importDefault(require("./routes/messages"));
const profiles_1 = __importDefault(require("./routes/profiles"));
const stories_1 = __importDefault(require("./routes/stories"));
const pokes_1 = __importDefault(require("./routes/pokes"));
const chatExtras_1 = __importDefault(require("./routes/chatExtras"));
const social_1 = __importDefault(require("./routes/social"));
const e2e_1 = __importDefault(require("./routes/e2e"));
const rooms_1 = __importDefault(require("./routes/rooms"));
const extras_1 = __importDefault(require("./routes/extras"));
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const origins = (process.env.ALLOWED_ORIGINS || 'http://localhost:5173').split(',');
const io = new socket_io_1.Server(server, {
    cors: { origin: origins, credentials: true },
    transports: ['websocket', 'polling'],
});
exports.io = io;
app.use((0, cors_1.default)({ origin: origins, credentials: true }));
app.use(express_1.default.json({ limit: '10mb' }));
app.use(express_1.default.urlencoded({ extended: true }));
app.use('/uploads', express_1.default.static(process.env.UPLOADS_DIR || path_1.default.join(__dirname, '../uploads')));
// Health
app.get('/health', (_req, res) => res.json({ ok: true, ts: Date.now() }));
// API роуты
app.use('/api/auth', auth_1.default);
app.use('/api/users', users_1.default);
app.use('/api/chats', chats_1.default);
app.use('/api/chats', messages_1.default);
app.use('/api/profiles', profiles_1.default);
app.use('/api/stories', stories_1.default);
app.use('/api/pokes', pokes_1.default);
app.use('/api/chats', chatExtras_1.default);
app.use('/api', social_1.default);
app.use('/api/e2e', e2e_1.default);
app.use('/api/rooms', rooms_1.default);
app.use('/api', extras_1.default);
// 404
app.use((_req, res) => res.status(404).json({ error: 'Не найдено' }));
// Error handler
app.use((err, _req, res, _next) => {
    console.error(err);
    res.status(500).json({ error: err.message || 'Ошибка сервера' });
});
// Socket.io
(0, socket_1.setupSocket)(io);
(0, extensions_1.setupSocketExtensions)(io);
const PORT = Number(process.env.PORT) || 4000;
async function start() {
    await (0, redis_1.connectRedis)();
    server.listen(PORT, () => {
        console.log(`\n🍬 Ириска сервер запущен на http://localhost:${PORT}`);
        console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'development'}`);
        console.log(`   DB:       ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}`);
        console.log(`   Redis:    ${process.env.REDIS_URL}`);
    });
}
start().catch((e) => { console.error('Ошибка запуска:', e); process.exit(1); });
//# sourceMappingURL=index.js.map