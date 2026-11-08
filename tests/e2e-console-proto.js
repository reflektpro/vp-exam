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
const STAFF = ['Учёба', 'Экзамены', 'Переаттестация', 'Отчёты', 'Бланки', 'Премии', 'Повышение', 'База'];
const ADMIN = ['Люди и роли', 'Проверка', 'Курсы', 'Лекции', 'Конструктор', 'Банк вопросов', 'Доступ к тестам', 'Законодательство', 'Личные дела', 'Неделя', 'Нарушения', 'Бюджет', 'Состав', 'Журнал', 'Параметры', 'Изображения', 'Сводка баз', 'Таблицы выплат'];
const EMPLOYEE = ['Учёба', 'Экзамены', 'Переаттестация', 'Отчёты', 'Премии', 'Повышение', 'База', 'Бланки'];
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
function railInfo(page) {
  return page.evaluate(() => {
    const rail = document.getElementById('rail');
    const cs = getComputedStyle(rail);
    const items = [...rail.querySelectorAll('.rail-item')];
    const top = items.length ? items[0].offsetTop : 0;
    const photo = getComputedStyle(document.querySelector('.scene-photo')).backgroundImage;
    return {
      wrap: cs.flexWrap,
      display: cs.display,
      scrollbar: cs.scrollbarWidth,
      overflowX: cs.overflowX,
      oneRow: items.every(el => el.offsetTop === top),
      overflow: rail.scrollWidth > rail.clientWidth + 8,
      pageDelta: document.documentElement.scrollWidth - window.innerWidth,
      bg: document.documentElement.dataset.bg,
      photo
    };
  });
}
(async () => {
  const bgFiles = fs.existsSync(path.join(ROOT, 'bg')) ? fs.readdirSync(path.join(ROOT, 'bg')).sort() : [];
  const allowedBg = ['formation-d.avif', 'formation-d.webp', 'formation-m.avif', 'formation-m.webp', 'kremlin-d.avif', 'kremlin-d.webp', 'kremlin-m.avif', 'kremlin-m.webp', 'tanks-d.avif', 'tanks-d.webp', 'tanks-m.avif', 'tanks-m.webp'];
  check('в папке фона только три переданных кадра', bgFiles.join('|') === allowedBg.join('|'), bgFiles.join('|'));
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
    if (/\/bg\//.test(u)) bgHits.push(u);
    else if (!u.startsWith(SITE)) hits.push(u);
  });
  await page.goto(SITE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rail-item');
  check('заголовок документа', (await page.title()) === 'Прототип — ГУ ВП', await page.title());
  const body0 = await page.textContent('body');
  check('нет пометок прогона и адресов', !/ДЕМО|фикстур|#\//i.test(body0));
  check('под плитками нет подписей', await page.locator('.rail-item small').count() === 0);
  check('лента сотрудника', (await labels(page)).join('|') === STAFF.join('|'), (await labels(page)).join('|'));
  let info = await railInfo(page);
  check('одна строка без переноса и без серой полосы', info.display === 'flex' && info.wrap === 'nowrap' && info.oneRow && info.scrollbar === 'none' && info.overflow && info.pageDelta <= 1, JSON.stringify(info));
  const allowedIds = ['kremlin', 'formation', 'tanks'];
  check('фон — один из трёх кадров', allowedIds.includes(info.bg) && info.photo.includes('/bg/' + info.bg + '-d.webp'), info.bg + ' ' + info.photo);
  const fx = await page.evaluate(() => {
    const s = getComputedStyle(document.querySelector('.scene-photo'));
    const v = getComputedStyle(document.querySelector('.scene-veil'));
    return s.filter + '|' + s.backdropFilter + '|' + v.backdropFilter;
  });
  check('размытие не считается на весь экран', fx === 'none|none|none', fx);
  check('запрошен только выбранный фон', bgHits.length === 1 && bgHits[0].includes(info.bg + '-d.webp'), bgHits.join(' '));
  check('шапка бланков', (await page.getAttribute('#formsLink', 'href')) === FORMS && (await page.getAttribute('#formsLink', 'target')) === '_blank');
  check('сразу видно, что внутри учёбы', (await page.textContent('h1')) === 'Учёба' && /лекции/.test(await page.textContent('.lead')) && /Открыть учебный отдел/.test(await page.textContent('.acts')));

  await page.click('#sec-reports');
  check('отчёты: заголовок и оба действия', (await page.textContent('h1')) === 'Отчёты' && /Заполнить отчёт/.test(await page.textContent('.acts')) && /Мои отчёты/.test(await page.textContent('.acts')));
  check('заполнить отчёт ведёт на бланк недели', (await page.getAttribute('.act[data-act="fill"]', 'href')) === REPORT);
  await page.click('.act[data-act="mine"]');
  check('мои отчёты не сообщают об успехе', !/сохран|одобр|отправлен|ДЕМО/.test(await page.textContent('#stage')) && (await page.getAttribute('.act[data-act="mine"]', 'aria-pressed')) === 'true');
  const seen = await page.evaluate(() => {
    const rail = document.getElementById('rail');
    const el = document.getElementById('sec-reports');
    const rr = rail.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return er.left >= rr.left - 2 && er.right <= rr.right + 2;
  });
  check('выбранная плитка в видимой части ленты', seen);
  await page.click('#sec-docs');
  await page.waitForFunction(() => {
    const rail = document.getElementById('rail');
    const el = document.getElementById('sec-docs');
    const rr = rail.getBoundingClientRect();
    const er = el.getBoundingClientRect();
    return er.left >= rr.left - 2 && er.right <= rr.right + 2;
  });
  check('дальняя плитка доезжает в видимую область', true);
  await page.click('#sec-reports');
  await page.screenshot({ path: SHOT + '/desktop-reports.png' });

  await page.focus('#sec-study');
  await page.keyboard.press('ArrowRight');
  check('стрелка вправо открывает экзамены', (await page.textContent('h1')) === 'Экзамены' && /К списку экзаменов/.test(await page.textContent('.acts')));
  await page.click('#sec-reports');
  await page.focus('#sec-reports');
  await page.keyboard.press('ArrowDown');
  check('стрелка вниз ставит фокус на действие', await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('act')));
  await page.keyboard.press('ArrowUp');
  check('стрелка вверх возвращает на плитку', await page.evaluate(() => document.activeElement && document.activeElement.id === 'sec-reports'));

  await page.evaluate(() => {
    const s = document.createElement('div');
    s.id = 'scroll-probe';
    s.style.height = '900px';
    document.body.appendChild(s);
  });
  const y0 = await page.evaluate(() => window.scrollY);
  await page.mouse.move(640, 640);
  await page.mouse.wheel(0, 400);
  await page.waitForFunction(() => window.scrollY > 20);
  check('вертикальное колесо листает страницу', (await page.evaluate(() => window.scrollY)) > y0);
  await page.evaluate(() => window.scrollTo(0, 0));
  const before = await page.textContent('h1');
  const box = await page.locator('#rail').boundingBox();
  await page.mouse.move(box.x + 30, box.y + box.height / 2);
  await page.mouse.wheel(0, 180);
  await page.waitForTimeout(60);
  check('колесо над лентой не меняет раздел', (await page.textContent('h1')) === before);
  await page.waitForFunction(() => {
    window.scrollTo(0, 0);
    const top = document.getElementById('rail').getBoundingClientRect().top;
    return window.scrollY === 0 && top > 0 && top < 240;
  });
  const swipe = await page.locator('#rail').boundingBox();
  const scrollOf = () => page.evaluate(() => document.getElementById('rail').scrollLeft);
  const y = swipe.y + swipe.height / 2;
  const x0 = swipe.x + swipe.width * 0.72;
  await page.mouse.move(x0, y);
  await page.mouse.down();
  await page.mouse.move(x0 - 180, y, { steps: 12 });
  const grabbing = await page.evaluate(() => document.getElementById('rail').classList.contains('is-grabbing'));
  await page.mouse.up();
  await page.waitForTimeout(40);
  const scrolledRight = await scrollOf();
  const headingAfterDrag = await page.textContent('h1');
  check('мышь тащит ленту вправо и не выбирает плитку', grabbing && scrolledRight > 80 && headingAfterDrag === before, scrolledRight + ' ' + headingAfterDrag);
  check('после протяжки нет залипшего захвата', await page.evaluate(() => !document.getElementById('rail').classList.contains('is-grabbing')));
  await page.mouse.move(x0 - 180, y);
  await page.mouse.down();
  await page.mouse.move(x0 - 40, y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(40);
  const scrolledBack = await scrollOf();
  check('обратное протягивание возвращает ленту влево', scrolledBack < scrolledRight - 60, scrolledRight + ' -> ' + scrolledBack);
  const beforeChev = await page.textContent('h1');
  await page.click('#chevR');
  check('кнопка следующего раздела работает', (await page.textContent('h1')) !== beforeChev);
  await page.evaluate(() => document.getElementById('scroll-probe').remove());

  const bgBefore = await page.evaluate(() => document.documentElement.dataset.bg);
  await page.focus('#sec-docs');
  const staleId = await page.evaluate(() => document.activeElement.id);
  await page.click('.mode[data-mode="admin"]');
  await page.waitForSelector('#sec-users');
  const focusInfo = await page.evaluate((stale) => {
    const el = document.activeElement;
    const r = el.getBoundingClientRect();
    return { staleGone: !document.getElementById(stale), id: el.id, top: r.top, bottom: r.bottom, scroll: window.scrollY, rail: document.getElementById('rail').scrollLeft };
  }, staleId);
  check('фокус на первом инструменте администратора', focusInfo.staleGone && focusInfo.id === 'sec-users' && focusInfo.scroll === 0 && focusInfo.rail === 0 && focusInfo.top >= 0 && focusInfo.top < 500, JSON.stringify(focusInfo));
  check('панель администратора объясняет раздел', (await page.textContent('h1')) === 'Люди и роли' && /Роли/.test(await page.textContent('.lead')));
  await page.screenshot({ path: SHOT + '/desktop-admin.png' });
  const adminLabels = await labels(page);
  check('админ без разделов сотрудника', EMPLOYEE.every(t => !adminLabels.includes(t)), adminLabels.join('|'));
  check('лента администратора', adminLabels.join('|') === ADMIN.join('|'), adminLabels.join('|'));
  const adminRail = await railInfo(page);
  check('админ тоже одна строка', adminRail.wrap === 'nowrap' && adminRail.oneRow && adminRail.overflow && adminRail.scrollbar === 'none', JSON.stringify(adminRail));
  const geom = await page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { w: Math.round(r.width), h: Math.round(r.height), pad: cs.padding, gap: cs.gap || '' };
    };
    const rail = document.getElementById('rail');
    const labelsOk = [...rail.querySelectorAll('.rail-item')].every(el => {
      const label = el.querySelector('.label');
      return label && label.scrollHeight <= label.clientHeight + 1 && label.textContent.length > 0;
    });
    return { nav: box(document.querySelector('.nav')), rail: box(rail), tile: box(rail.querySelector('.rail-item')), chev: box(document.querySelector('.chev')), labelsOk };
  });
  await page.click('.mode[data-mode="staff"]');
  const geomStaff = await page.evaluate(() => {
    const box = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return { w: Math.round(r.width), h: Math.round(r.height), pad: cs.padding };
    };
    const rail = document.getElementById('rail');
    return { nav: box(document.querySelector('.nav')), rail: box(rail), tile: box(rail.querySelector('.rail-item')), chev: box(document.querySelector('.chev')) };
  });
  check('у сотрудника и администратора одна геометрия ленты',
    geom.nav.w === geomStaff.nav.w && geom.nav.h === geomStaff.nav.h &&
    geom.rail.w === geomStaff.rail.w && geom.rail.h === geomStaff.rail.h &&
    geom.tile.w === geomStaff.tile.w && geom.tile.h === geomStaff.tile.h &&
    geom.tile.pad === geomStaff.tile.pad && geom.chev.w === geomStaff.chev.w && geom.chev.h === geomStaff.chev.h &&
    geom.labelsOk,
    JSON.stringify({ geom, geomStaff }));
  await page.click('.mode[data-mode="admin"]');
  await page.focus('#sec-users');
  for (let i = 0; i < 17; i++) await page.keyboard.press('ArrowRight');
  await page.waitForFunction(() => {
    const rail = document.getElementById('rail');
    return rail.scrollLeft > rail.scrollWidth - rail.clientWidth - 30;
  });
  const atEnd = await page.evaluate(() => Math.round(document.getElementById('rail').scrollLeft));
  await page.keyboard.press('ArrowLeft');
  await page.waitForFunction((end) => document.getElementById('rail').scrollLeft < end - 20, atEnd);
  const afterLeftKey = await page.evaluate(() => {
    const rail = document.getElementById('rail');
    const sel = document.querySelector('[aria-selected="true"]');
    const rr = rail.getBoundingClientRect();
    const er = sel.getBoundingClientRect();
    return { scroll: rail.scrollLeft, vis: er.left >= rr.left - 2 && er.right <= rr.right + 2, label: sel.textContent };
  });
  check('стрелка влево уводит ленту от правого края и оставляет плитку в кадре', afterLeftKey.scroll < atEnd - 20 && afterLeftKey.vis, JSON.stringify({ atEnd, afterLeftKey }));
  const beforeCancel = await page.evaluate(() => {
    const rail = document.getElementById('rail');
    rail.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: 500, clientY: 140, pointerId: 7 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 420, clientY: 140, pointerId: 7 }));
    return { grabbing: rail.classList.contains('is-grabbing'), scroll: rail.scrollLeft };
  });
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, clientX: 420, clientY: 140, pointerId: 7 }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 200, clientY: 140, pointerId: 7 }));
  });
  const afterCancel = await page.evaluate(() => ({
    grabbing: document.getElementById('rail').classList.contains('is-grabbing'),
    scroll: document.getElementById('rail').scrollLeft
  }));
  check('отмена указателя снимает захват', beforeCancel.grabbing && !afterCancel.grabbing && afterCancel.scroll === beforeCancel.scroll, JSON.stringify({ beforeCancel, afterCancel }));
  check('фон не сменился', (await page.evaluate(() => document.documentElement.dataset.bg)) === bgBefore && bgHits.length === 1, bgHits.join(' '));
  check('наружу не ходим', hits.length === 0, hits.join(' '));
  const gone = await page.evaluate(async () => (await fetch('bg/mp-mrzr.webp')).status);
  check('старый файл фона не отдаётся', gone === 404, gone);

  await page.click('.mode[data-mode="staff"]');
  check('сотрудник возвращается', (await labels(page)).join('|') === STAFF.join('|') && (await page.evaluate(() => document.activeElement.id)) === 'sec-study' && (await page.textContent('h1')) === 'Учёба');

  const studyBox = await page.locator('#sec-exams').boundingBox();
  const idleBg = await page.evaluate(() => getComputedStyle(document.querySelector('#sec-exams')).backgroundColor);
  await page.mouse.move(studyBox.x + 12, studyBox.y + 12);
  await page.mouse.down();
  const downBg = await page.evaluate(() => getComputedStyle(document.querySelector('#sec-exams')).backgroundColor);
  await page.mouse.up();
  check('нажатие плитки заметно', downBg !== idleBg, idleBg + ' -> ' + downBg);

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.rail-item');
  const dur = await page.evaluate(() => getComputedStyle(document.querySelector('.rail-item')).transitionDuration);
  check('reduced motion убирает анимацию', dur === '0s' || parseFloat(dur) === 0, dur);
  check('после перезагрузки фон снова из трёх', allowedIds.includes(await page.evaluate(() => document.documentElement.dataset.bg)));
  const picked = await page.evaluate(() => ({
    zero: window.vpPickBackground(() => 0).id,
    mid: window.vpPickBackground(() => 0.5).id,
    high: window.vpPickBackground(() => 0.999).id
  }));
  check('порядок кадров: Кремль, построение, техника', picked.zero === 'kremlin' && picked.mid === 'formation' && picked.high === 'tanks', JSON.stringify(picked));
  await context.close();

  async function seeded(value, width) {
    const ctx = await browser.newContext({ viewport: { width, height: width > 700 ? 800 : 844 } });
    await ctx.addInitScript(v => { Math.random = () => v; }, value);
    const p = await ctx.newPage();
    const seen = [];
    p.on('request', req => { if (/\/bg\//.test(req.url())) seen.push(req.url()); });
    await p.goto(SITE, { waitUntil: 'domcontentloaded' });
    await p.waitForSelector('.rail-item');
    const id = await p.evaluate(() => document.documentElement.dataset.bg);
    await p.click('.mode[data-mode="admin"]');
    await p.click('#sec-laws');
    const later = await p.evaluate(() => document.documentElement.dataset.bg);
    const variant = await p.evaluate(() => document.documentElement.dataset.bgVariant);
    await ctx.close();
    return { id, later, seen, variant };
  }
  const sameA = await seeded(0.01, 1280);
  const sameB = await seeded(0.01, 1280);
  const other = await seeded(0.99, 1280);
  const phone = await seeded(0.01, 390);
  check('один жребий держит один кадр', sameA.id === 'kremlin' && sameA.id === sameB.id && sameA.later === sameA.id && sameA.seen.length === 1 && sameA.variant === 'd' && /kremlin-d\.webp/.test(sameA.seen[0]), JSON.stringify(sameA));
  check('другой жребий может выбрать технику', other.id === 'tanks' && other.later === other.id && other.seen.length === 1 && /tanks-d\.webp/.test(other.seen[0]), JSON.stringify(other));
  check('узкий экран берёт мобильный кроп и только его', phone.id === 'kremlin' && phone.variant === 'm' && phone.seen.length === 1 && /kremlin-m\.webp/.test(phone.seen[0]), JSON.stringify(phone));

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const mp = await mobile.newPage();
  await mp.goto(SITE, { waitUntil: 'domcontentloaded' });
  await mp.waitForSelector('.rail-item');
  const mobileRail = await railInfo(mp);
  check('телефон: одна строка', mobileRail.wrap === 'nowrap' && mobileRail.oneRow && mobileRail.overflow && mobileRail.pageDelta <= 1, JSON.stringify(mobileRail));
  check('телефон: кадр из трёх, узкий вариант', allowedIds.includes(mobileRail.bg) && mobileRail.photo.includes(mobileRail.bg + '-m.webp'), mobileRail.bg + ' ' + mobileRail.photo);
  await mp.screenshot({ path: SHOT + '/mobile-staff.png' });
  const mb = await mp.locator('#rail').boundingBox();
  const touch = async (x1, x2) => {
    const y = mb.y + mb.height / 2;
    await mp.evaluate(({ x1, x2, y }) => {
      const rail = document.getElementById('rail');
      rail.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x1, clientY: y, pointerId: 3, pointerType: 'touch' }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x2, clientY: y, pointerId: 3, pointerType: 'touch' }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: x2, clientY: y, pointerId: 3, pointerType: 'touch' }));
    }, { x1, x2, y });
  };
  await touch(mb.x + mb.width * 0.8, mb.x + mb.width * 0.8 - 110);
  const touchRight = await mp.evaluate(() => document.getElementById('rail').scrollLeft);
  await touch(mb.x + 40, mb.x + 140);
  const touchLeft = await mp.evaluate(() => document.getElementById('rail').scrollLeft);
  check('телефон: сдвиг вправо и обратно двигает ленту', touchRight > 40 && touchLeft < touchRight - 30, touchRight + ' -> ' + touchLeft);
  await mp.click('.mode[data-mode="admin"]');
  await mp.waitForSelector('#sec-users');
  const mobileAdmin = await labels(mp);
  const mobileFocus = await mp.evaluate(() => {
    const el = document.getElementById('sec-users');
    const rail = document.getElementById('rail');
    const er = el.getBoundingClientRect();
    const rr = rail.getBoundingClientRect();
    return { id: document.activeElement.id, scroll: window.scrollY, rail: rail.scrollLeft, inView: er.left >= rr.left - 2 && er.right <= rr.right + 2, page: document.documentElement.scrollWidth - innerWidth };
  });
  check('телефон: админ без разделов сотрудника', EMPLOYEE.every(t => !mobileAdmin.includes(t)));
  check('телефон: первый инструмент виден', mobileFocus.id === 'sec-users' && mobileFocus.scroll === 0 && mobileFocus.rail === 0 && mobileFocus.inView && mobileFocus.page <= 1, JSON.stringify(mobileFocus));
  await mp.screenshot({ path: SHOT + '/mobile-admin.png' });
  await mobile.close();
  await browser.close();
  srv.kill();
  const failed = results.filter(x => !x.ok);
  console.log(failed.length ? 'FAILED ' + failed.length : 'ALL PASS');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
