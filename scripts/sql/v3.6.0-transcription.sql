-- v3.6.0: автотранскрипция. Выполнить на проде ДО деплоя (synchronize:false).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS transcription jsonb NOT NULL
  DEFAULT '{"enabled":false,"monthlyMinutesLimit":300}';

CREATE TABLE IF NOT EXISTS entry_audio (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "entryId" uuid NOT NULL,
  "fileUrl" varchar NOT NULL,
  "originalFileName" varchar NOT NULL,
  "fileSize" int NOT NULL DEFAULT 0,
  "durationSec" int NOT NULL DEFAULT 0,
  status varchar NOT NULL DEFAULT 'converting',
  "errorMessage" text,
  provider varchar NOT NULL DEFAULT 'salutespeech',
  "providerTaskId" varchar,
  "transcriptionResult" text,
  "appliedAt" timestamp,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT fk_entry_audio_entry FOREIGN KEY ("entryId") REFERENCES entries(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_entry_audio_entry ON entry_audio("entryId");
CREATE INDEX IF NOT EXISTS idx_entry_audio_status ON entry_audio(status);

CREATE TABLE IF NOT EXISTS transcription_usage (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  "companyId" varchar NOT NULL,
  "entryAudioId" uuid,
  seconds int NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_tu_company_created ON transcription_usage("companyId","createdAt");
