-- v5.7.0 — жизненный статус компании (операционный бейдж трекера).
-- launch (дефолт) | active | paused | closed | demo. synchronize=false на проде → колонка вручную.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS status varchar(16) NOT NULL DEFAULT 'launch';

-- Разовый backfill текущих компаний по фактическому положению дел (идемпотентно: только пока дефолт).
-- Компания на запуске остаётся 'launch' — отдельная строка не нужна.
UPDATE companies SET status = 'demo'   WHERE name = 'демо-компании' AND status = 'launch';
UPDATE companies SET status = 'closed' WHERE name = 'одного клиента'  AND status = 'launch';
UPDATE companies SET status = 'paused' WHERE name = 'Демо Компания' AND status = 'launch';
