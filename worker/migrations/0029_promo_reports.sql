-- Рапорты на повышение: подача из портала и проверка руководством по пунктам (как еженедельный отчёт).
CREATE TABLE IF NOT EXISTS promo_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',   -- submitted | review | approved | rejected
  rank TEXT NOT NULL DEFAULT '',              -- текущее звание из рапорта
  target TEXT NOT NULL DEFAULT '',            -- испрашиваемое звание
  data TEXT NOT NULL,                         -- {header, items:[{key,name,group,n,links,custom}]}
  item_review TEXT NOT NULL DEFAULT '{}',     -- {key: {status: ok|rejected, n_ok, comment, by, at}}
  comment TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  first_submitted_at INTEGER NOT NULL,
  submitted_at INTEGER NOT NULL,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_promo_reports_user ON promo_reports(user_id, id);
CREATE INDEX IF NOT EXISTS idx_promo_reports_status ON promo_reports(status, id);
