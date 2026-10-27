// E2E «Курсы → темы» (миграция 0013): системы званий/должностей, темы с короткими лекциями по порядку, полная выгрузка
// (статья Базы данных) и видео — только после всех лекций темы (сервер: 403), связанная тема «Основы ГУ ВП» в «Стажёр ВП»
// засчитывается в обе стороны, экзамены по группе тем, админ: темы, лекции в теме, экзамен по темам. Headless, без Discord.
// Запуск: bash /tmp/reset.sh (0001–0013), node serve.js (:8080).
const { chromium } = require('playwright');
const fs = require('fs');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || (__dirname + '/shots/'); fs.mkdirSync(SHOTS, { recursive: true });
const SUPER = '417660389723996170';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 600) : '')); };
async function call(method, path, token, body) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch (_) {}
  return { status: r.status, d, raw: t };
}
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, args) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args }) })).json()).results;
const U = { vp: '830000000000000001', vp2: '830000000000000002', none: '830000000000000003' };
const done = (uid, l) => sql('INSERT OR REPLACE INTO lecture_progress (user_id, lecture_id, max_pos, last_pos, watched_sec, last_hb_at, started_at, completed_at) VALUES (?1, ?2, ?3, ?3, ?3, ?4, ?4, ?4)', [uid, l.id, l.duration_sec, Date.now()]);

