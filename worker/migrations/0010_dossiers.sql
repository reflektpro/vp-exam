-- 0010: личные дела (досье) сотрудников ГУ ВП. Применяется один раз. Существующие данные не меняются:
-- только новые таблицы + заведение дел на текущих сотрудников (роль «ВП» или состав ГУ ВП).
-- Имя Фамилия, звание, статик, должность — это поля профиля (users), досье их показывает и правит (с журналом).

-- ручные поля дела; заполняет и меняет только старший состав (проверка на сервере)
CREATE TABLE IF NOT EXISTS dossiers (
  user_id TEXT PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'active',      -- active | archived (уволен — дело в архиве, не удаляется)
  joined_on TEXT,                             -- дата вступления в ГУ ВП, ГГГГ-ММ-ДД
  age INTEGER,                                -- возраст (ИРЛ)            — видят только СС и сам сотрудник
  timezone TEXT,                              -- часовой пояс             — только СС и сам сотрудник
  online_hours REAL,                          -- средний онлайн, часов в день
  online_time TEXT,                           -- обычное время онлайна (например «18:00–23:00 МСК»)
  discord TEXT,                               -- Discord для связи
  vehicles TEXT NOT NULL DEFAULT '[]',        -- личные ТС: [{model, plate}]
  service_cars TEXT NOT NULL DEFAULT '[]',    -- служебные автомобили ВП: [{model, plate, main}]
  law_score INTEGER,                          -- оценка знания законодательства СС, 1–5   — только СС и сам
  law_comment TEXT,                           --                                          — только СС и сам
  notes TEXT NOT NULL DEFAULT '',             -- характеристика / заметки СС              — только СС и сам
  archived_at INTEGER, archive_reason TEXT,
  created_by TEXT, created_at INTEGER NOT NULL,
  updated_by TEXT, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dossiers_status ON dossiers(status);

-- ручная история: взыскания, поощрения, повышения / понижения / переводы, заметки (+ архив / восстановление)
CREATE TABLE IF NOT EXISTS dossier_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,                         -- penalty | reward | promotion | demotion | transfer | note | archive | restore
  subtype TEXT NOT NULL DEFAULT '',           -- вид: «выговор», «благодарность» …
  on_date TEXT NOT NULL,                      -- дата события, ГГГГ-ММ-ДД
  reason TEXT NOT NULL DEFAULT '',            -- причина / основание / текст заметки
  evidence TEXT NOT NULL DEFAULT '',          -- ссылка на доказательство
  issued_by TEXT NOT NULL DEFAULT '',         -- кем выдано
  from_rank TEXT, to_rank TEXT, from_position TEXT, to_position TEXT,
  lifted_at INTEGER, lifted_by TEXT, lift_reason TEXT,   -- снятие взыскания
  created_by TEXT NOT NULL, created_at INTEGER NOT NULL,
  updated_by TEXT, updated_at INTEGER, deleted_at INTEGER -- удаление ошибочной записи — мягкое, в журнале
);
CREATE INDEX IF NOT EXISTS idx_dossier_events_user ON dossier_events(user_id, on_date);

-- дела на текущих сотрудников (роль «ВП» или состав ГУ ВП); дата вступления — неделя начала учёта в составе, если есть
INSERT OR IGNORE INTO dossiers (user_id, status, joined_on, created_by, created_at, updated_at)
  SELECT id, 'active', staff_since, 'migration', CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
  FROM users WHERE blocked = 0 AND (vp = 1 OR staff = 1);
