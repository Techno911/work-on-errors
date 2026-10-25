-- v8.1.0 — приостановка работы компании за неоплату.
--
-- Отдельные колонки, а не переиспользование status='paused' и pause_info: операционная пауза
-- обязана кончиться по дате (предел 60 дней, сторож напоминает) и никому не закрывает вход,
-- а приостановка за неоплату срока не имеет и закрывает работу всей команде клиента. Одно
-- состояние не может быть одновременно срочным и бессрочным.
--
-- payment_hold      — само состояние (false = работает как обычно).
-- payment_hold_info — когда приостановили, кто, что показать собственнику, когда сняли.
--
-- Идемпотентна: IF NOT EXISTS, дефолты проставляются существующим строкам. Данные не трогает.
ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS payment_hold BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS payment_hold_info JSONB NOT NULL DEFAULT '{}'::jsonb;
