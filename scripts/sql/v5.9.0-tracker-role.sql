-- v5.9.0 — роль трекера (производственный отдел ЧиП): видит все компании, ведёт онбординг,
-- без опасных действий суперадмина. Новое значение enum роли.
-- ADD VALUE IF NOT EXISTS: PG12+, per-statement autocommit в psql (не внутри транзакции).
ALTER TYPE public.users_role_enum ADD VALUE IF NOT EXISTS 'tracker';
