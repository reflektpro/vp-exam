-- 0032: рапорт на повышение — «Благодарность от руководства» хранится баллами (n = баллы, points = баллы), в итог идут как есть.
-- Старые рапорты хранили количество благодарностей (баллы ÷ 50) без points: переводим в баллы (×50). Решения (status) не меняются.
-- Сначала частично засчитанное количество в проверке (n_ok), потом сам пункт; повторный запуск ничего не меняет (points уже есть).
UPDATE promo_reports SET item_review = json_set(item_review, '$.thanks.n_ok', json_extract(item_review, '$.thanks.n_ok') * 50)
WHERE json_extract(item_review, '$.thanks.n_ok') IS NOT NULL
  AND EXISTS (SELECT 1 FROM json_each(promo_reports.data, '$.items') je WHERE json_extract(je.value, '$.key') = 'thanks' AND json_extract(je.value, '$.points') IS NULL);
UPDATE promo_reports SET data = (
  SELECT json_set(promo_reports.data, '$.items[' || je.key || '].n', json_extract(je.value, '$.n') * 50, '$.items[' || je.key || '].points', json_extract(je.value, '$.n') * 50)
  FROM json_each(promo_reports.data, '$.items') je WHERE json_extract(je.value, '$.key') = 'thanks' AND json_extract(je.value, '$.points') IS NULL LIMIT 1)
WHERE EXISTS (SELECT 1 FROM json_each(promo_reports.data, '$.items') je WHERE json_extract(je.value, '$.key') = 'thanks' AND json_extract(je.value, '$.points') IS NULL);
