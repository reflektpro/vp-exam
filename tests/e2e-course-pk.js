// Курс «По задержанию и процессуальному кодексу»: импорт (tools/gen-course-pk.js), выборка без повторов topic, проверка ответов 5 типов,
// текстовые лекции (засчитываются по времени чтения), курс открывает экзамен после всех 5 лекций. Headless, вход — /__test/login.
// Запуск: bash /tmp/reset.sh (миграции 0001–0009), node serve.js (:8080), затем node e2e-course-pk.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const { execSync } = require('child_process');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const DIR = process.env.COURSE_DIR || '/workspace/vp_course_pk';
const SHOTS = process.env.SHOTS || (__dirname + '/shots/'); fs.mkdirSync(SHOTS, { recursive: true });
const CAT = 'ПК — задержание (ВП)', TITLE = 'По задержанию и процессуальному кодексу';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 700) : '')); };
async function call(method, p, token, body) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let d = null, raw = ''; try { raw = await r.text(); d = JSON.parse(raw); } catch (_) {}
  return { status: r.status, d, raw };
}
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, args) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args }) })).json()).results;
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

// функции воркера в процессе (как в tools/gen-course-pk.js)
const wsrc = fs.readFileSync(path.join(__dirname, '../worker/worker.js'), 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '');
const W = new Function(wsrc + '\nreturn { questionInput, importItems, makeState, publicQuestion, gradeAnswer, validateAnswer, takeDistinct, sampleReatt, distinctCapacity };')();

const SRC = JSON.parse(fs.readFileSync(path.join(DIR, 'questions.json'), 'utf8'));
const byText = new Map(SRC.questions.map(q => [norm(q.question), q]));
// правильный (или заведомо неверный) ответ по публичному виду вопроса и исходному JSON
function answerFor(p, s, wrong) {
  const idOf = (list, t) => (list.find(x => norm(x.text) === norm(t)) || {}).id;
  switch (s.type) {
    case 'single': { const right = idOf(p.options, s.options[s.correct[0]]); return wrong ? p.options.find(o => o.id !== right).id : right; }
    case 'multiple': { const ids = s.correct.map(i => idOf(p.options, s.options[i])); return wrong ? ids.slice(1) : ids; }
    case 'number': return wrong ? s.answer + 1 : s.answer;
    case 'order': { const ids = s.correct.map(i => idOf(p.items, s.options[i])); return wrong ? ids.slice().reverse() : ids; }
    case 'match': { const o = {}; const rs = s.pairs.map(pr => idOf(p.right, pr.right)); s.pairs.forEach((pr, i) => { o[idOf(p.left, pr.left)] = wrong ? rs[(i + 1) % rs.length] : rs[i]; }); return o; }
  }
}

