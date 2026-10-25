-- Личное скрытие учебной карточки «Первые шаги» (change dismissible-first-steps).
-- nullable, без backfill: null = не скрывал; опытных закрывают пожизненные флаги dashboard,
-- а не массовая запись. Откат: ALTER TABLE users DROP COLUMN IF EXISTS first_steps_hidden_at;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_steps_hidden_at timestamptz NULL;
