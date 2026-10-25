-- v8.3.0 — сообщение человеку это новость, а не состояние.
--
-- Повод: Прислан скриншот из Telegram с двумя одинаковыми сводами подряд
-- («Все петли защищены, тишины нет, незакрытых подключений нет. Проверено компаний: 2») и
-- потребовал системного фикса: сообщений без ценности не должно приходить нигде.
--
-- Ежедневное «всё чисто» появилось 05.08.2026 как доказательство жизни крона (молчащий
-- сторож неотличим от упавшего). Доказательство верное, носитель неверный. Обе таблицы ниже
-- меняют носитель:
--
--  · staff_signals помнит, о какой проблеме мы УЖЕ сказали и на какой ступени. Повтор
--    вчерашней картины перестаёт быть сообщением, а ухудшение и закрытие им остаются.
--  · watchdog_runs помнит, когда сторож последний раз отработал. Живость видна в админке
--    в любой момент, а тревога уходит только когда сторож ЗАМОЛЧАЛ, то есть когда она
--    требует действия.
--
-- Идемпотентна: IF NOT EXISTS плюс ON CONFLICT DO NOTHING.

CREATE TABLE IF NOT EXISTS staff_signals (
  "key"           VARCHAR(64)  NOT NULL,
  "signal_id"     VARCHAR(128) NOT NULL,
  "stage"         VARCHAR(64)  NOT NULL DEFAULT '',
  "text"          TEXT         NOT NULL,
  "first_seen_at" TIMESTAMP    NOT NULL DEFAULT now(),
  "last_sent_at"  TIMESTAMP    NOT NULL DEFAULT now(),
  CONSTRAINT staff_signals_pkey PRIMARY KEY ("key", "signal_id")
);

CREATE TABLE IF NOT EXISTS watchdog_runs (
  "key"               VARCHAR(64) NOT NULL,
  "last_run_at"       TIMESTAMP   NOT NULL DEFAULT now(),
  "last_sent_at"      TIMESTAMP,
  "last_signal_count" INTEGER     NOT NULL DEFAULT 0,
  CONSTRAINT watchdog_runs_pkey PRIMARY KEY ("key")
);

-- Сторожа регистрируются с отметкой «жив на момент выката»: иначе сторож сторожей поднял бы
-- тревогу о них в первый же час, когда крон ещё просто не успел отработать.
INSERT INTO watchdog_runs ("key", "last_run_at")
VALUES ('loop-health', now()), ('channel-check', now()), ('weekly-report', now()), ('watchdog-liveness', now())
ON CONFLICT ("key") DO NOTHING;
