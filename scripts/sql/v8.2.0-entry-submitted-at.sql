-- v8.2.0 — момент сдачи записи руководителю и признак «CRM подключать нечем».
--
-- 1. entries."submittedAt"
-- Норматив разбора считался от createdAt, то есть от создания черновика: время, пока менеджер
-- писал самоанализ, списывалось со счёта руководителя. В коде это было прямо названо прокси
-- («entry submitted сразу»), но на живых данных предположение не держится.
-- Догон существующих строк: у сданных и разобранных записей другого источника нет, ставим
-- createdAt. Это ровно то, чем платформа пользовалась до сих пор, то есть цифры не ухудшатся,
-- а с этого момента начнут считаться честно.
--
-- 2. companies.crm_not_applicable
-- Подсказка «подключите CRM» не должна приходить туда, где подключать физически нечего
-- (нет CRM, записи разговоров не ведутся, телефония не поддерживает выгрузку). Отмечает
-- наш трекер или владелец ЧиП, причина хранится рядом, чтобы через полгода было понятно.
--
-- 3. companies.crm_hint_snoozed_until
-- Руководитель отдела продаж может отложить подсказку. Без этого напоминание превращается
-- в еженедельный шум, который перестают читать.
--
-- Идемпотентна: IF NOT EXISTS, догон только там, где значение пустое.

ALTER TABLE entries
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP;

UPDATE entries
   SET "submittedAt" = "createdAt"
 WHERE "submittedAt" IS NULL
   AND status IN ('submitted', 'reviewed');

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS crm_not_applicable BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS crm_not_applicable_info JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE companies
  ADD COLUMN IF NOT EXISTS crm_hint_snoozed_until TIMESTAMP;
