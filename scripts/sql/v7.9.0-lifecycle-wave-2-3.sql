-- v7.9.0 — волны 2 и 3 разбора жизненного цикла клиента (05.08.2026).
--
-- Волна 2 «сделать состояние честным»:
--   company_events   — журнал событий компании, включая попытки доставки сигналов и их отказы.
--                      Без него ни одно сообщение не может честно сказать «на паузе с 6 июня»,
--                      и любой следующий разбор снова пришлось бы собирать по переписке.
--   companies.pause_info — пауза перестаёт быть ярлыком: причина, дата начала, планируемая дата
--                      возврата, ответственный, условие окончания. По дате возврата к компании
--                      возвращается внимание (pause-watch.scheduler).
--
-- Волна 3 «убрать пароли из переписки»:
--   users.activation_token / activation_token_expires_at — именная одноразовая ссылка первого
--                      входа вместо пароля в чате. Человек задаёт пароль сам, ссылка гаснет.
--
-- Все операции идемпотентны (IF NOT EXISTS): деплой гоняет файл на каждом выкате.

CREATE TABLE IF NOT EXISTS public.company_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL,
  type          varchar(32) NOT NULL,
  title         varchar(255) NOT NULL,
  details       text,
  actor_user_id uuid,
  actor_label   varchar(255),
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at    timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_company_events_company ON public.company_events (company_id);
CREATE INDEX IF NOT EXISTS idx_company_events_company_created ON public.company_events (company_id, created_at);

ALTER TABLE public.companies
  ADD COLUMN IF NOT EXISTS pause_info jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS activation_token varchar(64);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS activation_token_expires_at timestamp;

-- Токен уникален: по чужой ссылке войти нельзя, а коллизия сделала бы это возможным.
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_activation_token
  ON public.users (activation_token) WHERE activation_token IS NOT NULL;
