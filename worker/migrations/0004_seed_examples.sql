-- 0004: ПРИМЕРЫ вопросов для банка переаттестации (заглушки, помечены «ПРИМЕР», ext_id = example-…).
-- Сгенерировано tools/gen-seed.js. Идемпотентно: вставляет только отсутствующие ext_id. Реальное содержание загружается импортом JSON.
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'single', 'ПРИМЕР [ПК] №1 (одиночный выбор) — вопрос-заглушка, будет заменён реальным содержанием. Выберите вариант «Верно».', '[{"id":"hAaEoEsL","text":"Верно"},{"id":"t4KX6XtS","text":"Неверно 1"},{"id":"3RwdKrIu","text":"Неверно 2"},{"id":"yN2EJPTx","text":"Неверно 3"}]', '["hAaEoEsL"]', '', 1, 10, '{}', 'ПК', 'question', 1, 1, 'example-pk-q1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-pk-q1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'multi', 'ПРИМЕР [ПК] №2 (множественный выбор) — вопрос-заглушка, будет заменён реальным содержанием. Отметьте оба варианта «Верно».', '[{"id":"UNtX2tay","text":"Верно (А)"},{"id":"iXPcdw0d","text":"Верно (Б)"},{"id":"cq2cObu","text":"Неверно 1"},{"id":"fpMRZ1LI","text":"Неверно 2"}]', '["UNtX2tay","iXPcdw0d"]', '', 1, 20, '{"partial":false}', 'ПК', 'question', 1, 1, 'example-pk-q2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-pk-q2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'number', 'ПРИМЕР [ПК] №3 (ввод числа) — вопрос-заглушка, будет заменён реальным содержанием. Сколько будет 12 + 30?', '[]', '[]', '', 1, 30, '{"answer":42,"tolerance":0,"unit":""}', 'ПК', 'question', 0, 1, 'example-pk-q3', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-pk-q3');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'text', 'ПРИМЕР [ПК] №4 (ввод текста) — вопрос-заглушка, будет заменён реальным содержанием. Введите слово «пример» (регистр и ё не важны).', '[]', '[]', '', 1, 40, '{"accepted":["пример"]}', 'ПК', 'question', 0, 1, 'example-pk-q4', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-pk-q4');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'param', 'ПРИМЕР [ПК] №5 (параметризованная задача) — вопрос-заглушка, будет заменён реальным содержанием. Наряд из {a} человек усилили ещё {b} людьми. Сколько человек в наряде?', '[]', '[]', '', 1, 50, '{"vars":{"a":{"min":2,"max":9,"step":1},"b":{"min":1,"max":5,"step":1}},"formula":"a + b","tolerance":0,"unit":"чел."}', 'ПК', 'question', 0, 1, 'example-pk-q5', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-pk-q5');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'long', 'ПРИМЕР [ПК] №6 (ответ в свободной форме) — вопрос-заглушка, будет заменён реальным содержанием. Напишите пару предложений.', '[]', '[]', 'ПРИМЕР эталона: любой осмысленный ответ.', 2, 60, '{}', 'ПК', 'question', 0, 1, 'example-pk-x1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-pk-x1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [ПК] — кейс-заглушка №1.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 70, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'ПК', 'case', 1, 1, 'example-pk-c1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-pk-c1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [ПК] — кейс-заглушка №2.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 80, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'ПК', 'case', 0, 1, 'example-pk-c2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-pk-c2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'order', 'ПРИМЕР [УК] №1 (установление последовательности) — вопрос-заглушка, будет заменён реальным содержанием. Расположите по порядку.', '[]', '[]', '', 1, 90, '{"items":[{"id":"EqkEdll8","text":"Первый шаг"},{"id":"chkAmSg","text":"Второй шаг"},{"id":"JqBwTIVr","text":"Третий шаг"},{"id":"J9Tghpm0","text":"Четвёртый шаг"}],"partial":false}', 'УК', 'question', 1, 1, 'example-uk-q1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-uk-q1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'match', 'ПРИМЕР [УК] №2 (установление соответствий) — вопрос-заглушка, будет заменён реальным содержанием. Сопоставьте.', '[]', '[]', '', 1, 100, '{"pairs":[{"l":{"id":"Y6benSS","text":"Один"},"r":{"id":"31NjWsN0","text":"1"}},{"l":{"id":"lhE4shH","text":"Два"},"r":{"id":"QLlucl2j","text":"2"}},{"l":{"id":"1xsh4mie","text":"Три"},"r":{"id":"9ZR3DsBj","text":"3"}}],"distractors":[{"id":"JwS7kAPx","text":"4"}],"partial":false}', 'УК', 'question', 1, 1, 'example-uk-q2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-uk-q2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'blanks_input', 'ПРИМЕР [УК] №3 (заполнение пропусков вводом) — вопрос-заглушка, будет заменён реальным содержанием. Заполните пропуски.', '[]', '[]', '', 1, 110, '{"content":"Дважды два — [[4|четыре]], трижды три — [[9|девять]].","parts":["Дважды два — ",{"i":0},", трижды три — ",{"i":1},"."],"blanks":[{"accepted":["4","четыре"]},{"accepted":["9","девять"]}],"partial":false}', 'УК', 'question', 0, 1, 'example-uk-q3', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-uk-q3');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'blanks_select', 'ПРИМЕР [УК] №4 (заполнение пропусков из списка) — вопрос-заглушка, будет заменён реальным содержанием. Выберите слова.', '[]', '[]', '', 1, 120, '{"content":"Зимой [[*холодно|жарко|душно]], летом [[*тепло|морозно]].","parts":["Зимой ",{"i":0},", летом ",{"i":1},"."],"blanks":[{"opts":[{"id":"KLwovaVk","text":"холодно"},{"id":"8NjXfkaj","text":"жарко"},{"id":"rvIYlVs","text":"душно"}],"correct":"KLwovaVk"},{"opts":[{"id":"ApgcF6M","text":"тепло"},{"id":"ACdos9Kt","text":"морозно"}],"correct":"ApgcF6M"}],"partial":false}', 'УК', 'question', 0, 1, 'example-uk-q4', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-uk-q4');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'dictation', 'ПРИМЕР [УК] №5 (интерактивный диктант) — вопрос-заглушка, будет заменён реальным содержанием. Выберите правильное написание.', '[]', '[]', '', 1, 130, '{"content":"В/Ч проводит [[*построение|постраение]] личного [[*состава|састава]].","parts":["В/Ч проводит ",{"i":0}," личного ",{"i":1},"."],"blanks":[{"opts":[{"id":"9VvVotF4","text":"построение"},{"id":"2o1ezlRh","text":"постраение"}],"correct":"9VvVotF4"},{"opts":[{"id":"nA9ga5cB","text":"состава"},{"id":"MeVBFFdM","text":"састава"}],"correct":"nA9ga5cB"}],"partial":false}', 'УК', 'question', 0, 1, 'example-uk-q5', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-uk-q5');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [УК] — кейс-заглушка №1.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 140, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'УК', 'case', 1, 1, 'example-uk-c1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-uk-c1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [УК] — кейс-заглушка №2.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 150, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'УК', 'case', 0, 1, 'example-uk-c2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-uk-c2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'eliminate', 'ПРИМЕР [ТК] №1 (последовательное исключение) — вопрос-заглушка, будет заменён реальным содержанием. Исключайте неверные варианты, пока не останется «Верно».', '[{"id":"NFg7U9F1","text":"Верно"},{"id":"SPoZva7O","text":"Лишнее 1"},{"id":"cnbATW","text":"Лишнее 2"},{"id":"cXKa6Leg","text":"Лишнее 3"}]', '["NFg7U9F1"]', '', 1, 160, '{"partial":false}', 'ТК', 'question', 1, 1, 'example-tk-q1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-tk-q1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'slider', 'ПРИМЕР [ТК] №2 (слайдер) — вопрос-заглушка, будет заменён реальным содержанием. Установите ползунок на 30.', '[]', '[]', '', 1, 170, '{"min":0,"max":100,"step":5,"answer":30,"tolerance":0,"unit":"мин"}', 'ТК', 'question', 1, 1, 'example-tk-q2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-tk-q2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'letters', 'ПРИМЕР [ТК] №3 (слова из букв) — вопрос-заглушка, будет заменён реальным содержанием. Соберите слово «ПАТРУЛЬ».', '[]', '[]', '', 1, 180, '{"word":"патруль","extra_letters":"","accepted":[]}', 'ТК', 'question', 0, 1, 'example-tk-q3', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-tk-q3');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'words', 'ПРИМЕР [ТК] №4 (фразы из слов) — вопрос-заглушка, будет заменён реальным содержанием. Соберите фразу «служу отечеству».', '[]', '[]', '', 1, 190, '{"phrase":"служу отечеству","extra_words":["лишнее"],"partial":false}', 'ТК', 'question', 0, 1, 'example-tk-q4', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-tk-q4');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'find', 'ПРИМЕР [ТК] №5 (поиск в тексте) — вопрос-заглушка, будет заменён реальным содержанием. Отметьте в тексте слово «ключевое».', '[]', '[]', '', 1, 200, '{"content":"Это обычный текст, в котором есть одно [[ключевое]] слово для поиска.","tokens":[{"t":"Это"},{"t":"обычный"},{"t":"текст,"},{"t":"в"},{"t":"котором"},{"t":"есть"},{"t":"одно"},{"t":"ключевое","c":1},{"t":"слово"},{"t":"для"},{"t":"поиска."}],"partial":false}', 'ТК', 'question', 0, 1, 'example-tk-q5', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-tk-q5');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [ТК] — кейс-заглушка №1.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 210, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'ТК', 'case', 1, 1, 'example-tk-c1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-tk-c1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [ТК] — кейс-заглушка №2.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 220, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'ТК', 'case', 0, 1, 'example-tk-c2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-tk-c2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'single', 'ПРИМЕР [ВУ] №1 (одиночный выбор) — вопрос-заглушка, будет заменён реальным содержанием. Выберите вариант «Верно».', '[{"id":"oaekZD65","text":"Верно"},{"id":"UFFsGLrZ","text":"Неверно 1"},{"id":"I764gqs","text":"Неверно 2"},{"id":"bkEVHcV","text":"Неверно 3"}]', '["oaekZD65"]', '', 1, 230, '{}', 'ВУ', 'question', 1, 1, 'example-vu-q1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-q1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'multi', 'ПРИМЕР [ВУ] №2 (множественный выбор) — вопрос-заглушка, будет заменён реальным содержанием. Отметьте оба варианта «Верно».', '[{"id":"PLBJ69DC","text":"Верно (А)"},{"id":"dLo2PnZh","text":"Верно (Б)"},{"id":"quLnkDTs","text":"Неверно 1"},{"id":"dg5sZ2uX","text":"Неверно 2"}]', '["PLBJ69DC","dLo2PnZh"]', '', 1, 240, '{"partial":false}', 'ВУ', 'question', 1, 1, 'example-vu-q2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-q2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'number', 'ПРИМЕР [ВУ] №3 (ввод числа) — вопрос-заглушка, будет заменён реальным содержанием. Сколько будет 12 + 30?', '[]', '[]', '', 1, 250, '{"answer":42,"tolerance":0,"unit":""}', 'ВУ', 'question', 1, 1, 'example-vu-q3', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-q3');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'text', 'ПРИМЕР [ВУ] №4 (ввод текста) — вопрос-заглушка, будет заменён реальным содержанием. Введите слово «пример» (регистр и ё не важны).', '[]', '[]', '', 1, 260, '{"accepted":["пример"]}', 'ВУ', 'question', 1, 1, 'example-vu-q4', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-q4');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'param', 'ПРИМЕР [ВУ] №5 (параметризованная задача) — вопрос-заглушка, будет заменён реальным содержанием. Наряд из {a} человек усилили ещё {b} людьми. Сколько человек в наряде?', '[]', '[]', '', 1, 270, '{"vars":{"a":{"min":2,"max":9,"step":1},"b":{"min":1,"max":5,"step":1}},"formula":"a + b","tolerance":0,"unit":"чел."}', 'ВУ', 'question', 1, 1, 'example-vu-q5', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-q5');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'order', 'ПРИМЕР [ВУ] №6 (установление последовательности) — вопрос-заглушка, будет заменён реальным содержанием. Расположите по порядку.', '[]', '[]', '', 1, 280, '{"items":[{"id":"cAM9uasi","text":"Первый шаг"},{"id":"14ks5YBZ","text":"Второй шаг"},{"id":"pS5u7HY","text":"Третий шаг"},{"id":"I67peFH7","text":"Четвёртый шаг"}],"partial":false}', 'ВУ', 'question', 1, 1, 'example-vu-q6', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-q6');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'match', 'ПРИМЕР [ВУ] №7 (установление соответствий) — вопрос-заглушка, будет заменён реальным содержанием. Сопоставьте.', '[]', '[]', '', 1, 290, '{"pairs":[{"l":{"id":"7jFQJRP1","text":"Один"},"r":{"id":"qmN5Q5R","text":"1"}},{"l":{"id":"gAmu9vKY","text":"Два"},"r":{"id":"XvwsFeM4","text":"2"}},{"l":{"id":"1ejsyY3C","text":"Три"},"r":{"id":"a3ZBKrUp","text":"3"}}],"distractors":[{"id":"jaa9AJNG","text":"4"}],"partial":false}', 'ВУ', 'question', 1, 1, 'example-vu-q7', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-q7');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'blanks_input', 'ПРИМЕР [ВУ] №8 (заполнение пропусков вводом) — вопрос-заглушка, будет заменён реальным содержанием. Заполните пропуски.', '[]', '[]', '', 1, 300, '{"content":"Дважды два — [[4|четыре]], трижды три — [[9|девять]].","parts":["Дважды два — ",{"i":0},", трижды три — ",{"i":1},"."],"blanks":[{"accepted":["4","четыре"]},{"accepted":["9","девять"]}],"partial":false}', 'ВУ', 'question', 1, 1, 'example-vu-q8', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-q8');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'blanks_select', 'ПРИМЕР [ВУ] №9 (заполнение пропусков из списка) — вопрос-заглушка, будет заменён реальным содержанием. Выберите слова.', '[]', '[]', '', 1, 310, '{"content":"Зимой [[*холодно|жарко|душно]], летом [[*тепло|морозно]].","parts":["Зимой ",{"i":0},", летом ",{"i":1},"."],"blanks":[{"opts":[{"id":"WHDk8K3m","text":"холодно"},{"id":"RvSSirC","text":"жарко"},{"id":"x6GfRj9R","text":"душно"}],"correct":"WHDk8K3m"},{"opts":[{"id":"onl6QJAP","text":"тепло"},{"id":"Lzpeh8Ln","text":"морозно"}],"correct":"onl6QJAP"}],"partial":false}', 'ВУ', 'question', 0, 1, 'example-vu-q9', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-q9');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'dictation', 'ПРИМЕР [ВУ] №10 (интерактивный диктант) — вопрос-заглушка, будет заменён реальным содержанием. Выберите правильное написание.', '[]', '[]', '', 1, 320, '{"content":"В/Ч проводит [[*построение|постраение]] личного [[*состава|састава]].","parts":["В/Ч проводит ",{"i":0}," личного ",{"i":1},"."],"blanks":[{"opts":[{"id":"RuFXPfw","text":"построение"},{"id":"3N3sUXa","text":"постраение"}],"correct":"RuFXPfw"},{"opts":[{"id":"Nq0j0nVD","text":"состава"},{"id":"zAJu7j5b","text":"састава"}],"correct":"Nq0j0nVD"}],"partial":false}', 'ВУ', 'question', 0, 1, 'example-vu-q10', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-q10');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'eliminate', 'ПРИМЕР [ВУ] №11 (последовательное исключение) — вопрос-заглушка, будет заменён реальным содержанием. Исключайте неверные варианты, пока не останется «Верно».', '[{"id":"EIRNADC","text":"Верно"},{"id":"2OamxVIs","text":"Лишнее 1"},{"id":"SoLkxrxc","text":"Лишнее 2"},{"id":"hleUS6Af","text":"Лишнее 3"}]', '["EIRNADC"]', '', 1, 330, '{"partial":false}', 'ВУ', 'question', 0, 1, 'example-vu-q11', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-q11');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'slider', 'ПРИМЕР [ВУ] №12 (слайдер) — вопрос-заглушка, будет заменён реальным содержанием. Установите ползунок на 30.', '[]', '[]', '', 1, 340, '{"min":0,"max":100,"step":5,"answer":30,"tolerance":0,"unit":"мин"}', 'ВУ', 'question', 0, 1, 'example-vu-q12', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-q12');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'file', 'ПРИМЕР [ВУ] №13 (загрузка файла) — вопрос-заглушка, будет заменён реальным содержанием. Приложите любое изображение или ссылку.', '[]', '[]', '', 2, 350, '{"accept":"image/*,application/pdf","max_kb":1024,"allow_url":true}', 'ВУ', 'question', 0, 1, 'example-vu-x1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-x1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [ВУ] — кейс-заглушка №1.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 360, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'ВУ', 'case', 1, 1, 'example-vu-c1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-c1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [ВУ] — кейс-заглушка №2.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 370, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'ВУ', 'case', 0, 1, 'example-vu-c2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-c2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [ВУ] — кейс-заглушка №3.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 380, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'ВУ', 'case', 0, 1, 'example-vu-c3', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-c3');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [ВУ] — кейс-заглушка №4.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 390, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'ВУ', 'case', 0, 1, 'example-vu-c4', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-vu-c4');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'letters', 'ПРИМЕР [СУ] №1 (слова из букв) — вопрос-заглушка, будет заменён реальным содержанием. Соберите слово «ПАТРУЛЬ».', '[]', '[]', '', 1, 400, '{"word":"патруль","extra_letters":"","accepted":[]}', 'СУ', 'question', 1, 1, 'example-su-q1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-su-q1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'words', 'ПРИМЕР [СУ] №2 (фразы из слов) — вопрос-заглушка, будет заменён реальным содержанием. Соберите фразу «служу отечеству».', '[]', '[]', '', 1, 410, '{"phrase":"служу отечеству","extra_words":["лишнее"],"partial":false}', 'СУ', 'question', 1, 1, 'example-su-q2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-su-q2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'find', 'ПРИМЕР [СУ] №3 (поиск в тексте) — вопрос-заглушка, будет заменён реальным содержанием. Отметьте в тексте слово «ключевое».', '[]', '[]', '', 1, 420, '{"content":"Это обычный текст, в котором есть одно [[ключевое]] слово для поиска.","tokens":[{"t":"Это"},{"t":"обычный"},{"t":"текст,"},{"t":"в"},{"t":"котором"},{"t":"есть"},{"t":"одно"},{"t":"ключевое","c":1},{"t":"слово"},{"t":"для"},{"t":"поиска."}],"partial":false}', 'СУ', 'question', 0, 1, 'example-su-q3', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-su-q3');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'voice', 'ПРИМЕР [СУ] №4 (голосовой ответ) — вопрос-заглушка, будет заменён реальным содержанием. Запишите короткое голосовое сообщение.', '[]', '[]', '', 2, 430, '{"max_sec":60}', 'СУ', 'question', 0, 1, 'example-su-x1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-su-x1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [СУ] — кейс-заглушка №1.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 440, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'СУ', 'case', 1, 1, 'example-su-c1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-su-c1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [СУ] — кейс-заглушка №2.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 450, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'СУ', 'case', 0, 1, 'example-su-c2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-su-c2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'single', 'ПРИМЕР [ДУ] №1 (одиночный выбор) — вопрос-заглушка, будет заменён реальным содержанием. Выберите вариант «Верно».', '[{"id":"T9IBoyBw","text":"Верно"},{"id":"DNL7ijM6","text":"Неверно 1"},{"id":"JwQhRmPJ","text":"Неверно 2"},{"id":"w6qvLb9P","text":"Неверно 3"}]', '["T9IBoyBw"]', '', 1, 460, '{}', 'ДУ', 'question', 1, 1, 'example-du-q1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-du-q1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'multi', 'ПРИМЕР [ДУ] №2 (множественный выбор) — вопрос-заглушка, будет заменён реальным содержанием. Отметьте оба варианта «Верно».', '[{"id":"n7zXVQ1i","text":"Верно (А)"},{"id":"MyFtPMJY","text":"Верно (Б)"},{"id":"iUqges0p","text":"Неверно 1"},{"id":"VObd5vNf","text":"Неверно 2"}]', '["n7zXVQ1i","MyFtPMJY"]', '', 1, 470, '{"partial":false}', 'ДУ', 'question', 1, 1, 'example-du-q2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-du-q2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'number', 'ПРИМЕР [ДУ] №3 (ввод числа) — вопрос-заглушка, будет заменён реальным содержанием. Сколько будет 12 + 30?', '[]', '[]', '', 1, 480, '{"answer":42,"tolerance":0,"unit":""}', 'ДУ', 'question', 0, 1, 'example-du-q3', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-du-q3');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [ДУ] — кейс-заглушка №1.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 490, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'ДУ', 'case', 1, 1, 'example-du-c1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-du-c1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [ДУ] — кейс-заглушка №2.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 500, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'ДУ', 'case', 0, 1, 'example-du-c2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-du-c2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'text', 'ПРИМЕР [КПС] №1 (ввод текста) — вопрос-заглушка, будет заменён реальным содержанием. Введите слово «пример» (регистр и ё не важны).', '[]', '[]', '', 1, 510, '{"accepted":["пример"]}', 'КПС', 'question', 1, 1, 'example-kps-q1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-kps-q1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'param', 'ПРИМЕР [КПС] №2 (параметризованная задача) — вопрос-заглушка, будет заменён реальным содержанием. Наряд из {a} человек усилили ещё {b} людьми. Сколько человек в наряде?', '[]', '[]', '', 1, 520, '{"vars":{"a":{"min":2,"max":9,"step":1},"b":{"min":1,"max":5,"step":1}},"formula":"a + b","tolerance":0,"unit":"чел."}', 'КПС', 'question', 1, 1, 'example-kps-q2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-kps-q2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'order', 'ПРИМЕР [КПС] №3 (установление последовательности) — вопрос-заглушка, будет заменён реальным содержанием. Расположите по порядку.', '[]', '[]', '', 1, 530, '{"items":[{"id":"xinuWbe","text":"Первый шаг"},{"id":"U7hMUNb9","text":"Второй шаг"},{"id":"e0rwyhh","text":"Третий шаг"},{"id":"jTbM0uXz","text":"Четвёртый шаг"}],"partial":false}', 'КПС', 'question', 0, 1, 'example-kps-q3', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-kps-q3');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [КПС] — кейс-заглушка №1.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 540, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'КПС', 'case', 1, 1, 'example-kps-c1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-kps-c1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [КПС] — кейс-заглушка №2.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 550, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'КПС', 'case', 0, 1, 'example-kps-c2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-kps-c2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'match', 'ПРИМЕР [ФЗ об обороне] №1 (установление соответствий) — вопрос-заглушка, будет заменён реальным содержанием. Сопоставьте.', '[]', '[]', '', 1, 560, '{"pairs":[{"l":{"id":"DzzwB2h","text":"Один"},"r":{"id":"KT33SYx5","text":"1"}},{"l":{"id":"8ZT0z0J9","text":"Два"},"r":{"id":"sTa410hg","text":"2"}},{"l":{"id":"dUssEe","text":"Три"},"r":{"id":"LtTwhap2","text":"3"}}],"distractors":[{"id":"wIgh9Vk8","text":"4"}],"partial":false}', 'ФЗ об обороне', 'question', 1, 1, 'example-fz-oborona-q1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-fz-oborona-q1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'blanks_input', 'ПРИМЕР [ФЗ об обороне] №2 (заполнение пропусков вводом) — вопрос-заглушка, будет заменён реальным содержанием. Заполните пропуски.', '[]', '[]', '', 1, 570, '{"content":"Дважды два — [[4|четыре]], трижды три — [[9|девять]].","parts":["Дважды два — ",{"i":0},", трижды три — ",{"i":1},"."],"blanks":[{"accepted":["4","четыре"]},{"accepted":["9","девять"]}],"partial":false}', 'ФЗ об обороне', 'question', 0, 1, 'example-fz-oborona-q2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-fz-oborona-q2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [ФЗ об обороне] — кейс-заглушка №1.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 580, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'ФЗ об обороне', 'case', 1, 1, 'example-fz-oborona-c1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-fz-oborona-c1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'blanks_select', 'ПРИМЕР [ФЗ о закрытых и охраняемых территориях] №1 (заполнение пропусков из списка) — вопрос-заглушка, будет заменён реальным содержанием. Выберите слова.', '[]', '[]', '', 1, 590, '{"content":"Зимой [[*холодно|жарко|душно]], летом [[*тепло|морозно]].","parts":["Зимой ",{"i":0},", летом ",{"i":1},"."],"blanks":[{"opts":[{"id":"RspRhkRf","text":"холодно"},{"id":"U36I8Ry8","text":"жарко"},{"id":"sxU4FIEb","text":"душно"}],"correct":"RspRhkRf"},{"opts":[{"id":"KWYwvlky","text":"тепло"},{"id":"dGzwxt4U","text":"морозно"}],"correct":"KWYwvlky"}],"partial":false}', 'ФЗ о закрытых и охраняемых территориях', 'question', 1, 1, 'example-fz-territorii-q1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-fz-territorii-q1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'dictation', 'ПРИМЕР [ФЗ о закрытых и охраняемых территориях] №2 (интерактивный диктант) — вопрос-заглушка, будет заменён реальным содержанием. Выберите правильное написание.', '[]', '[]', '', 1, 600, '{"content":"В/Ч проводит [[*построение|постраение]] личного [[*состава|састава]].","parts":["В/Ч проводит ",{"i":0}," личного ",{"i":1},"."],"blanks":[{"opts":[{"id":"LFTFbgP6","text":"построение"},{"id":"8P7uCOTr","text":"постраение"}],"correct":"LFTFbgP6"},{"opts":[{"id":"Z6o7UER0","text":"состава"},{"id":"EmmQmhPB","text":"састава"}],"correct":"Z6o7UER0"}],"partial":false}', 'ФЗ о закрытых и охраняемых территориях', 'question', 0, 1, 'example-fz-territorii-q2', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-fz-territorii-q2');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'case', 'ПРИМЕР [ФЗ о закрытых и охраняемых территориях] — кейс-заглушка №1.
Ситуация: условная ситуация для проверки работы кейсов.
Вопрос: как следует поступить? Обоснуйте.', '[]', '[]', 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).', 5, 610, '{"criteria":[{"text":"Верно квалифицирована ситуация","points":2},{"text":"Указаны нормы (статьи)","points":2},{"text":"Описан порядок действий","points":1}]}', 'ФЗ о закрытых и охраняемых территориях', 'case', 1, 1, 'example-fz-territorii-c1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-fz-territorii-c1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'eliminate', 'ПРИМЕР [ФЗ о гос. службе] №1 (последовательное исключение) — вопрос-заглушка, будет заменён реальным содержанием. Исключайте неверные варианты, пока не останется «Верно».', '[{"id":"GDgJM54","text":"Верно"},{"id":"JQdM4Yel","text":"Лишнее 1"},{"id":"tufUf9bo","text":"Лишнее 2"},{"id":"cfVcluAY","text":"Лишнее 3"}]', '["GDgJM54"]', '', 1, 620, '{"partial":false}', 'ФЗ о гос. службе', 'question', 0, 1, 'example-fz-gossluzhba-q1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-fz-gossluzhba-q1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'slider', 'ПРИМЕР [ФЗ об оружии] №1 (слайдер) — вопрос-заглушка, будет заменён реальным содержанием. Установите ползунок на 30.', '[]', '[]', '', 1, 630, '{"min":0,"max":100,"step":5,"answer":30,"tolerance":0,"unit":"мин"}', 'ФЗ об оружии', 'question', 1, 1, 'example-fz-oruzhie-q1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-fz-oruzhie-q1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'letters', 'ПРИМЕР [ФЗ о воздушном пространстве] №1 (слова из букв) — вопрос-заглушка, будет заменён реальным содержанием. Соберите слово «ПАТРУЛЬ».', '[]', '[]', '', 1, 640, '{"word":"патруль","extra_letters":"","accepted":[]}', 'ФЗ о воздушном пространстве', 'question', 0, 1, 'example-fz-vozduh-q1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-fz-vozduh-q1');
INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)
  SELECT 0, 'words', 'ПРИМЕР [ФКЗ об особых правовых режимах] №1 (фразы из слов) — вопрос-заглушка, будет заменён реальным содержанием. Соберите фразу «служу отечеству».', '[]', '[]', '', 1, 650, '{"phrase":"служу отечеству","extra_words":["лишнее"],"partial":false}', 'ФКЗ об особых правовых режимах', 'question', 0, 1, 'example-fkz-rezhimy-q1', 1792886400000, 1792886400000
  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = 'example-fkz-rezhimy-q1');
