-- v7.2.0 — ссылка-поручение на подключение CRM.
-- Вебхук создаётся только внутри портала клиента, доступа туда у трекера нет: теперь платформа
-- выдаёт одноразовую ссылку, по которой администратор портала подключает CRM сам, без входа
-- в платформу. Успешное подключение поднимает уведомление трекеру/суперадмину ('crm_connected').
-- synchronize=false на проде колонки и значения enum сам не добавляет → нужны ALTER.
-- ADD VALUE IF NOT EXISTS — PG12+, psql выполняет вне транзакции (per-statement).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS crm_setup_token varchar(64);
ALTER TABLE companies ADD COLUMN IF NOT EXISTS crm_setup_token_expires_at timestamp;
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_crm_setup_token ON companies (crm_setup_token) WHERE crm_setup_token IS NOT NULL;
ALTER TYPE public.notifications_type_enum ADD VALUE IF NOT EXISTS 'crm_connected';
