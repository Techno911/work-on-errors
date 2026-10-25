-- v8.0.5 — колонки-ссылки приводятся к uuid.
--
-- Класс дефекта, который в этом проекте уже дважды ломал прод (последний раз v7.7.3,
-- attestation_attempts."userId"): при synchronize: false фактический тип колонки задаёт только
-- ручная миграция, и копипаста протаскивала varchar туда, где на другой стороне uuid. Пока по
-- такой колонке нет ни одной связи, всё работает: INSERT и SELECT проходят, backend стартует,
-- health зелёный, tsc и тесты молчат. Ломается в тот день, когда кто-то добавит relation или
-- join, и падает уже в рантайме: operator does not exist: uuid = character varying.
--
-- Замер перед правкой (09.08.2026, прод): во всех десяти колонках 100% значений — валидные
-- uuid, ни одного исключения; самая большая таблица 308 строк. Спецзначений вида 'system'
-- здесь нет (единственное такое в проекте живёт в attestation_attempts.created_by, и эта
-- колонка сознательно остаётся varchar).
--
-- Миграция идемпотентна: колонку, уже имеющую тип uuid, пропускает. Перед каждым ALTER
-- проверяет, что ВСЕ значения кастуются, и падает с понятным текстом, если нет: молча
-- испортить чужие данные хуже, чем остановить выкат.
DO $$
DECLARE
  target RECORD;
  current_type TEXT;
  bad_rows BIGINT;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('entries',             'companyId'),
      ('error_tags',          'companyId'),
      ('playbook_cards',      'companyId'),
      ('playbook_cards',      'ownerId'),
      ('review_templates',    'companyId'),
      ('transcription_usage', 'companyId'),
      ('attestation_tests',   'companyId'),
      ('crm_connections',     'company_id'),
      ('achievements',        'userId'),
      ('xp_transactions',     'userId'),
      ('xp_transactions',     'entryId')
    ) AS t(tbl, col)
  LOOP
    SELECT data_type INTO current_type
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = target.tbl AND column_name = target.col;

    IF current_type IS NULL THEN
      RAISE NOTICE 'пропуск: %.% не существует', target.tbl, target.col;
      CONTINUE;
    END IF;

    IF current_type = 'uuid' THEN
      RAISE NOTICE 'пропуск: %.% уже uuid', target.tbl, target.col;
      CONTINUE;
    END IF;

    EXECUTE format(
      'SELECT COUNT(*) FROM %I WHERE %I IS NOT NULL AND %I !~ ''^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$''',
      target.tbl, target.col, target.col
    ) INTO bad_rows;

    IF bad_rows > 0 THEN
      RAISE EXCEPTION '%.%: % значений не являются uuid, конвертация отменена', target.tbl, target.col, bad_rows;
    END IF;

    EXECUTE format('ALTER TABLE %I ALTER COLUMN %I TYPE uuid USING %I::uuid', target.tbl, target.col, target.col);
    RAISE NOTICE 'готово: %.% переведена в uuid', target.tbl, target.col;
  END LOOP;
END $$;
