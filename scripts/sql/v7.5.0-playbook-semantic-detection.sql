-- v7.5.0 — методичка находит повторы и без тега (страховка от РОПа) + черновики правил от ИИ.
-- Решение владельца продукта: «а если РОП будет пропускать ставить теги? Нам нужна страховка
-- от РОПа». synchronize=false на проде — TypeORM не добавляет новые колонки сам.

ALTER TABLE entries ADD COLUMN IF NOT EXISTS "reviewEmbedding" jsonb;

ALTER TABLE playbook_cards ADD COLUMN IF NOT EXISTS "draftRuleText" text;
ALTER TABLE playbook_cards ADD COLUMN IF NOT EXISTS "detectionSource" varchar(20) NOT NULL DEFAULT 'tag';
ALTER TABLE playbook_cards ADD COLUMN IF NOT EXISTS "sourceEntryIds" jsonb NOT NULL DEFAULT '[]';

-- Уже существующие ручные карточки (errorTagId IS NULL, заведены до этой миграции) были созданы
-- в обход детекции — помечаем их 'manual', чтобы фронт не подписывал их «обнаружено по смыслу».
UPDATE playbook_cards SET "detectionSource" = 'manual' WHERE "errorTagId" IS NULL;
