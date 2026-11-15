// Юнит-тест кэша справочников изолята (memo): node tests/memo-unit.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../worker/worker.js'), 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '').replace(/^import .*$/gm, '');
const W = new Function(src + '\nreturn { memo, memoP, memoDrop, memoClear, MEMO, MEMO_KEEP_RE, MEMO_HOT_RE, promoSummary, getSettings, bankIndex, visibleExams, examLinks, examOwnCounts, lectureStates, docGates, adminCourses };')();
let fail = 0, pass = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };
// поддельная D1: считает запросы и прочитанные строки
const log = [];
const DATA = {
  settings: [{ k: 'sequential_lectures', v: '1' }],
  bank: Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, category: 'c' + (i % 5), kind: 'question', type: 'single', topic: 't' + i })),
  exams: [{ id: 1, title: 'A', bank_count: 10, bank_category: 'c1', published: 1 }, { id: 2, title: 'B', bank_count: 0, published: 1 }],
  links: [{ exam_id: 1, lecture_id: 5 }, { exam_id: 2, lecture_id: 6 }],
  qcount: [{ exam_id: 2, c: 7 }], lectures: [{ id: 5, required: 1, topic_id: null, course_id: null }], topics: [{ id: 1, doc_id: 7, published: 1, title: 'Тема' }, { id: 2, doc_id: 8, published: 1, title: 'Тема 2' }], progress: [{ lecture_id: 11, completed_at: 1 }],
  req: [{ id: 11, topic_id: 1 }, { id: 12, topic_id: 2 }], acourses: [{ id: 1, position: 0 }, { id: 2, position: 1 }], alec: [{ id: 5, course_id: 1 }, { id: 6, course_id: 1 }, { id: 7, course_id: null }], aex: [{ id: 1, course_id: 2 }], atop: [],
};
const pick = (sql) => /FROM lectures WHERE published = 1 AND required/.test(sql) ? 'req' : /FROM courses ORDER/.test(sql) ? 'acourses' : /FROM lectures ORDER/.test(sql) ? 'alec' : /FROM exams ORDER/.test(sql) ? 'aex' : /FROM topics t ORDER/.test(sql) ? 'atop' : /FROM settings/.test(sql) ? 'settings' : /exam_id = 0 AND active/.test(sql) ? 'bank' : /FROM exams e/.test(sql) ? 'exams' : /FROM exam_lectures/.test(sql) ? 'links'
  : /GROUP BY exam_id/.test(sql) ? 'qcount' : /FROM lectures l/.test(sql) ? 'lectures' : /FROM topics/.test(sql) ? 'topics' : /lecture_progress/.test(sql) ? 'progress' : '?';
