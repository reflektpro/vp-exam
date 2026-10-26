-- 0008: роли доступа (ВП, Переаттестация), профиль (должность), курсы (курс → лекции → экзамен), база данных (документация),
-- удалённые отчёты (архив). Применяется один раз (ALTER TABLE … ADD COLUMN). Существующие данные не меняются.

-- роли: «ВП» — учебный отдел, отчёты, премирование, система повышения; «Переаттестация» — раздел переаттестации.
-- «Проверяющий» и «Администратор» — users.role (как раньше), «Руководство ГУ ВП» — users.leader (0007).
ALTER TABLE users ADD COLUMN vp INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN reatt INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN position TEXT;                 -- должность из профиля (по желанию)
-- уже зарегистрированные пользователи сохраняют доступ, который у них был до ролей (лекции, экзамены, переаттестация)
UPDATE users SET vp = 1, reatt = 1;

-- курсы: лекции и экзамены группируются по курсам
CREATE TABLE IF NOT EXISTS courses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
ALTER TABLE lectures ADD COLUMN course_id INTEGER;
ALTER TABLE exams ADD COLUMN course_id INTEGER;
-- заготовки: каждый экзамен со своими лекциями становится курсом (название курса = название экзамена, его можно поменять)
INSERT INTO courses (id, title, description, position, published, created_at, updated_at)
  SELECT id, title, '', id * 10, published, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000 FROM exams;
UPDATE exams SET course_id = id;
UPDATE lectures SET course_id = (SELECT MIN(el.exam_id) FROM exam_lectures el WHERE el.lecture_id = lectures.id);
UPDATE lectures SET course_id = (SELECT MIN(e.id) FROM exams e WHERE e.requires_lectures = 1 AND COALESCE(e.lecture_mode, 'all') = 'all') WHERE course_id IS NULL;

-- база данных (документация): читать могут все, добавлять и править — администраторы
CREATE TABLE IF NOT EXISTS docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  category TEXT NOT NULL DEFAULT 'Общее',
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  created_by TEXT, updated_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_docs_cat ON docs(category, position);

-- удалённые отчёты: полная копия (отчёт + история правок) для журнала; сам отчёт удаляется, неделю можно сдать заново
CREATE TABLE IF NOT EXISTS reports_deleted (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL,
  user_id TEXT NOT NULL,
  week TEXT NOT NULL,
  row_json TEXT NOT NULL,
  history_json TEXT NOT NULL DEFAULT '[]',
  reason TEXT,
  deleted_by TEXT NOT NULL,
  deleted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reports_deleted_week ON reports_deleted(week);

-- стартовые статьи базы данных (их можно править и удалять)
INSERT INTO docs (category, title, body, position, created_at, updated_at) VALUES ('Сайт ГУ ВП', 'Роли и разделы сайта', 'Сайт открывает разделы по ролям. Роли назначает администратор на странице пользователя («Админка» → «Пользователи»), у одного человека может быть несколько ролей.

## Разделы

- **База данных** и **Личные дела** — всем, кто вошёл через Discord.
- **Учебный отдел** (курсы, лекции, экзамены), **Отчёты**, **Премирование**, **Система повышения** — роль «ВП».
- **Переаттестация** — роль «Переаттестация».
- **Админка** — роли «Проверяющий» (проверка попыток) и «Администратор» (всё содержимое сайта).
- **Отчёты и премии (руководство)** — роль «Руководство ГУ ВП» и администраторы: проверка отчётов, фонд, бюджет ГУ ВП, нарушения.

Если раздела нет в меню — у вас нет нужной роли. Обратитесь к руководству ГУ ВП.

## Профиль

В профиле укажите **Имя Фамилия**, **звание**, **статик** и должность. Эти данные сами подставляются в отчёты и документы на сайте бланков. Администраторы могут исправить их за вас — каждое изменение записывается в журнал.', 10, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT INTO docs (category, title, body, position, created_at, updated_at) VALUES ('Отчёты и премии', 'Как сдать еженедельный отчёт', '1. Откройте раздел **Отчёты** и нажмите «Заполнить отчёт» — откроется бланк еженедельного отчёта.
2. Отчётный период — неделя с **понедельника по воскресенье**.
3. Выберите должность из списка (по ней считается оклад).
4. Отметьте выполненное и приложите ссылки на доказательства к каждому пункту.
5. Нажмите **«Отправить отчёт»**. Повторная отправка за ту же неделю обновляет тот же отчёт — руководство видит историю правок.

**Срок — воскресенье 19:00 МСК.** Отчёт после срока сохраняется, но премия по нему не начисляется. Неделя без отчёта в срок — нарушение: 1 — предупреждение, 2 — выговор, 3 — увольнение.

Статус отчёта (отправлен, на проверке, принят, отклонён), комментарий руководства и незасчитанные пункты видны в разделе «Отчёты» и под кнопкой отправки.', 10, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
INSERT INTO docs (category, title, body, position, created_at, updated_at) VALUES ('Отчёты и премии', 'Как считается премия (приказ № 01_10)', 'Премия считается автоматически по принятым пунктам отчёта.

## Оклад и выплаты за действия

- **Нормальный план** — средний оклад + выплаты за действия полностью.
- **Минимальный план** — минимальный оклад + выплаты за действия − 20%.
- **План не выполнен** (отчёт сдан) — нулевой оклад + выплаты за действия − 50%.
- Оклад + действия — не больше **максимальной выплаты** должности. Превышение идёт в дополнительную премию (до 400 000 ₽).

## Надбавки

После базовой премии из фонда недели по очереди: дополнительная премия → наградная (100 000–700 000 ₽, назначает руководство) → премия старшего состава (до 500 000 ₽). Если фонда не хватает, надбавки урезаются.

Лимит на человека — **2 000 000 ₽** (оклад + премия + доп. + наградная из фонда).

## Наградная из бюджета ГУ ВП

Платится из другого источника — бюджета ГУ ВП, — поэтому показывается **отдельно** и в «Итого из фонда» не входит.

## Когда видна сумма

Список премий недели открывается всем ВП после срока (воскресенье 19:00 МСК), по принятым отчётам. Итоговые суммы появляются, когда руководство проверит все отчёты недели. Благодарность от руководства: каждые 50 баллов = 1 благодарность = 2 500 ₽.', 20, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000);
