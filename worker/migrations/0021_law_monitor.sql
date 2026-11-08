-- 0021: мониторинг законодательства. Новые таблицы, существующие вопросы и попытки не меняются.
-- Портал хранит опубликованные отчёты проверки и решения администратора.
-- Одобрение не переписывает questions.correct / текст вопроса и не заменяет content/reatt6/docs.

CREATE TABLE IF NOT EXISTS law_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  status TEXT NOT NULL,
  offline INTEGER NOT NULL DEFAULT 0,
  partial INTEGER NOT NULL DEFAULT 0,
  applied_locally INTEGER NOT NULL DEFAULT 0,
  payload_hash TEXT NOT NULL,
  generated_at INTEGER,
  finished_at INTEGER NOT NULL,
  runner TEXT NOT NULL DEFAULT '',
  summary_json TEXT NOT NULL,
  actor_id TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_law_checks_created ON law_checks(created_at);

CREATE TABLE IF NOT EXISTS law_doc_state (
  doc_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  last_check_id INTEGER,
  last_ok_at INTEGER,
  last_error_at INTEGER,
  last_error TEXT,
  edition_old TEXT,
  edition_new TEXT,
  accepted_edition TEXT,
  accepted_proposal_id INTEGER,
  pending_proposal_id INTEGER,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS law_proposals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT NOT NULL,
  check_id INTEGER NOT NULL,
  status TEXT NOT NULL,
  edition_old TEXT,
  edition_new TEXT,
  summary TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  questions_json TEXT NOT NULL,
  review_generation INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  reviewed_by TEXT,
  reviewed_at INTEGER,
  review_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_law_prop_doc ON law_proposals(doc_id, status, id);

CREATE TABLE IF NOT EXISTS law_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER,
  proposal_id INTEGER,
  doc_id TEXT,
  action TEXT NOT NULL,
  actor_id TEXT,
  details TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_law_events_at ON law_events(at);

CREATE TABLE IF NOT EXISTS law_question_flags (
  question_id INTEGER PRIMARY KEY,
  ext_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  proposal_id INTEGER,
  issue TEXT NOT NULL,
  detail TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  ack_by TEXT,
  ack_at INTEGER,
  ack_note TEXT
);
CREATE INDEX IF NOT EXISTS idx_law_flags_doc ON law_question_flags(doc_id, status);
