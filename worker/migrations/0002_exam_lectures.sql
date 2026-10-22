-- 0002: обязательные лекции для каждого экзамена отдельно.
-- Только добавление: новая таблица и новый столбец со значением по умолчанию. Существующие данные не меняются.
--
-- Режим допуска экзамена (вместе со старым столбцом requires_lectures):
--   requires_lectures = 0                               → лекции не нужны, экзамен открыт сразу;
--   requires_lectures = 1, lecture_mode = 'all'         → все опубликованные обязательные лекции (как раньше, по умолчанию);
--   requires_lectures = 1, lecture_mode = 'selected'    → только лекции из exam_lectures (черновики и удалённые не учитываются).
ALTER TABLE exams ADD COLUMN lecture_mode TEXT NOT NULL DEFAULT 'all';

CREATE TABLE IF NOT EXISTS exam_lectures (
  exam_id INTEGER NOT NULL,
  lecture_id INTEGER NOT NULL,
  PRIMARY KEY (exam_id, lecture_id)
);
CREATE INDEX IF NOT EXISTS idx_exam_lectures_lecture ON exam_lectures(lecture_id);
