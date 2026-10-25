-- v3.7.0: CRM-интеграция (Битрикс24). Выполнить на проде ДО деплоя.
-- Также добавить в .env деплоймента: CRM_ENCRYPTION_KEY=<openssl rand -base64 24>

CREATE TABLE IF NOT EXISTS crm_connections (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  company_id varchar NOT NULL,
  provider varchar(20) NOT NULL,
  base_url varchar(500) NOT NULL,
  secret_encrypted text NOT NULL,
  user_map jsonb NOT NULL DEFAULT '{}',
  status varchar(20) NOT NULL DEFAULT 'unverified',
  last_check_at timestamp NULL,
  last_error varchar(100) NULL,
  created_by uuid NULL,
  created_at timestamp NOT NULL DEFAULT now(),
  updated_at timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_crm_connections_company ON crm_connections(company_id);

ALTER TABLE entries ADD COLUMN IF NOT EXISTS "crmCallId" varchar(255) NULL;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS "crmProvider" varchar(20) NULL;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS "crmCallMetadata" jsonb NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_entries_company_crm_call
  ON entries ("companyId", "crmCallId")
  WHERE "crmCallId" IS NOT NULL AND "deletedAt" IS NULL;
