-- v6.2.0 — новый тип уведомления «премия РОПа» (владелец попросил обсудить в мастере / трекер
-- согласовал условия напрямую и подключил премию). Значение добавлено в TS-enum NotificationType,
-- но на проде synchronize=false не добавляет значение PG-enum сам → первый INSERT упал бы с 500
-- «invalid input value for enum notifications_type_enum: rop_bonus». ADD VALUE IF NOT EXISTS —
-- PG12+, psql выполняет вне транзакции. Deploy.sh применяет до rebuild.
ALTER TYPE public.notifications_type_enum ADD VALUE IF NOT EXISTS 'rop_bonus';
