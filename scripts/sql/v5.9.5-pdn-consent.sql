-- v5.9.5 — раздельное согласие на ПДн (ст. 9 ч. 1 152-ФЗ, действует с 01.09.2025):
-- владелец на оферте (ст. 6 152-ФЗ, поручение обработки) + КАЖДЫЙ сотрудник лично на первом
-- входе (ст. 88 ТК РФ, согласие на передачу третьему лицу — работодатель не может дать его
-- за работника) + ознакомление с ЛНА (ст. 86 ч. 8 ТК РФ, отдельная обязанность).
ALTER TABLE companies ADD COLUMN IF NOT EXISTS pdn_consent_accepted_at timestamp;
ALTER TABLE companies ADD COLUMN IF NOT EXISTS offer_accepted_ip varchar(64);
-- Легаси-компании, уже принявшие оферту ДО этого разделения — считаем ПДн принятыми тем же
-- моментом (акцепт УЖЕ включал согласие на ПДн текстом, разделился только чекбокс на экране).
UPDATE companies SET pdn_consent_accepted_at = offer_accepted_at WHERE offer_accepted_at IS NOT NULL AND pdn_consent_accepted_at IS NULL;

ALTER TABLE users ADD COLUMN IF NOT EXISTS pdn_consent_accepted_at timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS lna_acknowledged_at timestamp;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pdn_consent_ip varchar(64);
