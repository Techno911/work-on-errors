-- v5.9.5 — DI5: два одновременных запроса могли создать два active-спринта на одну неделю
-- компании. Чистим общий случай: более поздний дубль без записей удаляем, записи недели
-- остаются на первом спринте.
DELETE FROM sprints s
WHERE NOT EXISTS (SELECT 1 FROM entries WHERE "sprintId" = s.id)
  AND EXISTS (
    SELECT 1 FROM sprints s2
    WHERE s2."companyId" = s."companyId"
      AND s2."startDate" = s."startDate"
      AND s2.id <> s.id
      AND s2."createdAt" < s."createdAt"
  );

CREATE UNIQUE INDEX IF NOT EXISTS uq_sprints_company_start ON public.sprints ("companyId", "startDate");
