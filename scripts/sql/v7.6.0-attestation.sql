-- v7.6.0 — раздел «Аттестация по методичке» (Release 3 плана «Методичка», 28.07.2026).
-- Вопросы порождаются из активных карточек методички, платформа предлагает баллы 0/1/2,
-- РОП подтверждает или меняет каждый. synchronize=false — таблицы создаются здесь явно.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attestation_tests_status_enum') THEN
    CREATE TYPE public.attestation_tests_status_enum AS ENUM ('generating', 'draft', 'active', 'closed');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS attestation_tests (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  "companyId" varchar NOT NULL,
  title varchar(255) NOT NULL,
  status public.attestation_tests_status_enum NOT NULL DEFAULT 'generating',
  "passingScorePercent" integer NOT NULL DEFAULT 75,
  deadline date,
  "formVariant" varchar(1) NOT NULL DEFAULT 'A',
  "originalTestId" uuid,
  "createdBy" varchar NOT NULL,
  "generationError" text,
  "createdAt" timestamp without time zone NOT NULL DEFAULT now(),
  "updatedAt" timestamp without time zone NOT NULL DEFAULT now(),
  "closedAt" timestamp without time zone
);
CREATE INDEX IF NOT EXISTS idx_attestation_tests_company_status ON attestation_tests ("companyId", status);

CREATE TABLE IF NOT EXISTS attestation_questions (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  "testId" uuid NOT NULL REFERENCES attestation_tests(id) ON DELETE CASCADE,
  "cardId" uuid REFERENCES playbook_cards(id) ON DELETE SET NULL,
  type varchar(20) NOT NULL,
  "isCritical" boolean NOT NULL DEFAULT false,
  weight integer NOT NULL DEFAULT 1,
  "questionText" text NOT NULL,
  "referenceAnswer" text NOT NULL,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp without time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_attestation_questions_test ON attestation_questions ("testId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'attestation_attempts_status_enum') THEN
    CREATE TYPE public.attestation_attempts_status_enum AS ENUM ('assigned', 'submitted', 'ai_graded', 'graded');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS attestation_attempts (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  "testId" uuid NOT NULL REFERENCES attestation_tests(id) ON DELETE CASCADE,
  "userId" varchar NOT NULL,
  status public.attestation_attempts_status_enum NOT NULL DEFAULT 'assigned',
  "startedAt" timestamp without time zone,
  "submittedAt" timestamp without time zone,
  "gradedAt" timestamp without time zone,
  "gradedBy" varchar,
  "totalScorePercent" numeric(5,1),
  passed boolean,
  "failedCritical" boolean NOT NULL DEFAULT false,
  "createdAt" timestamp without time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attestation_attempts_test_user ON attestation_attempts ("testId", "userId");
CREATE INDEX IF NOT EXISTS idx_attestation_attempts_user ON attestation_attempts ("userId");

CREATE TABLE IF NOT EXISTS attestation_answers (
  id uuid PRIMARY KEY DEFAULT public.uuid_generate_v4(),
  "attemptId" uuid NOT NULL REFERENCES attestation_attempts(id) ON DELETE CASCADE,
  "questionId" uuid NOT NULL REFERENCES attestation_questions(id) ON DELETE CASCADE,
  "answerText" text NOT NULL DEFAULT '',
  "aiSuggestedScore" integer,
  "aiSuggestedReasoning" text,
  "reviewerScore" integer,
  "createdAt" timestamp without time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_attestation_answers_attempt_question ON attestation_answers ("attemptId", "questionId");

-- Новые типы уведомлений (см. notifications.entity.ts): synchronize=false не добавляет их сам.
ALTER TYPE public.notifications_type_enum ADD VALUE IF NOT EXISTS 'attestation_assigned';
ALTER TYPE public.notifications_type_enum ADD VALUE IF NOT EXISTS 'attestation_ready_to_review';
ALTER TYPE public.notifications_type_enum ADD VALUE IF NOT EXISTS 'attestation_result';
