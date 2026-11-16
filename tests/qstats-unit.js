// Юнит-тест аналитики вопросов (qstatsBuild) и мини-проверки после лекции (lectureQuiz): node tests/qstats-unit.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../worker/worker.js'), 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '').replace(/^import .*$/gm, '');
const W = new Function(src + '\nreturn { qstatsBuild, lectureQuiz, MEMO, qsTopicOf };')();
let fail = 0, pass = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x).slice(0, 400) : ''); } };
const opts = JSON.stringify([{ id: 'a', text: 'Верный' }, { id: 'b', text: 'Ловушка' }, { id: 'c', text: 'Третий' }]);
const Q = [
  { id: 1, type: 'single', text: 'Лёгкий', options: opts, correct: '["a"]', points: 1, source_doc: 'vu', source_ref: 'ВУ, п. 1.10', category: 'Переаттестация: Средняя', base: 'medium' },
  { id: 2, type: 'single', text: 'Ловушка', options: opts, correct: '["a"]', points: 1, category: 'ПК', topic: null, source_ref: 'ст. 12 ч. 3' },
  { id: 3, type: 'single', text: 'Обратный', options: opts, correct: '["a"]', points: 1, category: 'ПК', source_ref: 'ст. 12 ч. 5' },
  { id: 4, type: 'multi', text: 'Несколько', options: opts, correct: '["a","c"]', points: 2, category: 'ДУ' },
  { id: 5, type: 'number', text: 'Число', options: '[]', correct: '[]', points: 1, category: 'ДУ' },
  { id: 6, type: 'single', text: 'Мало', options: opts, correct: '["a"]', points: 1, category: 'ДУ' },
  { id: 7, type: 'single', text: 'Никто', options: opts, correct: '["a"]', points: 1, category: 'ДУ' },
  { id: 8, type: 'number', text: 'Сильные 1', options: '[]', correct: '[]', points: 3, category: 'ДУ' },
  { id: 9, type: 'number', text: 'Сильные 2', options: '[]', correct: '[]', points: 3, category: 'ДУ' },
];
// 30 попыток: «сила» участника s = i/29; вопрос 3 решают слабые, вопрос 2 — чаще выбирают ловушку b
const A = [], ANS = [];
for (let i = 0; i < 30; i++) {
  const s = i / 29; A.push({ id: 100 + i, exam_id: 9, reatt: i % 2 ? 'full' : null, started_at: 0, submitted_at: 600000, title: i % 2 ? 'Полная общая' : null });
  const put = (q, v, ap) => ANS.push({ t: 100 + i, q, v: JSON.stringify(v), ap, mp: null });
  put(1, 'a', 1);
  put(2, i % 3 === 0 ? 'a' : 'b', i % 3 === 0 ? 1 : 0);
  put(3, s < 0.5 ? 'a' : 'c', s < 0.5 ? 1 : 0);
  put(4, s > 0.3 ? ['a', 'c'] : ['a', 'b'], s > 0.3 ? 2 : 0);
  put(5, 5, s > 0.6 ? 1 : 0);
  if (i < 4) put(6, 'a', 1);
  put(7, i === 0 ? null : 'c', 0);
  put(8, 1, s > 0.35 ? 3 : 0); put(9, 1, s > 0.55 ? 3 : 0);
}
ANS.push({ t: 100, q: 4, v: '["a"]', ap: null, mp: null }); // дубль-заглушка: ждёт ручной проверки — пропускается (тот же вопрос перезапишет счёт не должен)
const S = W.qstatsBuild(ANS.filter((x, k) => k !== ANS.length - 1), A, Q, [{ id: 9, title: 'Экзамен курса' }], 123);
const it = (id) => S.items.find(x => x.id === id);
ok('посчитаны все 9 вопросов, 30 попыток', S.items.length === 9 && S.attempts === 30, { n: S.items.length, a: S.attempts });
ok('лёгкий: 100% верных, флаг «Слишком лёгкий»', it(1).p === 1 && it(1).flags.includes('easy'), it(1));
ok('ловушка: самый частый неверный — «Ловушка» (20), флаг дистрактора', it(2).wrong && it(2).wrong.text === 'Ловушка' && it(2).wrong.n === 20 && it(2).flags.includes('distractor'), it(2));
ok('распределение по вариантам (single)', JSON.stringify(it(2).opts.map(o => o.n)) === '[10,20,0]', it(2).opts);
ok('обратный: отрицательная разделяющая способность (r<0, D<0)', it(3).r < 0 && it(3).d < 0 && it(3).flags.includes('neg'), it(3));
ok('нормальный multi: r>0, D>0, без флагов, варианты считаются по каждому выбору', it(4).r > 0 && it(4).d > 0 && !it(4).flags.length && it(4).opts[0].n === 30, it(4));
ok('числовой вопрос: % верных без распределения', it(5).opts === null && Math.abs(it(5).p - 12 / 30) < 0.01, it(5));
ok('мало данных (<10 ответов) — только флаг «Мало данных»', it(6).n === 4 && JSON.stringify(it(6).flags) === '["low"]', it(6));
ok('никто не решает + пропуск ответа считается', it(7).p === 0 && it(7).flags.includes('hard') && it(7).skip === 1, it(7));
ok('экзамены: курс и переаттестация с названиями', S.exams.length === 2 && S.exams.some(e => e.key === 'r:full' && e.title === 'Полная общая') && S.exams.some(e => e.key === 'e:9' && e.title === 'Экзамен курса'), S.exams);
ok('документ: ВУ по source_doc, иначе категория', it(1).doc === 'ВУ' && it(2).doc === 'ПК', [it(1).doc, it(2).doc]);
ok('темы: «п. 1» (без повтора документа), «ст. 12»; слабые темы — по возрастанию % верных', it(1).topic === 'п. 1' && it(2).topic === 'ст. 12' && S.topics[0].p <= S.topics[S.topics.length - 1].p, S.topics);
ok('сводка по документам: вопросы, ответы, проблемные', S.docs.find(d => d.key === 'ПК').q === 2 && S.docs.find(d => d.key === 'ПК').bad === 2, S.docs);
ok('время: оценка по длительности попытки (600 с / число вопросов)', it(1).sec > 60 && it(1).sec < 80, it(1).sec);
const S2 = W.qstatsBuild([...ANS.slice(0, 7), { t: 100, q: 4, v: '["a"]', ap: null, mp: null }].filter(x => x.q !== 4 || x.ap === null), A, Q, [], 1);
ok('ответ на ручной проверке (баллов нет) не учитывается', !S2.items.find(x => x.id === 4), S2.items.map(x => x.id));
ok('пустые данные — пустой результат без ошибок', W.qstatsBuild([], [], [], [], 1).items.length === 0);