const env = { ADMIN_IDS: '', DB: { prepare(sql) { const st = { bind() { return st; }, async all() { const k = pick(sql); log.push(k); return { results: JSON.parse(JSON.stringify(DATA[k] || [])) }; }, async first() { return null; } }; return st; } } };
const count = (k) => log.filter(x => x === k).length;
(async () => {
  await W.getSettings(env); await W.getSettings(env);
  ok('настройки: второй вызов без запроса к D1', count('settings') === 1);
  const [a, b] = await Promise.all([W.bankIndex(env), W.bankIndex(env)]);
  ok('банк: параллельные вызовы — один запрос (общий промис)', count('bank') === 1 && a.length === 2500 && b.length === 2500);
  a[0].category = 'испорчено'; a.length = 1;
  const c = await W.bankIndex(env);
  ok('банк: отдаётся копия — правка результата не портит кэш', c.length === 2500 && c[0].category === 'c0' && count('bank') === 1);
  for (let i = 0; i < 20; i++) { await W.lectureStates(env, 'u' + i); await W.visibleExams(env); await W.examLinks(env); await W.examLinks(env, 1); await W.examOwnCounts(env); }
  ok('20 заходов: лекции, темы, экзамены, связи, счётчики — по одному запросу; прогресс — каждый раз', count('lectures') === 1 && count('topics') === 1 && count('exams') === 1 && count('links') === 1 && count('qcount') === 1 && count('progress') === 20, log.reduce((m, k) => (m[k] = (m[k] || 0) + 1, m), {}));
  ok('examLinks(id) из общего кэша', JSON.stringify([...(await W.examLinks(env, 1)).entries()]) === '[[1,[5]]]');
  W.memoClear(); await W.bankIndex(env); await W.getSettings(env);
  ok('сброс кэша — следующее чтение снова из D1', count('bank') === 2 && count('settings') === 2);
  // TTL
  const e = W.MEMO.get('bank'); e.t -= 61000; await W.bankIndex(env);
  ok('TTL банка 60 с: устаревшая запись перечитывается', count('bank') === 3);
  const s = W.MEMO.get('settings'); s.t -= 29000; await W.getSettings(env);
  ok('TTL настроек 30 с: свежая запись не перечитывается', count('settings') === 2);
  // ошибка D1 не кэшируется
  let calls = 0; await W.memo('topics:err', async () => { calls++; throw new Error('7500'); }).catch(() => {});
  await W.memo('topics:err', async () => { calls++; return [1]; });
  ok('ошибка запроса не остаётся в кэше', calls === 2);
  // какие записи сбрасывают кэш
  const keep = ['/api/lectures/3/heartbeat', '/api/attempts/9/answers', '/api/attempts/9/submit', '/api/exams/4/start', '/api/reatt/simple/start', '/api/reports', '/api/me', '/api/lead/reports/2/review', '/api/people/123456/events'];
  const clear = ['/api/admin/questions/5', '/api/admin/exams/3/import', '/api/admin/settings', '/api/admin/lectures/2', '/api/lead/config', '/api/docs/1', '/api/promo', '/api/admin/backups/1/restore', '/api/admin/topics/4'];
  ok('частые пользовательские записи кэш не сбрасывают', keep.every(p => W.MEMO_KEEP_RE.test(p)), keep.filter(p => !W.MEMO_KEEP_RE.test(p)));
  ok('правки вопросов, лекций, тем, экзаменов, настроек, восстановление — сбрасывают', clear.every(p => !W.MEMO_KEEP_RE.test(p)), clear.filter(p => W.MEMO_KEEP_RE.test(p)));
  const hot = ['/api/lectures/3/heartbeat', '/api/attempts/9/answers', '/api/attempts/9/upload'];
  ok('пульс и автосохранение ответов — «горячие» записи без сброса', hot.every(p => W.MEMO_HOT_RE.test(p)) && !W.MEMO_HOT_RE.test('/api/attempts/9/submit') && !W.MEMO_HOT_RE.test('/api/reports'));
  ok('рапорты на повышение и их проверка — пользовательские записи', ['/api/promo/raports', '/api/lead/promo/5/review'].every(p => W.MEMO_KEEP_RE.test(p)));
  // персональный кэш: прогресс u1 из кэша, сброс 'u:' — перечитать; X-VP-Fresh (env.__fresh) — мимо кэша
  log.length = 0; await W.lectureStates(env, 'u1'); await W.lectureStates(env, 'u1');
  ok('прогресс пользователя: повтор из кэша (u:<id>:prog)', count('progress') === 0 || count('progress') === 1, log);
  const before = count('progress'); await W.lectureStates(Object.assign(Object.create(env), { __fresh: true }), 'u1');
  ok('X-VP-Fresh: чтение мимо кэша', count('progress') === before + 1);
  W.MEMO.set('sess:abc', { t: Date.now(), p: Promise.resolve(1) }); W.MEMO.set('settings', { t: Date.now(), p: Promise.resolve({}) });
  W.memoDrop('sess:'); W.memoDrop('u:');
  ok('сброс по префиксу: сессии и личные данные удалены, общие данные — на месте', !W.MEMO.has('sess:abc') && ![...W.MEMO.keys()].some(k => k.startsWith('u:')) && W.MEMO.has('settings'));
  // итог рапорта на повышение
  const pc = { config: { points_per_item: 100, pts: { training: 30, prof: 30, guardhouse: 75, naryad: 0 }, ladder: [{ rank: 'Сержант', to: 'Старший сержант', points: 150, need: { naryad: 1, prof: 1, training: 1 } }] }, missing_points: true, items: [] };
  const items = [{ key: 'training', n: 3 }, { key: 'prof', n: 1 }, { key: 'naryad', n: 1 }, { key: 'guardhouse', n: 3 }];
  let sm = W.promoSummary(pc, 'Сержант', items, {}, []);
  ok('итог: без проверки засчитано 0, заявлено 345', sm.points === 0 && sm.claimed === 345 && sm.pending === 4 && !sm.met, sm);
  const rv = { training: { status: 'ok', n_ok: 2 }, prof: { status: 'rejected' }, naryad: { status: 'ok' }, guardhouse: { status: 'ok' } };
  sm = W.promoSummary(pc, 'Сержант', items, rv, []);
  ok('итог: 285 баллов, проф. пункт закрыт баллами сверх нормы', sm.points === 285 && sm.covered === 1 && sm.met && sm.rejected === 1, sm);
  sm = W.promoSummary({ ...pc, missing_points: false }, 'Сержант', items, rv, []);
  ok('итог: замена выключена — не хватает 1 пункта', !sm.met && sm.left.items === 1, sm);
  sm = W.promoSummary(pc, 'Сержант', items, rv, [{ id: 1, title: 'Курс', done: false }]);
  ok('итог: непройденный обязательный курс — не выполнено', !sm.met && sm.left.courses.length === 1, sm);
  // выгрузки тем: на N статей — один запрос прогресса, темы и обязательные лекции из кэша
  W.memoDrop('u:'); log.length = 0;
  const gate = await W.docGates(env, { id: 'u1', role: 'candidate' });
  const g7 = await gate(7), g8 = await gate(8), g9 = await gate(9);
  ok('выгрузки: пройдённая тема открыта, непройдённая закрыта, без темы — открыта', g7 === null && g8 === 'Тема 2' && g9 === null, [g7, g8, g9]);
  await (await W.docGates(env, { id: 'u2', role: 'candidate' }))(7);
  ok('выгрузки: один запрос прогресса на запрос пользователя, темы и лекции — из кэша', count('progress') === 2 && count('topics') <= 1 && count('req') === 1, log);
  // админ-курсы: число лекций и экзаменов без подзапросов на курс
  const ac = await (await W.adminCourses(env)).json();
  ok('админ-курсы: счётчики из списков', JSON.stringify(ac.courses.map(c => [c.id, c.lecture_count, c.exam_count])) === '[[1,2,0],[2,0,1]]', ac.courses);
  console.log(fail ? `FAILED ${fail}` : `ALL OK ${pass}`);
  process.exit(fail ? 1 : 0);
})();
