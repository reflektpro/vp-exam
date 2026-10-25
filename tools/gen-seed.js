// Генерирует worker/migrations/0004_seed_examples.sql — примерные вопросы-заглушки (ПРИМЕР) для банка переаттестации.
// Нормализация — той же функцией questionInput(), что и в worker.js. Запуск: node tools/gen-seed.js
// Заглушки помечены «ПРИМЕР» и ext_id = example-…; удалить их все: «Банк вопросов» → «Удалить все ПРИМЕРЫ».
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../worker/worker.js'), 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '');
const W = new Function(src + '\nreturn { questionInput };')();

const T = (cat, n, label) => `ПРИМЕР [${cat}] №${n} (${label}) — вопрос-заглушка, будет заменён реальным содержанием.`;
const gen = {
  single: (c, n) => ({ type: 'single', text: T(c, n, 'одиночный выбор') + ' Выберите вариант «Верно».', options: [{ text: 'Верно', correct: true }, { text: 'Неверно 1' }, { text: 'Неверно 2' }, { text: 'Неверно 3' }] }),
  multi: (c, n) => ({ type: 'multi', text: T(c, n, 'множественный выбор') + ' Отметьте оба варианта «Верно».', options: [{ text: 'Верно (А)', correct: true }, { text: 'Верно (Б)', correct: true }, { text: 'Неверно 1' }, { text: 'Неверно 2' }] }),
  number: (c, n) => ({ type: 'number', text: T(c, n, 'ввод числа') + ' Сколько будет 12 + 30?', answer: 42, tolerance: 0, unit: '' }),
  text: (c, n) => ({ type: 'text', text: T(c, n, 'ввод текста') + ' Введите слово «пример» (регистр и ё не важны).', accepted: ['пример'] }),
  param: (c, n) => ({ type: 'param', text: T(c, n, 'параметризованная задача') + ' Наряд из {a} человек усилили ещё {b} людьми. Сколько человек в наряде?', vars: { a: { min: 2, max: 9, step: 1 }, b: { min: 1, max: 5, step: 1 } }, formula: 'a + b', unit: 'чел.' }),
  order: (c, n) => ({ type: 'order', text: T(c, n, 'установление последовательности') + ' Расположите по порядку.', items: ['Первый шаг', 'Второй шаг', 'Третий шаг', 'Четвёртый шаг'] }),
  match: (c, n) => ({ type: 'match', text: T(c, n, 'установление соответствий') + ' Сопоставьте.', pairs: [{ left: 'Один', right: '1' }, { left: 'Два', right: '2' }, { left: 'Три', right: '3' }], distractors: ['4'] }),
  blanks_input: (c, n) => ({ type: 'blanks_input', text: T(c, n, 'заполнение пропусков вводом') + ' Заполните пропуски.', content: 'Дважды два — [[4|четыре]], трижды три — [[9|девять]].' }),
  blanks_select: (c, n) => ({ type: 'blanks_select', text: T(c, n, 'заполнение пропусков из списка') + ' Выберите слова.', content: 'Зимой [[*холодно|жарко|душно]], летом [[*тепло|морозно]].' }),
  dictation: (c, n) => ({ type: 'dictation', text: T(c, n, 'интерактивный диктант') + ' Выберите правильное написание.', content: 'В/Ч проводит [[*построение|постраение]] личного [[*состава|састава]].' }),
  eliminate: (c, n) => ({ type: 'eliminate', text: T(c, n, 'последовательное исключение') + ' Исключайте неверные варианты, пока не останется «Верно».', options: [{ text: 'Верно', correct: true }, { text: 'Лишнее 1' }, { text: 'Лишнее 2' }, { text: 'Лишнее 3' }] }),
  slider: (c, n) => ({ type: 'slider', text: T(c, n, 'слайдер') + ' Установите ползунок на 30.', min: 0, max: 100, step: 5, answer: 30, tolerance: 0, unit: 'мин' }),
  letters: (c, n) => ({ type: 'letters', text: T(c, n, 'слова из букв') + ' Соберите слово «ПАТРУЛЬ».', word: 'патруль' }),
  words: (c, n) => ({ type: 'words', text: T(c, n, 'фразы из слов') + ' Соберите фразу «служу отечеству».', phrase: 'служу отечеству', extra_words: ['лишнее'] }),
  find: (c, n) => ({ type: 'find', text: T(c, n, 'поиск в тексте') + ' Отметьте в тексте слово «ключевое».', content: 'Это обычный текст, в котором есть одно [[ключевое]] слово для поиска.' }),
  long: (c, n) => ({ type: 'long', text: T(c, n, 'ответ в свободной форме') + ' Напишите пару предложений.', reference: 'ПРИМЕР эталона: любой осмысленный ответ.' }),
  file: (c, n) => ({ type: 'file', text: T(c, n, 'загрузка файла') + ' Приложите любое изображение или ссылку.', accept: 'image/*,application/pdf', max_kb: 1024 }),
  voice: (c, n) => ({ type: 'voice', text: T(c, n, 'голосовой ответ') + ' Запишите короткое голосовое сообщение.', max_sec: 60 }),
};
const auto = ['single', 'multi', 'number', 'text', 'param', 'order', 'match', 'blanks_input', 'blanks_select', 'dictation', 'eliminate', 'slider', 'letters', 'words', 'find'];
const plan = [ // [категория, код, вопросов, из них easy, кейсов, лишние ручные типы]
  ['ПК', 'pk', 5, 2, 2, ['long']], ['УК', 'uk', 5, 2, 2, []], ['ТК', 'tk', 5, 2, 2, []],
  ['ВУ', 'vu', 12, 8, 4, ['file']], ['СУ', 'su', 3, 2, 2, ['voice']], ['ДУ', 'du', 3, 2, 2, []], ['КПС', 'kps', 3, 2, 2, []],
  ['ФЗ об обороне', 'fz-oborona', 2, 1, 1, []], ['ФЗ о закрытых и охраняемых территориях', 'fz-territorii', 2, 1, 1, []],
  ['ФЗ о гос. службе', 'fz-gossluzhba', 1, 0, 0, []], ['ФЗ об оружии', 'fz-oruzhie', 1, 1, 0, []],
  ['ФЗ о воздушном пространстве', 'fz-vozduh', 1, 0, 0, []], ['ФКЗ об особых правовых режимах', 'fkz-rezhimy', 1, 0, 0, []],
];
const items = []; let t = 0;
for (const [cat, code, nq, ne, nc, extra] of plan) {
  for (let i = 1; i <= nq; i++) { const type = auto[t++ % auto.length]; items.push({ ext_id: `example-${code}-q${i}`, category: cat, kind: 'question', easy: i <= ne, points: 1, ...gen[type](cat, i) }); }
  extra.forEach((type, k) => items.push({ ext_id: `example-${code}-x${k + 1}`, category: cat, kind: 'question', easy: false, points: 2, ...gen[type](cat, nq + k + 1) }));
  for (let i = 1; i <= nc; i++) items.push({ ext_id: `example-${code}-c${i}`, category: cat, kind: 'case', easy: i === 1, type: 'case', points: 5,
    text: `ПРИМЕР [${cat}] — кейс-заглушка №${i}.\nСитуация: условная ситуация для проверки работы кейсов.\nВопрос: как следует поступить? Обоснуйте.`,
    reference: 'ПРИМЕР эталона: правильный порядок действий со ссылками на статьи (будет заменён реальным содержанием).',
    criteria: [{ text: 'Верно квалифицирована ситуация', points: 2 }, { text: 'Указаны нормы (статьи)', points: 2 }, { text: 'Описан порядок действий', points: 1 }] });
}
const q = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const now = Date.UTC(2026, 9, 25);
let sql = `-- 0004: ПРИМЕРЫ вопросов для банка переаттестации (заглушки, помечены «ПРИМЕР», ext_id = example-…).\n-- Сгенерировано tools/gen-seed.js. Идемпотентно: вставляет только отсутствующие ext_id. Реальное содержание загружается импортом JSON.\n`;
let pos = 0;
for (const it of items) {
  const o = W.questionInput(it, null); pos += 10;
  sql += `INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at)\n  SELECT 0, ${q(o.type)}, ${q(o.text)}, ${q(JSON.stringify(o.options))}, ${q(JSON.stringify(o.correct))}, ${q(o.reference)}, ${o.points}, ${pos}, ${q(JSON.stringify(o.data))}, ${q(o.category)}, ${q(o.kind)}, ${o.easy}, 1, ${q(o.ext_id)}, ${now}, ${now}\n  WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = ${q(o.ext_id)});\n`;
}
fs.writeFileSync(path.join(__dirname, '../worker/migrations/0004_seed_examples.sql'), sql);
fs.writeFileSync(path.join(__dirname, 'examples.json'), JSON.stringify({ format: 'vp-exam-questions/1', questions: items }, null, 2));
console.log('items', items.length, 'sql bytes', sql.length);
