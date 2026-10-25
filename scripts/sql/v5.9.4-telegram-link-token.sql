-- v5.9.4 — TG2: deep-link t.me/<бот>?start=<userId-hex> кодировал userId напрямую (не секрет,
-- GET /users отдаёт UUID любому в компании) — атакующий мог собрать чужую ссылку и привязать
-- СВОЙ Telegram к ЧУЖОМУ userId, перехватывая личные дайджесты жертвы. Заменяем на случайный
-- одноразовый TTL-токен (см. users.entity.ts telegramLinkToken).
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_link_token varchar(32) NULL;
ALTER TABLE users ADD COLUMN IF NOT EXISTS telegram_link_token_expires_at timestamptz NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_link_token
  ON users(telegram_link_token) WHERE telegram_link_token IS NOT NULL;
