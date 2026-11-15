// E2E «Проверка рапортов на повышение»: сотрудник отправляет рапорт с портала (#/promo/raport) → руководство (#/lead/promo/:id)
// засчитывает/отклоняет пункты по одному (с количеством и комментарием), итог пересчитывается на месте, прокрутка и черновики
// сохраняются, кнопки блокируются на время запроса; замена пунктов баллами и обязательные курсы учитываются; итоговое решение.
// Запуск: bash /tmp/reset.sh (wrangler dev :8787 со всеми миграциями, serve.js :8080).
const { chromium } = require('playwright');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const SUPER = '417660389723996170', EMP = '500000000000000031', LEAD = '500000000000000039', OTHER = '500000000000000032';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 600) : '')); };
const call = async (m, p, t, b) => { const h = {}; if (t) h.Authorization = 'Bearer ' + t; if (b !== undefined) h['Content-Type'] = 'application/json'; const r = await fetch(API + p, { method: m, headers: h, body: b !== undefined ? JSON.stringify(b) : undefined }); let d = null; try { d = await r.json(); } catch (_) {} return { status: r.status, d }; };
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, a) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args: a }) })).json()).results;

(async () => {
  const A = await login(SUPER, 'Шерман Ассман');
  const U = await login(EMP, 'promo-emp', 'vp');
  const L = await login(LEAD, 'promo-lead', 'leader,vp');
  const O = await login(OTHER, 'promo-other', 'vp');
  await call('PUT', '/api/admin/users/' + EMP, A, { ic_name: 'Пётр Сидоров', rank: 'Сержант', static_id: '7788' });
  await call('PUT', '/api/admin/settings', A, { promo_missing_points: true });
  await call('PUT', '/api/promo/courses', A, { all: [], by_rank: {} });

  // ---------- API: права ----------
  check('без роли ВП рапорт не отправить', (await call('POST', '/api/promo/raports', await login('500000000000000033', 'nobody', 'none'), { header: {}, items: [] })).status === 403);
  check('сотрудник не видит список руководства', (await call('GET', '/api/lead/promo', U)).status === 403);
  check('мой рапорт: пока нет', (await call('GET', '/api/promo/raports/my', U)).d.raport === null);

  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const open = async (tok, w, h) => { const ctx = await b.newContext({ viewport: { width: w || 1400, height: h || 900 }, locale: 'ru-RU' }); await ctx.addInitScript(t => localStorage.setItem('vpexam_token', t), tok);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return p; };

  // ---------- 1. сотрудник отправляет рапорт с портала ----------
  const p = await open(U);
  await p.goto(SITE + '#/promo/raport'); await p.waitForSelector('#promoSend'); await p.waitForFunction(() => window.__vp && window.__vp.crit);
  check('портал: блок «Мой рапорт» — ещё не отправлялся', /ещё не отправлялся/.test(await p.textContent('#promoMine')));
  await p.fill('#fromUnit', 'Батальон военной полиции'); await p.fill('#target', 'Старший сержант'); await p.fill('#toDate', '2026-11-15');
  for (const id of ['#fromRank', '#fromStatic', '#fromName']) if (!(await p.inputValue(id))) await p.fill(id, id === '#fromRank' ? 'Сержант' : id === '#fromStatic' ? '7788' : 'Пётр Сидоров');
  if (await p.$('select#fromPos')) await p.selectOption('#fromPos', { index: 1 }); else await p.fill('#fromPos', 'Инспектор ВП');
  const setAct = async (key, n, links) => { const row = p.locator(`.act[data-key=${key}]`); if (links) { await row.locator('summary').click(); await row.locator('[data-links]').fill(links.join('\n')); } await row.locator('[data-n]').fill(String(n)); await row.locator('[data-n]').dispatchEvent('input'); };
  await setAct('training', 3, ['https://imgur.com/a/tr1']); await setAct('prof', 1, ['https://imgur.com/a/prof']); await setAct('naryad', 1, ['https://imgur.com/a/nar']); await setAct('guardhouse', 3, ['https://imgur.com/a/gh']);
  // блокировка кнопки на время запроса
  let release; const gate = new Promise(r => { release = r; });
  await p.route('**/api/promo/raports', async (route) => { await gate; await route.continue(); });
  await p.click('#promoSend');
  await p.waitForFunction(() => document.getElementById('promoSend').disabled);
  check('портал: кнопка «Отправить на проверку» заблокирована на время запроса', true);
  release(); await p.waitForFunction(() => /отправлен руководству/.test(document.getElementById('promoSendStatus').textContent), null, { timeout: 10000 });
  await p.unroute('**/api/promo/raports');
  check('портал: кнопка снова активна, карточка «Мой рапорт» обновилась на месте', !(await p.$eval('#promoSend', e => e.disabled)) && /Сержант → Старший сержант/.test(await p.textContent('#promoMine')) && /Отправлен/.test(await p.textContent('#promoMine')), await p.textContent('#promoMine'));
  const my = await call('GET', '/api/promo/raports/my', U);
  const RID = my.d.raport && my.d.raport.id;
  check('рапорт сохранён: 4 пункта, имя/звание из профиля, заявлено 30*3+30+75*3=345', my.d.raport && my.d.raport.items.length === 4 && my.d.raport.header.name === 'Пётр Сидоров' && my.d.raport.summary.claimed === 345 && my.d.raport.summary.points === 0, my.d.raport && my.d.raport.summary);
  check('чужой не видит рапорт сотрудника', (await call('GET', '/api/promo/raports/my', O)).d.raport === null && (await call('GET', '/api/lead/promo/' + RID, O)).status === 403);

  // ---------- 2. руководство: список и проверка по пунктам ----------
  const lp = await open(L, 1400, 700);
  await lp.goto(SITE + '#/lead/promo'); await lp.waitForSelector('tr[data-href]');
  check('руководство: рапорт в «Ждут решения»', /Пётр Сидоров/.test(await lp.textContent('#app')) && /Отправлен/.test(await lp.textContent('#app')));
  await lp.click('tr[data-href]'); await lp.waitForSelector('#sumCard');
  check('карточка: итог «не хватает», 0 баллов из 150', /не хватает/.test(await lp.textContent('#sumCard')) && /150/.test(await lp.textContent('#sumCard')));
  await lp.evaluate(() => { document.getElementById('sumCard').dataset.mark = '1'; document.querySelector('#rf textarea').value = 'черновик решения'; });
  const gh = lp.locator('.ritem[data-key=guardhouse]');
  await gh.locator('.icom').fill('черновик пункта');
  await lp.locator('.ritem[data-key=training] .icom').fill('ок, 2 из 3');
  await lp.locator('.ritem[data-key=training]').scrollIntoViewIfNeeded(); await lp.evaluate(() => window.scrollBy(0, 120));
  const topOf = () => lp.evaluate(() => Math.round(document.querySelector('.ritem[data-key=training]').getBoundingClientRect().top));
  let rel2; const g2 = new Promise(r => { rel2 = r; });
  await lp.route('**/api/lead/promo/*/review', async (route) => { await g2; await route.continue(); });
  await lp.locator('.ritem[data-key=training] .nok').fill('2');
  await lp.locator('.ritem[data-key=training] .i-ok').click();
  const dis = await lp.evaluate(() => [...document.querySelectorAll('.ritem[data-key=training] button')].every(b => b.disabled));
  check('пункт: кнопки заблокированы на время запроса', dis);
  await lp.evaluate(() => window.scrollBy(0, 60)); const y0 = await topOf(); // клик прокрутил к кнопке; сдвигаем ещё раз, пока запрос висит
  rel2(); await lp.waitForFunction(() => /засчитан \(2 из 3\)/.test(document.querySelector('.ritem[data-key=training]').textContent));
  await lp.unroute('**/api/lead/promo/*/review');
  const t1 = await topOf(); 
  const st1 = await lp.evaluate(() => ({ mark: document.getElementById('sumCard').dataset.mark, draft: document.querySelector('#rf textarea').value, gh: document.querySelector('.ritem[data-key=guardhouse] .icom').value, sum: document.getElementById('sumCard').textContent, badge: document.getElementById('prBadges').textContent }));
  check('пункт засчитан частично: страница не перерисована, прокрутка и черновики на месте', st1.mark === '1' && Math.abs(t1 - y0) < 3 && st1.draft === 'черновик решения' && st1.gh === 'черновик пункта', { ...st1, y0, t1 });
  check('итог на месте: 60 баллов, статус «На проверке»', /Баллы60150/.test(st1.sum.replace(/\s+/g, '')) && /На проверке/.test(st1.badge), st1.sum);
  // отклонить проф. пункт с комментарием
  await lp.locator('.ritem[data-key=prof] .icom').fill('нет доказательства');
  await lp.locator('.ritem[data-key=prof] .i-rej').click();
  await lp.waitForFunction(() => /отклонён/.test(document.querySelector('.ritem[data-key=prof]').textContent));
  // засчитать гауптвахту 3 и наряд
  await lp.locator('.ritem[data-key=guardhouse] .i-ok').click(); await lp.waitForFunction(() => /засчитан/.test(document.querySelector('.ritem[data-key=guardhouse] .row .badge').textContent));
  await lp.locator('.ritem[data-key=naryad] .i-ok').click(); await lp.waitForFunction(() => /засчитан/.test(document.querySelector('.ritem[data-key=naryad] .row .badge').textContent));
  let sum = (await lp.textContent('#sumCard')).replace(/\s+/g, ' ');
  check('замена включена: 60+225=285 баллов, проф. пункт закрыт баллами сверх нормы → критерии выполнены', /критерии выполнены/.test(sum) && /заменено: 1/.test(sum), sum);
  // решения сохраняются сразу: уйти и вернуться
  await lp.goto(SITE + '#/lead/promo'); await lp.waitForSelector('tr[data-href]'); await lp.goto(SITE + '#/lead/promo/' + RID); await lp.waitForSelector('#sumCard');
  check('после ухода и возврата отметки на месте', /засчитан \(2 из 3\)/.test(await lp.textContent('.ritem[data-key=training]')) && (await lp.inputValue('.ritem[data-key=prof] .icom')) === 'нет доказательства');
  // выключить замену пунктов баллами
  await call('PUT', '/api/admin/settings', A, { promo_missing_points: false });
  const off = await call('GET', '/api/lead/promo/' + RID, L);
  check('замена выключена: не хватает 1 обязательного пункта', off.d.raport.summary.met === false && off.d.raport.summary.left.items === 1 && off.d.raport.summary.missing_points === false, off.d.raport.summary);
  await call('PUT', '/api/admin/settings', A, { promo_missing_points: true });
  // обязательный курс
  const now = Date.now();
  await sql("INSERT INTO courses (title, description, position, published, created_at, updated_at) VALUES ('Курс для повышения', '', 98, 1, ?, ?)", [now, now]);
  const CID = (await sql("SELECT id FROM courses WHERE title='Курс для повышения'"))[0].id;
  await sql("INSERT INTO lectures (title, description, video_url, duration_sec, position, required, published, created_at, updated_at, course_id) VALUES ('Лекция повышения', '', '', 60, 1, 1, 1, ?, ?, ?)", [now, now, CID]);
  await call('PUT', '/api/promo/courses', A, { all: [], by_rank: { 'Сержант': [CID] } });
  await lp.reload(); await lp.waitForSelector('#sumCard');
  sum = (await lp.textContent('#sumCard')).replace(/\s+/g, ' ');
  check('обязательный курс не пройден → «не хватает: курс …»', /не хватает/.test(sum) && /Не хватает: курс «Курс для повышения»/.test(sum), sum);
  check('без курса новую версию рапорта не отправить (403)', (await call('POST', '/api/promo/raports', U, { header: { target: 'Старший сержант' }, items: [{ key: 'training', n: 1 }] })).status === 403);
  await call('PUT', '/api/promo/courses', A, { all: [], by_rank: {} });
  await lp.reload(); await lp.waitForSelector('#sumCard');
  // итоговое решение
  await lp.fill('#rf textarea', 'Поздравляем с повышением');
  await lp.click('#rf [data-st=approved]');
  await lp.waitForFunction(() => /Повышение одобрено/.test(document.getElementById('prBadges').textContent));
  check('решение: «Одобрить повышение», проверяющий указан', /Проверял: promo-lead/.test(await lp.textContent('#prReviewer')));
  await lp.screenshot({ path: '/tmp/promo-rev/lead.png', fullPage: true });

  // ---------- 3. сотрудник видит результат ----------
  await p.reload(); await p.waitForSelector('#promoMine'); await p.waitForFunction(() => window.__vp && window.__vp.crit);
  const mine = await p.textContent('#promoMine');
  check('сотрудник: одобрено, отметки и комментарии по пунктам видны', /Повышение одобрено/.test(mine) && /засчитан 2 из 3/.test(mine) && /нет доказательства/.test(mine) && /Поздравляем/.test(mine), mine);
  await p.screenshot({ path: '/tmp/promo-rev/emp.png', fullPage: true });
  const lst = await call('GET', '/api/lead/promo?status=approved', L);
  check('список «Одобрены» содержит рапорт', lst.d.raports.some(r => r.id === RID && r.points === 285));
  check('ошибок на страницах нет', !errs.length, errs);
  await b.close();
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
