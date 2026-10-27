-- 0009: группы вариантов вопросов (topic), текстовые лекции, экзамены с выборкой из банка.
-- Только добавляет столбцы; существующие данные не меняются. Применяется один раз.
-- questions.topic — id группы вариантов: в одной попытке не выдаются два вопроса с одинаковым topic (NULL — без ограничений).
ALTER TABLE questions ADD COLUMN topic TEXT;
CREATE INDEX IF NOT EXISTS idx_questions_topic ON questions(topic);
-- lectures.body — текст лекции (Markdown). Лекция без видео, но с текстом — «текстовая»: засчитывается по времени чтения (duration_sec).
ALTER TABLE lectures ADD COLUMN body TEXT NOT NULL DEFAULT '';
-- exams.bank_category / bank_count — экзамен берёт bank_count случайных вопросов из банка (категория, можно с *), без повторов topic.
ALTER TABLE exams ADD COLUMN bank_category TEXT;
ALTER TABLE exams ADD COLUMN bank_count INTEGER NOT NULL DEFAULT 0;