(async () => {
  let calls = 0; const rows = [
    { lecture_id: 5, lq_quote: '', id: 11, type: 'single', text: 'В1', options: opts, correct: '["a"]', data: JSON.stringify({ meta: { quote: '«Цитата»', article: 'ВУ, п. 1' } }), source_ref: '' },
    { lecture_id: 5, lq_quote: 'Абзац лекции', id: 12, type: 'multi', text: 'В2', options: opts, correct: '["a","c"]', data: '{}', source_ref: 'ст. 3' },
    { lecture_id: 6, lq_quote: '', id: 13, type: 'single', text: 'В3', options: '[]', correct: '["a"]', data: '{}', source_ref: '' }];
  const env = { DB: { prepare() { const st = { bind() { return st; }, async all() { calls++; return { results: JSON.parse(JSON.stringify(rows)) }; } }; return st; } } };
  const q5 = await W.lectureQuiz(env, 5); await W.lectureQuiz(env, 6); await W.lectureQuiz(env, 7);
  ok('мини-проверка: все лекции одним запросом, дальше из кэша', calls === 1, calls);
  ok('мини-проверка: цитата вопроса, иначе абзац лекции; пункт', q5.length === 2 && q5[0].quote === '«Цитата»' && q5[0].ref === 'ВУ, п. 1' && q5[1].quote === 'Абзац лекции' && q5[1].ref === 'ст. 3', q5);
  ok('мини-проверка: вопрос без вариантов пропущен', (await W.lectureQuiz(env, 6)).length === 0);
  W.MEMO.clear();
  const bad = { DB: { prepare() { return { async all() { throw new Error('no such table: lecture_quiz'); } }; } } };
  ok('мини-проверка: до миграции (нет таблицы) — пусто, без ошибки', (await W.lectureQuiz(bad, 5)).length === 0);
  console.log(`\n${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0);
})();
