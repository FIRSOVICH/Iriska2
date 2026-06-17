import pool from './pool';
import dotenv from 'dotenv';
dotenv.config();

const SQL = `
-- Расширенный профиль
CREATE TABLE IF NOT EXISTS user_profiles (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status_preset   VARCHAR(30) DEFAULT 'online',
  mood            VARCHAR(10),
  music_track     VARCHAR(200),
  music_artist    VARCHAR(200),
  game_name       VARCHAR(200),
  hide_online     BOOLEAN DEFAULT FALSE,
  cover_url       TEXT,
  bg_url          TEXT,
  bio             TEXT,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Тема оформления
CREATE TABLE IF NOT EXISTS user_theme (
  user_id         UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  theme           VARCHAR(10) DEFAULT 'dark' CHECK(theme IN ('dark','light')),
  font            VARCHAR(50) DEFAULT 'Inter',
  accent_color    VARCHAR(20) DEFAULT 'iriska',
  bubble_style    VARCHAR(20) DEFAULT 'round' CHECK(bubble_style IN ('round','classic')),
  cozy_mode       VARCHAR(20) DEFAULT 'off',
  wallpaper       INT DEFAULT 0,
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Каталог достижений
CREATE TABLE IF NOT EXISTS achievements (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            VARCHAR(100) UNIQUE NOT NULL,
  description     TEXT,
  icon            VARCHAR(10),
  rarity          VARCHAR(20) DEFAULT 'common' CHECK(rarity IN ('common','rare','epic','legendary'))
);

-- Достижения пользователей
CREATE TABLE IF NOT EXISTS user_achievements (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  achievement_id  UUID NOT NULL REFERENCES achievements(id),
  unlocked_at     TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, achievement_id)
);
CREATE INDEX IF NOT EXISTS idx_ua_user ON user_achievements(user_id);

-- Посев базовых достижений
INSERT INTO achievements (name, description, icon, rarity) VALUES
  ('Первое сообщение',   'Отправил первое сообщение',        '✉️', 'common'),
  ('Ранняя пташка',      'Написал до 6 утра',                '🌅', 'common'),
  ('Душа компании',      'Состоит в 5+ группах',             '🎉', 'rare'),
  ('Полуночник',         'Написал после полуночи 10 раз',    '🌙', 'rare'),
  ('Хранитель тайн',     'Включил E2E в 3 чатах',           '🔐', 'epic'),
  ('Легенда чата',       '1000+ сообщений',                  '👑', 'legendary'),
  ('Коллекционер',       'Разблокировал 5 достижений',       '💎', 'epic'),
  ('Уютный',             'Включил уютный режим',             '🕯️', 'common')
ON CONFLICT (name) DO NOTHING;

-- Опросы
CREATE TABLE IF NOT EXISTS polls (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id         UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  message_id      UUID REFERENCES messages(id),
  created_by      UUID NOT NULL REFERENCES users(id),
  question        TEXT NOT NULL,
  is_multiple     BOOLEAN DEFAULT FALSE,
  is_closed       BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_polls_chat ON polls(chat_id);

CREATE TABLE IF NOT EXISTS poll_options (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poll_id         UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  text            TEXT NOT NULL,
  sort_order      INT DEFAULT 0
);

CREATE TABLE IF NOT EXISTS poll_votes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  poll_id         UUID NOT NULL REFERENCES polls(id) ON DELETE CASCADE,
  option_id       UUID NOT NULL REFERENCES poll_options(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  voted_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(poll_id, option_id, user_id)
);

-- Общие заметки
CREATE TABLE IF NOT EXISTS shared_notes (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id         UUID UNIQUE NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  content         TEXT DEFAULT '',
  updated_by      UUID REFERENCES users(id),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS note_history (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  note_id         UUID NOT NULL REFERENCES shared_notes(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id),
  diff            TEXT NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- Истории
CREATE TABLE IF NOT EXISTS stories (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type            VARCHAR(20) DEFAULT 'image' CHECK(type IN ('image','video','text')),
  media_url       TEXT,
  text            TEXT,
  bg_color        TEXT,
  text_color      TEXT,
  expires_at      TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '24 hours'),
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stories_user    ON stories(user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_stories_expires ON stories(expires_at);

CREATE TABLE IF NOT EXISTS story_views (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  story_id        UUID NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  emoji           VARCHAR(10),
  viewed_at       TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(story_id, user_id)
);

-- Тайм-капсулы
CREATE TABLE IF NOT EXISTS time_capsules (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  chat_id         UUID NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  created_by      UUID NOT NULL REFERENCES users(id),
  text            TEXT NOT NULL,
  open_at         TIMESTAMPTZ NOT NULL,
  opened          BOOLEAN DEFAULT FALSE,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_capsules_open ON time_capsules(open_at, opened);
`;

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(SQL);
    await client.query('COMMIT');
    console.log('✅ Миграция v2 выполнена');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('❌ Ошибка миграции v2:', e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
