-- 0023: резервные копии сайта (только главные администраторы) и роль «Руководство (СС)».
-- users.role теперь: candidate | examiner | manager | admin (manager — «Руководство (СС)»); схема users не меняется.
-- Настройка promo_missing_points (settings) и обязательные курсы для повышения (prem_config 'promo_courses') — ключи в существующих таблицах.
CREATE TABLE IF NOT EXISTS site_backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL,
  created_by TEXT,
  created_by_name TEXT,
  label TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'manual',      -- manual | auto (перед восстановлением) | upload (из файла)
  status TEXT NOT NULL DEFAULT 'building',  -- building | ready
  size INTEGER NOT NULL DEFAULT 0,
  parts INTEGER NOT NULL DEFAULT 0,
  summary TEXT,
  restored_at INTEGER,
  restored_by TEXT
);
CREATE TABLE IF NOT EXISTS site_backup_parts (
  backup_id INTEGER NOT NULL,
  idx INTEGER NOT NULL,
  tbl TEXT NOT NULL,
  nrows INTEGER NOT NULL DEFAULT 0,
  data TEXT NOT NULL,
  PRIMARY KEY (backup_id, idx)
);
