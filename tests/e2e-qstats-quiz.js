// E2E «Аналитика вопросов» (#/lead/qstats) и «Мини-проверка после лекции» (конец страницы лекции).
// Запуск: bash /tmp/reset.sh (wrangler dev :8787 со всеми миграциями, serve.js :8080), затем node tests/e2e-qstats-quiz.js
const { chromium } = require('playwright');
const fs = require('fs');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const SUPER = '417660389723996170', EMP = '500000000000000051', LEAD = '500000000000000059', NOBODY = '500000000000000052';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 600) : '')); };
const call = async (m, p, t, b) => { const h = {}; if (t) h.Authorization = 'Bearer ' + t; if (b !== undefined) h['Content-Type'] = 'application/json'; const r = await fetch(API + p, { method: m, headers: h, body: b !== undefined ? JSON.stringify(b) : undefined }); let d = null; try { d = await r.json(); } catch (_) {} return { status: r.status, d }; };
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, a) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args: a }) })).json()).results;

(async () => {
  const A = await login(SUPER, 'Шерман Ассман');
  const U = await login(EMP, 'quiz-emp', 'vp');
  const L = await login(LEAD, 'qs-lead', 'leader,vp');
  const N = await login(NOBODY, 'qs-nobody', 'vp');
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const open = async (tok, w, h) => { const ctx = await b.newContext({ viewport: { width: w || 1400, height: h || 900 }, locale: 'ru-RU' }); await ctx.addInitScript(t => localStorage.setItem('vpexam_token', t), tok);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return p; };

  // ================= 1. мини-проверка после лекции =================
  const lec = (await call('POST', '/api/admin/lectures', A, { title: 'Мини-проверка: тестовая лекция', body: '# Раздел\n\nТекст лекции для проверки.\n\nВторой абзац.', duration_sec: 60, published: true, required: false })).d.lecture.id;
  const singles = await sql("SELECT id, options, correct, json_extract(data, '$.meta.quote') AS quote, source_ref FROM questions WHERE type = 'single' AND active = 1 AND json_extract(data, '$.meta.quote') IS NOT NULL ORDER BY id LIMIT 2");
  const multi = (await sql("SELECT id, options, correct FROM questions WHERE type = 'multi' AND active = 1 ORDER BY id LIMIT 1"))[0];
  const QZ = [singles[0], singles[1], multi];
  for (const [i, q] of QZ.entries()) await sql('INSERT INTO lecture_quiz (lecture_id, question_id, position, quote) VALUES (?1, ?2, ?3, ?4)', [lec, q.id, i + 1, i === 2 ? 'Абзац лекции для вопроса с несколькими ответами.' : '']);
  check('до прохождения лекции вопросов проверки нет', !(await call('GET', '/api/lectures/' + lec, U)).d.lecture.quiz);
  // почти дочитано: осталось ~4 секунды
  const now = Date.now();
  await sql('INSERT INTO lecture_progress (user_id, lecture_id, max_pos, last_pos, watched_sec, last_hb_at, started_at) VALUES (?1, ?2, 56, 56, 57, ?3, ?3)', [EMP, lec, now - 1000]);
  const p = await open(U);
  let lecGets = 0, hbQuiz = 0;
  p.on('request', r => { if (new RegExp('/api/lectures/' + lec + '$').test(r.url())) lecGets++; });
  p.on('response', async r => { if (/heartbeat$/.test(r.url())) { try { const j = await r.json(); if (j.quiz) hbQuiz++; } catch (_) {} } });
  await p.goto(SITE + '#/lecture/' + lec); await p.waitForSelector('#lecText');
  check('пока лекция не засчитана — блока проверки нет', !(await p.$('#lecQuiz .lq')));
  await p.waitForSelector('#lecQuiz .lq', { timeout: 20000 });
  check('лекция засчитана → вопросы пришли с тем же пульсом и показаны в конце страницы без перехода', hbQuiz === 1 && lecGets === 1 && (await p.$$('#lecQuiz .lq')).length === 3, { hbQuiz, lecGets });
  check('заголовок «Проверьте себя», «на оценку не влияет»', /Проверьте себя/i.test(await p.textContent('#lecQuiz')) && /не влияет/.test(await p.textContent('#lecQuiz')));
  const q1 = p.locator(`.lq[data-q="${QZ[0].id}"]`);
  check('кнопка «Проверить» неактивна, пока ничего не выбрано', await q1.locator('.lq-check').isDisabled());
  const corr1 = JSON.parse(QZ[0].correct)[0], wrong1 = JSON.parse(QZ[0].options).find(o => o.id !== corr1).id;
  await q1.locator(`input[value="${wrong1}"]`).check(); await q1.locator('.lq-check').click();
  check('неверный ответ: «Неверно», верный вариант подсвечен, выбранный — красным', /Неверно/.test(await q1.locator('.lq-res').textContent()) && await q1.locator(`.lq-opt.ok input[value="${corr1}"]`).count() === 1 && await q1.locator(`.lq-opt.bad input[value="${wrong1}"]`).count() === 1);
  check('после ответа — цитата и пункт документа', (await q1.locator('.lq-quote').textContent()).includes(QZ[0].quote.replace(/[«»]/g, '').slice(0, 20)) && (await q1.locator('.lq-quote footer').count()) === 1);
  const q2 = p.locator(`.lq[data-q="${QZ[1].id}"]`);
  await q2.locator(`input[value="${JSON.parse(QZ[1].correct)[0]}"]`).check(); await q2.locator('.lq-check').click();
  check('верный ответ: «Верно»', /Верно/.test(await q2.locator('.lq-res').textContent()) && !/Неверно/.test(await q2.locator('.lq-res').textContent()));
  check('итог появляется только когда отвечены все вопросы', await p.locator('.lq-sum').isHidden());
  const q3 = p.locator(`.lq[data-q="${QZ[2].id}"]`);
  for (const c of JSON.parse(QZ[2].correct)) await q3.locator(`input[value="${c}"]`).check();
  await q3.locator('.lq-check').click();
  check('несколько ответов: все верные → «Верно», цитата — абзац лекции', /Верно/.test(await q3.locator('.lq-res').textContent()) && /Абзац лекции/.test(await q3.locator('.lq-quote').textContent()));
  check('итог: «Верно 2 из 3»', /Верно 2 из 3/.test(await p.textContent('.lq-sum')));
  const writes = []; p.on('request', r => { if (r.method() !== 'GET' && !/heartbeat/.test(r.url())) writes.push(r.url()); });
  await p.reload(); await p.waitForSelector('#lecQuiz .lq');
  check('после перезагрузки ответы сохранены в браузере, итог на месте; на сервер ничего не отправлялось', /Верно 2 из 3/.test(await p.textContent('.lq-sum')) && await p.locator(`.lq[data-q="${QZ[0].id}"] .lq-check`).isHidden() && writes.length === 0, writes);
  await p.click('.lq-again');
  check('«Пройти ещё раз» — вопросы снова открыты', (await p.$$('#lecQuiz .lq-check:not([hidden])')).length === 3 && await p.locator('.lq-sum').isHidden());
  const prog = await call('GET', '/api/lectures', U);
  check('лекция засчитана как обычно (проверка на оценку не влияет)', prog.d.lectures.find(l => l.id === lec).status === 'watched');
  await sql('UPDATE questions SET active = 0 WHERE id = ?1', [QZ[1].id]);
  check('выключенный вопрос из проверки пропадает', (await call('GET', '/api/lectures/' + lec, U)).d.lecture.quiz.length === 2);
  await sql('UPDATE questions SET active = 1 WHERE id = ?1', [QZ[1].id]);
  // видео-лекция: проверка рисуется тем же способом (пульс плеера идёт через тот же api)
  await p.screenshot({ path: __dirname + '/shots/lecture-quiz.png', fullPage: true });

  // ================= 2. аналитика вопросов =================
  check('без роли руководства — 403', (await call('GET', '/api/lead/qstats', N)).status === 403 && (await call('POST', '/api/lead/qstats', N)).status === 403);
  // 12 сданных попыток переаттестации по 4 вопросам: Q[0] — все верно, Q[1] — ловушка, Q[2] — решают слабые, Q[3] — 3 ответа
  const bank = await sql("SELECT id, options, correct, points, source_doc FROM questions WHERE type = 'single' AND active = 1 AND source_doc = 'vu' ORDER BY id LIMIT 4");
  const ins = async (n0) => {
    for (let i = n0; i < n0 + 12; i++) {
      const strong = i % 12 >= 6;
      const att = (await sql("INSERT INTO attempts (exam_id, user_id, status, started_at, submitted_at, reatt, meta) VALUES (0, ?1, 'passed', ?2, ?3, 'simple', ?4) RETURNING id", [EMP, now - 600000, now - 300000, JSON.stringify({ title: 'Упрощённая переаттестация' })]))[0].id;
      const put = async (q, ok, pickWrong) => { const c = JSON.parse(q.correct)[0], w = JSON.parse(q.options).filter(o => o.id !== c).map(o => o.id); await sql('INSERT INTO answers (attempt_id, question_id, answer, auto_points) VALUES (?1, ?2, ?3, ?4)', [att, q.id, JSON.stringify(ok ? c : w[pickWrong || 0]), ok ? q.points : 0]); };
      await put(bank[0], true);
      await put(bank[1], i % 4 === 0);
      await put(bank[2], !strong);
      for (let k = 0; k < 5; k++) await sql('INSERT INTO answers (attempt_id, question_id, answer, auto_points) SELECT ?1, id, ?2, CASE WHEN ?3 THEN points ELSE 0 END FROM questions WHERE id = ?4', [att, '"x"', strong ? 1 : 0, 200 + k]);
      if (i < 3) await put(bank[3], true);
    }
  };
  await ins(0);
  const lp = await open(L, 1400, 900);
  let qsGets = 0; lp.on('request', r => { if (/\/api\/lead\/qstats/.test(r.url())) qsGets++; });
  await lp.goto(SITE + '#/lead/qstats'); await lp.waitForSelector('#qsList');
  const txt = await lp.textContent('#app');
  check('страница открылась: первый расчёт сделан автоматически, попыток 12', /попыток 12/.test(txt) && /Обновлено/.test(txt), txt.slice(0, 300));
  const row = (id) => lp.locator(`tr.qs-row[data-id="${id}"]`);
  check('лёгкий вопрос: 100% и «Слишком лёгкий»', /100%/.test(await row(bank[0].id).textContent()) && /Слишком лёгкий/.test(await row(bank[0].id).textContent()));
  check('ловушка: частый неверный вариант и «Подозрительный дистрактор»', /Подозрительный дистрактор/.test(await row(bank[1].id).textContent()) && /75%/.test(await row(bank[1].id).textContent()));
  check('обратный вопрос: «Отрицательная разделяющая способность», значение < 0 красным', /Отрицательная разделяющая/.test(await row(bank[2].id).textContent()) && await row(bank[2].id).locator('.qs-bad').count() === 1);
  check('3 ответа: «Мало данных»', /Мало данных/.test(await row(bank[3].id).textContent()));
  check('сводка по документам (ВУ) и слабые темы', /ВУ/.test(await lp.textContent('.qs-docs')) && (await lp.$$('.qs-topics tr.click')).length >= 1);
  await lp.selectOption('#qsF [name=flag]', 'distractor');
  check('фильтр по отметке: остаётся только ловушка, адрес обновлён без перезагрузки', (await lp.$$('tr.qs-row')).length === 1 && /flag=distractor/.test(lp.url()) && qsGets === 1, { n: (await lp.$$('tr.qs-row')).length, qsGets });
  await lp.selectOption('#qsF [name=flag]', ''); await lp.selectOption('#qsF [name=sort]', 'p');
  check('сортировка «Меньше верных»: первым — обратный или ловушка', [bank[1].id, bank[2].id].includes(Number(await lp.getAttribute('tr.qs-row', 'data-id'))));
  await lp.selectOption('#qsF [name=ex]', 'r:simple');
  check('фильтр по экзамену (переаттестация «Упрощённая»)', (await lp.$$('tr.qs-row')).length >= 4);
  await lp.fill('#qsF [name=q]', 'zzz-нет-такого'); await lp.waitForTimeout(400);
  check('поиск без совпадений — «ничего не попало»', /ничего не попало/.test(await lp.textContent('#qsList')));
  await lp.fill('#qsF [name=q]', ''); await lp.waitForTimeout(400);
  await row(bank[1].id).click();
  check('раскрытие строки: распределение по вариантам, у руководства без кнопки правки', await lp.locator('.qs-det .qs-opt').count() >= 2 && await lp.locator('.qs-det a', { hasText: 'Править' }).count() === 0);
  check('чтение страницы не пересчитывает: повторный GET отдаёт тот же результат', (await call('GET', '/api/lead/qstats', L)).d.stats.at === (await call('GET', '/api/lead/qstats', L)).d.stats.at);
  await ins(12); // ещё 12 попыток — видно только после «Пересчитать»
  check('новые ответы без пересчёта не видны (сохранённый результат)', /попыток 12/.test(await lp.textContent('.qs-head')));
  await sql("UPDATE analytics SET updated_at = updated_at - 120000, v = json_set(v, '$.at', json_extract(v, '$.at') - 120000) WHERE k = 'qstats'"); // прошлый пересчёт был 2 минуты назад
  let rel; const gate = new Promise(r => { rel = r; });
  await lp.route('**/api/lead/qstats', async (route) => { if (route.request().method() === 'POST') await gate; await route.continue(); });
  await lp.click('#qsRe');
  await lp.waitForFunction(() => document.getElementById('qsRe').disabled);
  check('«Пересчитать»: кнопка заблокирована на время расчёта', true);
  rel(); await lp.waitForFunction(() => /попыток 24/.test(document.querySelector('.qs-head').textContent), null, { timeout: 10000 });
  check('после пересчёта — 24 попытки, страница обновилась на месте', true);
  const audit = await sql("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'qstats_recompute'");
  check('пересчёт записан в журнал', audit[0].c >= 1);
  const t1 = (await call('POST', '/api/lead/qstats', L)).d;
  check('повторное нажатие в течение минуты — без нового расчёта', t1.fresh === true);
  const ap = await open(A);
  await ap.goto(SITE + '#/lead/qstats?flag=distractor'); await ap.waitForSelector('tr.qs-row');
  await ap.click('tr.qs-row');
  const href = await ap.getAttribute('.qs-det a', 'href');
  check('администратор: из строки — «Править вопрос» в банке', /#\/admin\/bank\?q=/.test(href || ''), href);
  await ap.click('.qs-det a'); await ap.waitForSelector('#blist');
  check('переход в банк с поиском по вопросу', /Найдено: 1\b/.test(await ap.textContent('#app')));
  await ap.goto(SITE + '#/'); await ap.click('.mode[data-mode="admin"]').catch(() => {});
  check('плитка «Аналитика» в консоли руководства', await ap.locator('.rail >> text=Аналитика').count() >= 1 || (await ap.evaluate(() => window.vpMenu().includes('#/lead/qstats'))));
  await lp.screenshot({ path: __dirname + '/shots/qstats.png', fullPage: true });
  check('без ошибок на страницах', errs.length === 0, errs);
  await b.close();
  fs.writeFileSync(__dirname + '/e2e-qstats-quiz-results.json', JSON.stringify(results, null, 1));
  const f = results.filter(r => !r.ok).length; console.log(`\n${results.length - f} PASS, ${f} FAIL`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