(async () => {
  // ---------- 1. валидатор и импорт ----------
  let v = ''; try { v = execSync(`python3 ${DIR}/validate.py`, { encoding: 'utf8' }); } catch (e) { v = String(e.stdout || e); }
  check('validate.py: 0 ошибок, 119 вопросов, 90 topic', /Итого ошибок: 0/.test(v) && /вопросов: 119/.test(v) && /уникальных topic: 90/.test(v), v.slice(-400));
  const gen = JSON.parse(execSync(`node ${__dirname}/../tools/gen-course-pk.js ${DIR} /tmp/e2e_course_pk.json`, { encoding: 'utf8' }));
  check('конвертер: 5 лекций, 119 вопросов, типы single 54 / multi 28 / number 22 / match 9 / order 6', gen.lectures.length === 5 && gen.questions === 119 &&
    gen.by_type.single === 54 && gen.by_type.multi === 28 && gen.by_type.number === 22 && gen.by_type.match === 9 && gen.by_type.order === 6 && gen.topics === 90, gen);
  const sqlFile = '/tmp/e2e_course_pk.sql'; fs.writeFileSync(sqlFile, JSON.parse(fs.readFileSync('/tmp/e2e_course_pk.json', 'utf8')).batches.join('\n'));
  const wr = `PATH=/workspace/vp_exam_test/node_modules/.bin:$PATH wrangler d1 execute DB --local -c ${__dirname}/wrangler.toml --file ${sqlFile}`;
  execSync(wr, { stdio: 'ignore' }); execSync(wr, { stdio: 'ignore' });   // дважды — проверка идемпотентности
  const cnt = (await sql(`SELECT (SELECT COUNT(*) FROM questions WHERE category = ?1) q, (SELECT COUNT(DISTINCT topic) FROM questions WHERE category = ?1) t,
    (SELECT COUNT(*) FROM questions WHERE category = ?1 AND (topic IS NULL OR topic = '')) nt, (SELECT COUNT(*) FROM courses WHERE title = ?2) c,
    (SELECT COUNT(*) FROM lectures WHERE body != '') l, (SELECT COUNT(*) FROM exams WHERE bank_category = ?1) e`, [CAT, TITLE]))[0];
  check('импорт дважды — без дублей: 119 вопросов, 90 topic, 1 курс, 5 лекций, 1 экзамен', cnt.q === 119 && cnt.t === 90 && cnt.nt === 0 && cnt.c === 1 && cnt.l === 5 && cnt.e === 1, cnt);
  const types = await sql('SELECT type, COUNT(*) c FROM questions WHERE category = ?1 GROUP BY type ORDER BY type', [CAT]);
  check('банк: типы в базе', JSON.stringify(types) === JSON.stringify([{ type: 'match', c: 9 }, { type: 'multi', c: 28 }, { type: 'number', c: 22 }, { type: 'order', c: 6 }, { type: 'single', c: 54 }]), types);
  const ex = (await sql('SELECT * FROM exams WHERE bank_category = ?1', [CAT]))[0];
  check('экзамен: 25 из банка, 70%, 40 мин, перемешивание, после лекций курса', ex.bank_count === 25 && ex.pass_pct === 70 && ex.time_limit_min === 40 && ex.shuffle_options === 1 && ex.shuffle_questions === 1 && ex.requires_lectures === 1 && ex.lecture_mode === 'all' && ex.published === 1, ex);

  // ---------- 2. проверка ответов всех 5 типов (в процессе, все 119) ----------
  const rows = JSON.parse(fs.readFileSync('/tmp/e2e_course_pk.json', 'utf8')) && (await sql('SELECT * FROM questions WHERE category = ?1', [CAT]));
  const bad = [], badWrong = [];
  for (const row of rows) {
    const s = byText.get(norm(row.text)); if (!s) { bad.push('нет исходника: ' + row.text.slice(0, 40)); continue; }
    for (let k = 0; k < 3; k++) {
      const st = W.makeState(row, true), p = W.publicQuestion(row, st);
      const g = W.gradeAnswer(row, st, W.validateAnswer(row, st, answerFor(p, s, false)));
      if (g.ap !== row.points || g.nr) bad.push(s.id + ' ' + s.type + ' → ' + JSON.stringify(g));
      const gw = W.gradeAnswer(row, st, W.validateAnswer(row, st, answerFor(p, s, true)));
      if (gw.ap !== 0) badWrong.push(s.id + ' ' + s.type + ' → ' + JSON.stringify(gw));
    }
  }
  check('все 119 вопросов: верный ответ = полный балл (при перемешанных вариантах)', !bad.length, bad.slice(0, 5));
  check('все 119 вопросов: неверный ответ = 0 (multi — только точное совпадение, match/order — целиком)', !badWrong.length, badWrong.slice(0, 5));

  // ---------- 3. выборка без повторов topic (много прогонов) ----------
  const bankIdx = rows.map(r => ({ id: r.id, category: r.category, kind: r.kind, type: r.type, topic: r.topic }));
  check('ёмкость пула без повторов topic = 90', W.distinctCapacity(bankIdx) === 90);
  let dupRuns = 0, shortRuns = 0; const seenQ = new Set();
  for (let k = 0; k < 5000; k++) {
    const pick = W.takeDistinct(bankIdx, 25, new Set(), new Set());
    if (pick.length !== 25) shortRuns++;
    if (new Set(pick.map(q => q.topic)).size !== pick.length) dupRuns++;
    pick.forEach(q => seenQ.add(q.id));
  }
  check('5000 выборок по 25: ни одного повтора topic, всегда 25 вопросов', dupRuns === 0 && shortRuns === 0, { dupRuns, shortRuns });
  check('за 5000 выборок встречаются все 119 вопросов', seenQ.size === 119, seenQ.size);
  let big = W.takeDistinct(bankIdx, 200, new Set(), new Set());
  check('запрос 200 → не больше 90 (по одному на topic)', big.length === 90 && new Set(big.map(q => q.topic)).size === 90, big.length);
  let rdup = 0;
  for (let k = 0; k < 1000; k++) { const g = W.sampleReatt(bankIdx, [{ label: 'A', categories: [CAT], questions: 40, cases: 0 }, { label: 'B', categories: [CAT], questions: 40, cases: 0 }]); const ids = g.flatMap(x => x.q); const t = ids.map(id => bankIdx.find(q => q.id === id).topic); if (new Set(t).size !== t.length) rdup++; }
  check('переаттестация (sampleReatt): topic не повторяется и между блоками (1000 прогонов)', rdup === 0, rdup);

  // ---------- 4. курс и лекции ----------
  const VP = await login('700000000000000001', 'vp_kursant', 'vp'), V2 = await login('700000000000000002', 'vp_second', 'vp'), NONE = await login('700000000000000003', 'nobody', 'none');
  let r = await call('GET', '/api/courses', NONE); check('без роли ВП курсы недоступны', r.status === 403);
  r = await call('GET', '/api/courses', VP); const C = r.d.courses.find(c => c.title === TITLE);
  check('ВП: курс в «Учебном отделе» — 5 лекций по порядку, экзамен', C && C.lectures.length === 5 && C.lectures.every((l, i) => l.title.startsWith(`Лекция ${i + 1}.`)) && C.exams.length === 1 && C.required_total === 5, C);
  check('лекции текстовые, время чтения задано', C.lectures.every(l => l.kind === 'text' && l.duration_sec >= 60), C.lectures.map(l => [l.kind, l.duration_sec]));
  const E = C.exams[0];
  check('экзамен до лекций закрыт («Сначала просмотрите лекции»), 25 вопросов', !E.can_start && /Сначала просмотрите лекции/.test(E.reason) && E.question_count === 25 && E.pass_pct === 70, E);
  r = await call('POST', `/api/exams/${E.id}/start`, VP); check('старт экзамена до лекций → 403', r.status === 403);
  const L = C.lectures;
  r = await call('GET', '/api/lectures/' + L[0].id, VP);
  check('лекция 1: текст (Markdown) со ссылками на форум, без видео', r.status === 200 && r.d.lecture.kind === 'text' && /forum\.rmrp\.ru\/threads\//.test(r.d.lecture.body) && !r.d.lecture.video_url, r.d && r.d.lecture && Object.keys(r.d.lecture));
  r = await call('GET', '/api/lectures/' + L[1].id, VP); check('лекция 2 закрыта, пока не прочитана лекция 1', r.status === 403);
  r = await call('POST', `/api/lectures/${L[0].id}/heartbeat`, VP, { position: 0 }); r = await call('POST', `/api/lectures/${L[0].id}/heartbeat`, VP, { position: 300 });
  check('«пролистать» текстовую лекцию нельзя (скачок позиции отклонён)', r.d.accepted === false && !r.d.completed, r.d);

  // интерфейс: чтение лекции 1 (время чтения на тест уменьшено до 8 с)
  await sql('UPDATE lectures SET duration_sec = 8 WHERE id = ?1', [L[0].id]);
  await sql('DELETE FROM lecture_progress WHERE user_id = ?1', ['700000000000000001']);
  const b = await chromium.launch({ args: ['--no-sandbox'] }); const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(t => { localStorage.setItem('vpexam_token', t); }, VP);
  const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
  await page.goto(SITE + '#/study'); await page.waitForSelector('.course-card');
  check('«Учебный отдел»: карточка курса', /По задержанию и процессуальному кодексу/.test(await page.textContent('#app')));
  await page.click(`.course-card[href="#/course/${C.id}"]`); await page.waitForSelector('ol.steps');
  check('страница курса: 5 шагов-лекций + экзамен (закрыт)', (await page.$$('ol.steps li.step:not(.exam)')).length === 5 && (await page.$$('ol.steps li.step.exam.locked')).length === 1 && /Текст · чтение/.test(await page.textContent('ol.steps')));
  await page.screenshot({ path: SHOTS + 'pk-course.png', fullPage: true });
  await page.goto(SITE + '#/lecture/' + L[0].id); await page.waitForSelector('article.lecture-text');
  check('лекция: заголовки, таблицы/цитаты, ссылки на форум открываются в новой вкладке', (await page.$$('article.lecture-text h3')).length >= 4 && (await page.$$('article.lecture-text a[href^="https://forum.rmrp.ru/"][target=_blank]')).length >= 3 && (await page.$$('article.lecture-text blockquote')).length >= 1);
  await page.screenshot({ path: SHOTS + 'pk-lecture.png' });
  await page.waitForFunction(() => /засчитана/.test(document.getElementById('rtxt').textContent), null, { timeout: 30000 }).catch(() => {});
  check('чтение лекции 1 в браузере → «Лекция прочитана и засчитана»', /засчитана/.test(await page.textContent('#rtxt')), await page.textContent('#rtxt'));
  r = await call('GET', '/api/lectures/' + L[1].id, VP); check('после лекции 1 открылась лекция 2', r.status === 200);
  // остальные лекции — отметка «прочитано» напрямую (реальное чтение заняло бы ~22 мин)
  for (const l of L.slice(1, 4)) await sql('INSERT OR REPLACE INTO lecture_progress (user_id, lecture_id, max_pos, last_pos, watched_sec, last_hb_at, started_at, completed_at) VALUES (?1, ?2, ?3, ?3, ?3, ?4, ?4, ?4)', ['700000000000000001', l.id, l.duration_sec, Date.now()]);
  r = await call('GET', `/api/exams/${E.id}`, VP); check('4 из 5 лекций → экзамен ещё закрыт', !r.d.exam.can_start && r.d.exam.lectures_left === 1, r.d.exam);
  await sql('INSERT OR REPLACE INTO lecture_progress (user_id, lecture_id, max_pos, last_pos, watched_sec, last_hb_at, started_at, completed_at) VALUES (?1, ?2, ?3, ?3, ?3, ?4, ?4, ?4)', ['700000000000000001', L[4].id, L[4].duration_sec, Date.now()]);
  r = await call('GET', `/api/exams/${E.id}`, VP); check('все 5 лекций → экзамен открыт', r.d.exam.can_start === true, r.d.exam);

  // ---------- 5. попытка: 25 вопросов, разные topic, ответы не уходят клиенту, всё верно → сдан ----------
  r = await call('POST', `/api/exams/${E.id}/start`, VP); const aid = r.d.attempt_id;
  r = await call('GET', '/api/attempts/' + aid, VP); const A = r.d.attempt;
  const srcOf = A.questions.map(p => byText.get(norm(p.text)));
  check('попытка: 25 вопросов из банка курса, все topic разные', A.questions.length === 25 && srcOf.every(Boolean) && new Set(srcOf.map(s => s.topic)).size === 25, A.questions.length);
  const leak = ['"correct"', '"answer"', '"pairs"', '"explanation"', '"quote"', '"accepted"', '"topic"'].filter(k => r.raw.includes(k));
  check('правильные ответы, пояснения и цитаты клиенту не уходят', !leak.length, leak);
  const answers = {}; A.questions.forEach((p, i) => { answers[p.id] = answerFor(p, srcOf[i], false); });
  r = await call('POST', `/api/attempts/${aid}/submit`, VP, { answers });
  r = await call('GET', '/api/attempts/' + aid, VP); check('все ответы верные → «сдан», 100%', r.d.attempt.status === 'passed' && r.d.attempt.score_pct === 100, r.d.attempt);
  r = await call('GET', '/api/courses', VP); check('курс отмечен пройденным', r.d.courses.find(c => c.id === C.id).complete === true);
  await page.goto(SITE + '#/course/' + C.id); await page.waitForTimeout(1200); await page.screenshot({ path: SHOTS + 'pk-course-done.png', fullPage: true });

  // ---------- 6. много реальных попыток через API (второй ВП): без повторов topic, неверные ответы → 0 ----------
  // старт попытки ограничен 10 в минуту на пользователя — 30 попыток делят 5 ВП
  const VS = [V2]; for (let k = 4; k <= 7; k++) VS.push(await login('70000000000000000' + k, 'vp_r' + k, 'vp'));
  for (const uid of ['700000000000000002', '700000000000000004', '700000000000000005', '700000000000000006', '700000000000000007'])
    for (const l of L) await sql('INSERT OR REPLACE INTO lecture_progress (user_id, lecture_id, max_pos, last_pos, watched_sec, last_hb_at, started_at, completed_at) VALUES (?1, ?2, ?3, ?3, ?3, ?4, ?4, ?4)', [uid, l.id, l.duration_sec, Date.now()]);
  await sql('UPDATE exams SET cooldown_min = 0 WHERE id = ?1', [E.id]);
  let apiDup = 0, apiN = 0, wrongOk = true, shuffled = false; const types5 = new Set();
  for (let k = 0; k < 30; k++) {
    const U = VS[k % VS.length];
    const s1 = await call('POST', `/api/exams/${E.id}/start`, U); if (s1.status !== 200) { apiN = -1; console.log(s1.d); break; }
    const at = (await call('GET', '/api/attempts/' + s1.d.attempt_id, U)).d.attempt;
    const ss = at.questions.map(p => byText.get(norm(p.text)));
    if (at.questions.length !== 25 || new Set(ss.map(s => s.topic)).size !== 25) apiDup++;
    ss.forEach(s => types5.add(s.type));
    at.questions.forEach((p, i) => { const s = ss[i]; if (s.type === 'single' && p.options.map(o => norm(o.text)).join('|') !== s.options.map(norm).join('|')) shuffled = true; });
    const ans = {}; if (k === 0) at.questions.forEach((p, i) => { ans[p.id] = answerFor(p, ss[i], true); });
    await call('POST', `/api/attempts/${s1.d.attempt_id}/submit`, U, { answers: ans });
    if (k === 0) { const fin = (await call('GET', '/api/attempts/' + s1.d.attempt_id, U)).d.attempt; wrongOk = fin.status === 'failed' && fin.score_pct === 0; }
    apiN++;
  }
  check('30 попыток через API: в каждой 25 вопросов без повторов topic', apiN === 30 && apiDup === 0, { apiN, apiDup });
  check('все неверные ответы → «не сдан», 0%', wrongOk);
  check('варианты ответов перемешиваются', shuffled);
  check('в попытках встречаются все 5 типов', types5.size === 5, [...types5]);
  await sql('UPDATE exams SET cooldown_min = 60 WHERE id = ?1', [E.id]);

  // ---------- 7. админка: экзамен из банка редактируется ----------
  const AD = await login('417660389723996170', 'super-admin');
  r = await call('GET', '/api/admin/exams/' + E.id, AD); check('админка: у экзамена категория банка и 25 вопросов', r.d.exam.bank_category === CAT && r.d.exam.bank_count === 25);
  r = await call('GET', '/api/admin/bank?category=' + encodeURIComponent(CAT) + '&limit=500', AD);
  check('банк в админке: 119 вопросов категории, topic у каждого', r.d.total === 119 && r.d.questions.length === 119 && r.d.questions.every(q => q.topic), r.d.total);
  check('нет ошибок JS', errs.length === 0, errs);
  await b.close();
  const okN = results.filter(x => x.ok).length; console.log(`\nИТОГО: ${okN}/${results.length} PASS`);
  fs.writeFileSync(__dirname + '/e2e-course-pk-results.json', JSON.stringify(results, null, 1));
  process.exit(okN === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
