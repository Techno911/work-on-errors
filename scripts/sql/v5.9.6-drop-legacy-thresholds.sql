-- v5.9.5 — легаси-колонки threshold_good/threshold_great (LOW/INFO): заменены на
-- threshold_good_calls/threshold_good_chats/threshold_great_calls/threshold_great_chats
-- при разделении норматива по типу (звонки/чаты). Подтверждено: 0 обращений в коде
-- backend/frontend, кроме объявления полей. Дефолты 500/1000 (единицы XP, не звонков) —
-- явный признак, что колонки пережили полную смену дизайна.
ALTER TABLE companies DROP COLUMN IF EXISTS threshold_good;
ALTER TABLE companies DROP COLUMN IF EXISTS threshold_great;
