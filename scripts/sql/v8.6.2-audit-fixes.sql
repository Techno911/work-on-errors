-- AUDIT-0710 (M2): видимый статус сбоя OCR скриншотов (поле ocrFailed в entry_screenshots).
ALTER TABLE entry_screenshots ADD COLUMN IF NOT EXISTS ocr_failed boolean NOT NULL DEFAULT false;
