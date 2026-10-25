-- v5.8.0 — предложение премии РОПа собственнику (флоу-аналог оферты).
-- Отдельная JSONB-колонка, боевой rop_bonus не трогаем. synchronize=false → колонка вручную.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS rop_bonus_proposal jsonb NOT NULL DEFAULT '{}'::jsonb;
