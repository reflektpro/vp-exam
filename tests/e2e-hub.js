// Навигация после упрощения: мок API, без Discord и без боевых запросов.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const SITE = 'http://127.0.0.1:8094/';
fs.mkdirSync('/tmp/ux-after', { recursive: true });
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + String(extra).slice(0, 300) : '')); };
function user(role, caps) {
  return { id: '1', username: 'fixture', global_name: 'fixture', role, super: !!caps.super, ic_name: 'Иван', rank: 'Лейтенант', static_id: '1', caps };
}
const courses = { courses: [{ id: 7, title: 'Внутренний устав', description: 'Служба', track: 'rank', complete: false, topics: [{ id: 1, title: 'Распорядок', done: false, status: 'ready' }], topics_total: 4, topics_done: 1, exams: [], required_total: 2, required_done: 1, lectures_total: 2, watched: 1 }] };
function fulfill(route, who) {
  const p = new URL(route.request().url()).pathname;
  const stats = { pending_review: 2, users: 9, passed: 1, in_progress: 0, lectures_published: 1, lectures: 2, exams: 1, bank_questions: 10, bank_cases: 1, reatt_pending: 0, reatt_total: 6 };
  const laws = { pipeline: { fetches_forum: false, rewrites_answers: false, updates_repository: false, routine: 'Портал сам форум не скачивает.', publish: 'отдельно', approval: 'не меняет ответы', production_migration: '0021' }, checks_total: 1, pending_count: 1, open_flags: 0, latest_check: { id: 1, status: 'changes', offline: true, partial: false, applied_locally: false, generated_at: Date.now(), finished_at: Date.now(), runner: 'e2e-fixture', actor_name: 'fixture', summary: {} }, documents: [{ id: 'pk', short: 'ПК', title: 'Процессуальный кодекс', url: 'https://forum.rmrp.ru/', mode: 'auto', manual_reason: '', monitor_status: 'changed', last_ok_at: Date.now(), last_error: '', pending_proposal_id: 1, open_flags: 0 }, { id: 'uk', short: 'УК', title: 'Уголовный кодекс', url: 'https://forum.rmrp.ru/', mode: 'auto', manual_reason: '', monitor_status: 'unchanged', last_ok_at: Date.now(), last_error: '', pending_proposal_id: null, open_flags: 0 }] };
  const lawDoc = { document: laws.documents[0], proposals: [], pending: null, latest: null, events: [] };
  const map = {
    '/api/config': { oauth_configured: false, settings: { site_title: 'ГУ ВП — портал', welcome_text: '', sequential_lectures: true } },
    '/api/me': { user: who },
    '/api/reports/my': { report: { status: 'accepted' }, deadline: Date.now() + 86400000, now: Date.now() },
    '/api/courses': courses,
    '/api/docs': { docs: [], categories: [] },
    '/api/admin/stats': stats,
    '/api/admin/laws': laws,
    '/api/admin/laws/docs/pk': lawDoc,
    '/api/admin/lectures': { lectures: [] },
    '/api/exams': { exams: [] },
    '/api/reatt': { versions: [] },
  };
  const delay = route.request().headers()['x-delay'] ? 500 : 0;
  setTimeout(() => route.fulfill({ contentType: 'application/json', body: JSON.stringify(map[p] || { lectures: [], exams: [], courses: [], docs: [], items: [], versions: [] }) }), delay);
}
(async () => {
  const srv = spawn('node', ['tests/serve.js'], { cwd: require('path').join(__dirname, '..'), env: { ...process.env, PORT: '8094' }, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 250));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open(who, hash, vp) {
    const ctx = await browser.newContext({ viewport: vp || { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    await page.route('**://localhost:8787/**', route => fulfill(route, who));
    await ctx.addInitScript(() => localStorage.setItem('vpexam_token', 'fixture'));
    await page.goto(SITE + (hash || ''), { waitUntil: 'domcontentloaded' });
    return page;
  }
  const admin = user('admin', { vp: true, reatt: true, examiner: true, admin: true, lead: true, ss: true, super: true });
  let page = await open(admin);
  await page.waitForSelector('.hub-main');
  const homeText = await page.textContent('#app');
  check('главная админа: один следующий шаг, без стены всех разделов', /Внутренний устав/.test(homeText) && /Все курсы/.test(homeText) && /Админка/.test(homeText) && !/Премирование/.test(homeText) && !/Система повышения/.test(homeText) && (await page.locator('.tile-card').count()) === 0, homeText.slice(0, 240));
  const hrefs = await page.$$eval('#drawer .drawer-nav a', a => a.map(x => x.getAttribute('href')));
  check('шторка админа сохраняет прежние разделы', ['#/', '#/study', '#/reatt', '#/reports', '#/premiums', '#/promo', '#/docs', '#/people', '#/lead', '#/admin', '#/profile'].every(h => hrefs.includes(h)), hrefs.join(','));
  await page.screenshot({ path: '/tmp/ux-after/home-desktop.png' });
  await page.goto(SITE + '#/admin', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hub-link');
  const adminText = await page.textContent('#app');
  check('админка: четыре задачи, без сводки из восьми цифр и без инструкции', /Проверка/.test(adminText) && /2 работ ждут/.test(adminText) && /Законы/.test(adminText) && !/Как наполнить сайт/.test(adminText) && !/попыток ждут проверки/.test(adminText));
  check('на сводке админки нет полной ленты всех подразделов', (await page.locator('.subnav a').count()) === 0);
  await page.screenshot({ path: '/tmp/ux-after/admin-desktop.png' });
  await page.goto(SITE + '#/admin/lectures', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.subnav');
  const sub = await page.$$eval('.subnav a', a => a.map(x => x.textContent));
  check('лекции: только группа «Учёба», законы не торчат в этой ленте', sub.join('|') === 'Курсы|Лекции|Экзамены', sub);
  await page.goto(SITE + '#/admin/laws', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.law-card');
  check('законы: карточка только у того, что ждёт решения, остальные строкой', (await page.locator('.law-card').count()) === 1 && /Без расхождений/.test(await page.textContent('#app')) && /УК/.test(await page.textContent('.law-rest')));
  await page.screenshot({ path: '/tmp/ux-after/laws-desktop.png' });
  const mob = await open(admin, '#/admin', { width: 390, height: 844 });
  await mob.waitForSelector('.hub-link');
  await mob.screenshot({ path: '/tmp/ux-after/admin-mobile.png' });
  await mob.close();
  await page.click('a.law-card');
  await page.waitForFunction(() => /Процессуальный кодекс/.test(document.body.textContent));
  check('глубокая ссылка карточки закона открывается', /Процессуальный кодекс/.test(await page.textContent('#app')));
  await page.close();

  const vp = user('candidate', { vp: true, reatt: false, examiner: false, admin: false, lead: false, ss: false, super: false });
  page = await open(vp, '', { width: 390, height: 844 });
  await page.waitForSelector('.hub-main');
  const vpHrefs = await page.$$eval('#drawer .drawer-nav a', a => a.map(x => x.getAttribute('href')));
  check('ВП: в шторке учёба и служба, без админки и переаттестации', vpHrefs.includes('#/study') && vpHrefs.includes('#/reports') && !vpHrefs.includes('#/admin') && !vpHrefs.includes('#/reatt'), vpHrefs.join(','));
  check('телефон: главный шаг на всю ширину, без горизонтального скролла', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1 && document.querySelector('.hub-main').getBoundingClientRect().width > 280));
  await page.screenshot({ path: '/tmp/ux-after/home-mobile.png' });
  await page.goto(SITE + '#/admin');
  await page.waitForSelector('.alert, h1');
  check('ВП не входит в админку по прямой ссылке', /Недостаточно прав/.test(await page.textContent('#app')));
  await page.close();

  const none = user('candidate', { vp: false, reatt: false, examiner: false, admin: false, lead: false, ss: false, super: false });
  page = await open(none);
  await page.waitForSelector('.hub-main');
  const noneHrefs = await page.$$eval('#drawer .drawer-nav a', a => a.map(x => x.getAttribute('href')));
  check('без ролей шторка: Главная, База данных, Профиль', JSON.stringify(noneHrefs) === JSON.stringify(['#/', '#/docs', '#/profile']), noneHrefs.join(','));
  check('без ролей главный шаг — база данных', /База данных/.test(await page.textContent('.hub-main')));
  await page.close();

  // медленный ответ: сначала «Открываю…», чужой ответ не затирает новую страницу
  page = await open(admin);
  await page.waitForSelector('.hub-main');
  await page.route('**://localhost:8787/api/courses', async route => { await new Promise(r => setTimeout(r, 700)); await route.fulfill({ contentType: 'application/json', body: JSON.stringify(courses) }); });
  const t0 = Date.now();
  await page.evaluate(() => document.querySelector('a[href="#/study"]').click());
  await page.waitForSelector('.loading');
  const shown = Date.now() - t0;
  check('при задержке сети сразу виден статус «Открываю…»', shown < 400, shown);
  await page.evaluate(() => document.querySelector('a.brand').click());
  await page.waitForSelector('.hub-main');
  await page.waitForTimeout(900);
  check('ушедший запрос курса не затирает главную', /Внутренний устав/.test(await page.textContent('.hub-main')) && !/Система званий/.test(await page.textContent('#app')));
  await page.close();
  await browser.close();
  srv.kill();
  const failed = results.filter(x => !x.ok);
  console.log(failed.length ? 'FAILED ' + failed.length : 'ALL PASS');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
