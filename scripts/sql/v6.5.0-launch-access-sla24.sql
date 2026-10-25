-- v6.5.0 — доступы команде в рабочий чат при запуске + норматив разбора 24 часа.
--
-- 1) users.last_login_at: факт реального входа по паролю (бейдж «ещё не входил»,
--    правило «новый пароль при запуске — только не входившим»).
--    Backfill: у входивших живут refresh-токены (7 дней жизни) — берём последний.
--    У входивших давно (>7 дней, токены вычищены) останется NULL: при запуске они
--    получат новый пароль в чат, что для давно не входивших безвредно.
-- 2) Норматив разбора РОПа: 48 → 24 часа (решение владельца продукта — скорость
--    обратной связи напрямую влияет на качество развития команды).
--    Меняем дефолт колонки И существующие компании, где стоит нетронутый дефолт 48.
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamp;
UPDATE users u
  SET last_login_at = rt.last_seen
  FROM (SELECT user_id, max(created_at) AS last_seen FROM refresh_tokens GROUP BY user_id) rt
  WHERE rt.user_id = u.id AND u.last_login_at IS NULL;

ALTER TABLE companies ALTER COLUMN review_norms
  SET DEFAULT '{"minReviewsPerWeek":0,"maxHoursToRespond":24,"minReviewCharsAvg":150,"qualityThresholdPct":80}'::jsonb;
UPDATE companies
  SET review_norms = jsonb_set(review_norms, '{maxHoursToRespond}', '24')
  WHERE (review_norms->>'maxHoursToRespond')::int = 48;
