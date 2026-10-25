-- v7.7.3 — attestation_attempts."userId" создан миграцией v7.6.0 как varchar (копипаста от
-- "createdBy", который varchar осознанно из-за спецзначения 'system'). userId — всегда
-- настоящий uuid пользователя, но JOIN с users.id (uuid) требует точного совпадения типов:
-- Postgres падал "operator does not exist: uuid = character varying" на КАЖДЫЙ запрос,
-- где грузится relation 'user' у попытки аттестации (проверка ответов РОПом — весь раздел
-- «Аттестация» был сломан в проде). Найдено сквозным прогоном scripts/e2e-smoke-playbook.py
-- 28.07.2026. Идемпотентно: повторный прогон на уже исправленной колонке — no-op.
DO $$
BEGIN
  IF (SELECT data_type FROM information_schema.columns
      WHERE table_name = 'attestation_attempts' AND column_name = 'userId') = 'character varying' THEN
    ALTER TABLE attestation_attempts ALTER COLUMN "userId" TYPE uuid USING "userId"::uuid;
  END IF;
END$$;
