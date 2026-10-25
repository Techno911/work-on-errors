-- v7.4.0 — раздел «Методичка»: платформа сама находит повторяющиеся ошибки в разборах и
-- поднимает кандидата с доказательствами, РОП подтверждает или отклоняет (решение владельца продукта
-- 28.07.2026: «нам нужно сами находить повторения... и показывать эту кнопку именно тогда,
-- когда система увидит повторения»). Таблица создаётся здесь явно, потому что на проде
-- synchronize=false — TypeORM не создаёт новые таблицы сам вне dev-окружения.
-- deploy.sh прогоняет ВСЕ v*.sql заново на каждом деплое (идемпотентно), а у CREATE TYPE
-- нет IF NOT EXISTS в PostgreSQL — без проверки повторный прогон падал бы «type already exists».
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'playbook_cards_status_enum') THEN
    CREATE TYPE public.playbook_cards_status_enum AS ENUM ('candidate', 'active', 'dismissed');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS playbook_cards (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  "companyId" varchar NOT NULL,
  "errorTagId" uuid,
  title varchar(255) NOT NULL,
  "ruleText" text,
  examples jsonb NOT NULL DEFAULT '[]',
  status public.playbook_cards_status_enum NOT NULL DEFAULT 'candidate',
  "occurrenceCount" integer NOT NULL DEFAULT 0,
  trend varchar(20) NOT NULL DEFAULT 'stable',
  evidence jsonb NOT NULL DEFAULT '[]',
  "ownerId" varchar,
  "ownerName" varchar(150),
  "confirmedAt" timestamp without time zone,
  "confirmedBy" varchar,
  "dismissedAt" timestamp without time zone,
  "dismissedBy" varchar,
  "dismissedReason" text,
  "occurrenceCountAtDismissal" integer,
  "reviewDueAt" date,
  version integer NOT NULL DEFAULT 1,
  "createdAt" timestamp without time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp without time zone NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'FK_playbook_cards_error_tag'
  ) THEN
    ALTER TABLE playbook_cards
      ADD CONSTRAINT "FK_playbook_cards_error_tag" FOREIGN KEY ("errorTagId")
      REFERENCES public.error_tags(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE INDEX IF NOT EXISTS idx_playbook_cards_company_status ON playbook_cards ("companyId", status);
CREATE INDEX IF NOT EXISTS idx_playbook_cards_company ON playbook_cards ("companyId");

-- Одна открытая (кандидат/активная) карточка на тег в компании — повтор не плодит дубли.
-- Ручные карточки (errorTagId = null) под ограничение не попадают.
CREATE UNIQUE INDEX IF NOT EXISTS uq_playbook_cards_company_tag
  ON playbook_cards ("companyId", "errorTagId")
  WHERE "errorTagId" IS NOT NULL;

-- Новый тип уведомления (см. notifications.entity.ts): synchronize=false на проде не добавляет
-- значение PG-enum сам, ADD VALUE IF NOT EXISTS — PG12+, вне транзакции.
ALTER TYPE public.notifications_type_enum ADD VALUE IF NOT EXISTS 'playbook_candidate';
