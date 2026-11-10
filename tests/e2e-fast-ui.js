// Быстрый интерфейс: /api/bootstrap, кэш GET-запросов, действия прямо в списках, встроенный еженедельный отчёт,
// совместимость со старым сервером без /api/bootstrap. Тестовый сервер (wrangler dev :8787, вход — /__test/login), Discord не трогаем.
const { chromium } = require('playwright');
const fs = require('fs');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '/tmp/fast-ui/'; fs.mkdirSync(SHOTS, { recursive: true });
const SUPER = '417660389723996170', STAFF = '640000000000000001', VICT = '640000000000000002', REP = '640000000000000003';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 400) : '')); };
const call = async (m, p, t, b) => { const h = {}; if (t) h.Authorization = 'Bearer ' + t; if (b !== undefined) h['Content-Type'] = 'application/json'; const r = await fetch(API + p, { method: m, headers: h, body: b !== undefined ? JSON.stringify(b) : undefined }); let d = null; try { d = await r.json(); } catch (_) {} return { status: r.status, d }; };
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, a) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args: a }) })).json()).results;
const DOCS = ['vu','du','kps','su','pk','uk','koap','tk','fz_oborona','fz_oruzhie','fz_territorii','fz_gostayna','fz_gossluzhba','fz_vozduh','fkz_rezhimy','upk'];
const monday = (d = new Date()) => { const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())); x.setUTCDate(x.getUTCDate() - ((x.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };

(async () => {
  // ---------- 1. /api/bootstrap ----------
  const A = await login(SUPER, 'Шерман Ассман');
  const S = await login(STAFF, 'Иван Петров', 'vp,reatt');
  const V = await login(VICT, 'Пётр Сидоров', 'vp');
  await call('PUT', '/api/me', A, { ic_name: 'Шерман Ассман', rank: 'Лейтенант', static_id: '100-001' });
  await call('PUT', '/api/me', S, { ic_name: 'Иван Петров', rank: 'Рядовой', static_id: '100-002' });
  let r = await call('GET', '/api/bootstrap');
  check('bootstrap без входа: 200, гость, настройки на месте', r.status === 200 && r.d.user === null && r.d.session === 'none' && r.d.config && 'oauth_configured' in r.d.config && r.d.config.settings, r.d);
  r = await call('GET', '/api/bootstrap', 'x'.repeat(40));
  check('bootstrap с чужим токеном: сессия истекла, данных нет', r.status === 200 && r.d.user === null && r.d.session === 'expired' && Object.keys(r.d.data).length === 0, r.d);
  r = await call('GET', '/api/bootstrap?want=' + encodeURIComponent('/api/courses,/api/reatt,/api/admin/stats,/api/admin/settings,/etc/passwd'), S);
  check('bootstrap сотрудника: профиль и данные только своих разделов', r.status === 200 && r.d.session === 'ok' && r.d.user.id === STAFF && r.d.data['/api/courses'] && r.d.data['/api/reatt'] && !r.d.data['/api/admin/stats'] && !r.d.data['/api/admin/settings'] && !r.d.data['/etc/passwd'], Object.keys(r.d.data || {}));
  const me = await call('GET', '/api/me', S), courses = await call('GET', '/api/courses', S);
  check('bootstrap отдаёт то же, что /api/me и /api/courses', JSON.stringify(r.d.user) === JSON.stringify(me.d.user) && JSON.stringify(r.d.data['/api/courses']) === JSON.stringify(courses.d));
  r = await call('GET', '/api/bootstrap?want=' + encodeURIComponent('/api/admin/stats,/api/admin/users?q='), A);
  check('bootstrap администратора: сводка и список людей', r.status === 200 && r.d.data['/api/admin/stats'] && Array.isArray(r.d.data['/api/admin/users?q='].users), Object.keys(r.d.data || {}));
  const B = await login('640000000000000009', 'blocked', 'vp'); await sql('UPDATE users SET blocked=1 WHERE id=?', ['640000000000000009']);
  r = await call('GET', '/api/bootstrap', B); check('bootstrap заблокированного: 403', r.status === 403, r);
  const opt = await fetch(API + '/api/bootstrap', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8080', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization' } });
  check('bootstrap: CORS для сайта', opt.status === 204 && opt.headers.get('access-control-allow-origin') === 'http://localhost:8080');
  for (const p of ['/api/config', '/api/me', '/api/courses']) { r = await call('GET', p, S); check('старый адрес работает: ' + p, r.status === 200); }

  // старт переаттестации сразу возвращает попытку
  await sql('UPDATE reattestations SET cooldown_min = 0, max_attempts = 0');
  const vers = (await call('GET', '/api/admin/reatt', A)).d.items;
  const cases = vers.find(v => /case/.test(v.key)) || vers[0];
  await call('POST', `/api/admin/reatt/${cases.id}/access`, A, { user_id: STAFF, expires_at: Date.now() + 86400e3, attempts: 5 });
  r = await call('POST', `/api/reatt/${cases.key}/start`, S);
  check('старт переаттестации: в ответе и номер, и сама попытка', r.status === 200 && r.d.attempt_id && r.d.attempt && r.d.attempt.id === r.d.attempt_id && Array.isArray(r.d.attempt.questions), r.d && Object.keys(r.d));
  const att = r.d.attempt_id;
  await call('POST', `/api/attempts/${att}/submit`, S, { answers: {} }); await sql("UPDATE attempts SET status='pending_review' WHERE id=?", [att]);
  // проверка закона
  const q = (await sql("SELECT ext_id, source_doc FROM questions WHERE active=1 AND ext_id IS NOT NULL AND ext_id!='' LIMIT 1"))[0];
  const docs = DOCS.map(id => id === 'du' ? { id, status: 'manual' } : { id, status: 'unchanged', text_changed: false, edition_old: 'ред. A', edition_new: 'ред. A', quotes_checked: 1 });
  docs[DOCS.indexOf('pk')] = { id: 'pk', status: 'changed', text_changed: true, edition_old: 'ред. A', edition_new: 'ред. B', added: [], removed: [], added_count: 0, removed_count: 0, changed_count: 1, quotes_checked: 1,
    changed_units: [{ unit: 'п. 11.1', diff: '- было\n+ стало', old: 'было', new: 'стало' }], questions: [{ ext_id: q.ext_id, base: q.source_doc || 'simple', ref: 'п. 11.1', issue: 'missing', excerpt: 'цитаты нет' }] };
  r = await call('POST', '/api/admin/laws/reports', A, { mode: 'check', offline: true, partial: false, applied_locally: false, source: 'upload', runner: 'e2e-fast', generated_at: Date.now(), documents: docs });
  check('подготовка: отчёт сверки загружен', r.status < 300 && r.d && r.d.check && r.d.check.status === 'changes', [r.status, r.d]);

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open(tok, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(t => { if (t) localStorage.setItem('vpexam_token', t); }, tok);
    await ctx.route(/discord(app)?\.com/, rt => rt.abort());
    if (opts.oldServer) await ctx.route(API + '/api/bootstrap**', rt => rt.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"Не найдено"}' }));
    const p = await ctx.newPage();
    const st = { req: [], errs: [], dialogs: [] };
    p.on('request', q => { if (q.url().startsWith(API) && q.method() !== 'OPTIONS') st.req.push(q.method() + ' ' + q.url().slice(API.length)); if (/discord/.test(q.url())) st.errs.push('discord ' + q.url()); });
    p.on('pageerror', e => st.errs.push('js ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) st.errs.push('console ' + m.text()); });
    p.on('dialog', d => { st.dialogs.push(d.message()); (st.answer === false ? d.dismiss() : d.accept(d.type() === 'prompt' ? 'тест' : undefined)); });
    return { p, ctx, st };
  }
  const ready = (p) => p.waitForFunction(() => document.body.dataset.shown === (location.hash.slice(1) || '/') && document.querySelector('#app h1') && !document.querySelector('#app .skel'), null, { timeout: 15000 });
  const hideToast = (p) => p.evaluate(() => { const t = document.getElementById('toast'); t.hidden = true; t.textContent = ''; });
  const count = (st, re) => st.req.filter(x => re.test(x)).length;

  // ---------- 2. первая загрузка: один запрос ----------
  let s = await open(S);
  await s.p.goto(SITE + '#/'); await s.p.waitForSelector('#logoutBtn'); await ready(s.p); await s.p.waitForTimeout(300);
  const first = s.st.req.slice(0, 1)[0] || '';
  check('вход: первым идёт один /api/bootstrap', /^GET \/api\/bootstrap/.test(first) && count(s.st, /^GET \/api\/(me|config)$/) === 0, s.st.req);
  check('вход: список курсов не перезапрашивается (пришёл в bootstrap)', count(s.st, /^GET \/api\/courses$/) === 0 && await s.p.locator('.course-card, #app .alert').count() > 0, s.st.req);
  // кэш: повторный заход в раздел без запросов, без заготовки
  await s.p.click('#sec-exams'); await ready(s.p);
  s.st.req = [];
  await s.p.click('#sec-study'); await ready(s.p); await s.p.waitForTimeout(200);
  check('кэш: повторный заход в «Учёбу» без запросов', count(s.st, /^GET \/api\/courses/) === 0, s.st.req);
  // заготовка появляется, пока ждём медленный ответ
  await s.ctx.route(API + '/api/premiums**', async rt => { await new Promise(x => setTimeout(x, 700)); rt.continue(); });
  await s.ctx.route(API + '/api/prem**', async rt => { await new Promise(x => setTimeout(x, 700)); rt.continue(); });
  await s.p.evaluate(() => window.cacheClear && window.cacheClear());
  await s.p.click('#sec-premiums');
  const skel = await s.p.waitForSelector('#app .skel', { timeout: 600 }).then(() => true).catch(() => false);
  check('медленный ответ: сразу заготовка страницы, не старый экран', skel);
  await ready(s.p);
  check('после ответа заготовки нет, открыт раздел', /Прем/.test(await s.p.textContent('#app h1')) && !(await s.p.$('#app .skel')));
  // тема раскрывается прямо в курсе
  await s.p.click('#sec-study'); await ready(s.p);
  const course = await s.p.$('.course-card');
  if (course) {
    await course.click(); await s.p.waitForSelector('.topic-card', { timeout: 10000 }).catch(() => {});
    const h0 = await s.p.evaluate(() => location.hash);
    if (await s.p.$('.topic-card')) {
      await s.p.click('.topic-card'); await s.p.waitForSelector('.topic-inline', { timeout: 10000 });
      check('тема раскрывается в курсе без перехода', (await s.p.evaluate(() => location.hash)) === h0 && await s.p.locator('.topic-inline a[href^="#/topic/"]').count() === 1);
    } else check('тема раскрывается в курсе без перехода (в курсе нет тем — пропуск)', true);
  } else check('курс есть у сотрудника', false, await s.p.textContent('#app'));
  check('сотрудник: без ошибок в консоли и без Discord', s.st.errs.length === 0, s.st.errs);
  await s.ctx.close();

  // ---------- 3. старый сервер без /api/bootstrap ----------
  s = await open(S, { oldServer: true });
  await s.p.goto(SITE + '#/'); await s.p.waitForSelector('#logoutBtn', { timeout: 15000 }).catch(() => {}); await ready(s.p).catch(() => {});
  check('старый сервер: вход и главная работают прежними запросами', await s.p.isVisible('#logoutBtn') && count(s.st, /^GET \/api\/me$/) === 1 && count(s.st, /^GET \/api\/config$/) === 1 && (await s.p.textContent('#app h1')) === 'Учебный отдел', s.st.req);
  await s.p.click('#sec-reatt'); await s.p.waitForSelector('.reatt-card');
  check('старый сервер: разделы открываются', await s.p.locator('.reatt-card').count() > 0);
  check('старый сервер: без ошибок в консоли', s.st.errs.filter(e => !/404/.test(e)).length === 0, s.st.errs);
  await s.ctx.close();
  s = await open(null);
  await s.p.goto(SITE + '#/'); await s.p.waitForSelector('.login');
  check('гость: страница входа после одного bootstrap', count(s.st, /^GET \/api\/bootstrap/) === 1 && count(s.st, /^GET \/api\/(me|config)$/) === 0, s.st.req);
  await s.ctx.close();
  s = await open('y'.repeat(40));
  await s.p.goto(SITE + '#/'); await s.p.waitForSelector('.login');
  check('истёкшая сессия: токен убран, показан вход', (await s.p.evaluate(() => localStorage.getItem('vpexam_token'))) === null);
  await s.ctx.close();

  // ---------- 4. действия прямо в списках (администратор) ----------
  const a = await open(A); const P = a.p;
  await P.goto(SITE + '#/'); await P.waitForSelector('#logoutBtn'); await P.click('.mode[data-mode="admin"]'); await P.waitForSelector('.users-t');
  check('плитка «Люди и роли» сразу открывает таблицу', (await P.evaluate(() => location.hash)) === '#/admin/users');
  // роль одной галкой; строка обновлена из ответа, список не перечитан
  a.st.req = [];
  await hideToast(P); await P.check(`tr[data-u="${VICT}"] input[data-k="reatt"]`); await P.waitForSelector('.toast:not([hidden])');
  await P.waitForTimeout(300);
  r = await call('GET', '/api/admin/users/' + VICT, A);
  check('роль из строки: сохранена на сервере', r.d.user.reatt === true || r.d.user.reatt === 1, r.d.user);
  check('роль из строки: обновлена только строка (без перечитывания списка и перехода)', count(a.st, /^PUT \/api\/admin\/users\//) === 1 && count(a.st, /^GET \/api\/admin\/users/) === 0 && (await P.evaluate(() => location.hash)) === '#/admin/users' && /Переаттестация/.test(await P.textContent(`tr[data-u="${VICT}"] .u-badges`)), a.st.req);
  // опасное действие спрашивает подтверждение; отказ — ничего не меняется
  const roleSel = `tr[data-u="${VICT}"] .inl-roles select`;
  a.st.dialogs = []; a.st.answer = true;
  await P.selectOption(roleSel, 'admin'); await P.waitForFunction(() => /Админ-права: Админ/.test(document.getElementById('toast').textContent)); await P.waitForTimeout(300);
  r = await call('GET', '/api/admin/users/' + VICT, A);
  check('назначение администратором из строки: с подтверждением', a.st.dialogs.length === 1 && r.d.user.role === 'admin', [a.st.dialogs, r.d.user.role]);
  a.st.req = []; a.st.dialogs = []; a.st.answer = false;
  await P.selectOption(roleSel, 'candidate'); await P.waitForTimeout(400);
  r = await call('GET', '/api/admin/users/' + VICT, A);
  check('снятие администратора: подтверждение, отказ — роль осталась и галки вернулись', a.st.dialogs.length === 1 && r.d.user.role === 'admin' && count(a.st, /^PUT /) === 0 && (await P.inputValue(roleSel)) === 'admin', [a.st.dialogs, r.d.user.role]);
  a.st.answer = true; a.st.dialogs = [];
  await P.selectOption(roleSel, 'candidate'); await P.waitForFunction(() => /Админ-права: нет/.test(document.getElementById('toast').textContent)); await P.waitForTimeout(300);
  r = await call('GET', '/api/admin/users/' + VICT, A);
  check('снятие администратора: после «ОК» снято', a.st.dialogs.length === 1 && r.d.user.role !== 'admin', r.d.user.role);
  // кэш сброшен после действия: следующий заход перечитывает список
  await P.click('#sec-attempts'); await P.waitForSelector('#app tr.click, #app .alert, #app .empty', { timeout: 15000 }).catch(() => {});
  a.st.req = []; await P.click('#sec-users'); await P.waitForSelector('.users-t'); await P.waitForTimeout(300);
  check('кэш: после изменения список людей перечитан', count(a.st, /^GET \/api\/admin\/users/) >= 1, a.st.req);
  // проверка работы прямо в списке
  await P.click('#sec-attempts'); await P.waitForSelector(`tr.click[data-href="#/admin/attempt/${att}"]`);
  await P.click(`tr.click[data-href="#/admin/attempt/${att}"]`); await P.waitForSelector('tr.inl-panel #rf');
  check('работа раскрывается в списке', (await P.evaluate(() => location.hash)) === '#/admin/attempts');
  await hideToast(P); await P.selectOption('#rf [name=verdict]', 'passed'); await P.click('#rf button.gold'); await P.waitForSelector('.toast:not([hidden])');
  r = await call('GET', '/api/admin/attempts/' + att, A);
  check('проверка из списка сохранена, строка обновлена', r.d.attempt.status === 'passed' && /Сдан|сдан/.test(await P.textContent(`tr.click[data-href="#/admin/attempt/${att}"]`)), r.d.attempt.status);
  check('прямая ссылка на работу открывает отдельную страницу', await P.goto(SITE + '#/admin/attempt/' + att).then(() => P.waitForSelector('#rf')).then(() => true).catch(() => false));
  // доступ к тесту прямо в списке видов
  await P.click('#sec-access'); await P.waitForSelector('.r-acc');
  const accBtn = P.locator('.r-acc').first(); await accBtn.click(); await P.waitForSelector('.inl-panel #gf');
  check('доступ раскрывается в списке видов', (await P.evaluate(() => location.hash)) === '#/admin/reatt');
  const before = await accBtn.textContent();
  const opt1 = await P.$eval('.inl-panel #gf select[name=user_id]', el => [...el.options].map(o => o.value).filter(Boolean)[0] || '');
  if (opt1) await P.selectOption('.inl-panel #gf select[name=user_id]', opt1);
  await hideToast(P); await P.click('.inl-panel #gf button.gold'); await P.waitForSelector('.toast:not([hidden])'); await P.waitForTimeout(300);
  check('доступ выдан: счётчик на кнопке обновился без перезагрузки', (await accBtn.textContent()) !== before, [before, await accBtn.textContent()]);
  // закон: карточка раскрывается, отклонение спрашивает, принятие обновляет карточку
  await P.click('#sec-laws'); await P.waitForSelector('a.law-card[href="#/admin/laws/doc/pk"]');
  await P.click('a.law-card[href="#/admin/laws/doc/pk"]'); await P.waitForSelector('.inl-panel #lawDecide');
  check('документ закона раскрывается среди карточек', (await P.evaluate(() => location.hash)) === '#/admin/laws');
  await P.fill('.inl-panel #lawDecide textarea', 'сверено с форумом');
  a.st.answer = false; a.st.dialogs = []; a.st.req = [];
  await P.click('.inl-panel #lawDecide button[value=reject]'); await P.waitForTimeout(400);
  check('отклонение правки: подтверждение, отказ — ничего не отправлено', a.st.dialogs.length === 1 && count(a.st, /^POST /) === 0);
  a.st.answer = true;
  await hideToast(P); await P.click('.inl-panel #lawDecide button[value=approve]'); await P.waitForSelector('.toast:not([hidden])'); await P.waitForTimeout(400);
  check('правка принята из списка, решение показано на месте', !(await P.$('.inl-panel #lawDecide')) && /Решение уже записано/.test(await P.textContent('.inl-panel')));
  await P.screenshot({ path: SHOTS + 'laws-inline.png' });
  check('админ: без ошибок в консоли', a.st.errs.length === 0, a.st.errs);
  await a.ctx.close();

  // ---------- 5. встроенный еженедельный отчёт ----------
  const RT = await login(REP, 'rep_user', 'vp');
  await call('PUT', '/api/me', RT, { ic_name: 'Олег Рапортов', rank: 'Сержант', static_id: '7788' });
  const WEEK = monday();
  s = await open(RT); const R = s.p;
  await R.goto(SITE + '#/'); await R.waitForSelector('#logoutBtn'); await R.click('#sec-reports');
  await R.waitForSelector('#repBox #sendBtn'); await R.waitForSelector('#repBox .pv-page', { timeout: 25000 });
  await R.waitForFunction(() => /Отправить/.test(document.getElementById('sendBtn').textContent), null, { timeout: 15000 });
  check('отчёт: бланк в разделе, имя и звание из профиля', (await R.inputValue('#fromName')) === 'Олег Рапортов' && (await R.inputValue('#fromRank')) === 'Сержант' && (await R.inputValue('#fromStatic')) === '7788');
  check('отчёт: период — текущая неделя', (await R.inputValue('#fromDate')) === WEEK, await R.inputValue('#fromDate'));
  // проверка формы: без должности не отправляется
  s.st.req = [];
  await R.click('#sendBtn'); await R.waitForTimeout(600);
  check('проверка формы: без должности отчёт не уходит', count(s.st, /^POST \/api\/reports/) === 0 && (await R.textContent('#sendStatus')).length > 0, await R.textContent('#sendStatus'));
  await R.selectOption('#fromPos', 'Инспектор ВП'); await R.fill('#fromUnit', 'Батальон военной полиции');
  const setAct = async (key, n, links) => { const row = R.locator(`#repBox .act[data-key=${key}]`); if (links) { await row.locator('summary').click(); await row.locator('[data-links]').fill(links.join('\n')); } await row.locator('[data-n]').fill(String(n)); };
  await setAct('postavka', 10, ['https://disk.yandex.ru/d/post1']); await setAct('otbitie', 3, ['https://disk.yandex.ru/d/otb']); await setAct('training', 1, ['https://imgur.com/a/tr']);
  await R.waitForTimeout(500);
  // черновик переживает перезагрузку
  await R.reload(); await R.waitForSelector('#repBox #sendBtn'); await R.waitForSelector('#repBox .pv-page', { timeout: 25000 });
  check('черновик: пункты и должность после перезагрузки', (await R.inputValue('#repBox .act[data-key=postavka] [data-n]')) === '10' && (await R.inputValue('#fromPos')) === 'Инспектор ВП');
  const dl = R.waitForEvent('download'); await R.click('#pdf'); const pdf = await dl;
  check('PDF выгружается из встроенного бланка', /\.pdf$/.test(pdf.suggestedFilename()), pdf.suggestedFilename());
  await R.waitForFunction(() => /Отправить/.test(document.getElementById('sendBtn').textContent), null, { timeout: 15000 });
  s.st.req = [];
  await R.click('#sendBtn'); await R.waitForFunction(() => /отправлен руководству|Не отправлено/.test(document.getElementById('sendStatus').textContent), null, { timeout: 15000 });
  check('отправка: тот же запрос POST /api/reports, отчёт принят', /отправлен руководству/.test(await R.textContent('#sendStatus')) && count(s.st, /^POST \/api\/reports$/) === 1, [await R.textContent('#sendStatus'), s.st.req]);
  r = await call('GET', '/api/reports/my?week=' + WEEK, RT);
  check('сервер: отчёт недели с пунктами формы', r.d.report && r.d.report.items.some(i => i.key === 'postavka' && i.n === 10) && r.d.report.header.name === 'Олег Рапортов', r.d.report);
  await R.waitForFunction(() => /отправлен|принят|на проверке/i.test(document.getElementById('repWeek').textContent), null, { timeout: 8000 }).catch(() => {});
  check('карточка недели и список отчётов обновились без перехода', /отправлен|принят|на проверке/i.test(await R.textContent('#repWeek')) && (await R.evaluate(() => location.hash)) === '#/reports', await R.textContent('#repWeek'));
  await R.screenshot({ path: SHOTS + 'report-embed.png' });
  check('отчёт: без ошибок консоли и без запросов в Discord', s.st.errs.length === 0, s.st.errs);
  await s.ctx.close();
  await browser.close();

  const failed = results.filter(x => !x.ok);
  fs.writeFileSync(SHOTS + 'e2e-fast-ui-results.json', JSON.stringify({ ok: failed.length === 0, failed: failed.map(x => x.name) }, null, 2));
  console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
