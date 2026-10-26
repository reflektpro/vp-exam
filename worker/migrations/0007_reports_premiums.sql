-- 0007: еженедельные отчёты сотрудников ГУ ВП и расчёт премий (приказ № 01_10), роль «Руководство ГУ ВП».
-- Применяется один раз (ALTER TABLE … ADD COLUMN). Существующие данные не меняются.
ALTER TABLE users ADD COLUMN leader INTEGER NOT NULL DEFAULT 0;        -- роль «Руководство ГУ ВП»
ALTER TABLE users ADD COLUMN staff INTEGER NOT NULL DEFAULT 0;         -- в составе ГУ ВП (обязан сдавать отчёт)
ALTER TABLE users ADD COLUMN senior INTEGER NOT NULL DEFAULT 0;        -- старший состав (премия СС, взносы в бюджет)
ALTER TABLE users ADD COLUMN staff_position TEXT;                      -- должность по составу (ключ таблицы окладов)
ALTER TABLE users ADD COLUMN staff_since TEXT;                         -- неделя (пн), с которой учитываются нарушения

CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  week TEXT NOT NULL,                    -- понедельник 'YYYY-MM-DD'
  position TEXT NOT NULL,                -- ключ должности из отчёта
  data TEXT NOT NULL,                    -- {header, items:[{key,name,group,n,vp,links,custom}]}
  points INTEGER NOT NULL DEFAULT 0,     -- баллы еженедельного отчёта (только основная отчётность)
  status TEXT NOT NULL DEFAULT 'submitted', -- submitted | review | approved | rejected
  late INTEGER NOT NULL DEFAULT 0,       -- первая отправка после срока → без премии
  edited_after_deadline INTEGER NOT NULL DEFAULT 0,
  item_review TEXT NOT NULL DEFAULT '{}',-- {key: {status: ok|rejected, n_ok, comment, by, at}}
  comment TEXT,
  reviewed_by TEXT, reviewed_at INTEGER,
  version INTEGER NOT NULL DEFAULT 1,
  first_submitted_at INTEGER NOT NULL,
  submitted_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, week)
);
CREATE INDEX IF NOT EXISTS idx_reports_week ON reports(week);
CREATE TABLE IF NOT EXISTS report_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  position TEXT,
  data TEXT NOT NULL,
  submitted_at INTEGER NOT NULL,
  after_deadline INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_report_history ON report_history(report_id);
CREATE TABLE IF NOT EXISTS prem_config (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_by TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS prem_weeks (week TEXT PRIMARY KEY, fund INTEGER NOT NULL DEFAULT 0, note TEXT, updated_by TEXT, updated_at INTEGER);
CREATE TABLE IF NOT EXISTS prem_manual (
  week TEXT NOT NULL, user_id TEXT NOT NULL,
  award INTEGER NOT NULL DEFAULT 0,        -- наградная премия из фонда (100 000–700 000)
  ss INTEGER NOT NULL DEFAULT 0,           -- премия старшего состава (до 500 000)
  award_budget INTEGER NOT NULL DEFAULT 0, -- наградная из бюджета ГУ ВП (вне лимита 2 000 000)
  note TEXT, updated_by TEXT, updated_at INTEGER,
  PRIMARY KEY (week, user_id)
);
CREATE TABLE IF NOT EXISTS budget_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,                      -- contribution | leftover | income | withdrawal
  amount INTEGER NOT NULL,
  user_id TEXT, week TEXT, note TEXT,
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  deleted_by TEXT, deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_budget_week ON budget_ledger(week);
CREATE TABLE IF NOT EXISTS violation_excuses (user_id TEXT NOT NULL, week TEXT NOT NULL, note TEXT, by_id TEXT, at INTEGER, PRIMARY KEY (user_id, week));
