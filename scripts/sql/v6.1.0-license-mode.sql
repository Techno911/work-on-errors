-- v6.1.0 — режим лицензии компании. trial — бесплатный тест N дней; implementation — команда уже
-- во внедрении (контракт идёт), лицензия бесплатна пока идёт внедрение, счётчик триала не показываем.
-- synchronize=false на проде не создаст колонку сам → ALTER до старта нового backend.
ALTER TABLE companies ADD COLUMN IF NOT EXISTS license_mode varchar(16) NOT NULL DEFAULT 'trial';
