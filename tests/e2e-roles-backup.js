// Роль «Руководство (СС)», резервные копии (главный администратор), выключатель баллов за недостающий пункт,
// обязательные курсы для рапорта на повышение. Тестовый сервер (wrangler dev :8787, вход — /__test/login), Discord не трогаем.
const { chromium } = require('playwright');
const fs = require('fs');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '/tmp/roles-backup/'; fs.mkdirSync(SHOTS, { recursive: true });
const SUPER = '417660389723996170', ADM = '650000000000000001', MAN = '650000000000000002', STAFF = '650000000000000003', OTHER = '650000000000000004';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 400) : '')); };
const call = async (m, p, t, b) => { const h = {}; if (t) h.Authorization = 'Bearer ' + t; if (b !== undefined) h['Content-Type'] = 'application/json'; const r = await fetch(API + p, { method: m, headers: h, body: b !== undefined ? JSON.stringify(b) : undefined }); let d = null; try { d = await r.json(); } catch (_) {} return { status: r.status, d }; };
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, a) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args: a }) })).json()).results;

async function backup(tok, kind, label) {
  const c = await call('POST', '/api/admin/backups', tok, { kind, label });
  if (c.status !== 200) return c;
  for (const t of c.d.tables) { let off = 0; while (off !== null) { const r = await call('POST', `/api/admin/backups/${c.d.backup.id}/step`, tok, { table: t, offset: off }); if (r.status !== 200) return r; off = r.d.next; } }
  return call('POST', `/api/admin/backups/${c.d.backup.id}/finish`, tok);
}

