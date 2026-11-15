-- Индексы под чтения, которые раньше шли полным сканом таблицы на каждую строку списка (лимит D1 по прочитанным строкам).
-- Сколько засчитано просмотров лекции (админ-список лекций) и удаление прогресса лекции.
CREATE INDEX IF NOT EXISTS idx_lecture_progress_lecture ON lecture_progress(lecture_id, completed_at);
-- Попытки и ожидающие проверки по экзамену (админ-список экзаменов, удаление экзамена).
CREATE INDEX IF NOT EXISTS idx_attempts_exam ON attempts(exam_id, status);
-- Попытки по виду переаттестации (доступы, сводки).
CREATE INDEX IF NOT EXISTS idx_attempts_reatt_key ON attempts(reatt, status);
-- История профиля и досье: записи журнала по человеку.
CREATE INDEX IF NOT EXISTS idx_audit_target ON audit_log(target, at);
-- Банк: только активные вопросы, по базе и типу (пул банка, база переаттестации, «есть ли ручная проверка»).
CREATE INDEX IF NOT EXISTS idx_questions_bank_active ON questions(exam_id, active, base, type);
