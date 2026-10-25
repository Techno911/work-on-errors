-- v5.9.5 — DI12: entryNumber назначается КЛИЕНТОМ (count+1) без атомарности на сервере —
-- гонка (двойной клик, две вкладки) даёт две записи с одним номером в рамках менеджер+спринт+тип.
-- Найдено 5 реальных дублей на проде (все — demo-аккаунты «Аудит Альфа/Браво»).
-- Перенумеровываем ВСЕ записи в 1..N по created_at внутри каждого (managerId,sprintId,type) —
-- уже-корректные ряды не меняются (они и так 1..N), меняются только реальные дубли/разрывы.
WITH renumbered AS (
  SELECT id, ROW_NUMBER() OVER (PARTITION BY "managerId", "sprintId", type ORDER BY "createdAt", id) AS rn
  FROM entries WHERE "deletedAt" IS NULL
)
UPDATE entries e SET "entryNumber" = r.rn
FROM renumbered r WHERE r.id = e.id AND e."entryNumber" != r.rn;

-- Барьер на будущее: гонка теперь падает на уникальном индексе, create() ловит 23505 и просит повторить.
CREATE UNIQUE INDEX IF NOT EXISTS uq_entries_manager_sprint_type_number
  ON public.entries ("managerId", "sprintId", type, "entryNumber")
  WHERE "deletedAt" IS NULL;
