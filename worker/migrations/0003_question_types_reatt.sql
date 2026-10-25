-- 0003: все типы вопросов, банк вопросов (категории/кейсы/«не душные»), переаттестация, загрузки файлов и голосовых ответов.
-- Только добавление столбцов (со значениями по умолчанию) и новых таблиц — существующие экзамены, вопросы и попытки не меняются.
-- Старые вопросы single/multi/text/long продолжают работать как раньше (options/correct остаются на месте, data = '{}').
--
-- questions.exam_id = 0      → вопрос из банка переаттестации (не привязан к экзамену)
-- questions.data             → JSON с параметрами типа (правильные ответы, допуски, разметка пропусков и т.д.; кандидату не отдаётся)
-- questions.category         → ПК, УК, ТК, ВУ, СУ, ДУ, КПС, «ФЗ об обороне», … (свободный текст)
-- questions.kind             → 'question' | 'case'
-- questions.easy             → 1 = «не душный» (простой) вопрос, предпочитается в упрощённой переаттестации
-- questions.active           → 0 = вопрос выключен (не попадает в выборку/новые попытки)
-- questions.ext_id           → внешний id из импорта (для обновления при повторном импорте)
-- attempts.reatt             → NULL для экзаменов; 'full' | 'simple' для переаттестации (exam_id = 0)
-- attempts.meta              → JSON: какие вопросы попали в какой блок квот
ALTER TABLE questions ADD COLUMN data TEXT NOT NULL DEFAULT '{}';
ALTER TABLE questions ADD COLUMN category TEXT NOT NULL DEFAULT '';
ALTER TABLE questions ADD COLUMN kind TEXT NOT NULL DEFAULT 'question';
ALTER TABLE questions ADD COLUMN easy INTEGER NOT NULL DEFAULT 0;
ALTER TABLE questions ADD COLUMN active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE questions ADD COLUMN ext_id TEXT;
ALTER TABLE questions ADD COLUMN created_at INTEGER;
ALTER TABLE questions ADD COLUMN updated_at INTEGER;
CREATE INDEX IF NOT EXISTS idx_questions_bank ON questions(exam_id, category, kind);
CREATE INDEX IF NOT EXISTS idx_questions_ext ON questions(exam_id, ext_id);

ALTER TABLE attempts ADD COLUMN reatt TEXT;
ALTER TABLE attempts ADD COLUMN meta TEXT NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_attempts_reatt ON attempts(user_id, reatt);

-- Файлы и голосовые ответы кандидатов (R2 на аккаунте не включён — храним в D1 base64, до 1 МБ на файл).
CREATE TABLE IF NOT EXISTS uploads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  attempt_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  kind TEXT NOT NULL,              -- file | voice
  name TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL DEFAULT '',
  size INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,              -- base64
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_uploads_attempt ON uploads(attempt_id, question_id);