(async () => {
  const A = await login(SUPER, 'super-admin');
  const T = { vp: await login(U.vp, 'vp_topic', 'vp'), vp2: await login(U.vp2, 'vp_topic2', 'vp'), none: await login(U.none, 'nobody', 'none') };
  // ---------- 1. структура ----------
  let r = await call('GET', '/api/courses', T.vp);
  const C = (slugTitle) => r.d.courses.find(c => c.title.startsWith(slugTitle));
  const rank = r.d.courses.filter(c => c.track === 'rank' && c.topics.length), pos = r.d.courses.filter(c => c.track === 'position' && c.topics.length);
  check('система званий: 5 курсов с темами', rank.map(c => c.title.slice(0, 6)).join() === 'Курс 1,Курс 2,Курс 3,Курс 4,Курс 5', rank.map(c => c.title));
  check('система должностей: Стажёр ВП, Инспектор ВП, Инструктор, Инспектор комендатуры', pos.map(c => c.title).join() === 'Стажёр ВП,Инспектор ВП,Инструктор,Инспектор комендатуры', pos.map(c => c.title));
  check('темы: 1 / 4 / 4 / 8 / 7', rank.map(c => c.topics.length).join() === '1,4,4,8,7', rank.map(c => c.topics.length));
  check('Курс 5: ПОиП, ФТ, ПКС, налёты, КрАЗ, ОПГО, Основы психологии', C('Курс 5').topics.map(t => t.title).join('|').includes('Основы психологии') && C('Курс 5').topics.some(t => /ОПГО/.test(t.title)));
  const st = C('Стажёр ВП'); const K4 = C('Курс 4').id;
  check('Стажёр ВП: 2 темы, первая связана с «Основы ГУ ВП»', st.topics.length === 2 && st.topics[0].linked && st.topics[0].linked.title === 'Основы ГУ ВП' && st.topics[1].status === 'placeholder', st.topics);
  check('должности: по 1 теме (кроме стажёра)', pos.slice(1).every(c => c.topics.length === 1));
  check('новые экзамены — черновики (не видны кандидату)', r.d.courses.every(c => c.exams.every(e => !/Уставы|УК \+ КоАП|Федеральные законы|OOC|психологии/.test(e.title))));
  r = await call('GET', '/api/courses', T.none); check('без роли ВП — 403', r.status === 403);
  r = await call('GET', '/api/topics/1', T.none); check('тема без роли ВП — 403', r.status === 403);

  // ---------- 2. админ наполняет тему «Основы ГУ ВП» ----------
  r = await call('GET', '/api/admin/topics', A); const TP = r.d.topics; const tp = (title, course) => TP.find(t => t.title === title && (!course || t.course_title.startsWith(course)));
  const OS = tp('Основы ГУ ВП', 'Курс 1'), OSP = tp('Основы ГУ ВП', 'Стажёр'), RAB = tp('Работа стажёра ВП'), DU = tp('Дисциплинарный устав (ДУ)');
  check('админ: список тем (29)', TP.length === 29, TP.length);
  r = await call('GET', '/api/admin/topics', T.vp); check('ВП не видит админку тем (403)', r.status === 403);
  r = await call('POST', '/api/docs', A, { category: 'Курсы: выгрузки', title: 'Основы ГУ ВП — полная выгрузка', body: '# Основы\n\nСЕКРЕТНЫЙ_ТЕКСТ_ВЫГРУЗКИ всё целиком.' }); const DOC = r.d.doc.id;
  r = await call('PUT', '/api/admin/topics/' + OS.id, A, { doc_id: DOC, video_plan: '1. Вступление\n2. Примеры', status: 'ready' });
  check('тема: выгрузка и план ролика сохранены', r.d.topic.doc_id === DOC && r.d.topic.video_plan.includes('Примеры'), r.d);
  const mkL = async (title, topic, extra) => (await call('POST', '/api/admin/lectures', A, { title, body: '# ' + title + '\n\nТекст лекции.', duration_sec: 60, published: true, required: true, topic_id: topic, ...extra })).d.lecture;
  const L1 = await mkL('Основы: лекция 1', OS.id), L2 = await mkL('Основы: лекция 2', OS.id), L3 = await mkL('Основы: лекция 3', OS.id);
  check('лекции в теме: курс подставлен автоматически', L1.topic_id === OS.id && L1.course_id === OS.course_id, L1);
  r = await call('POST', '/api/admin/lectures', A, { title: 'x', body: 'x', duration_sec: 60, topic_id: OSP.id }); check('в связанную тему лекции не добавляются (400)', r.status === 400, r.d);
  r = await call('PUT', '/api/admin/topics/' + OS.id, A, { link_topic_id: OS.id }); check('тема не ссылается сама на себя (400)', r.status === 400);
  r = await call('PUT', '/api/admin/topics/' + DU.id, A, { link_topic_id: OSP.id }); check('нельзя связать со связанной (400)', r.status === 400);
  r = await call('PUT', '/api/admin/topics/' + OS.id, A, { link_topic_id: DU.id }); check('тема со своими лекциями не становится связанной (400)', r.status === 400);
  r = await call('PUT', '/api/admin/topics/' + DU.id, A, { status: 'bogus' }); check('неверный статус (400)', r.status === 400);
  // банк и экзамен темы
  r = await call('POST', '/api/admin/bank/import', A, { data: { questions: [1, 2, 3, 4, 5, 6].map(i => ({ type: 'single', text: 'Основы: вопрос ' + i, options: ['верно', 'неверно'], correct: [0], category: 'Основы ГУ ВП', topic: 'osn-' + i })) } });
  check('банк «Основы ГУ ВП»: 6 вопросов', r.status === 200 && r.d.report.created === 6, r.d);
  r = await call('GET', '/api/admin/exams', A); const EX = r.d.exams.find(e => e.title === 'Экзамен: Основы ГУ ВП'), EXS = r.d.exams.find(e => e.title === 'Экзамен: Стажёр ВП'), EXU = r.d.exams.find(e => /Уставы/.test(e.title));
  check('экзамен «Основы»: режим «по темам», 3 обязательные лекции', EX.lecture_mode === 'topics' && EX.topic_ids.includes(OS.id) && EX.effective_lecture_count === 3, EX);
  check('экзамен «Стажёр ВП»: темы обеих систем через связь', EXS.topic_ids.includes(OSP.id) && EXS.topic_ids.includes(RAB.id) && EXS.effective_lecture_count === 3, EXS);
  r = await call('PUT', '/api/admin/exams/' + EX.id, A, { bank_count: 5, published: true }); check('экзамен «Основы» опубликован', r.d.exam.published === 1, r.d);
  r = await call('PUT', '/api/admin/exams/' + EXS.id, A, { bank_category: 'Основы ГУ ВП', bank_count: 4, published: true }); check('экзамен «Стажёр ВП» опубликован', r.d.exam.published === 1);
  r = await call('PUT', '/api/admin/exams/' + EXU.id, A, { topic_ids: [DU.id], required_lectures: 'all' }); check('темы важнее списка лекций при сохранении формы', r.d.exam.lecture_mode === 'topics' && r.d.exam.topic_ids.join() === String(DU.id), r.d.exam);
  r = await call('PUT', '/api/admin/exams/' + EXU.id, A, { topic_ids: [999999] }); check('несуществующая тема экзамена (400)', r.status === 400);

  // ---------- 3. кандидат: выгрузка и видео только после лекций ----------
  r = await call('GET', '/api/topics/' + OS.id, T.vp);
  check('тема: 3 лекции, первая открыта, вторая заблокирована (по порядку внутри темы)', r.d.lectures.length === 3 && !r.d.lectures[0].locked && r.d.lectures[1].locked, r.d.lectures.map(l => l.status));
  check('выгрузка закрыта до лекций', r.d.material && r.d.material.locked && !r.d.material.doc_id, r.d.material);
  check('видео — «готовится» (есть план, нет ролика)', r.d.video && r.d.video.planned, r.d.video);
  check('план ролика кандидату не отдаётся', r.d.topic.video_plan === undefined);
  check('экзамен темы закрыт', r.d.exams.length === 1 && !r.d.exams[0].can_start && r.d.exams[0].lectures_left === 3, r.d.exams);
  r = await call('GET', '/api/docs/' + DOC, T.vp); check('статья-выгрузка напрямую — 403', r.status === 403 && /после прохождения всех лекций/.test(r.d.error), r.d);
  r = await call('GET', '/api/docs?q=СЕКРЕТНЫЙ_ТЕКСТ', T.vp); check('поиск не находит текст закрытой выгрузки', !r.d.docs.length);
  r = await call('GET', '/api/docs', T.vp); let dd = r.d.docs.find(x => x.id === DOC); check('в Базе данных — замок без текста', dd && dd.locked && !dd.snippet && /Основы ГУ ВП/.test(dd.locked_topic), dd);
  r = await call('GET', '/api/docs/' + DOC, A); check('админ видит выгрузку всегда', r.status === 200);
  r = await call('GET', '/api/lectures/' + L2.id, T.vp); check('вторая лекция до первой — 403', r.status === 403);
  await done(U.vp, L1); await done(U.vp, L2);
  r = await call('GET', '/api/topics/' + OS.id, T.vp); check('2 из 3 — выгрузка ещё закрыта', r.d.material.locked && r.d.progress.required_done === 2);
  await done(U.vp, L3);
  await call('PUT', '/api/admin/topics/' + OS.id, A, { video_url: 'https://www.youtube.com/watch?v=MaW7GrNHHCc' });
  r = await call('GET', '/api/topics/' + OS.id, T.vp);
  check('все лекции → тема пройдена, выгрузка открыта', r.d.progress.done && r.d.material.doc_id === DOC, r.d.progress);
  check('видео открыто (YouTube)', r.d.video && r.d.video.type === 'youtube' && r.d.video.youtube_id === 'MaW7GrNHHCc', r.d.video);
  check('экзамен темы открыт', r.d.exams[0].can_start, r.d.exams[0]);
  r = await call('GET', '/api/docs/' + DOC, T.vp); check('выгрузка читается', r.status === 200 && /СЕКРЕТНЫЙ/.test(r.d.doc.body));
  r = await call('GET', '/api/docs/' + DOC, T.vp2); check('у другого кандидата — по-прежнему 403', r.status === 403);
  // связанная тема
  r = await call('GET', '/api/topics/' + OSP.id, T.vp);
  check('«Стажёр ВП» → «Основы»: те же лекции, засчитаны', r.d.topic.linked && r.d.lectures.map(l => l.id).join() === [L1.id, L2.id, L3.id].join() && r.d.progress.done && r.d.material.doc_id === DOC, r.d);
  check('экзамен «Стажёр ВП» открыт (тема «Работа стажёра» пока без лекций)', r.d.exams.some(e => e.id === EXS.id && e.can_start), r.d.exams);
  r = await call('GET', '/api/courses', T.vp);
  check('курс 1 пройден по темам (экзамен ещё не сдан → не завершён)', C('Курс 1').topics[0].done && C('Курс 1').topics_done === 1 && !C('Курс 1').complete);
  check('Стажёр ВП: тема 1 засчитана из системы званий', C('Стажёр ВП').topics[0].done);
  // в обратную сторону: второй кандидат проходит через «Стажёр ВП»
  await done(U.vp2, L1); await done(U.vp2, L2); await done(U.vp2, L3);
  r = await call('GET', '/api/topics/' + OS.id, T.vp2); check('пройдено в «Стажёр ВП» → засчитано в системе званий', r.d.progress.done);
  // экзамен из банка по теме
  r = await call('POST', `/api/exams/${EX.id}/start`, T.vp); const AT = r.d.attempt_id; check('старт экзамена темы', !!AT, r.d);
  r = await call('GET', '/api/attempts/' + AT, T.vp); check('5 вопросов из банка «Основы ГУ ВП»', r.d.attempt.questions.length === 5);

  // ---------- 4. удаление темы ----------
  r = await call('POST', '/api/admin/topics', A, { course_id: OS.course_id, title: 'Временная тема', status: 'draft' }); const TT = r.d.topic.id;
  check('создание темы', r.status === 200 && r.d.topic.title === 'Временная тема', r.d);
  const LT = await mkL('Временная лекция', TT);
  await call('PUT', '/api/admin/exams/' + EX.id, A, { topic_ids: [OS.id, TT] });
  r = await call('DELETE', '/api/admin/topics/' + TT, A); check('удаление темы', r.status === 200);
  const lrow = (await sql('SELECT topic_id, course_id FROM lectures WHERE id = ?1', [LT.id]))[0]; check('лекция осталась в курсе без темы', lrow.topic_id === null && lrow.course_id === OS.course_id, lrow);
  r = await call('GET', '/api/admin/exams/' + EX.id, A); check('тема убрана из экзамена', r.d.exam.topic_ids.join() === String(OS.id), r.d.exam.topic_ids);
  await call('DELETE', '/api/admin/lectures/' + LT.id, A);

  // ---------- 5. UI ----------
  const b = await chromium.launch(); const errs = [];
  async function page(tok, mob) { const ctx = await b.newContext(mob ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(t => { localStorage.setItem('vpexam_token', t); }, tok); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return p; }
  const go = async (p, h, sel) => { await p.goto(SITE + '#' + h); await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(250); };
  const P = await page(T.vp2);
  await go(P, '/study', '.tracktabs');
  check('UI: вкладки «Система званий» / «Система должностей»', (await P.$$eval('.tracktabs a', a => a.map(x => x.textContent))).join() === 'Система званий,Система должностей');
  check('UI: 5 курсов в системе званий', (await P.$$('.course-grid .course-card')).length >= 5);
  await P.screenshot({ path: SHOTS + 'topics-study-rank.png', fullPage: true });
  await P.click('.tracktabs a:nth-child(2)'); await P.waitForFunction(() => /Стажёр ВП/.test(document.querySelector('#app').textContent)); await P.waitForTimeout(200);
  check('UI: система должностей — 4 курса', (await P.$$('.course-grid .course-card')).length === 4);
  await P.screenshot({ path: SHOTS + 'topics-study-position.png', fullPage: true });
  await go(P, '/course/' + st.id, '.topic-card');
  check('UI: курс — «Выберите тему», 2 карточки, связанная отмечена', (await P.$$('.topic-card')).length === 2 && /Общая тема с системой званий/.test(await P.textContent('.topic-card')));
  await go(P, '/topic/' + OSP.id, 'ol.steps');
  const tt = await P.textContent('#app');
  check('UI: тема — лекции, выгрузка открыта, экзамен', /Основы: лекция 3/.test(tt) && /Полная выгрузка/.test(tt) && /Экзамен: Стажёр ВП/.test(tt) && !/Видео по теме/.test(tt), tt.slice(0, 400));
  await P.screenshot({ path: SHOTS + 'topics-topic-position.png', fullPage: true });
  await go(P, '/topic/' + OS.id, 'ol.steps'); check('UI: в системе званий — видео-плеер', !!(await P.$('.vwrap iframe')));
  await P.click(`a[href="#/lecture/${L2.id}"]`); await P.waitForSelector('.lecture-text');
  check('UI: из лекции — «← К теме»', /К теме/.test(await P.textContent('#app p a')));
  const P1 = await page(await login('830000000000000009', 'fresh', 'vp'));
  await go(P1, '/topic/' + OS.id, 'ol.steps'); check('UI: новичок — выгрузка и видео под замком', (await P1.$$('.step.locked')).length >= 3, await P1.textContent('#app'));
  await P1.screenshot({ path: SHOTS + 'topics-topic-locked.png', fullPage: true });
  await go(P1, '/docs', 'h1'); check('UI: База данных — карточка выгрузки с замком', /🔒 Основы ГУ ВП — полная выгрузка/.test(await P1.textContent('#app')));
  const M = await page(T.vp2, true); const wide = [];
  for (const [h, sel] of [['/study', '.course-card'], ['/course/' + K4, '.topic-card'], ['/topic/' + OS.id, 'ol.steps'], ['/doc/' + DOC, '.lecture-text']]) { await go(M, h, sel); const w = await M.evaluate(() => document.documentElement.scrollWidth); if (w > 392) wide.push(h + ':' + w); }
  check('телефон: курсы/темы/выгрузка без горизонтальной прокрутки', !wide.length, wide);
  await go(M, '/course/' + K4, '.topic-card'); await M.screenshot({ path: SHOTS + 'topics-course-mobile.png', fullPage: true });
  const PA = await page(A);
  await go(PA, '/admin/courses', 'table'); check('UI админ: столбцы «Система» и «Тем»', /Система должностей/.test(await PA.textContent('#app')));
  await go(PA, '/admin/course/' + OS.course_id, '#topIn'); check('UI админ: курс — список тем', /Основы ГУ ВП/.test(await PA.textContent('#topIn')));
  await go(PA, '/admin/topic/' + DU.id, '#tf');
  await PA.fill('#tf [name=description]', 'Описание из UI'); await PA.selectOption('#tf [name=doc_id]', String(DOC)); await PA.click('#tf button.gold'); await PA.waitForTimeout(1000);
  r = await call('GET', '/api/admin/topics/' + DU.id, A); check('UI админ: тема сохранена', r.d.topic.description === 'Описание из UI' && r.d.topic.doc_id === DOC, r.d.topic);
  await PA.screenshot({ path: SHOTS + 'topics-admin-topic.png', fullPage: true });
  await go(PA, '/admin/topic/new?course=' + OS.course_id, '#tf'); await PA.fill('#tf [name=title]', 'Тема из UI'); await PA.click('#tf button.gold');
  await PA.waitForFunction(() => /Тема: Тема из UI/.test(document.querySelector('h1').textContent), null, { timeout: 10000 }); check('UI админ: новая тема создаётся', true);
  const NT = Number((await PA.evaluate(() => location.hash)).split('/').pop());
  await go(PA, '/admin/lecture/new?topic=' + NT, '#lf'); check('UI админ: новая лекция — тема выбрана', (await PA.inputValue('#lf [name=topic_id]')) === String(NT));
  await go(PA, '/admin/exam/' + EX.id, '#ef'); check('UI админ: экзамен — темы отмечены', (await PA.$$('.extopic:checked')).length === 1);
  await PA.click('#ef .pubsel'); // не меняем, только проверяем, что форма есть
  await call('DELETE', '/api/admin/topics/' + NT, A);
  check('UI без ошибок JS', !errs.length, errs);
  await b.close();
  const ok = results.filter(x => x.ok).length;
  console.log(`\nИТОГО: ${ok}/${results.length} PASS`);
  fs.writeFileSync(__dirname + '/e2e-topics-results.json', JSON.stringify(results, null, 1));
  process.exit(ok === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
