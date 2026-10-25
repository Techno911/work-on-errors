-- v6.0.0 — единый флоу владельца: онбординг-мастер владельца получил шаг подключения CRM.
-- Владелец может сам подключить amoCRM/Bitrix24 и импортировать команду, либо нажать
-- «позвать трекера» (не разобрался). Флаг запроса помощи — новая колонка. synchronize=false
-- на проде не создаст её сам → ALTER до старта нового backend (deploy.sh гоняет миграции до rebuild).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS crm_help_requested_at timestamp;
