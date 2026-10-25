-- v6.7.0. Менеджеры сдают записи до пятницы, а не до среды (решение владельца продукта).
-- Меняем только тем компаниям, где стоит прежний дефолт: осознанно выбранный день не трогаем.
ALTER TABLE companies ALTER COLUMN manager_deadline_day SET DEFAULT 'friday';
UPDATE companies SET manager_deadline_day = 'friday' WHERE manager_deadline_day = 'wednesday';
