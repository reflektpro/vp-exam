// Офлайн-бланки: галочка «баллы за недостающий пункт» с vp-exam-api, кэш без сети, те же три фона, PDF как раньше.
// Запуск: wrangler dev :8787, serve.js :8080, SITE_DIR=/workspace/vp_raport_offline PORT=8081 node serve.js.
const { chromium } = require('playwright');
const fs = require('fs');
const API = 'http://localhost:8787', OFF = 'http://localhost:8081/';
const SHOTS = process.env.SHOTS || '/tmp/offline-promo/'; fs.mkdirSync(SHOTS, { recursive: true });
const SUPER = '417660389723996170';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 400) : '')); };
const call = async (m, p, t, b) => { const h = {}; if (t) h.Authorization = 'Bearer ' + t; if (b !== undefined) h['Content-Type'] = 'application/json'; const r = await fetch(API + p, { method: m, headers: h, body: b !== undefined ? JSON.stringify(b) : undefined }); let d = null; try { d = await r.json(); } catch (_) {} return { status: r.status, d }; };
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;

(async () => {
  const A = await login(SUPER, 'Шерман Ассман');
  await call('PUT', '/api/me', A, { ic_name: 'Шерман Ассман', rank: 'Сержант', static_id: '100-001', position: 'Инспектор ВП' });
  await call('PUT', '/api/admin/settings', A, { promo_missing_points: false });
  const cfg = await call('GET', '/api/promo-config');
  check('сервер отдаёт настройку без входа', cfg.status === 200 && cfg.d.missing_points === false, cfg.d && cfg.d.missing_points);

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  async function open(tok, opts = {}) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    if (tok) await ctx.addInitScript(t => { localStorage.setItem('vpexam_token', t); }, tok);
    await ctx.route(/discord(app)?\.com/, rt => rt.abort());
    const p = await ctx.newPage();
    const st = { errs: [], bg: [] };
    p.on('pageerror', e => st.errs.push('js ' + e.message));
    p.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) st.errs.push('console ' + m.text()); });
    p.on('dialog', d => d.accept());
    p.on('request', q => { if (/\/assets\/bg\//.test(q.url())) st.bg.push(q.url()); });
    if (opts.offlinePromo) await ctx.route('**/api/promo-config**', rt => rt.abort());
    return { p, ctx, st };
  }
  const readyPromo = async (p) => {
    await p.waitForFunction(() => window.__vp && window.VP_ECO && window.VP_ECO.ready, null, { timeout: 15000 });
    await p.evaluate(() => window.VP_ECO.ready);
    await p.waitForTimeout(200);
  };
  const calc = (p) => p.evaluate(() => {
    const c = window.__vp.crit, t = c.total, n = c.n;
    c.total = () => 1000; c.n = () => 0;
    const r = window.__vp.compute();
    c.total = t; c.n = n;
    return { covered: r.covered, met: r.met, rank: r.rank, swap: window.VP_ECO.missingPoints };
  });
  const fillForm = async (p) => {
    await p.fill('#fromRank', 'Сержант');
    await p.fill('#fromStatic', '100-001');
    await p.fill('#fromName', 'Шерман Ассман');
    await p.fill('#fromUnit', 'Батальон военной полиции');
    await p.fill('#fromPos', 'Инспектор ВП');
    await p.fill('#fromDate', '2026-01-01');
    await p.evaluate(() => { const fr = document.getElementById('fromRank'); fr.dispatchEvent(new Event('input', { bubbles: true })); });
  };

  let s = await open(A);
  await s.p.goto(OFF + 'povyshenie.html', { waitUntil: 'domcontentloaded' });
  await readyPromo(s.p);
  await fillForm(s.p);
  let r = await calc(s.p);
  check('выключено: недостающие пункты баллами не закрываются', r.rank === 'Сержант' && r.covered === 0 && r.met === false && r.swap === false, r);
  const note = await s.p.locator('#critNote').textContent();
  check('выключено: текст без замены пунктов баллами', /Не хватает/.test(note) && !/можно заменить/.test(note), note);
  const fx = await s.p.evaluate(() => {
    const ph = document.querySelector('.scene-photo'), v = document.querySelector('.scene-veil');
    const s1 = getComputedStyle(ph), s2 = getComputedStyle(v);
    return {
      bg: document.documentElement.dataset.bg,
      variant: document.documentElement.dataset.bgVariant,
      img: s1.backgroundImage,
      filter: s1.filter + '|' + s1.backdropFilter + '|' + s2.backdropFilter,
      paper: getComputedStyle(document.querySelector('.paper, .pv-page, .preview')).backgroundColor
    };
  });
  check('фон — один из трёх кадров сайта ГУ ВП', ['kremlin', 'formation', 'tanks'].includes(fx.bg) && fx.img.includes('/assets/bg/' + fx.bg + '-d.webp'), fx);
  check('затемнение без размытия на весь экран', fx.filter === 'none|none|none' && await s.p.locator('.scene-veil').count() === 1, fx.filter);
  check('запрошен только выбранный кадр', s.st.bg.length === 1 && s.st.bg[0].includes(fx.bg + '-d.webp'), s.st.bg);
  check('ошибки в консоли на рапорте нет', s.st.errs.length === 0, s.st.errs);
  const cache = await s.p.evaluate(() => JSON.parse(localStorage.getItem('vp_promo_config') || 'null'));
  check('настройка сохранена в браузере', cache && cache.missing_points === false, cache);
  await s.ctx.close();

  // без сети берётся кэш (настройка остаётся выключенной)
  s = await open(A, { offlinePromo: true });
  await s.p.addInitScript(() => { localStorage.setItem('vp_promo_config', JSON.stringify({ missing_points: false, custom: false, config: null })); });
  await s.p.goto(OFF + 'povyshenie.html', { waitUntil: 'domcontentloaded' });
  await readyPromo(s.p);
  await fillForm(s.p);
  r = await calc(s.p);
  check('без сети: кэш держит выключенную настройку', r.covered === 0 && r.swap === false, r);
  await s.ctx.close();

  // включаем обратно — расчёт как раньше
  await call('PUT', '/api/admin/settings', A, { promo_missing_points: true });
  s = await open(A);
  await s.p.goto(OFF + 'povyshenie.html', { waitUntil: 'domcontentloaded' });
  await readyPromo(s.p);
  await fillForm(s.p);
  r = await calc(s.p);
  check('включено: недостающие пункты закрываются баллами', r.covered === 3 && r.met === true && r.swap === true, r);
  check('включено: текст о замене пунктов на месте', /закрыты лишними баллами|можно заменить|Все критерии выполнены/.test(await s.p.locator('#critNote').textContent()), await s.p.locator('#critNote').textContent());

  const dlp = s.p.waitForEvent('download', { timeout: 30000 }).catch(() => null);
  await s.p.click('#pdf');
  const file = await dlp;
  let pdfOk = false, pdfName = file && file.suggestedFilename();
  if (file) {
    const dest = SHOTS + 'promo.pdf';
    await file.saveAs(dest);
    const buf = fs.readFileSync(dest);
    pdfOk = buf.slice(0, 5).toString() === '%PDF-' && buf.length > 2000;
  }
  check('PDF скачивается как раньше', !!file && /\.pdf$/i.test(pdfName || '') && pdfOk, pdfName);
  check('рапорт: ошибок нет', s.st.errs.length === 0, s.st.errs);
  await s.ctx.close();

  // остальные страницы: фон и без ошибок
  for (const page of ['index.html', 'otchet.html', 'vygovor.html', 'ugolovnoe.html', 'gajd.html']) {
    const x = await open(A);
    await x.p.goto(OFF + page, { waitUntil: 'domcontentloaded' });
    await x.p.waitForTimeout(800);
    const ok = await x.p.evaluate(() => {
      const el = document.querySelector('.scene-photo');
      const img = el ? getComputedStyle(el).backgroundImage : '';
      return { bg: document.documentElement.dataset.bg, has: /assets\/bg\/(kremlin|formation|tanks)-(d|m)\.webp/.test(img) };
    });
    check('фон на ' + page, ok.has && ['kremlin', 'formation', 'tanks'].includes(ok.bg), ok);
    check('ошибок нет на ' + page, x.st.errs.length === 0, x.st.errs);
    await x.ctx.close();
  }

  await browser.close();
  const fail = results.filter(x => !x.ok).length;
  fs.writeFileSync(__dirname + '/e2e-offline-promo-results.json', JSON.stringify(results, null, 1));
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
