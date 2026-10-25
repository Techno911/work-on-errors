-- v7.7.0 — живой цикл методички (Release 4 плана, 28.07.2026): просроченный пересмотр не
-- висит молча, давно не повторяющаяся ошибка подсвечивается «похоже, решено», короткие
-- еженедельные квизы для действующей команды. synchronize=false — колонки добавляются явно.

ALTER TABLE playbook_cards ADD COLUMN IF NOT EXISTS "lastOccurrenceAt" timestamp without time zone;
ALTER TABLE playbook_cards ADD COLUMN IF NOT EXISTS "autoResolvedHint" boolean NOT NULL DEFAULT false;
ALTER TABLE playbook_cards ADD COLUMN IF NOT EXISTS "overdueNotifiedAt" timestamp without time zone;

ALTER TABLE attestation_tests ADD COLUMN IF NOT EXISTS "isQuiz" boolean NOT NULL DEFAULT false;
