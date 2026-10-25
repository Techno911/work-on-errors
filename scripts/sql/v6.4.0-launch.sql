-- v6.4.0 — фаза «Запуск»: kick-off в рабочий чат после онбординга + сторож тишины.
-- 1) launched_at: момент отправки kick-off трекером (от него сторож считает тишину).
-- 2) Новое значение enum уведомлений 'launch' (тишина после запуска / петля прокрутилась).
--    ADD VALUE IF NOT EXISTS — PG12+, psql выполняет вне транзакции.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS launched_at timestamp;
ALTER TYPE public.notifications_type_enum ADD VALUE IF NOT EXISTS 'launch';
