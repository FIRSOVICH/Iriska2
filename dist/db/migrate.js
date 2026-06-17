"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const pool_1 = __importDefault(require("./pool"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
const SQL = `
-- Расширения
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Пользователи
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        VARCHAR(100) NOT NULL,
  username    VARCHAR(50)  UNIQUE NOT NULL,
  email       VARCHAR(255) UNIQUE NOT NULL,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Пароли
CREATE TABLE IF NOT EXISTS auth_credentials (
  user_id     UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Refresh-токены
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);

-- Контакты
CREATE TABLE IF NOT EXISTS contacts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  contact_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  nickname    VARCHAR(100),
  blocked     BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, contact_id)
);
CREATE INDEX IF NOT EXISTS idx_contacts_user ON contacts(user_id);

-- Тычки (pokes)
CREATE TABLE IF NOT EXISTS pokes (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  to_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(30) NOT NULL,
  seen        BOOLEAN DEFAULT FALSE,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pokes_to ON pokes(to_id, seen);

-- Лента активности
CREATE TABLE IF NOT EXISTS activity_feed (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type        VARCHAR(50) NOT NULL,
  payload     JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_feed_user ON activity_feed(user_id, created_at DESC);

-- Чаты
CREATE TABLE IF NOT EXISTS chats (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type        VARCHAR(20) NOT NULL CHECK(type IN ('dm','group','channel')),
  name        VARCHAR(200),
  description TEXT,
  avatar_url  TEXT,
  invite_code VARCHAR(20) UNIQUE,
  e2e_enabled BOOLEAN DEFAULT FALSE,
  created_by  UUID REFERENCES users(id),
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Участники чатов
CREATE TABLE IF NOT EXISTS chat_members (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        VARCHAR(20) DEFAULT 'member' CHECK(role IN ('owner','admin','member')),
  joined_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_chat  ON chat_members(chat_id);
CREATE INDEX IF NOT EXISTS idx_chat_members_user  ON chat_members(user_id);

-- Сообщения
CREATE TABLE IF NOT EXISTS messages (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id              UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  user_id              UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type                 VARCHAR(30) DEFAULT 'text'
                         CHECK(type IN ('text','image','video','audio','file','video_note','capsule','system')),
  text                 TEXT,
  file_url             TEXT,
  file_name            TEXT,
  file_size            BIGINT,
  duration             INT,
  reply_to_id          UUID REFERENCES messages(id),
  is_edited            BOOLEAN DEFAULT FALSE,
  is_deleted           BOOLEAN DEFAULT FALSE,
  self_destruct_after  INT,
  no_forward           BOOLEAN DEFAULT FALSE,
  created_at           TIMESTAMPTZ DEFAULT NOW(),
  updated_at           TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_messages_chat ON messages(chat_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_user ON messages(user_id);
CREATE INDEX IF NOT EXISTS idx_messages_text ON messages USING GIN(to_tsvector('russian', COALESCE(text,'')));

-- Прочтения
CREATE TABLE IF NOT EXISTS message_reads (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  read_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reads_message ON message_reads(message_id);
CREATE INDEX IF NOT EXISTS idx_reads_user    ON message_reads(user_id);

-- Реакции
CREATE TABLE IF NOT EXISTS message_reactions (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji       VARCHAR(10) NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, user_id, emoji)
);
CREATE INDEX IF NOT EXISTS idx_reactions_msg ON message_reactions(message_id);

-- Закреплённые сообщения
CREATE TABLE IF NOT EXISTS pinned_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id     UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by   UUID NOT NULL REFERENCES users(id),
  pinned_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(chat_id, message_id)
);

-- Звонки
CREATE TABLE IF NOT EXISTS calls (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id     UUID REFERENCES chats(id),
  type        VARCHAR(20) NOT NULL CHECK(type IN ('audio','video','group')),
  status      VARCHAR(20) DEFAULT 'pending' CHECK(status IN ('pending','active','ended','declined','missed')),
  started_at  TIMESTAMPTZ,
  ended_at    TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Участники звонков
CREATE TABLE IF NOT EXISTS call_participants (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  call_id     UUID NOT NULL REFERENCES calls(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES users(id),
  joined_at   TIMESTAMPTZ,
  left_at     TIMESTAMPTZ,
  UNIQUE(call_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_call_parts ON call_participants(call_id);
`;
async function migrate() {
    const client = await pool_1.default.connect();
    try {
        await client.query('BEGIN');
        await client.query(SQL);
        await client.query('COMMIT');
        console.log('✅ Миграция v1 выполнена');
    }
    catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Ошибка миграции v1:', e);
        process.exit(1);
    }
    finally {
        client.release();
        await pool_1.default.end();
    }
}
migrate();
//# sourceMappingURL=migrate.js.map