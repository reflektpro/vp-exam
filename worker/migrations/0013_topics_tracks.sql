-- 0013: курсы → темы → короткие лекции → полная выгрузка (статья Базы данных, после всех лекций темы) → видео → экзамены по темам.
-- Две системы курсов: «Система званий» (track = 'rank') и «Система должностей» (track = 'position').
-- Связанная тема (link_topic_id) показывает лекции исходной темы — прохождение общее (Основы ГУ ВП в курсе «Стажёр ВП»).
-- Экзамен по теме/группе тем: exams.topic_ids (JSON) + lecture_mode = 'topics'.
-- Существующий курс «По задержанию и процессуальному кодексу» становится курсом 3 «Кодексы», его 5 лекций — темой «ПК».
-- Ничего не удаляется; новые экзамены заводятся черновиками (публикуются, когда готовы лекции/вопросы).

ALTER TABLE courses ADD COLUMN track TEXT NOT NULL DEFAULT 'rank';
ALTER TABLE courses ADD COLUMN subtitle TEXT NOT NULL DEFAULT '';
ALTER TABLE courses ADD COLUMN slug TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_courses_slug ON courses(slug) WHERE slug IS NOT NULL;

CREATE TABLE IF NOT EXISTS topics (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  course_id INTEGER NOT NULL,
  slug TEXT,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL DEFAULT 0,
  published INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'ready',          -- ready | draft (текст требует сверки) | placeholder (заполняется вручную)
  link_topic_id INTEGER,                         -- связанная тема: лекции/выгрузка/видео берутся из исходной
  doc_id INTEGER,                                -- полная выгрузка — статья Базы данных
  video_url TEXT NOT NULL DEFAULT '',
  video_plan TEXT NOT NULL DEFAULT '',           -- план ролика (видят только администраторы)
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_topics_course ON topics(course_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS idx_topics_slug ON topics(slug) WHERE slug IS NOT NULL;
ALTER TABLE lectures ADD COLUMN topic_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_lectures_topic ON lectures(topic_id, position);
ALTER TABLE exams ADD COLUMN topic_ids TEXT NOT NULL DEFAULT '[]';

-- ---------- Система званий ----------
INSERT INTO courses (title, description, published, position, created_at, updated_at, track, subtitle, slug) VALUES
 ('Курс 1. Основы ГУ ВП', 'Что такое Главное управление Военной полиции, его место в бригаде, структура, полномочия, порядок службы, отчётность и премирование.', 1, 1010, strftime('%s','now')*1000, strftime('%s','now')*1000, 'rank', 'Система званий', 'r1'),
 ('Курс 2. Уставы', 'Дисциплинарный, Внутренний, Строевой уставы и Устав караульно-постовой службы 1-й мотострелковой бригады. Общий экзамен по всем уставам.', 1, 1020, strftime('%s','now')*1000, strftime('%s','now')*1000, 'rank', 'Система званий', 'r2');
UPDATE courses SET title = 'Курс 3. Кодексы', slug = 'r3', track = 'rank', subtitle = 'Система званий', position = 1030,
  description = 'Процессуальный, Уголовно-процессуальный, Уголовный кодексы и КоАП — в части, нужной Военной полиции. Экзамены: «ПК + УПК» и «УК + КоАП».'
  WHERE id = (SELECT id FROM courses WHERE title = 'По задержанию и процессуальному кодексу' ORDER BY id LIMIT 1);
INSERT INTO courses (title, description, published, position, created_at, updated_at, track, subtitle, slug)
  SELECT 'Курс 3. Кодексы', 'Процессуальный, Уголовно-процессуальный, Уголовный кодексы и КоАП — в части, нужной Военной полиции. Экзамены: «ПК + УПК» и «УК + КоАП».', 1, 1030, strftime('%s','now')*1000, strftime('%s','now')*1000, 'rank', 'Система званий', 'r3'
  WHERE NOT EXISTS (SELECT 1 FROM courses WHERE slug = 'r3');
INSERT INTO courses (title, description, published, position, created_at, updated_at, track, subtitle, slug) VALUES
 ('Курс 4. Федеральные законы и Трудовой кодекс', 'Федеральные законы, с которыми работает Военная полиция, и Трудовой кодекс. Два экзамена: по ФЗ и по ТК.', 1, 1040, strftime('%s','now')*1000, strftime('%s','now')*1000, 'rank', 'Система званий', 'r4'),
 ('Курс 5. OOC-правила проекта', 'Основные правила проекта для госструктур: ограбления и поставки, федеральная тюрьма, криминальные события, налёты, война за КрАЗ, ОПГО — и отдельная тема «Основы психологии».', 1, 1050, strftime('%s','now')*1000, strftime('%s','now')*1000, 'rank', 'Система званий', 'r5'),
-- ---------- Система должностей ----------
 ('Стажёр ВП', 'Первый курс по должности: основы ГУ ВП (засчитываются из системы званий) и работа стажёра.', 1, 2010, strftime('%s','now')*1000, strftime('%s','now')*1000, 'position', 'Система должностей', 'p1'),
 ('Инспектор ВП', 'Курс по должности «Инспектор ВП».', 1, 2020, strftime('%s','now')*1000, strftime('%s','now')*1000, 'position', 'Система должностей', 'p2'),
 ('Инструктор', 'Курс по должности «Инструктор».', 1, 2030, strftime('%s','now')*1000, strftime('%s','now')*1000, 'position', 'Система должностей', 'p3'),
 ('Инспектор комендатуры', 'Курс по должности «Инспектор комендатуры».', 1, 2040, strftime('%s','now')*1000, strftime('%s','now')*1000, 'position', 'Система должностей', 'p4');

-- ---------- темы ----------
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'osnovy', 'Основы ГУ ВП', 'Место ГУ ВП в бригаде, подразделения, полномочия, порядок службы, отчёты и премии.', 10, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r1';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'du', 'Дисциплинарный устав (ДУ)', 'Воинская дисциплина, поощрения и взыскания, порядок их применения.', 10, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r2';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'vu', 'Внутренний устав (ВУ)', 'Внутренний устав 1-й мотострелковой бригады: права и обязанности, структура, ГУ ВП в уставе, запреты.', 20, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r2';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'su', 'Строевой устав (СУ)', 'Строй, построения, воинское приветствие, обязанности ГУ ВП на построении.', 30, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r2';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'kps', 'Устав караульно-постовой службы (КПС)', 'Караулы и посты, КПП, обязанности часовых и доклады в органы военной полиции.', 40, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r2';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'pk', 'Процессуальный кодекс (ПК)', 'Задержание, права задержанного, обыск и доказательства, передача и освобождение — в части работы ВП.', 10, 'ready', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r3';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'upk', 'Уголовно-процессуальный кодекс (УПК)', 'Уголовное преследование, доказательства, меры принуждения — то, что нужно ВП.', 20, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r3';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'uk', 'Уголовный кодекс (УК)', 'Составы преступлений, с которыми сталкивается ВП: против порядка управления, военной службы, оружие.', 30, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r3';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'koap', 'КоАП', 'Административные правонарушения и порядок привлечения к ответственности.', 40, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r3';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'fz-oborona', 'ФЗ «Об обороне»', 'Организация обороны, Вооружённые Силы, военная полиция в законе.', 10, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r4';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'fz-oruzhie', 'ФЗ «Об оружии»', 'Виды оружия, лицензии, хранение, ношение и применение.', 20, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r4';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'fz-territorii', 'ФЗ о закрытых и охраняемых территориях', 'Режим охраняемых и закрытых территорий, допуск и ответственность.', 30, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r4';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'fz-gostayna', 'ФЗ «О государственной тайне»', 'Сведения, составляющие тайну, допуск и защита.', 40, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r4';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'fz-gossluzhba', 'ФЗ «О государственной службе»', 'Права, обязанности и ограничения госслужащего.', 50, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r4';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'fz-vozduh', 'ФЗ «О воздушном пространстве»', 'Использование воздушного пространства и ответственность.', 60, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r4';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'fkz-rezhimy', 'ФКЗ «Об особых правовых режимах»', 'Чрезвычайное и военное положение, особые режимы.', 70, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r4';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'tk', 'Трудовой кодекс (ТК)', 'Трудовые отношения, дисциплина труда, увольнение.', 80, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r4';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'ooc-poip', 'Правила ограблений и поставок (ПОиП)', 'OOC-правила проекта.', 10, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r5';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'ooc-ft', 'Правила нападения и обороны федеральной тюрьмы', 'OOC-правила проекта.', 20, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r5';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'ooc-pks', 'Правила криминальных событий (ПКС)', 'OOC-правила проекта.', 30, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r5';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'ooc-nalety', 'Правила налётов', 'OOC-правила проекта.', 40, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r5';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'ooc-kraz', 'Правила войны за КрАЗ', 'OOC-правила проекта.', 50, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r5';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'ooc-opgo', 'Основные правила государственных организаций (ОПГО)', 'OOC-правила проекта.', 60, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r5';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'psy', 'Основы психологии', 'Как вести себя с агрессивными задержанными, правила коммуникации и этики, как не допускать конфликтов.', 70, 'draft', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r5';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'p1-osnovy', 'Основы ГУ ВП', 'Засчитывается, если тема пройдена в системе званий (и наоборот).', 10, 'ready', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'p1';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'p1-rabota', 'Работа стажёра ВП', 'Заполняется руководством ГУ ВП.', 20, 'placeholder', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'p1';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'p2-rabota', 'Работа инспектора ВП', 'Заполняется руководством ГУ ВП.', 10, 'placeholder', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'p2';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'p3-rabota', 'Работа инструктора', 'Заполняется руководством ГУ ВП.', 10, 'placeholder', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'p3';
INSERT INTO topics (course_id, slug, title, description, position, status, created_at, updated_at) SELECT id, 'p4-rabota', 'Работа инспектора комендатуры', 'Заполняется руководством ГУ ВП.', 10, 'placeholder', strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'p4';
UPDATE topics SET link_topic_id = (SELECT id FROM topics WHERE slug = 'osnovy') WHERE slug = 'p1-osnovy';

-- лекции бывшего курса ПК → тема «ПК»
UPDATE lectures SET topic_id = (SELECT id FROM topics WHERE slug = 'pk') WHERE course_id = (SELECT id FROM courses WHERE slug = 'r3') AND topic_id IS NULL;

-- ---------- экзамены ----------
-- существующий экзамен ПК → «ПК + УПК» (допуск — после лекций тем ПК и УПК)
UPDATE exams SET title = 'Экзамен: ПК + УПК', topic_ids = json_array((SELECT id FROM topics WHERE slug = 'pk'), (SELECT id FROM topics WHERE slug = 'upk')), lecture_mode = 'topics', requires_lectures = 1
  WHERE course_id = (SELECT id FROM courses WHERE slug = 'r3') AND title = 'По задержанию и процессуальному кодексу';
INSERT INTO exams (title, description, time_limit_min, max_attempts, cooldown_min, pass_pct, shuffle_questions, shuffle_options, requires_lectures, lecture_mode, position, published, course_id, bank_category, bank_count, topic_ids, created_at, updated_at)
  SELECT 'Экзамен: Основы ГУ ВП', 'После всех лекций темы «Основы ГУ ВП».', 25, 0, 60, 70, 1, 1, 1, 'topics', 1010, 0, id, 'Основы ГУ ВП', 20, json_array((SELECT id FROM topics WHERE slug = 'osnovy')), strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r1';
INSERT INTO exams (title, description, time_limit_min, max_attempts, cooldown_min, pass_pct, shuffle_questions, shuffle_options, requires_lectures, lecture_mode, position, published, course_id, bank_category, bank_count, topic_ids, created_at, updated_at)
  SELECT 'Экзамен: Уставы (ДУ, ВУ, СУ, КПС)', 'Общий экзамен по всем четырём уставам: случайная выборка из большого банка вопросов.', 40, 0, 60, 70, 1, 1, 1, 'topics', 1020, 0, id, 'ДУ,ВУ,СУ,КПС', 30, json_array((SELECT id FROM topics WHERE slug = 'du'), (SELECT id FROM topics WHERE slug = 'vu'), (SELECT id FROM topics WHERE slug = 'su'), (SELECT id FROM topics WHERE slug = 'kps')), strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r2';
INSERT INTO exams (title, description, time_limit_min, max_attempts, cooldown_min, pass_pct, shuffle_questions, shuffle_options, requires_lectures, lecture_mode, position, published, course_id, bank_category, bank_count, topic_ids, created_at, updated_at)
  SELECT 'Экзамен: УК + КоАП', 'Уголовный кодекс и КоАП: случайная выборка из банка.', 35, 0, 60, 70, 1, 1, 1, 'topics', 1032, 0, id, 'УК,КоАП', 25, json_array((SELECT id FROM topics WHERE slug = 'uk'), (SELECT id FROM topics WHERE slug = 'koap')), strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r3';
INSERT INTO exams (title, description, time_limit_min, max_attempts, cooldown_min, pass_pct, shuffle_questions, shuffle_options, requires_lectures, lecture_mode, position, published, course_id, bank_category, bank_count, topic_ids, created_at, updated_at)
  SELECT 'Экзамен: Федеральные законы', 'Все ФЗ и ФКЗ курса: случайная выборка из банка.', 40, 0, 60, 70, 1, 1, 1, 'topics', 1040, 0, id, 'ФЗ*,ФКЗ*', 30, json_array((SELECT id FROM topics WHERE slug = 'fz-oborona'), (SELECT id FROM topics WHERE slug = 'fz-oruzhie'), (SELECT id FROM topics WHERE slug = 'fz-territorii'), (SELECT id FROM topics WHERE slug = 'fz-gostayna'), (SELECT id FROM topics WHERE slug = 'fz-gossluzhba'), (SELECT id FROM topics WHERE slug = 'fz-vozduh'), (SELECT id FROM topics WHERE slug = 'fkz-rezhimy')), strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r4';
INSERT INTO exams (title, description, time_limit_min, max_attempts, cooldown_min, pass_pct, shuffle_questions, shuffle_options, requires_lectures, lecture_mode, position, published, course_id, bank_category, bank_count, topic_ids, created_at, updated_at)
  SELECT 'Экзамен: Трудовой кодекс', 'Трудовой кодекс: случайная выборка из банка.', 25, 0, 60, 70, 1, 1, 1, 'topics', 1041, 0, id, 'ТК', 20, json_array((SELECT id FROM topics WHERE slug = 'tk')), strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r4';
INSERT INTO exams (title, description, time_limit_min, max_attempts, cooldown_min, pass_pct, shuffle_questions, shuffle_options, requires_lectures, lecture_mode, position, published, course_id, bank_category, bank_count, topic_ids, created_at, updated_at)
  SELECT 'Экзамен: криминальные события (ПОиП, ПКС, налёты)', 'Правила ограблений и поставок, криминальных событий и налётов.', 25, 0, 60, 70, 1, 1, 1, 'topics', 1050, 0, id, 'OOC — ПОиП,OOC — ПКС,OOC — налёты', 20, json_array((SELECT id FROM topics WHERE slug = 'ooc-poip'), (SELECT id FROM topics WHERE slug = 'ooc-pks'), (SELECT id FROM topics WHERE slug = 'ooc-nalety')), strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r5';
INSERT INTO exams (title, description, time_limit_min, max_attempts, cooldown_min, pass_pct, shuffle_questions, shuffle_options, requires_lectures, lecture_mode, position, published, course_id, bank_category, bank_count, topic_ids, created_at, updated_at)
  SELECT 'Экзамен: федеральная тюрьма и война за КрАЗ', 'Нападение и оборона федеральной тюрьмы, война за КрАЗ.', 20, 0, 60, 70, 1, 1, 1, 'topics', 1051, 0, id, 'OOC — федеральная тюрьма,OOC — КрАЗ', 15, json_array((SELECT id FROM topics WHERE slug = 'ooc-ft'), (SELECT id FROM topics WHERE slug = 'ooc-kraz')), strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r5';
INSERT INTO exams (title, description, time_limit_min, max_attempts, cooldown_min, pass_pct, shuffle_questions, shuffle_options, requires_lectures, lecture_mode, position, published, course_id, bank_category, bank_count, topic_ids, created_at, updated_at)
  SELECT 'Экзамен: ОПГО и основы психологии', 'Основные правила госорганизаций и основы психологии в работе с задержанными.', 25, 0, 60, 70, 1, 1, 1, 'topics', 1052, 0, id, 'OOC — ОПГО,Основы психологии', 20, json_array((SELECT id FROM topics WHERE slug = 'ooc-opgo'), (SELECT id FROM topics WHERE slug = 'psy')), strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'r5';
INSERT INTO exams (title, description, time_limit_min, max_attempts, cooldown_min, pass_pct, shuffle_questions, shuffle_options, requires_lectures, lecture_mode, position, published, course_id, bank_category, bank_count, topic_ids, created_at, updated_at)
  SELECT 'Экзамен: Стажёр ВП', 'Основы ГУ ВП и работа стажёра.', 30, 0, 60, 70, 1, 1, 1, 'topics', 2010, 0, id, 'Основы ГУ ВП,Должность — стажёр ВП', 20, json_array((SELECT id FROM topics WHERE slug = 'p1-osnovy'), (SELECT id FROM topics WHERE slug = 'p1-rabota')), strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'p1';
INSERT INTO exams (title, description, time_limit_min, max_attempts, cooldown_min, pass_pct, shuffle_questions, shuffle_options, requires_lectures, lecture_mode, position, published, course_id, bank_category, bank_count, topic_ids, created_at, updated_at)
  SELECT 'Экзамен: Инспектор ВП', 'Вопросы заполняются руководством ГУ ВП.', 30, 0, 60, 70, 1, 1, 1, 'topics', 2020, 0, id, 'Должность — инспектор ВП', 20, json_array((SELECT id FROM topics WHERE slug = 'p2-rabota')), strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'p2';
INSERT INTO exams (title, description, time_limit_min, max_attempts, cooldown_min, pass_pct, shuffle_questions, shuffle_options, requires_lectures, lecture_mode, position, published, course_id, bank_category, bank_count, topic_ids, created_at, updated_at)
  SELECT 'Экзамен: Инструктор', 'Вопросы заполняются руководством ГУ ВП.', 30, 0, 60, 70, 1, 1, 1, 'topics', 2030, 0, id, 'Должность — инструктор', 20, json_array((SELECT id FROM topics WHERE slug = 'p3-rabota')), strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'p3';
INSERT INTO exams (title, description, time_limit_min, max_attempts, cooldown_min, pass_pct, shuffle_questions, shuffle_options, requires_lectures, lecture_mode, position, published, course_id, bank_category, bank_count, topic_ids, created_at, updated_at)
  SELECT 'Экзамен: Инспектор комендатуры', 'Вопросы заполняются руководством ГУ ВП.', 30, 0, 60, 70, 1, 1, 1, 'topics', 2040, 0, id, 'Должность — инспектор комендатуры', 20, json_array((SELECT id FROM topics WHERE slug = 'p4-rabota')), strftime('%s','now')*1000, strftime('%s','now')*1000 FROM courses WHERE slug = 'p4';
