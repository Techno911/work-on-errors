-- Личное подтверждение чтения разбора менеджером (change review-reread-confirm, релиз 8.7.0).
-- Версия текста — sha256 сырого UTF8 reviewText; reviewedAt версией не является
-- (правка готового разбора его не двигает). Откат: DROP COLUMN по каждой колонке.
ALTER TABLE entries ADD COLUMN IF NOT EXISTS "reviewTextHash" varchar(64);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS "reviewConfirmedHash" varchar(64);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS "reviewConfirmedAt" timestamptz;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS "reviewRereadAt" timestamptz;

-- Backfill архива: тот же алгоритм, что в Node (sha256 сырого UTF8-текста, без trim).
-- convert_to, а не ::bytea — текстовый литерал bytea иначе может съесть обратные слеши.
UPDATE entries
SET "reviewTextHash" = encode(sha256(convert_to("reviewText", 'UTF8')), 'hex')
WHERE status = 'reviewed'
  AND "reviewText" IS NOT NULL
  AND "reviewTextHash" IS NULL
  AND "deletedAt" IS NULL;
