-- 0012: портал (нейтральное название, без приветственного текста), переаттестации короче и проще, доступ к переаттестации по выдаче.
-- Применяется один раз. Новая таблица + точечные UPDATE (только если значения не меняли вручную); остальные данные не трогаются.

-- доступ к переаттестации: без выдачи переаттестация не видна (кроме администраторов)
CREATE TABLE IF NOT EXISTS reatt_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  reatt_key TEXT NOT NULL,          -- reattestations.key
  user_id TEXT,                     -- кому; NULL — всем с ролью «Переаттестация»
  expires_at INTEGER,               -- до какого момента (мс); NULL — бессрочно
  attempts INTEGER,                 -- сколько попыток по этой выдаче (на человека); NULL — без ограничения
  note TEXT NOT NULL DEFAULT '',
  granted_by TEXT NOT NULL, granted_at INTEGER NOT NULL,
  revoked_at INTEGER, revoked_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_reatt_access ON reatt_access(reatt_key, user_id);

-- главная: общее название портала, без текста «Добро пожаловать в учебный центр…»
UPDATE settings SET v = 'ГУ ВП — портал' WHERE k = 'site_title' AND v = 'ГУ ВП — Учебный центр';
UPDATE settings SET v = '' WHERE k = 'welcome_text' AND v = 'Добро пожаловать в учебный центр Главного управления Военной полиции. Войдите через Discord, просмотрите все лекции по порядку — после этого откроется экзамен.';

-- общая переаттестация: 28 вопросов, в первую очередь — с одним верным ответом (проще), 60 минут
UPDATE reattestations SET groups = '[{"label": "ПК", "categories": ["ПК"], "questions": 4, "cases": 0, "pref_types": ["single"], "pref_count": 4}, {"label": "УК", "categories": ["УК"], "questions": 3, "cases": 0, "pref_types": ["single"], "pref_count": 3}, {"label": "ВУ", "categories": ["ВУ"], "questions": 6, "cases": 0, "pref_types": ["single"], "pref_count": 6}, {"label": "СУ", "categories": ["СУ"], "questions": 2, "cases": 0, "pref_types": ["single"], "pref_count": 2}, {"label": "КПС", "categories": ["КПС"], "questions": 2, "cases": 0, "pref_types": ["single"], "pref_count": 2}, {"label": "ДУ", "categories": ["ДУ"], "questions": 2, "cases": 0, "pref_types": ["single"], "pref_count": 2}, {"label": "ФЗ / ФКЗ / КоАП", "categories": ["ФЗ*", "ФКЗ*", "КоАП"], "questions": 6, "cases": 0, "pref_types": ["single"], "pref_count": 6}, {"label": "ТК", "categories": ["ТК"], "questions": 3, "cases": 0, "pref_types": ["single"], "pref_count": 3}]',
  description = '28 вопросов по законодательству и уставам — в основном с одним верным ответом. Проверяется автоматически, результат сразу после отправки.',
  time_limit_min = 60, updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'full' AND deleted_at IS NULL;
-- упрощённая: 12 вопросов по уставам, 30 минут
UPDATE reattestations SET groups = '[{"label": "ВУ", "categories": ["ВУ"], "questions": 6, "cases": 0, "pref_types": [], "pref_count": 0}, {"label": "СУ", "categories": ["СУ"], "questions": 2, "cases": 0, "pref_types": [], "pref_count": 0}, {"label": "ДУ", "categories": ["ДУ"], "questions": 2, "cases": 0, "pref_types": [], "pref_count": 0}, {"label": "КПС", "categories": ["КПС"], "questions": 2, "cases": 0, "pref_types": [], "pref_count": 0}]',
  description = 'Только внутренние уставы, 12 вопросов. Проверяется автоматически, результат сразу после отправки.',
  time_limit_min = 30, updated_at = CAST(strftime('%s','now') AS INTEGER) * 1000
WHERE key = 'simple' AND deleted_at IS NULL;
