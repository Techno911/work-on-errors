-- v5.9.4 — GAM12: DB-default xp_settings был заморожен на старых цифрах
-- (reviewNoErrors:15 живой на новых компаниях, хотя код считает его отключённым —
-- DEFAULT_XP_SETTINGS.reviewNoErrors=0). Синхронизируем DB-default с кодом и бэкафилим
-- компании, которые НИКОГДА не трогали настройки геймификации (значение всё ещё равно
-- старому дефолту — значит не кастомизировали, безопасно заменить).
ALTER TABLE companies ALTER COLUMN xp_settings
  SET DEFAULT '{"entrySubmitted":3,"selfReviewComplete":10,"reviewReceived":2,"reviewNoErrors":0,"weeklyGoodZone":30,"weeklyGreatZone":60,"streakBonus":25}'::jsonb;

UPDATE companies
SET xp_settings = '{"entrySubmitted":3,"selfReviewComplete":10,"reviewReceived":2,"reviewNoErrors":0,"weeklyGoodZone":30,"weeklyGreatZone":60,"streakBonus":25}'::jsonb
WHERE xp_settings = '{"entrySubmitted":5,"selfReviewComplete":10,"reviewReceived":5,"reviewNoErrors":15,"weeklyGoodZone":15,"weeklyGreatZone":30,"streakBonus":5}'::jsonb;
