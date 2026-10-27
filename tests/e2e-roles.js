// E2E «Роли, шторка, разделы, удаление отчёта, публичный список премий» (headless, вход — имитация /__test/login, без Discord).
// Запуск: bash /tmp/reset.sh (wrangler dev :8787, миграции 0001–0008), node serve.js (:8080), SITE_DIR=../vp_raport_offline PORT=8081 node serve.js.
const { chromium } = require('playwright');
const fs = require('fs');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/', OFF = 'http://localhost:8081/';
const SHOTS = process.env.SHOTS || (__dirname + '/shots/'); fs.mkdirSync(SHOTS, { recursive: true });
const SUPER = '417660389723996170';
const U = { none: '600000000000000001', vp: '600000000000000002', reatt: '600000000000000003', exam: '600000000000000004', admin: '600000000000000005', vp2: '600000000000000006', lead: '600000000000000007' };
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 600) : '')); };
async function call(method, path, token, body) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch (_) {}
  return { status: r.status, d };
}
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, args) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args }) })).json()).results;
const mondayMsk = (ms) => { const d = new Date(ms + 3 * 3600000); const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const addD = (w, n) => { const d = new Date(w + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const WEEK = mondayMsk(Date.now()), PREV = addD(WEEK, -7);

(async () => {
  const T = {
    super: await login(SUPER, 'super-admin'),
    none: await login(U.none, 'nobody', 'none'), vp: await login(U.vp, 'vp_ivan', 'vp'), reatt: await login(U.reatt, 'reatt_only', 'reatt'),
    exam: await login(U.exam, 'checker', 'examiner'), admin: await login(U.admin, 'adm', 'admin'), vp2: await login(U.vp2, 'vp_petr', 'vp'), lead: await login(U.lead, 'boss', 'leader'),
  };
  // ---------- 1. права на сервере ----------
  const EP = { courses: '/api/courses', lectures: '/api/lectures', exams: '/api/exams', reports: '/api/reports/my', premiums: '/api/premiums', promo: '/api/promo', reatt: '/api/reatt',
    lead: '/api/lead/week', adminUsers: '/api/admin/users', adminCourses: '/api/admin/courses', attempts: '/api/admin/attempts', docs: '/api/docs', people: '/api/people', me: '/api/me' };
  const expect = {
    none: { docs: 200, people: 403, me: 200, courses: 403, lectures: 403, exams: 403, reports: 403, premiums: 403, promo: 403, reatt: 403, lead: 403, adminUsers: 403, adminCourses: 403, attempts: 403 },
    vp: { courses: 200, lectures: 200, exams: 200, reports: 200, premiums: 200, promo: 200, docs: 200, people: 403, reatt: 403, lead: 403, adminUsers: 403, adminCourses: 403, attempts: 403 },
    reatt: { reatt: 200, docs: 200, courses: 403, reports: 403, premiums: 403, lead: 403, adminUsers: 403 },
    exam: { attempts: 200, adminUsers: 200, adminCourses: 403, courses: 403, lead: 403, reatt: 403 },
    admin: { courses: 200, reports: 200, premiums: 200, reatt: 200, lead: 200, adminUsers: 200, adminCourses: 200, attempts: 200, promo: 200 },
    lead: { lead: 200, docs: 200, people: 200, courses: 403, adminUsers: 403 },
  };
  for (const [who, exp] of Object.entries(expect)) {
    const bad = [];
    for (const [k, st] of Object.entries(exp)) { const r = await call('GET', EP[k], T[who]); if (r.status !== st) bad.push(`${k}: ${r.status}≠${st}`); }
    check(`сервер: права роли «${who}»`, !bad.length, bad);
  }
  let r = await call('GET', '/api/me', T.none); check('без ролей: caps все false', r.d.user.caps && !Object.entries(r.d.user.caps).some(([k, v]) => k !== 'super' && v), r.d.user.caps);
  r = await call('GET', '/api/me', T.admin); check('админ: caps включают vp, reatt, lead', r.d.user.caps.vp && r.d.user.caps.reatt && r.d.user.caps.lead && r.d.user.caps.admin);
  r = await call('POST', '/api/docs', T.vp, { category: 'X', title: 'Y', body: 'z' }); check('ВП не может добавить статью в базу данных', r.status === 403);
  r = await call('PUT', '/api/promo', T.vp, {}); check('ВП не может менять систему повышения', r.status === 403);

  // ---------- 2. роли назначает админ ----------
  r = await call('PUT', '/api/admin/users/' + U.none, T.exam, { vp: true }); check('проверяющий не назначает роли', r.status === 403);
  r = await call('PUT', '/api/admin/users/' + U.none, T.super, { vp: true, reatt: true }); check('админ назначает «ВП» + «Переаттестация»', r.status === 200 && r.d.user.vp && r.d.user.reatt, r.d);
  r = await call('GET', '/api/courses', T.none); check('после назначения роли «ВП» — учебный отдел открыт', r.status === 200);
  r = await call('PUT', '/api/admin/users/' + U.none, T.super, { vp: false, reatt: false }); r = await call('GET', '/api/courses', T.none); check('роль снята — снова 403', r.status === 403);

  // ---------- 3. профиль и журнал изменений ----------
  r = await call('PUT', '/api/me', T.vp, { ic_name: 'Иван Петров', rank: 'Лейтенант', static_id: '4455', position: 'Инспектор ВП' }); check('ВП заполняет профиль', r.status === 200 && r.d.user.ic_name === 'Иван Петров', r.d);
  r = await call('PUT', '/api/admin/users/' + U.vp, T.super, { rank: 'Старший лейтенант', static_id: '4456' }); check('админ меняет звание и статик ВП', r.status === 200 && r.d.user.rank === 'Старший лейтенант');
  r = await call('PUT', '/api/admin/users/' + U.vp, T.exam, { rank: 'Рядовой' }); check('проверяющий не меняет профиль', r.status === 403);
  r = await call('GET', '/api/admin/users/' + U.vp, T.super);
  const plog = r.d.profile_log || [];
  check('журнал изменений профиля: сам + админ, старое → новое', plog.some(x => x.self) && plog.some(x => !x.self && x.changes.rank && x.changes.rank[0] === 'Лейтенант' && x.changes.rank[1] === 'Старший лейтенант'), plog);
  await call('PUT', '/api/me', T.vp2, { ic_name: 'Пётр Сидоров', rank: 'Сержант', static_id: '777' });

  // ---------- 4. отчёты, удаление, публичный список ----------
  const rep = (week, n) => ({ week, position: 'Инспектор ВП', header: { rank: 'x', name: 'подмена', static_id: '0', from: week, to: addD(week, 6) }, items: [{ key: 'postavka', n, links: ['https://imgur.com/a/p'] }, { key: 'otbitie', n: 3, links: ['https://imgur.com/a/o'] }, { key: 'training', n: 1, links: ['https://imgur.com/a/t'] }] });
  r = await call('POST', '/api/reports', T.vp, rep(PREV, 10)); const repV = r.d.report; check('отчёт ВП за прошлую неделю (после срока)', r.status === 200 && repV.late, r.d);
  r = await call('GET', '/api/lead/reports/' + repV.id, T.lead); check('шапка отчёта: имя/звание/статик подставлены из профиля (а не из формы)', r.d.report.header.name === 'Иван Петров' && r.d.report.header.rank === 'Старший лейтенант' && r.d.report.header.static_id === '4456', r.d.report.header);
  r = await call('POST', '/api/reports', T.vp2, rep(PREV, 6)); const repV2 = r.d.report;
  r = await call('POST', '/api/reports', T.vp, rep(WEEK, 8)); const repCur = r.d.report;
  r = await call('POST', '/api/reports', T.reatt, rep(WEEK, 1)); check('без роли ВП отчёт не отправить', r.status === 403);
  // имитация: отчёты прошлой недели сданы в срок
  await sql('UPDATE reports SET late = 0, first_submitted_at = ?1 WHERE week = ?2', [Date.parse(PREV + 'T12:00:00Z'), PREV]);
  // до срока (текущая неделя): список закрыт
  r = await call('GET', '/api/premiums?week=' + WEEK, T.vp2); check('текущая неделя (до вс 19:00): список закрыт', r.d.open === false && r.d.list.length === 0 && r.d.totals === null, r.d);
  await call('POST', `/api/lead/reports/${repCur.id}/review`, T.lead, { status: 'approved' });
  r = await call('GET', '/api/premiums?week=' + WEEK, T.vp2); check('даже принятый отчёт текущей недели не виден до срока', r.d.list.length === 0);
  // после срока, не всё проверено
  r = await call('GET', '/api/premiums?week=' + PREV, T.vp2); check('после срока: список открыт, но пуст — ничего не принято', r.d.open && !r.d.final && r.d.list.length === 0 && r.d.stats.pending === 2, r.d.stats);
  await call('POST', `/api/lead/reports/${repV.id}/review`, T.lead, { status: 'approved' });
  r = await call('GET', '/api/premiums?week=' + PREV, T.vp2);
  check('после срока: принятый отчёт в списке без сумм (проверено 1 из 2)', r.d.open && !r.d.final && r.d.list.length === 1 && r.d.list[0].total_fund === undefined && r.d.list[0].items.length === 3 && r.d.list[0].rank === 'Старший лейтенант', r.d);
  check('свой итог ВП2 скрыт, пока не проверены все отчёты', r.d.my && r.d.my.total_fund === undefined, r.d.my);
  // удаление «говно-отчёта»
  r = await call('DELETE', '/api/lead/reports/' + repV2.id, T.vp, { reason: 'x' }); check('ВП не может удалить отчёт', r.status === 403);
  r = await call('DELETE', '/api/lead/reports/' + repV2.id, T.exam, { reason: 'x' }); check('проверяющий (без руководства) не может удалить отчёт', r.status === 403);
  r = await call('GET', '/api/lead/week?week=' + PREV, T.lead); const before = r.d;
  await call('PUT', `/api/lead/week/${PREV}/fund`, T.lead, { fund: 10000000 });
  // наградная из бюджета ГУ ВП — отдельно от фонда
  r = await call('PUT', `/api/lead/week/${PREV}/manual/${U.vp}`, T.lead, { award_budget: 50000 }); check('наградная из бюджета ГУ ВП назначена', r.status === 200, r.d);
  r = await call('GET', '/api/lead/week?week=' + PREV, T.lead);
  const rowV = r.d.rows.find(x => x.user_id === U.vp);
  check('раздельные итоги: total = total_fund, бюджет отдельно', rowV.total === rowV.total_fund && rowV.award_budget === 50000 && r.d.totals.award_budget === 50000 && r.d.totals.paid === r.d.rows.reduce((s, x) => s + x.total_fund, 0), { rowV, totals: r.d.totals });
  check('остаток фонда не уменьшен наградной из бюджета', r.d.totals.remaining === 10000000 - r.d.totals.paid, r.d.totals);
  r = await call('DELETE', '/api/lead/reports/' + repV2.id, T.lead, { reason: 'недостоверные доказательства' }); check('руководство удаляет отчёт', r.status === 200 && r.d.week === PREV, r.d);
  r = await call('DELETE', '/api/lead/reports/' + repV2.id, T.lead, {}); check('повторное удаление → 404', r.status === 404);
  r = await call('GET', '/api/lead/reports/' + repV2.id, T.lead); check('удалённый отчёт не открывается', r.status === 404);
  r = await call('GET', '/api/lead/deleted?week=' + PREV, T.lead); check('журнал удалённых: причина и кто удалил', r.d.deleted.length === 1 && r.d.deleted[0].reason === 'недостоверные доказательства' && r.d.deleted[0].user_id === U.vp2, r.d);
  r = await call('GET', '/api/admin/audit?limit=20', T.super); check('журнал действий: report.delete', JSON.stringify(r.d).includes('report.delete'));
  r = await call('GET', '/api/lead/week?week=' + PREV, T.lead); check('после удаления неделя пересчитана (отчёта ВП2 нет, deleted_count = 1)', !r.d.rows.some(x => x.user_id === U.vp2 && x.status !== 'missing') && r.d.deleted_count === 1, r.d.rows.map(x => [x.user_id, x.status]));
  r = await call('GET', '/api/reports/my?week=' + PREV, T.vp2); check('у сотрудника отчёта за неделю больше нет', !r.d.report, r.d);
  // теперь все отчёты проверены → итоговые суммы
  r = await call('GET', '/api/premiums?week=' + PREV, T.vp2);
  const it = r.d.list[0] || {};
  check('после проверки всех отчётов: суммы видны всем ВП', r.d.final && r.d.list.length === 1 && it.total_fund > 0 && it.oklad > 0, r.d);
  check('публичный список: раздельные итоги фонд / бюджет ГУ ВП', r.d.totals.fund === it.total_fund && r.d.totals.award_budget === 50000 && it.award_budget === 50000, r.d.totals);
  r = await call('GET', '/api/premiums?week=' + PREV, T.vp); check('ВП видит свой итог', r.d.my && r.d.my.total_fund === it.total_fund && r.d.my.status === 'approved');
  r = await call('GET', '/api/premiums?week=' + PREV, T.none); check('без роли ВП список премий закрыт', r.status === 403);

  // ---------- 5. база данных, личные дела, система повышения ----------
  r = await call('POST', '/api/docs', T.admin, { category: 'Уставы', title: 'Порядок несения наряда', body: '# Наряд\n- пункт 1\n- пункт 2' }); const docId = r.d && r.d.doc && r.d.doc.id;
  check('админ добавляет статью с категорией', r.status === 200 && docId, r.d);
  r = await call('GET', '/api/docs?q=наряд', T.none); check('статью видят все (поиск)', r.status === 200 && r.d.docs.some(d => d.id === docId), r.d);
  r = await call('PUT', '/api/docs/' + docId, T.vp, { category: 'Уставы', title: 'взлом', body: '' }); check('ВП не правит статью', r.status === 403);
  r = await call('PUT', '/api/docs/' + docId, T.admin, { category: 'Уставы', title: 'Порядок несения наряда (ред.)', body: 'текст' }); check('админ правит статью', r.status === 200);
  // с миграции 0010 в списке — заведённые личные дела (заводит старший состав)
  r = await call('POST', '/api/people/' + U.vp, T.lead, {}); check('руководство заводит личное дело ВП', r.status === 200, r.d);
  r = await call('GET', '/api/people', T.lead); const pv = r.d.people.find(p => p.id === U.vp);
  check('личные дела: карточка ВП с ФИО, званием, статиком, должностью', pv && pv.name === 'Иван Петров' && pv.rank === 'Старший лейтенант' && pv.static_id === '4456' && pv.position === 'Инспектор ВП', pv);
  r = await call('GET', '/api/people/' + U.vp, T.lead); check('личное дело (руководство): история отчётов', r.status === 200 && r.d.reports && r.d.reports.some(x => x.week === PREV), r.d);
  r = await call('GET', '/api/promo', T.admin); const pc = r.d.config;
  pc.ladder[0].points = 175; r = await call('PUT', '/api/promo', T.admin, { points_per_item: 120, pts: pc.pts, ladder: pc.ladder }); check('админ меняет требования системы повышения', r.status === 200 && r.d.custom, r.d);
  r = await call('GET', '/api/promo-config'); check('публичная конфигурация повышения для сайта бланков', r.d.custom && r.d.config.points_per_item === 120 && r.d.config.ladder[0].points === 175);

  // ---------- 6. интерфейс: шторка по ролям ----------
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const open = async (tok, hash, vp) => {
    const ctx = await b.newContext({ viewport: vp || { width: 1300, height: 900 }, locale: 'ru-RU' }); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'тест' : undefined));
    await ctx.addInitScript(t => { if (location.port === '8080') localStorage.setItem('vpexam_token', t); }, tok);
    await p.goto(SITE + '#' + hash); await p.waitForSelector('#logoutBtn'); await p.waitForTimeout(700);
    return p;
  };
  const menu = async (p) => p.$$eval('#drawer .drawer-nav a', a => a.map(x => x.getAttribute('href')));
  const M = {};
  for (const who of ['none', 'vp', 'reatt', 'exam', 'admin', 'lead']) { const p = await open(T[who], '/'); M[who] = await menu(p); if (who === 'none') { await p.screenshot({ path: SHOTS + 'roles-none.png' }); } await p.context().close(); }
  const has = (who, ...h) => h.every(x => M[who].includes('#' + x)), hasNo = (who, ...h) => h.every(x => !M[who].includes('#' + x));
  check('без ролей: только Главная, База данных, Профиль (Личные дела — только СС)', JSON.stringify(M.none) === JSON.stringify(['#/', '#/docs', '#/profile']), M.none);
  check('ВП: учебный отдел, отчёты, премирование, повышение; без переаттестации/админки', has('vp', '/study', '/reports', '/premiums', '/promo', '/docs') && hasNo('vp', '/reatt', '/admin', '/lead', '/people'), M.vp);
  check('Переаттестация: только переаттестация + общие', has('reatt', '/reatt', '/docs') && hasNo('reatt', '/study', '/reports', '/admin'), M.reatt);
  check('Проверяющий: админка; без учебного отдела и руководства', has('exam', '/admin') && hasNo('exam', '/study', '/lead'), M.exam);
  check('Админ: все разделы', has('admin', '/study', '/reatt', '/reports', '/premiums', '/promo', '/docs', '/people', '/lead', '/admin'), M.admin);
  check('Руководство: разделы «Руководство» и «Личные дела»', has('lead', '/lead', '/people') && hasNo('lead', '/admin'), M.lead);
  // прямой переход в закрытый раздел
  let p = await open(T.none, '/study'); check('без ролей: прямой переход в учебный отдел → «Раздел недоступен»', /Раздел недоступен/.test(await p.textContent('main'))); await p.context().close();
  p = await open(T.reatt, '/premiums'); check('переаттестация: премирование недоступно', /Раздел недоступен/.test(await p.textContent('main'))); await p.context().close();
  // мобильная шторка
  p = await open(T.vp, '/', { width: 390, height: 800 });
  check('мобильный: шторка скрыта, есть бургер', await p.isVisible('#burger') && await p.evaluate(() => document.getElementById('drawer').getBoundingClientRect().right <= 0));
  await p.click('#burger'); await p.waitForTimeout(400);
  check('мобильный: бургер открывает шторку', await p.evaluate(() => document.body.classList.contains('drawer-open') && document.getElementById('drawer').getBoundingClientRect().left >= 0));
  await p.screenshot({ path: SHOTS + 'roles-drawer-mobile.png' });
  await p.click('#drawer a[href="#/premiums"]'); await p.waitForTimeout(800);
  check('мобильный: переход по пункту закрывает шторку', !(await p.evaluate(() => document.body.classList.contains('drawer-open'))) && /Премирование/.test(await p.textContent('main')));
  check('мобильный: без горизонтальной прокрутки', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await p.context().close();
  // премирование: публичный список с раздельными итогами
  p = await open(T.vp2, '/premiums?week=' + PREV);
  await p.waitForSelector('table.plist');
  check('страница премий: список, колонка «Наградная (бюджет ГУ ВП)» отдельно, итоги раздельно', /Иван Петров/.test(await p.textContent('table.plist')) && (await p.$$('table.plist th.bcol')).length === 1 && /50\s000/.test(await p.textContent('table.plist tfoot')), await p.textContent('table.plist tfoot').catch(() => ''));
  await p.click('[data-det="0"]'); check('«За что»: пункты отчёта', /Участие в поставочном мероприятии/.test(await p.textContent('#det0')));
  await p.screenshot({ path: SHOTS + 'roles-premiums.png', fullPage: true });
  await p.goto(SITE + '#/premiums?week=' + WEEK); await p.waitForTimeout(800);
  check('страница премий: текущая неделя — «откроется после срока»', /откроется после срока/.test(await p.textContent('main')));
  await p.context().close();
  // руководство: удаление через интерфейс, раздельные итоги
  await call('POST', '/api/reports', T.vp2, rep(WEEK, 2)); r = await call('GET', '/api/reports/my?week=' + WEEK, T.vp2); const rid = r.d.report.id;
  p = await open(T.lead, '/lead/report/' + rid); await p.waitForSelector('#delRep');
  await p.fill('#delReason', 'тест удаления'); await p.click('#delRep'); await p.waitForFunction(() => location.hash.startsWith('#/lead?week='));
  r = await call('GET', '/api/reports/my?week=' + WEEK, T.vp2); check('интерфейс: «Удалить отчёт» с подтверждением → отчёт удалён', !r.d.report);
  await p.goto(SITE + '#/lead?week=' + PREV); await p.waitForTimeout(1200); await p.waitForSelector('table.prem');
  const bc = [(await p.$$('table.prem th.bcol')).length, /Итого из фонда/.test(await p.textContent('main')), await p.textContent('#budgetTotal')]; check('руководство: «Итого из фонда» и «Наградная (бюджет)» — разные колонки и итоги', (await p.$$('table.prem th.bcol')).length === 1 && /Итого из фонда/.test(await p.textContent('main')) && /50\s000/.test(await p.textContent('#budgetTotal')), bc);
  await p.screenshot({ path: SHOTS + 'roles-lead.png', fullPage: true });
  await p.context().close();
  // курсы
  r = await call('POST', '/api/admin/lectures', T.admin, { title: 'Лекция 1. Устав', video_url: 'videos/a.mp4', duration_sec: 60, required: true, published: true }); const l1 = r.d.lecture && r.d.lecture.id;
  r = await call('POST', '/api/admin/courses', T.admin, { title: 'Курс молодого бойца', description: 'Основы службы', published: true, lecture_ids: [l1], exam_ids: [] }); const cid = r.d.course && r.d.course.id;
  check('админ создаёт курс с лекциями', r.status === 200 && cid, r.d);
  r = await call('GET', '/api/courses', T.vp); const cc = r.d.courses.find(c => c.id === cid);
  check('ВП видит курс: лекции и прогресс', cc && cc.lectures.length === 1 && cc.required_total === 1 && cc.required_done === 0, cc);
  r = await call('POST', '/api/admin/courses', T.exam, { title: 'x' }); check('проверяющий не создаёт курсы', r.status === 403);
  p = await open(T.vp, '/study'); await p.waitForSelector('.course-card');
  check('учебный отдел: карточки курсов', /Курс молодого бойца/.test(await p.textContent('.course-grid')));
  await p.click(`.course-card[href="#/course/${cid}"]`); await p.waitForSelector('ol.steps');
  check('курс: шаги-лекции', /Лекция 1\. Устав/.test(await p.textContent('ol.steps')));
  await p.screenshot({ path: SHOTS + 'roles-course.png', fullPage: true });
  await p.context().close();
  // профиль → сайт бланков
  const ctx = await b.newContext({ viewport: { width: 1300, height: 900 } }); p = await ctx.newPage(); p.on('pageerror', e => errs.push('off: ' + e.message));
  await p.goto(OFF + 'otchet.html'); await p.evaluate(t => { localStorage.clear(); localStorage.setItem('vpexam_token', t); }, T.vp); await p.reload();
  await p.waitForFunction(() => document.getElementById('fromName').value === 'Иван Петров', null, { timeout: 8000 }).catch(() => {});
  check('сайт бланков: имя, звание, статик, должность из профиля', (await p.inputValue('#fromName')) === 'Иван Петров' && (await p.inputValue('#fromRank')) === 'Старший лейтенант' && (await p.inputValue('#fromStatic')) === '4456' && (await p.inputValue('#fromPos')) === 'Инспектор ВП',
    [await p.inputValue('#fromName'), await p.inputValue('#fromRank'), await p.inputValue('#fromStatic'), await p.inputValue('#fromPos')]);
  await p.click('#ecoBurger'); await p.waitForTimeout(300);
  const offMenu = await p.$$eval('#ecoDrawer a', a => a.map(x => x.textContent.trim()));
  check('сайт бланков: шторка по ролям ВП (учебный отдел, премирование; без админки)', offMenu.some(x => /Учебный отдел/.test(x)) && offMenu.some(x => /Премирование/.test(x)) && !offMenu.some(x => /Админка/.test(x)), offMenu);
  await p.goto(OFF + 'povyshenie.html'); await p.waitForFunction(() => window.VP_ECO && window.VP_ECO.promoCustom, null, { timeout: 8000 }).catch(() => {});
  check('сайт бланков: изменённые требования повышения применены', await p.evaluate(() => window.PROMO.pointsPerItem === 120 && window.PROMO.ladder['Сержант'].points === 175));
  await ctx.close();
  check('нет ошибок JS', errs.length === 0, errs);
  await b.close();
  const okN = results.filter(x => x.ok).length; console.log(`\nИТОГО: ${okN}/${results.length} PASS`);
  fs.writeFileSync(__dirname + '/e2e-roles-results.json', JSON.stringify(results, null, 1));
  process.exit(okN === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
