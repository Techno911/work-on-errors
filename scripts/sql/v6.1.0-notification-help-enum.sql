-- v6.1.0 — новый тип уведомления «нужна помощь» (владелец не разобрался с CRM на онбординге).
-- В v6.0.0 значение добавили в TS-enum NotificationType, но НЕ в PG-enum → requestHelp падал
-- с 500 «invalid input value for enum notifications_type_enum: help_requested». synchronize=false
-- на проде не добавляет значения enum сам. ADD VALUE IF NOT EXISTS — PG12+, вне транзакции (psql).
ALTER TYPE public.notifications_type_enum ADD VALUE IF NOT EXISTS 'help_requested';
