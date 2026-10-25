-- v5.9.4 — TG5: один Telegram-чат не должен оказаться привязан сразу к двум компаниям.
CREATE UNIQUE INDEX IF NOT EXISTS uq_companies_telegram_work_chat
  ON public.companies (telegram_work_chat_id)
  WHERE telegram_work_chat_id IS NOT NULL;