(async () => {
  const A = await login(SUPER, 'Шерман Ассман');
  const AD = await login(ADM, 'Админ Сайта', 'vp,admin');
  const M = await login(MAN, 'Руководитель СС', 'vp');
  await sql("UPDATE users SET role='manager' WHERE id=?", [MAN]);
  const S = await login(STAFF, 'Иван Петров', 'vp');
  const O = await login(OTHER, 'Пётр Сидоров', 'vp');
  await call('PUT', '/api/me', S, { ic_name: 'Иван Петров', rank: 'Сержант', static_id: '100-002' });

  // ---------- 1. руководство: что можно ----------
  let r = await call('GET', '/api/me', M);
  check('руководство: роль и возможности', r.d.user.role === 'manager' && r.d.user.caps.grant && r.d.user.caps.lead && r.d.user.caps.examiner && !r.d.user.caps.admin && !r.d.user.caps.super, r.d.user);
  r = await call('PUT', '/api/admin/users/' + STAFF, M, { reatt: true });
  check('руководство: выдаёт роль «Переаттестация»', r.status === 200 && (await sql('SELECT reatt FROM users WHERE id=?', [STAFF]))[0].reatt === 1, r);
  r = await call('PUT', '/api/admin/users/' + STAFF, M, { role: 'examiner' });
  check('руководство: назначает проверяющего', r.status === 200 && (await sql('SELECT role FROM users WHERE id=?', [STAFF]))[0].role === 'examiner', r);
  r = await call('PUT', '/api/admin/users/' + STAFF, M, { role: 'candidate' }); check('руководство: снимает проверяющего', r.status === 200, r);
  const vers = (await call('GET', '/api/admin/reatt', M));
  check('руководство: видит виды переаттестации', vers.status === 200 && vers.d.items.length > 0, vers.status);
  r = await call('POST', `/api/admin/reatt/${vers.d.items[0].id}/access`, M, { user_id: STAFF, expires_at: Date.now() + 86400e3, attempts: 2 });
  check('руководство: выдаёт доступ к переаттестации', r.status < 300, r);
  for (const p of ['/api/lead/week', '/api/admin/attempts', '/api/admin/users', '/api/admin/stats']) { r = await call('GET', p, M); check('руководство: открыто ' + p, r.status === 200, r.status); }
  // ---------- 2. руководство: что нельзя ----------
  const deny = [
    ['PUT', '/api/admin/users/' + STAFF, { leader: true }], ['PUT', '/api/admin/users/' + STAFF, { role: 'manager' }], ['PUT', '/api/admin/users/' + STAFF, { role: 'admin' }],
    ['PUT', '/api/admin/users/' + ADM, { vp: false }], ['PUT', '/api/admin/users/' + SUPER, { reatt: false }], ['PUT', '/api/admin/users/' + STAFF, { blocked: true }],
    ['PUT', '/api/promo', { points_per_item: 1, pts: {}, ladder: [{ rank: 'А', to: 'Б', points: 1, need: {} }] }], ['PUT', '/api/promo/courses', { all: [] }],
    ['POST', '/api/admin/lectures', { title: 'x' }], ['POST', '/api/admin/courses', { title: 'x' }], ['PUT', '/api/admin/settings', { promo_missing_points: false }], ['GET', '/api/admin/settings'],
    ['POST', '/api/admin/exams', { title: 'x' }], ['PUT', '/api/admin/reatt/' + vers.d.items[0].id, { enabled: false }], ['DELETE', '/api/admin/reatt/' + vers.d.items[0].id],
    ['GET', '/api/admin/backups'], ['POST', '/api/admin/backups', { label: 'x' }], ['GET', '/api/admin/laws'], ['GET', '/api/admin/audit'],
  ];
  for (const [m, p, b] of deny) { r = await call(m, p, M, b); check(`руководство: 403 на ${m} ${p} ${b ? JSON.stringify(b).slice(0, 40) : ''}`, r.status === 403, [r.status, r.d]); }
  check('руководство: данные не изменились', (await sql('SELECT leader, role, blocked FROM users WHERE id=?', [STAFF]))[0].role === 'candidate' && (await sql('SELECT vp FROM users WHERE id=?', [ADM]))[0].vp === 1);
  // администратор сайта назначает руководство; не главный — без резервных копий
  r = await call('PUT', '/api/admin/users/' + OTHER, AD, { role: 'manager' });
  check('администратор сайта назначает «Руководство (СС)»', r.status === 200 && (await sql('SELECT role FROM users WHERE id=?', [OTHER]))[0].role === 'manager', r);
  r = await call('PUT', '/api/admin/users/' + OTHER, M, { role: 'candidate' }); check('руководство не снимает руководство', r.status === 403, r.status);
  r = await call('PUT', '/api/admin/users/' + OTHER, AD, { role: 'candidate' }); check('администратор снимает руководство', r.status === 200, r);
  for (const [m, p] of [['GET', '/api/admin/backups'], ['POST', '/api/admin/backups']]) { r = await call(m, p, AD, m === 'GET' ? undefined : {}); check(`админ (не главный): 403 на ${m} ${p}`, r.status === 403 && /главному/.test(r.d.error), r); }
  r = await call('GET', '/api/admin/backups'); check('без входа: 401 на копии', r.status === 401, r.status);

  // ---------- 3. резервные копии ----------
  await sql("UPDATE users SET role='manager' WHERE id=?", [OTHER]);
  await call('PUT', '/api/admin/settings', A, { site_title: 'Портал до копии' });
  const qBefore = (await sql('SELECT COUNT(*) AS n FROM questions'))[0].n;
  r = await backup(A, 'manual', 'перед тестом');
  check('главный: копия собрана', r.status === 200 && r.d.backup.status === 'ready' && r.d.backup.parts > 0 && r.d.backup.summary.questions === qBefore, r.d && r.d.backup);
  const B1 = r.d.backup;
  const list = await call('GET', '/api/admin/backups', A);
  check('список копий', list.status === 200 && list.d.backups.some(b => b.id === B1.id && b.label === 'перед тестом' && b.created_by === SUPER), list.d);
  const part0 = await call('GET', `/api/admin/backups/${B1.id}/part/0`, A);
  check('часть копии скачивается', part0.status === 200 && part0.d.tbl && Array.isArray(part0.d.cols) && Array.isArray(part0.d.rows), part0.status);
  const allParts = []; for (let i = 0; i < B1.parts; i++) allParts.push((await call('GET', `/api/admin/backups/${B1.id}/part/${i}`, A)).d);
  const blob = JSON.stringify(allParts);
  check('в копии нет сессий и секретов', !allParts.some(p => /sessions|login_codes/.test(p.tbl)) && !/token|client_secret|webhook/i.test(allParts.filter(p => p.tbl === 'users').map(p => p.cols.join(',')).join(',')) && !allParts.some(p => p.tbl === 'settings' && p.rows.some(x => /webhook|token|secret/i.test(x[0]))), allParts.map(p => p.tbl));
  check('в копии роли людей и курсы для повышения', allParts.some(p => p.tbl === 'users' && p.cols.includes('role')) && blob.includes('Портал до копии'));
  // портим данные
  await call('PUT', '/api/admin/settings', A, { site_title: 'Испорчено' });
  await sql('DELETE FROM questions WHERE id IN (SELECT id FROM questions LIMIT 5)');
  await sql("UPDATE users SET role='candidate' WHERE id=?", [OTHER]);
  r = await call('POST', `/api/admin/backups/${B1.id}/restore`, A, { idx: 0 });
  check('восстановление без автокопии текущего состояния — отказ', r.status === 409, r);
  r = await call('POST', `/api/admin/backups/${B1.id}/restore`, AD, { idx: 0 }); check('админ (не главный): 403 на восстановление', r.status === 403, r.status);
  r = await call('POST', `/api/admin/backups/${B1.id}/restore`, M, { idx: 0 }); check('руководство: 403 на восстановление', r.status === 403, r.status);
  const pre = await backup(A, 'auto', 'перед восстановлением');
  check('автокопия текущего состояния', pre.status === 200 && pre.d.backup.kind === 'auto', pre.d);
  let idx = 0, steps = 0;
  while (idx !== null && steps < 200) { r = await call('POST', `/api/admin/backups/${B1.id}/restore`, A, { idx, pre_backup_id: pre.d.backup.id }); if (r.status !== 200) break; idx = r.d.next; steps++; }
  check('восстановление по шагам прошло', idx === null, r);
  const st = (await call('GET', '/api/config')).d.settings;
  check('восстановлены настройки, вопросы и роли', st.site_title === 'Портал до копии' && (await sql('SELECT COUNT(*) AS n FROM questions'))[0].n === qBefore && (await sql('SELECT role FROM users WHERE id=?', [OTHER]))[0].role === 'manager', [st.site_title]);
  check('после восстановления вход не сброшен', (await call('GET', '/api/me', A)).status === 200 && (await call('GET', '/api/me', S)).status === 200);
  const l2 = (await call('GET', '/api/admin/backups', A)).d.backups.find(b => b.id === B1.id);
  check('у копии отмечено восстановление', l2 && l2.restored_at && l2.restored_by === SUPER, l2);
  // загрузка из файла
  let u = await call('POST', '/api/admin/backups', A, { kind: 'upload', label: 'файл' });
  r = await call('POST', `/api/admin/backups/${u.d.backup.id}/upload`, A, { tbl: 'sessions', cols: ['token_hash'], rows: [['x']] });
  check('файл с чужой таблицей — отказ', r.status === 400, r);
  r = await call('POST', `/api/admin/backups/${u.d.backup.id}/upload`, A, { tbl: 'settings', cols: ['k', 'evil'], rows: [['a', 'b']] });
  check('файл с неизвестным столбцом — отказ', r.status === 400, r);
  r = await call('POST', `/api/admin/backups/${u.d.backup.id}/upload`, A, { tbl: 'settings', cols: ['k', 'v'], rows: [[{ a: 1 }, 'b']] });
  check('файл с неверными значениями — отказ', r.status === 400, r);
  for (const p of allParts) { r = await call('POST', `/api/admin/backups/${u.d.backup.id}/upload`, A, p); if (r.status !== 200) break; }
  r = await call('POST', `/api/admin/backups/${u.d.backup.id}/finish`, A);
  check('копия из файла собрана', r.status === 200 && r.d.backup.status === 'ready' && r.d.backup.parts === B1.parts, r.d);
  r = await call('DELETE', '/api/admin/backups/' + u.d.backup.id, A); check('копия удаляется', r.status === 200 && (await call('GET', '/api/admin/backups/' + u.d.backup.id, A)).status === 404, r.status);

  // ---------- 4. баллы за недостающий пункт ----------
  r = await call('GET', '/api/promo-config'); check('по умолчанию баллы за пункт включены', r.d.missing_points === true, r.d.missing_points);
  r = await call('PUT', '/api/admin/settings', AD, { promo_missing_points: false });
  check('администратор выключает баллы за пункт', r.status === 200 && r.d.settings.promo_missing_points === false, r);
  r = await call('GET', '/api/promo-config'); check('настройка видна расчёту', r.d.missing_points === false, r.d.missing_points);

  // ---------- 5. обязательные курсы ----------
  const now = Date.now();
  await sql("INSERT INTO courses (title, description, position, published, created_at, updated_at) VALUES ('Курс сержанта', '', 99, 1, ?, ?)", [now, now]);
  const CID = (await sql("SELECT id FROM courses WHERE title='Курс сержанта'"))[0].id;
  await sql("INSERT INTO lectures (title, description, video_url, duration_sec, position, required, published, created_at, updated_at, course_id) VALUES ('Лекция сержанта', '', '', 60, 1, 1, 1, ?, ?, ?)", [now, now, CID]);
  const LID = (await sql("SELECT id FROM lectures WHERE title='Лекция сержанта'"))[0].id;
  r = await call('PUT', '/api/promo/courses', M, { all: [CID] }); check('руководство: 403 на обязательные курсы', r.status === 403, r.status);
  r = await call('PUT', '/api/promo/courses', AD, { all: [999999] }); check('несуществующий курс — отказ', r.status === 400, r);
  r = await call('PUT', '/api/promo/courses', AD, { all: [], by_rank: { 'Сержант': [CID] } });
  check('администратор задаёт курс для звания', r.status === 200 && r.d.courses_req.by_rank['Сержант'][0] === CID, r);
  r = await call('GET', '/api/promo/eligibility', S);
  check('курс не пройден — выгрузка закрыта', r.status === 200 && r.d.allowed === false && r.d.missing[0].id === CID && r.d.missing[0].title === 'Курс сержанта', r.d);
  r = await call('GET', '/api/promo/eligibility?rank=' + encodeURIComponent('Рядовой'), S); check('для другого звания курс не нужен', r.d.allowed === true, r.d);
  r = await call('GET', '/api/promo'); check('курсы для повышения видны в правилах', (await call('GET', '/api/promo', S)).d.courses_req.by_rank['Сержант'].includes(CID));

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open(tok) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    await ctx.addInitScript(t => { if (t) localStorage.setItem('vpexam_token', t); }, tok);
    await ctx.route(/discord(app)?\.com/, rt => rt.abort());
    const p = await ctx.newPage();
    const st = { errs: [], dialogs: [] };
    p.on('pageerror', e => st.errs.push('js ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) st.errs.push('console ' + m.text()); });
    p.on('dialog', d => { st.dialogs.push(d.message()); d.accept(); });
    return { p, ctx, st };
  }
  const ready = (p) => p.waitForFunction(() => document.body.dataset.shown === (location.hash.slice(1) || '/') && document.querySelector('#app h1') && !document.querySelector('#app .skel'), null, { timeout: 15000 });

  // рапорт: курс не пройден
  let s = await open(S);
  await s.p.goto(SITE + '#/promo/raport'); await ready(s.p);
  await s.p.waitForFunction(() => window.__vp && document.querySelector('#fromRank'), null, { timeout: 15000 });
  await s.p.waitForSelector('.promo-gate a', { timeout: 8000 }).catch(() => {});
  const gateTxt = await s.p.locator('.promo-gate').textContent().catch(() => '');
  check('рапорт: сообщение с курсом и ссылкой', /Скачать рапорт можно после курса/.test(gateTxt) && /Курс сержанта/.test(gateTxt) && await s.p.locator(`.promo-gate a[href="#/course/${CID}"]`).count() === 1, gateTxt);
  check('рапорт: PDF неактивна', await s.p.locator('#pdf.gated[aria-disabled="true"]').count() === 1);
  check('рапорт: без технических надписей', !/eligib|allowed|api|undefined|null/i.test(gateTxt));
  // расчёт без замены пунктов баллами
  const calc = await s.p.evaluate(() => { const c = window.__vp.crit; const t = c.total, n = c.n; c.total = () => 1000; c.n = () => 0; const r = window.__vp.compute(); c.total = t; c.n = n; return { covered: r.covered, met: r.met, rank: r.rank }; });
  check('выключено: недостающие пункты баллами не закрываются', calc.rank === 'Сержант' && calc.covered === 0 && calc.met === false, calc);
  let dl = false; s.p.once('download', () => { dl = true; });
  await s.p.locator('#pdf').click({ force: true }); await s.p.waitForTimeout(800);
  check('рапорт: клик по закрытой кнопке — без файла, с пояснением', !dl && /обязательных курсов/.test(await s.p.locator('#status').textContent()), await s.p.locator('#status').textContent());
  await s.p.screenshot({ path: SHOTS + 'promo-gated.png', fullPage: true });
  // ссылка на курс — в один клик
  await s.p.click('.promo-gate a'); await ready(s.p);
  check('ссылка ведёт на курс', s.p.url().endsWith('#/course/' + CID) && /Курс сержанта/.test(await s.p.locator('#app h1').textContent()), s.p.url());
  // проходим курс
  await sql('INSERT INTO lecture_progress (user_id, lecture_id, started_at, max_pos, last_pos, watched_sec, last_hb_at, rejected, completed_at) VALUES (?, ?, ?, 60, 60, 60, ?, 0, ?)', [STAFF, LID, now, now, now]);
  r = await call('GET', '/api/promo/eligibility', S); check('курс пройден — выгрузка открыта', r.d.allowed === true && r.d.required[0].done === true, r.d);
  await call('PUT', '/api/admin/settings', AD, { promo_missing_points: true });
  await s.p.evaluate(() => window.cacheClear && window.cacheClear());
  await s.p.goto(SITE + '#/promo/raport'); await s.p.reload(); await ready(s.p);
  await s.p.waitForFunction(() => window.__vp && document.querySelector('#fromRank'), null, { timeout: 15000 }); await s.p.waitForTimeout(500);
  check('рапорт: после курса кнопка активна, сообщения нет', await s.p.locator('#pdf.gated').count() === 0 && await s.p.locator('.promo-gate').count() === 0);
  const calc2 = await s.p.evaluate(() => { const c = window.__vp.crit; c.total = () => 1000; c.n = () => 0; return window.__vp.compute(); });
  check('включено: недостающие пункты закрываются баллами', calc2.covered === 3 && calc2.met === true, { covered: calc2.covered, met: calc2.met });
  await s.p.evaluate(() => { const v = { num: '1', date: '01.01.2026', fromStatic: '100-002', fromName: 'Иван Петров', fromUnit: 'ВП', fromPos: 'Сотрудник', target: 'Старший сержант', toDate: '01.01.2026' }; for (const [k, x] of Object.entries(v)) { const el = document.getElementById(k); if (el && !el.value) { el.value = x; el.dispatchEvent(new Event('input', { bubbles: true })); } } });
  const dlp = s.p.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await s.p.click('#pdf');
  const file = await dlp;
  check('рапорт: после курса PDF скачивается', !!file && /\.pdf$/i.test(file.suggestedFilename()), file && file.suggestedFilename());
  check('рапорт: ошибок в консоли нет', s.st.errs.length === 0, s.st.errs);
  await s.ctx.close();

  // правила повышения: текст зависит от настройки, курсы видны
  s = await open(S);
  await s.p.goto(SITE + '#/promo'); await ready(s.p);
  let t = await s.p.locator('#app').textContent();
  check('правила: курс в списке обязательных с отметкой', /Обязательные курсы/.test(t) && /Курс сержанта ✔/.test(t) && /каждый недостающий пункт можно заменить/i.test(t), t.slice(0, 300));
  await s.ctx.close();
  await call('PUT', '/api/admin/settings', AD, { promo_missing_points: false });
  s = await open(S); await s.p.goto(SITE + '#/promo'); await ready(s.p);
  t = await s.p.locator('#app').textContent();
  check('правила: при выключенной настройке нет фразы о замене пунктов', !/можно заменить/i.test(t) && /баллами они не заменяются/.test(t), t.slice(0, 300));
  await s.ctx.close();

  // ---------- 6. интерфейс администратора ----------
  s = await open(AD);
  await s.p.goto(SITE + '#/admin/settings'); await ready(s.p);
  check('параметры: выключатель в положении «выключено»', await s.p.locator('#pmp').isChecked() === false);
  check('параметры: у не главного администратора нет резервных копий', await s.p.locator('#bkBox').count() === 0);
  await s.p.click('#pmp'); await s.p.waitForFunction(() => !document.getElementById('pmp').disabled); await s.p.waitForTimeout(300);
  check('параметры: включение в один клик', (await call('GET', '/api/promo-config')).d.missing_points === true);
  await s.p.goto(SITE + '#/promo'); await ready(s.p);
  check('правила: редактор обязательных курсов у администратора', await s.p.locator('#promoReqEdit').count() === 1);
  await s.p.click('#promoReqEdit summary');
  await s.p.locator(`#promoReqEdit input[data-r=""][data-c="${CID}"]`).check(); await s.p.waitForTimeout(800);
  check('правила: курс для всех званий — в один клик', (await call('GET', '/api/promo', A)).d.courses_req.all.includes(CID));
  check('правила: редактор остался открыт', await s.p.locator('#promoReqEdit[open]').count() === 1);
  check('админ: ошибок нет', s.st.errs.length === 0, s.st.errs);
  await s.ctx.close();
  await call('PUT', '/api/promo/courses', AD, { all: [], by_rank: {} });

  // главный: копия из интерфейса
  s = await open(A);
  await s.p.goto(SITE + '#/admin/settings'); await ready(s.p);
  await s.p.waitForSelector('#bkSave', { timeout: 8000 });
  const before = (await call('GET', '/api/admin/backups', A)).d.backups.length;
  await s.p.fill('#bkLabel', 'из интерфейса'); await s.p.click('#bkSave');
  await s.p.waitForFunction(() => /из интерфейса/.test(document.getElementById('bkBox').textContent) && !document.querySelector('#bkSave').disabled, null, { timeout: 30000 });
  check('главный: копия сохранена из параметров', (await call('GET', '/api/admin/backups', A)).d.backups.length === before + 1);
  const dlp2 = s.p.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await s.p.locator('tr[data-b]').first().locator('.bk-dl').click();
  const f2 = await dlp2; let okJson = false;
  if (f2) { const path = SHOTS + 'backup.json'; await f2.saveAs(path); const j = JSON.parse(fs.readFileSync(path, 'utf8')); okJson = j.format === 'vp-exam-backup' && j.parts.length > 0; fs.unlinkSync(path); }
  check('главный: файл копии скачан', okJson);
  await call('PUT', '/api/admin/settings', A, { site_title: 'Снова испорчено' });
  await s.p.locator('tr[data-b]').first().locator('.bk-rs').click();
  await s.p.waitForFunction(() => document.getElementById('toast') && /Копия восстановлена/.test(document.getElementById('toast').textContent), null, { timeout: 60000 }).catch(() => {});
  check('главный: восстановление из интерфейса с подтверждением', s.st.dialogs.some(d => /Восстановить копию/.test(d)) && (await call('GET', '/api/config')).d.settings.site_title === 'Портал до копии', s.st.dialogs);
  check('главный: перед восстановлением сохранена автокопия', (await call('GET', '/api/admin/backups', A)).d.backups.filter(b => b.kind === 'auto').length >= 2);
  check('главный: ошибок нет', s.st.errs.length === 0, s.st.errs);
  await s.p.screenshot({ path: SHOTS + 'backups.png', fullPage: true });
  await s.ctx.close();

  // руководство: интерфейс
  s = await open(M);
  await s.p.goto(SITE + '#/admin/users'); await ready(s.p);
  const rail = await s.p.locator('.rail-item').allTextContents();
  check('руководство: есть люди, доступ, проверка, неделя', ['Люди и роли', 'Доступ к тестам', 'Проверка', 'Неделя'].every(x => rail.some(y => y.includes(x))), rail);
  check('руководство: нет курсов, лекций, банка, параметров, законов', !['Курсы', 'Лекции', 'Банк вопросов', 'Параметры', 'Законодательство', 'Конструктор'].some(x => rail.some(y => y.trim().startsWith(x))), rail);
  await s.p.goto(SITE + '#/admin/user/' + STAFF); await s.p.waitForSelector('#role', { timeout: 15000 });
  const opts = await s.p.locator('select option').allTextContents();
  check('руководство: в карточке нет роли администратора и руководства', !opts.some(o => /Администратор|Руководство \(СС\)/.test(o)), opts);
  await s.p.goto(SITE + '#/admin/reatt'); await ready(s.p);
  check('руководство: в доступе к тестам только «Доступ» и «Попытки»', await s.p.locator('.r-acc').count() > 0 && await s.p.locator('.r-del, .r-tog, #newR').count() === 0);
  await s.p.goto(SITE + '#/admin/settings'); await s.p.waitForTimeout(1500);
  check('руководство: параметры закрыты', !(await s.p.locator('#pmp').count()));
  await s.p.goto(SITE + '#/promo'); await ready(s.p);
  check('руководство: правила повышения без правки', await s.p.locator('#promoReqEdit').count() === 0 && !/Изменить правила/.test(await s.p.locator('#app').textContent()));
  check('руководство: ошибок нет', s.st.errs.length === 0, s.st.errs);
  await s.ctx.close();

  await browser.close();
  const fail = results.filter(x => !x.ok).length;
  fs.writeFileSync(__dirname + '/e2e-roles-backup-results.json', JSON.stringify(results, null, 1));
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
