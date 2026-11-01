-- 0016: переаттестации v2 — шесть видов, отдельные базы вопросов, сложность 1/2/3, привязка к документам проекта, изображения.
-- Только ADD/CREATE/INSERT: существующие вопросы, попытки, выдачи доступа (reatt_access) и результаты не меняются.
-- questions.base — база переаттестации (cases_int, cases_gen, simple, medium, full, vp; NULL — обычный банк/экзамены);
-- questions.difficulty — 1 лёгкий / 2 средний / 3 сложный; source_doc — id документа проекта; source_ref — пункт/статья.
ALTER TABLE questions ADD COLUMN base TEXT;
ALTER TABLE questions ADD COLUMN difficulty INTEGER;
ALTER TABLE questions ADD COLUMN source_doc TEXT;
ALTER TABLE questions ADD COLUMN source_ref TEXT;
CREATE INDEX IF NOT EXISTS idx_questions_base ON questions(base, active);
-- reattestations.mode: 'groups' — прежняя выборка по блокам категорий; 'bank' — выборка из базы по cfg (количество, доли сложности, темы, баллы).
-- level/track — место в иерархии: track 'line' (Упрощённая 1 → Средняя 2 → Полная общая 3 → Полная ВП 4) или 'cases' (отдельная категория).
ALTER TABLE reattestations ADD COLUMN mode TEXT NOT NULL DEFAULT 'groups';
ALTER TABLE reattestations ADD COLUMN cfg TEXT NOT NULL DEFAULT '{}';
ALTER TABLE reattestations ADD COLUMN level INTEGER NOT NULL DEFAULT 0;
ALTER TABLE reattestations ADD COLUMN track TEXT NOT NULL DEFAULT '';
-- изображения к вопросам (загружает администратор); отдаются по неугадываемому ключу GET /media/<key>
CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  mime TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
-- место трёх прежних видов в иерархии (режим выборки меняет миграция с контентом баз — 0017)
UPDATE reattestations SET track = 'line', level = 1, position = 10 WHERE key = 'simple';
UPDATE reattestations SET track = 'line', level = 3, position = 30 WHERE key = 'full';
UPDATE reattestations SET track = 'cases', level = 2, position = 60 WHERE key = 'cases';
-- три новых вида (без выдачи доступа кандидаты их не видят)
INSERT OR IGNORE INTO reattestations (key, title, description, enabled, visible, time_limit_min, pass_pct, groups, position, created_at, updated_at, mode, cfg, level, track) VALUES
 ('cases_int', 'Переаттестация по внутренним кейсам', 'Ситуационные задачи по внутренним уставам (ВУ, ДУ, КПС, СУ).', 1, 1, 60, 70, '[]', 50,
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000, 'bank',
  '{"base":"cases_int","count":8,"mix":[25,50,25],"pts":[1,2,3],"topics":{},"types":[],"max_topic_pct":50,"max_type_pct":60,"partial":"question","pass_points":null,"unique_ref":true,"avoid_repeat":true}', 1, 'cases'),
 ('medium', 'Переаттестация — средняя', 'Внутренние уставы и важнейшие нормы ПК, ФЗ, ФКЗ, КоАП.', 1, 1, 60, 70, '[]', 20,
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000, 'bank',
  '{"base":"medium","count":20,"mix":[30,50,20],"pts":[1,2,3],"topics":{},"types":[],"max_topic_pct":35,"max_type_pct":50,"partial":"question","pass_points":null,"unique_ref":true,"avoid_repeat":true}', 2, 'line'),
 ('full_vp', 'Переаттестация — полная ВП', 'Максимальная сложность: законодательство и уставы в применении к службе Военной полиции.', 1, 1, 90, 75, '[]', 40,
  CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000, 'bank',
  '{"base":"vp","count":30,"mix":[10,35,55],"pts":[1,2,3],"topics":{},"types":[],"max_topic_pct":30,"max_type_pct":40,"partial":"question","pass_points":null,"unique_ref":true,"avoid_repeat":true}', 4, 'line');
