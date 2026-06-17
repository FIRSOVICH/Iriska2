import pool from './pool';
import dotenv from 'dotenv';
dotenv.config();

const SQL = `
-- E2E ключи
CREATE TABLE IF NOT EXISTS e2e_keys (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id       VARCHAR(100) NOT NULL,
  public_key      TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_e2e_user ON e2e_keys(user_id);

-- E2E конверты (зашифрованные сессионные ключи для групп)
CREATE TABLE IF NOT EXISTS message_envelopes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  recipient_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_key   TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(message_id, recipient_id)
);

-- Бункер-сессии
CREATE TABLE IF NOT EXISTS bunker_sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id         UUID UNIQUE NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  destruct_sec    INT NOT NULL,
  no_forward      BOOLEAN DEFAULT TRUE,
  created_by      UUID NOT NULL REFERENCES users(id),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Комнаты
CREATE TABLE IF NOT EXISTS rooms (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type            VARCHAR(20) NOT NULL CHECK(type IN ('music','watch','voice','topic')),
  name            VARCHAR(200) NOT NULL,
  topic           TEXT,
  slug            VARCHAR(50) UNIQUE NOT NULL,
  created_by      UUID NOT NULL REFERENCES users(id),
  is_active       BOOLEAN DEFAULT TRUE,
  playback_state  JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rooms_type ON rooms(type, is_active);

-- Участники комнат
CREATE TABLE IF NOT EXISTS room_members (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(room_id, user_id)
);

-- Сообщения комнат
CREATE TABLE IF NOT EXISTS room_messages (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id         UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text            TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_room_msgs ON room_messages(room_id, created_at DESC);

-- Ириска Моменты
CREATE TABLE IF NOT EXISTS moments (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  message_id      UUID REFERENCES messages(id) ON DELETE CASCADE,
  type            VARCHAR(20) NOT NULL CHECK(type IN ('year_ago','month_ago','top_reaction')),
  seen            BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moments_user ON moments(user_id, seen);

-- PWA push-подписки
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint        TEXT UNIQUE NOT NULL,
  keys            JSONB NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);

-- Кружочки
CREATE TABLE IF NOT EXISTS video_notes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  message_id      UUID UNIQUE NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  duration        INT NOT NULL,
  thumb_url       TEXT,
  width           INT DEFAULT 360,
  height          INT DEFAULT 360,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(SQL);
    await client.query('COMMIT');
    console.log('✅ Миграция v3 выполнена');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка миграции v3:', e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
