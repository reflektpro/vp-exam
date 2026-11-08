// Прототип главной: локальный файл, без API и без боевого входа.
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const https = require('https');
const path = require('path');
const ROOT = path.join(__dirname, '..', 'prototype', 'console');
const SITE = 'http://127.0.0.1:8095/';
const FORMS = 'https://reflektpro.github.io/vp-raport-offline/';
const REPORT = 'https://reflektpro.github.io/vp-raport-offline/otchet.html';
const SHOT = '/tmp/console-proto';
const STAFF = ['Бланки', 'Учёба', 'Экзамены', 'Переаттестация', 'Отчёты', 'Премии', 'Повышение', 'База'];
const ADMIN = ['Люди и роли', 'Проверка', 'Курсы', 'Лекции', 'Конструктор', 'Банк вопросов', 'Доступ к тестам', 'Законодательство', 'Личные дела', 'Неделя', 'Нарушения', 'Бюджет', 'Состав', 'Журнал', 'Параметры', 'Изображения', 'Сводка баз', 'Таблицы выплат'];
const EMPLOYEE = ['Учёба', 'Экзамены', 'Переаттестация', 'Отчёты', 'Премии', 'Повышение', 'База'];
fs.mkdirSync(SHOT, { recursive: true });
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + String(extra).slice(0, 400) : '')); };
function head(url) {
  return new Promise((resolve, reject) => {
    const req = https.request(url, { method: 'HEAD' }, res => { resolve(res.statusCode); res.resume(); });
    req.on('error', reject);
    req.end();
  });
}
function labels(page) {
  return page.$$eval('.rail-item .label', ns => ns.map(n => n.textContent));
}
(async () => {
  const formsStatus = await head(FORMS);
  const reportStatus = await head(REPORT);
  check('сайт бланков отвечает', formsStatus === 200, formsStatus);
  check('бланк отчёта отвечает', reportStatus === 200, reportStatus);

  const srv = spawn('python3', ['-m', 'http.server', '8095', '--bind', '127.0.0.1'], { cwd: ROOT, stdio: 'ignore' });
  await new Promise(r => setTimeout(r, 300));
  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const hits = [];
  const bgHits = [];
  page.on('request', req => {
    const u = req.url();
    if (/\/bg\/[^/]+\.webp/.test(u)) bgHits.push(u);
    else if (!u.startsWith(SITE)) hits.push(u);
  });
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rail-item');
  check('заголовок документа', (await page.title()) === 'Прототип — ГУ ВП', await page.title());
  const body = await page.textContent('body');
  check('на экране нет пометок прогона и фикстур', !/ДЕМО|фикстур|не боевой|#\//i.test(body), body.slice(0, 180));
  check('у плиток нет вторичных подписей', await page.locator('.rail-item small, .hint, .demo-flag, .colophon, #sheet, .lead, .meta').count() === 0);
  const staffLabels = await labels(page);
  check('лента сотрудника', staffLabels.join('|') === STAFF.join('|'), staffLabels.join('|'));
  check('у сотрудника нет подписи «неделя»', !staffLabels.some(t => /неделя/i.test(t)));
  const formsTile = await page.getAttribute('#sec-forms', 'href');
  const formsHead = await page.getAttribute('#formsLink', 'href');
  check('плитка бланков ведёт на сайт бланков', formsTile === FORMS, formsTile);
  check('шапка ведёт на сайт бланков', formsHead === FORMS, formsHead);
  check('бланки открываются в новой вкладке', (await page.getAttribute('#formsLink', 'target')) === '_blank' && /noopener/.test(await page.getAttribute('#formsLink', 'rel') || ''));
  const bgReqs = () => bgHits.slice();
  check('загружается один фон', bgReqs().length === 1, bgReqs().join(' '));
  const bg0 = await page.evaluate(() => document.documentElement.dataset.bg);
  const image0 = await page.evaluate(() => getComputedStyle(document.querySelector('.scene-photo')).backgroundImage);
  await page.click('#sec-reports');
  check('отчёты остаются отдельным разделом', (await page.locator('[aria-selected="true"] .label').textContent()) === 'Отчёты');
  const reportHref = await page.getAttribute('.act', 'href');
  check('заполнить отчёт ведёт на бланк недели', reportHref === REPORT, reportHref);
  check('действие отчёта — обычная ссылка, без текста успеха', (await page.getAttribute('.act', 'target')) === '_blank' && !/сохран|принят|одобр|ДЕМО/.test(await page.textContent('body')));
  await page.click('#sec-premiums');
  check('премии без подписи и без листа успеха', (await page.locator('.stage:visible, #stage:not([hidden])').count()) === 0 && !/неделя|ДЕМО|сохран/.test((await page.locator('#stage').textContent()) || ''));
  await page.focus('#sec-premiums');
  await page.keyboard.press('Enter');
  check('Enter по разделу не сообщает о сохранении', !/сохран|принят|одобр|отправлен/.test(await page.textContent('#stage') || ' ') && (await page.locator('[aria-selected="true"] .label').textContent()) === 'Премии');
  const bg1 = await page.evaluate(() => document.documentElement.dataset.bg);
  check('фон не меняется при выборе раздела', bg0 === bg1 && bgReqs().length === 1, bg0 + ' -> ' + bg1);
  await page.screenshot({ path: SHOT + '/desktop-staff.png' });

  await page.focus('#sec-study');
  await page.keyboard.press('ArrowRight');
  check('стрелка вправо выбирает экзамены', (await page.locator('[aria-selected="true"] .label').textContent()) === 'Экзамены');
  await page.click('#sec-reports');
  await page.focus('#sec-reports');
  await page.keyboard.press('ArrowDown');
  check('стрелка вниз ставит фокус на действие отчёта', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('act')));
  await page.keyboard.press('ArrowUp');
  check('стрелка вверх возвращает фокус на раздел', await page.evaluate(() => document.activeElement && document.activeElement.id === 'sec-reports'));

  await page.evaluate(() => {
    const s = document.createElement('div');
    s.id = 'scroll-probe';
    s.style.height = '1400px';
    document.body.appendChild(s);
  });
  const y0 = await page.evaluate(() => window.scrollY);
  await page.mouse.move(640, 700);
  await page.mouse.wheel(0, 500);
  await page.waitForFunction(() => window.scrollY > 40);
  check('вертикальное колесо листает страницу', (await page.evaluate(() => window.scrollY)) > y0);
  await page.evaluate(() => window.scrollTo(0, 0));
  const before = await page.locator('[aria-selected="true"] .label').textContent();
  const box = await page.locator('#rail').boundingBox();
  await page.mouse.move(box.x + 40, box.y + 30);
  await page.mouse.wheel(0, 220);
  await page.waitForTimeout(80);
  check('колесо над лентой не меняет раздел вертикалью', (await page.locator('[aria-selected="true"] .label').textContent()) === before);
  await page.waitForFunction(() => {
    window.scrollTo(0, 0);
    const top = document.getElementById('rail').getBoundingClientRect().top;
    return window.scrollY === 0 && top > 0 && top < 220;
  });
  const swipe = await page.locator('#rail').boundingBox();
  await page.mouse.move(swipe.x + swipe.width * 0.72, swipe.y + 36);
  await page.mouse.down();
  await page.mouse.move(swipe.x + swipe.width * 0.72 - 180, swipe.y + 30, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(80);
  check('горизонтальный жест меняет раздел', (await page.locator('[aria-selected="true"] .label').textContent()) !== before);
  const beforeChev = await page.locator('[aria-selected="true"] .label').textContent();
  await page.click('#chevR');
  check('кнопка следующего раздела работает', (await page.locator('[aria-selected="true"] .label').textContent()) !== beforeChev);

  const bar = await page.evaluate(() => {
    const rail = document.getElementById('rail');
    const cs = getComputedStyle(rail);
    return {
      scrollbarWidth: cs.scrollbarWidth,
      overflowX: cs.overflowX,
      delta: rail.scrollWidth - rail.clientWidth,
      pageDelta: document.documentElement.scrollWidth - window.innerWidth,
      scheme: getComputedStyle(document.documentElement).colorScheme
    };
  });
  check('у ленты нет серой полосы прокрутки', bar.scrollbarWidth === 'none' && bar.delta <= 1 && bar.pageDelta <= 1, JSON.stringify(bar));
  check('оформление тёмное', bar.scheme === 'dark', bar.scheme);

  await page.focus('#sec-docs');
  const staleId = await page.evaluate(() => document.activeElement.id);
  await page.click('.mode[data-mode="admin"]');
  await page.waitForSelector('#sec-users');
  const adminLabels = await labels(page);
  check('админ не показывает разделы сотрудника', EMPLOYEE.every(t => !adminLabels.includes(t)) && !adminLabels.includes('Бланки'), adminLabels.join('|'));
  check('лента администратора', adminLabels.join('|') === ADMIN.join('|'), adminLabels.join('|'));
  const firstBox = await page.locator('#sec-users').boundingBox();
  const focusInfo = await page.evaluate((stale) => {
    const el = document.activeElement;
    const node = document.getElementById(stale);
    const r = el ? el.getBoundingClientRect() : null;
    return {
      staleGone: !node,
      id: el && el.id,
      top: r ? r.top : -1,
      bottom: r ? r.bottom : -1,
      scroll: window.scrollY
    };
  }, staleId);
  check('фокус не остаётся на скрытом разделе сотрудника', focusInfo.staleGone && focusInfo.id === 'sec-users', JSON.stringify(focusInfo));
  check('первый инструмент администратора сразу виден', focusInfo.scroll === 0 && firstBox && firstBox.y >= 0 && firstBox.y < 700 && focusInfo.bottom > 0 && focusInfo.top < 800, JSON.stringify({ focusInfo, y: firstBox && firstBox.y }));
  check('шапка бланков остаётся у администратора', (await page.getAttribute('#formsLink', 'href')) === FORMS);
  const bgAdmin = await page.evaluate(() => document.documentElement.dataset.bg);
  check('фон не меняется при смене режима', bgAdmin === bg0 && bgReqs().length === 1, bgAdmin);
  await page.screenshot({ path: SHOT + '/desktop-admin.png' });
  check('наружу не ходим', hits.length === 0, hits.join(' '));

  const picked = await page.evaluate(() => ({
    zero: window.vpPickBackground(() => 0).id,
    high: window.vpPickBackground(() => 0.999).id,
    mid: window.vpPickBackground(() => 0.5).id,
    n: window.vpBackgrounds.length
  }));
  check('выбор фона детерминирован', picked.n === 4 && picked.zero === 'mp-nv-check' && picked.high === 'mp-sinai' && picked.mid === 'mp-mrzr', JSON.stringify(picked));

  await page.evaluate(() => document.getElementById('scroll-probe').remove());
  await page.click('.mode[data-mode="staff"]');
  const restored = await labels(page);
  const backFocus = await page.evaluate(() => document.activeElement && document.activeElement.id);
  check('сотрудник возвращает свои разделы', restored.join('|') === STAFF.join('|') && backFocus === 'sec-forms', restored.join('|') + ' ' + backFocus);

  const studyBox = await page.locator('#sec-study').boundingBox();
  const idleBg = await page.evaluate(() => getComputedStyle(document.querySelector('#sec-study')).backgroundColor);
  await page.mouse.move(studyBox.x + 12, studyBox.y + 12);
  await page.mouse.down();
  const downBg = await page.evaluate(() => getComputedStyle(document.querySelector('#sec-study')).backgroundColor);
  await page.mouse.up();
  check('нажатие плитки заметно', downBg !== idleBg, idleBg + ' -> ' + downBg);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rail-item');
  const dur = await page.evaluate(() => getComputedStyle(document.querySelector('.rail-item')).transitionDuration);
  check('reduced motion убирает анимацию', dur === '0s' || parseFloat(dur) === 0, dur);
  await context.close();

  async function seeded(value) {
    const ctx = await browser.newContext();
    await ctx.addInitScript(v => { Math.random = () => v; }, value);
    const p = await ctx.newPage();
    const seen = [];
    p.on('request', req => { if (/\/bg\/[^/]+\.webp$/.test(req.url())) seen.push(req.url()); });
    await p.goto(SITE, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.rail-item');
    const id = await p.evaluate(() => document.documentElement.dataset.bg);
    const image = await p.evaluate(() => getComputedStyle(document.querySelector('.scene-photo')).backgroundImage);
    await p.click('.mode[data-mode="admin"]');
    await p.click('#sec-laws');
    const later = await p.evaluate(() => document.documentElement.dataset.bg);
    await ctx.close();
    return { id, later, seen, image };
  }
  const a = await seeded(0.01);
  const b = await seeded(0.01);
  const c = await seeded(0.99);
  check('один и тот же жребий даёт один фон и не крутит его', a.id === 'mp-nv-check' && a.id === b.id && a.later === a.id && a.seen.length === 1, JSON.stringify({ a, b }));
  check('другой жребий может выбрать другой кадр', c.id === 'mp-sinai' && c.later === c.id && c.seen.length === 1 && !/quebec/.test(c.image), JSON.stringify(c));

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mobile.newPage();
  await mp.goto(SITE, { waitUntil: 'domcontentloaded' });
  await mp.waitForSelector('.rail-item');
  await mp.screenshot({ path: SHOT + '/mobile-staff.png' });
  const mb = await mp.locator('#rail').boundingBox();
  const hBefore = await mp.locator('[aria-selected="true"] .label').textContent();
  await mp.evaluate(({ x, y }) => {
    const rail = document.getElementById('rail');
    rail.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y, pointerId: 1 }));
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x - 120, clientY: y + 4, pointerId: 1 }));
  }, { x: mb.x + mb.width * 0.8, y: mb.y + 36 });
  check('телефон: сдвиг ленты меняет раздел', (await mp.locator('[aria-selected="true"] .label').textContent()) !== hBefore);
  await mp.click('.mode[data-mode="admin"]');
  await mp.waitForSelector('#sec-users');
  const mobileAdmin = await labels(mp);
  const mobileFocus = await mp.evaluate(() => {
    const el = document.activeElement;
    const r = el.getBoundingClientRect();
    return { id: el.id, top: r.top, bottom: r.bottom, scroll: window.scrollY, page: document.documentElement.scrollWidth - innerWidth };
  });
  const usersBox = await mp.locator('#sec-users').boundingBox();
  check('телефон: админ без разделов сотрудника', EMPLOYEE.every(t => !mobileAdmin.includes(t)), mobileAdmin.join('|'));
  check('телефон: первый инструмент сразу виден и в фокусе', mobileFocus.id === 'sec-users' && mobileFocus.scroll === 0 && usersBox.y >= 0 && usersBox.y < 700, JSON.stringify({ mobileFocus, y: usersBox && usersBox.y }));
  check('телефон: нет горизонтальной прокрутки страницы', mobileFocus.page <= 1, mobileFocus.page);
  await mp.screenshot({ path: SHOT + '/mobile-admin.png' });
  await mp.click('.mode[data-mode="staff"]');
  check('телефон: возврат к сотруднику', (await labels(mp)).join('|') === STAFF.join('|'));
  await mobile.close();
  await browser.close();
  srv.kill();
  const failed = results.filter(x => !x.ok);
  console.log(failed.length ? 'FAILED ' + failed.length : 'ALL PASS');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
