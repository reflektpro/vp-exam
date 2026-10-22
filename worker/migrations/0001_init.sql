-- ГУ ВП — экзаменационный портал. Схема D1 (SQLite).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,               -- Discord user id
  username TEXT NOT NULL DEFAULT '',
  global_name TEXT,
  avatar TEXT,
  ic_name TEXT,                      -- игровое имя
  static_id TEXT,                    -- статик
  rank TEXT,                         -- звание
  role TEXT NOT NULL DEFAULT 'candidate', -- candidate | examiner | admin
  blocked INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  ip TEXT,
  ua TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS oauth_states (
  state TEXT PRIMARY KEY,
  return_to TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS login_codes (
  code_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS rate_limits (
  k TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  cnt INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS lectures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  video_url TEXT NOT NULL DEFAULT '',
  duration_sec INTEGER NOT NULL DEFAULT 0,
  position INTEGER NOT NULL DEFAULT 0,
  required INTEGER NOT NULL DEFAULT 1,
  published INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS lecture_progress (
  user_id TEXT NOT NULL,
  lecture_id INTEGER NOT NULL,
  max_pos REAL NOT NULL DEFAULT 0,
  last_pos REAL NOT NULL DEFAULT 0,
  watched_sec REAL NOT NULL DEFAULT 0,
  last_hb_at INTEGER,                -- ms
  rejected INTEGER NOT NULL DEFAULT 0,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  PRIMARY KEY (user_id, lecture_id)
);

CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  time_limit_min INTEGER NOT NULL DEFAULT 0,   -- 0 = без ограничения
  max_attempts INTEGER NOT NULL DEFAULT 0,     -- 0 = без ограничения
  cooldown_min INTEGER NOT NULL DEFAULT 0,
  pass_pct INTEGER NOT NULL DEFAULT 70,
  shuffle_questions INTEGER NOT NULL DEFAULT 0,
  shuffle_options INTEGER NOT NULL DEFAULT 0,
  requires_lectures INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  type TEXT NOT NULL,                -- single | multi | text | long
  text TEXT NOT NULL,
  options TEXT NOT NULL DEFAULT '[]',-- JSON [{id,text}]
  correct TEXT NOT NULL DEFAULT '[]',-- JSON [optionId,...]
  reference TEXT NOT NULL DEFAULT '',-- эталонный ответ для проверяющего
  points INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_questions_exam ON questions(exam_id);

CREATE TABLE IF NOT EXISTS attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  exam_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,              -- in_progress | pending_review | passed | failed
  started_at INTEGER NOT NULL,
  deadline_at INTEGER,               -- ms, NULL = без лимита
  submitted_at INTEGER,
  expired INTEGER NOT NULL DEFAULT 0,
  q_order TEXT NOT NULL DEFAULT '[]',
  opt_order TEXT NOT NULL DEFAULT '{}',
  auto_score REAL NOT NULL DEFAULT 0,
  manual_score REAL NOT NULL DEFAULT 0,
  max_score REAL NOT NULL DEFAULT 0,
  score_pct REAL,
  reviewer_id TEXT,
  reviewer_comment TEXT,
  reviewed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON attempts(user_id, exam_id);
CREATE INDEX IF NOT EXISTS idx_attempts_status ON attempts(status);

CREATE TABLE IF NOT EXISTS answers (
  attempt_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  answer TEXT NOT NULL DEFAULT 'null', -- JSON
  auto_points REAL,
  manual_points REAL,
  needs_review INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (attempt_id, question_id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT,
  details TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit_log(at);

INSERT OR IGNORE INTO settings (k, v) VALUES
  ('site_title', 'ГУ ВП — Учебный центр'),
  ('welcome_text', 'Добро пожаловать в учебный центр Главного управления Военной полиции. Войдите через Discord, просмотрите все лекции по порядку — после этого откроется экзамен.'),
  ('sequential_lectures', '1');
