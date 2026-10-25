-- 0005: переаттестации как записи (админ создаёт/редактирует/удаляет), вместо двух фиксированных версий в settings.reatt_config.
-- attempts.reatt хранит reattestations.key; у существующих попыток key = 'full' / 'simple' — они остаются привязаны к одноимённым записям.
-- Признак «простой» (questions.easy) больше не используется: обнуляется, столбец оставлен для совместимости.
CREATE TABLE IF NOT EXISTS reattestations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  enabled INTEGER NOT NULL DEFAULT 1,
  visible INTEGER NOT NULL DEFAULT 1,
  time_limit_min INTEGER NOT NULL DEFAULT 0,
  pass_pct INTEGER NOT NULL DEFAULT 70,
  cooldown_min INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 0,
  q_points REAL,                       -- баллы за вопрос (NULL — как в банке)
  c_points REAL,                       -- баллы за кейс (NULL — как в банке)
  groups TEXT NOT NULL DEFAULT '[]',   -- [{label, categories:[…], questions, cases}]
  position INTEGER NOT NULL DEFAULT 0,
  deleted_at INTEGER,                  -- мягкое удаление (если есть попытки)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO reattestations (key, title, description, enabled, visible, time_limit_min, pass_pct, groups, position, created_at, updated_at) VALUES
 ('full', 'Переаттестация — полная (общая)', 'Законодательство и внутренние уставы. Кейсы проверяет экзаменатор.', 1, 1, 120, 70,
  '[{"label":"ПК","categories":["ПК"],"questions":4,"cases":1},{"label":"УК","categories":["УК"],"questions":4,"cases":1},{"label":"ВУ","categories":["ВУ"],"questions":8,"cases":2},{"label":"СУ","categories":["СУ"],"questions":2,"cases":1},{"label":"КПС","categories":["КПС"],"questions":2,"cases":1},{"label":"ДУ","categories":["ДУ"],"questions":2,"cases":1},{"label":"ФЗ / ФКЗ / КоАП","categories":["ФЗ*","ФКЗ*","КоАП"],"questions":6,"cases":2},{"label":"ТК","categories":["ТК"],"questions":4,"cases":1}]',
  10, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000),
 ('simple', 'Переаттестация — упрощённая (уставы)', 'Только внутренние уставы. Кейсы проверяет экзаменатор.', 1, 1, 60, 70,
  '[{"label":"ВУ","categories":["ВУ"],"questions":9,"cases":0},{"label":"СУ","categories":["СУ"],"questions":2,"cases":0},{"label":"ДУ","categories":["ДУ"],"questions":2,"cases":0},{"label":"КПС","categories":["КПС"],"questions":2,"cases":0},{"label":"Кейсы по уставам","categories":["ВУ","СУ","ДУ","КПС"],"questions":0,"cases":3}]',
  20, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
UPDATE questions SET easy = 0 WHERE easy <> 0;
