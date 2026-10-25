-- v5.9.2 — REG3: DB-дефолт колонки transcription был {"enabled":false}, из-за чего КАЖДАЯ
-- созданная через админку компания получала автотранскрипцию ВЫКЛЮЧЕННОЙ (вопреки entity true,
-- «без транскриптов петля рвётся на РОПе»). Приводим дефолт к включённому.
ALTER TABLE companies ALTER COLUMN transcription SET DEFAULT '{"enabled":true,"monthlyMinutesLimit":300}'::jsonb;
