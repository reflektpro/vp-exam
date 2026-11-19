// E2E «Порядок ступеней повышения»: в редакторе правил (#/promo?edit=1) кнопки ↑/↓ переставляют ступень, «Сохранить» — один запрос;
// пункты, баллы и критерии ступеней не меняются; «Система повышения» и офлайн-бланк (povyshenie.html, :8081) показывают новый порядок.
// Запуск: bash /tmp/reset.sh; офлайн-бланк — SITE_DIR=/workspace/vp_raport_offline PORT=8081 node serve.js (если не запущен — часть пропускается).
const { chromium } = require('playwright');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/', OFF = 'http://localhost:8081/';
const SUPER = '417660389723996170';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 600) : '')); };
const call = async (m, p, t, b) => { const h = {}; if (t) h.Authorization = 'Bearer ' + t; if (b !== undefined) h['Content-Type'] = 'application/json'; const r = await fetch(API + p, { method: m, headers: h, body: b !== undefined ? JSON.stringify(b) : undefined }); let d = null; try { d = await r.json(); } catch (e) {} return { status: r.status, d }; };
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const ranks = (c) => c.ladder.map(s => s.rank);
const norm = (c) => JSON.stringify(c.ladder.map(s => [s.rank, s.to, s.points, s.need]).sort());

(async () => {
  const A = await login(SUPER, 'Шерман Ассман');
  // как на проде до правки: «Сержант → Старший сержант» последней
  const d0 = (await call('GET', '/api/promo', A)).d;
  const lad = d0.config.ladder.filter(s => s.rank !== 'Сержант').concat(d0.config.ladder.filter(s => s.rank === 'Сержант'));
  const put = await call('PUT', '/api/promo', A, { points_per_item: d0.config.points_per_item, pts: d0.config.pts, ladder: lad });
  check('исходно: «Сержант» последней ступенью', put.status === 200 && ranks((await call('GET', '/api/promo', A)).d.config).pop() === 'Сержант', put.d);
  const before = (await call('GET', '/api/promo', A)).d.config;

  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ru-RU' });
  await ctx.addInitScript(t => localStorage.setItem('vpexam_token', t), A);
  const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept());
  await p.goto(SITE + '#/promo?edit=1'); await p.waitForSelector('#ladT .lrow');
  const rows = () => p.$$eval('#ladT .lrow .lr', a => a.map(i => i.value));
  check('редактор: у каждой ступени кнопки ↑ и ↓', (await p.$$('#ladT .lrow .lu')).length === before.ladder.length && (await p.$$('#ladT .lrow .ld')).length === before.ladder.length);
  const n = before.ladder.length;
  // ↑ у первой и ↓ у последней ничего не делают
  await p.locator('#ladT .lrow').first().locator('.lu').click(); await p.locator('#ladT .lrow').last().locator('.ld').click();
  check('↑ у первой и ↓ у последней — без изменений', JSON.stringify(await rows()) === JSON.stringify(ranks(before)));
  // поднять «Сержант» наверх: n-1 нажатий ↑
  for (let i = 0; i < n - 1; i++) await p.locator('#ladT .lrow', { has: p.locator('.lr[value="Сержант"]') }).locator('.lu').click();
  const want = ['Сержант'].concat(ranks(before).filter(r => r !== 'Сержант'));
  check('редактор: «Сержант» поднят наверх', JSON.stringify(await rows()) === JSON.stringify(want), await rows());
  let puts = 0; p.on('request', r => { if (r.method() === 'PUT' && r.url().endsWith('/api/promo')) puts++; });
  await p.click('#saveP'); await p.waitForFunction(() => location.hash === '#/promo'); await p.waitForSelector('.ladder');
  const after = (await call('GET', '/api/promo', A)).d.config;
  check('сохранено одним запросом', puts === 1, puts);
  check('сервер: новый порядок', JSON.stringify(ranks(after)) === JSON.stringify(want), ranks(after));
  check('ступени, баллы и критерии не изменились', norm(after) === norm(before) && JSON.stringify(after.pts) === JSON.stringify(before.pts) && after.points_per_item === before.points_per_item);
  const shown = await p.$$eval('.ladder .lstep b', a => a.map(x => x.textContent.split(' → ')[0].trim()));
  check('«Система повышения» показывает новый порядок', JSON.stringify(shown) === JSON.stringify(want), shown);
  // ↓ возвращает на одно место
  await p.goto(SITE + '#/promo?edit=1'); await p.waitForSelector('#ladT .lrow');
  await p.locator('#ladT .lrow').first().locator('.ld').click();
  check('↓ опускает ступень на одно место', (await rows())[1] === 'Сержант' && (await rows())[0] === want[1]);
  await p.goto(SITE + '#/promo'); // без сохранения
  check('без «Сохранить» порядок на сервере прежний', JSON.stringify(ranks((await call('GET', '/api/promo', A)).d.config)) === JSON.stringify(want));

  let offOk = false; try { offOk = (await fetch(OFF + 'povyshenie.html')).ok; } catch (e) {}
  if (offOk) {
    const op = await (await b.newContext()).newPage(); op.on('pageerror', e => errs.push('off ' + e.message));
    await op.goto(OFF + 'povyshenie.html'); await op.waitForFunction(() => window.__vp && window.PROMO);
    await op.waitForFunction((w) => JSON.stringify(Object.keys(window.PROMO.ladder)) === w, JSON.stringify(want), { timeout: 10000 }).catch(() => {});
    check('офлайн-бланк: ступени в новом порядке', JSON.stringify(await op.evaluate(() => Object.keys(window.PROMO.ladder))) === JSON.stringify(want), await op.evaluate(() => Object.keys(window.PROMO.ladder)));
  } else console.log('SKIP офлайн-бланк не запущен на :8081');
  // правила по умолчанию в бланке (без сети) — тоже «Сержант» первым
  const g = {}; new Function('window', require('fs').readFileSync(__dirname + '/../report/promo-rules.js', 'utf8'))(g);
  check('promo-rules.js: «Сержант» первой ступенью', Object.keys(g.PROMO.ladder)[0] === 'Сержант');
  check('без ошибок JS', !errs.length, errs);
  await b.close();
  const f = results.filter(r => !r.ok).length;
  console.log(`${results.length - f}/${results.length} PASS`);
  process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
