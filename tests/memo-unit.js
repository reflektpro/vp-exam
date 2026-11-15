// Юнит-тест кэша справочников изолята (memo): node tests/memo-unit.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../worker/worker.js'), 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '').replace(/^import .*$/gm, '');
const W = new Function(src + '\nreturn { memo, memoClear, MEMO, MEMO_KEEP_RE, getSettings, bankIndex, visibleExams, examLinks, examOwnCounts, lectureStates, docGates, adminCourses };')();
let fail = 0, pass = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };
// поддельная D1: считает запросы и прочитанные строки
const log = [];
const DATA = {
  settings: [{ k: 'sequential_lectures', v: '1' }],
  bank: Array.from({ length: 2500 }, (_, i) => ({ id: i + 1, category: 'c' + (i % 5), kind: 'question', type: 'single', topic: 't' + i })),
  exams: [{ id: 1, title: 'A', bank_count: 10, bank_category: 'c1', published: 1 }, { id: 2, title: 'B', bank_count: 0, published: 1 }],
  links: [{ exam_id: 1, lecture_id: 5 }, { exam_id: 2, lecture_id: 6 }],
  qcount: [{ exam_id: 2, c: 7 }], lectures: [{ id: 5, required: 1, topic_id: null, course_id: null }], topics: [{ id: 1, doc_id: 7, published: 1, title: 'Тема' }, { id: 2, doc_id: 8, published: 1, title: 'Тема 2' }], progress: [{ lecture_id: 11 }],
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
  // выгрузки тем: на N статей — один запрос прогресса, темы и обязательные лекции из кэша
  log.length = 0;
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
