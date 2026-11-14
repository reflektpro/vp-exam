// Схемы в лекциях и выгрузках: блоки «```схема» собраны из content/schemes/*.svg, SVG безопасны и лёгкие, на сайте
// схемы видны на ПК и 390 px, без горизонтальной прокрутки и без лишних запросов; safeSvg вырезает опасное.
// Запуск: bash /tmp/reset.sh; node tools/content/build.js; node tools/content/apply-local.js; node tests/e2e-lecture-schemes.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const ROOT = path.join(__dirname, '..');
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 600) : '')); };
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, args) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args }) })).json()).results;
// те же правила, что у sanitizeSvg воркера (вопросы), плюс белый список элементов
const BAD = (s) => /<\s*(script|foreignobject|iframe|object|embed|image|a|animate\w*|set|style|link|meta|use)\b/i.test(s) || /\son[a-z]+\s*=/i.test(s) || /<!(entity|doctype)/i.test(s)
  || /(?:xlink:)?href\s*=/i.test(s) || /url\s*\(/i.test(s) || /javascript:/i.test(s);
const FENCE = /^```схема (.+)\n(<svg[^\n]*<\/svg>)\n```$/mg;
(async () => {
  // 1. исходники
  const files = fs.readdirSync(ROOT + '/content/schemes').filter(f => f.endsWith('.svg'));
  check('схем в content/schemes: 15', files.length === 15, files);
  for (const f of files) { const s = fs.readFileSync(ROOT + '/content/schemes/' + f, 'utf8').trim();
    check(`${f}: svg ≤ 8 КБ, без опасных элементов, только рисование`, s.length <= 8192 && /^<svg[\s>]/.test(s) && /<\/svg>$/.test(s) && !BAD(s)
      && [...s.matchAll(/<([a-z]+)/g)].every(m => ['svg', 'g', 'rect', 'circle', 'path', 'text'].includes(m[1])), s.length); }
  const used = new Set();
  for (const slug of fs.readdirSync(ROOT + '/content')) { const f = ROOT + `/content/${slug}/vygruzka.md`; if (!fs.existsSync(f)) continue;
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/^::([a-z0-9-]+)$/mg)) used.add(m[1]); }
  check('каждая схема вставлена в выгрузку, ссылок на несуществующие нет', used.size === files.length && files.every(f => used.has(f.replace('.svg', ''))), [...used]);
  const B = JSON.parse(fs.readFileSync(ROOT + '/content/build/content.json', 'utf8'));
  const lecs = []; let docFig = 0;
  for (const t of B) { docFig += [...t.doc.body.matchAll(FENCE)].length;
    for (const l of t.lectures) { const n = [...l.body.matchAll(FENCE)].length; if (n) lecs.push({ slug: t.slug, title: l.title, n, body: l.body }); } }
  check('в сборке: 12 схем в 10 лекциях, 15 — в выгрузках (3 из них только в выгрузке СУ)', lecs.length === 10 && lecs.reduce((a, l) => a + l.n, 0) === 12 && docFig === 15, { lecs: lecs.map(l => l.slug + ':' + l.n), docFig });
  check('в сборке нет незакрытых или пустых блоков схем', B.every(t => [t.doc.body, ...t.lectures.map(l => l.body)].every(b => (b.match(/^```схема/mg) || []).length === [...b.matchAll(FENCE)].length)));
  // 2. база: лекции с схемами
  const rows = await sql("SELECT l.id, l.title, l.body, t.slug FROM lectures l JOIN topics t ON t.id = l.topic_id WHERE l.body LIKE '%```схема%' ORDER BY l.position");
  check('в базе 10 лекций со схемами, тексты совпадают со сборкой', rows.length === 10 && rows.every(r => lecs.some(l => l.title === r.title && l.body === r.body)), rows.map(r => r.title));
  // 3. сайт
  const uid = '840000000000000077'; const T = await login(uid, 'vp_schemes', 'vp');
  for (const l of await sql('SELECT id, duration_sec FROM lectures')) await sql('INSERT OR REPLACE INTO lecture_progress (user_id, lecture_id, max_pos, last_pos, watched_sec, last_hb_at, started_at, completed_at) VALUES (?1, ?2, ?3, ?3, ?3, ?4, ?4, ?4)', [uid, l.id, l.duration_sec, Date.now()]);
  const b = await chromium.launch({ args: ['--no-sandbox'] }); const errs = []; let minFont = 99, extra = [];
  for (const vp of [{ width: 1300, height: 900 }, { width: 390, height: 800 }]) {
    const ctx = await b.newContext({ viewport: vp, locale: 'ru-RU' }); await ctx.addInitScript(t => localStorage.setItem('vpexam_token', t), T);
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    page.on('request', r => { if (/\.svg|\/schemes\/|\/media\//.test(r.url()) && !/\/assets\//.test(r.url())) extra.push(r.url()); });
    let allOk = true, bad = [];
    for (const r of rows) {
      const exp = lecs.find(l => l.title === r.title).n;
      await page.goto(SITE + '#/lecture/' + r.id); await page.waitForFunction(t => (document.querySelector('.lec-title') || {}).textContent === t && document.querySelector('.lecture-text'), r.title); await page.waitForTimeout(150);
      const st = await page.evaluate(() => { const box = document.querySelector('.lecture-text').getBoundingClientRect();
        const figs = [...document.querySelectorAll('.lecture-text figure.lec-fig')].map(f => { const s = f.querySelector('svg'), rb = s.getBoundingClientRect();
          const vb = s.viewBox.baseVal.width, k = rb.width / vb; const fs = Math.min(...[...s.querySelectorAll('text')].map(t => +t.getAttribute('font-size')));
          return { w: rb.width, h: rb.height, inBox: rb.left >= box.left - 1 && rb.right <= box.right + 1, cap: (f.querySelector('figcaption') || {}).textContent || '', font: fs * k }; });
        return { figs, ow: document.documentElement.scrollWidth - innerWidth }; });
      const ok = st.figs.length === exp && st.figs.every(f => f.w > 250 && f.h > 100 && f.inBox && f.cap.length > 10) && st.ow <= 1;
      st.figs.forEach(f => { minFont = Math.min(minFont, f.font); });
      if (!ok) { allOk = false; bad.push({ t: r.title, st }); }
    }
    check(`10 лекций: схемы видны, внутри текста, с подписью, без горизонтальной прокрутки (${vp.width})`, allOk, bad);
    const did = (await sql("SELECT doc_id FROM topics WHERE slug = 'su'"))[0].doc_id;
    await page.goto(SITE + '#/doc/' + did); await page.waitForTimeout(1200);
    const nd = await page.$$eval('.lecture-text figure.lec-fig svg', x => x.length);
    check(`выгрузка СУ: 8 схем (${vp.width})`, nd === 8, nd);
    if (vp.width === 390) await page.screenshot({ path: '/tmp/lsch/doc-su-390.png', fullPage: false });
    // safeSvg: опасное вырезается, битая разметка — схема не показывается
    const san = await page.evaluate(() => {
      const evil = '```схема Тест\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" onload="alert(1)"><script>alert(2)</script><style>*{}</style><a href="javascript:alert(3)"><rect width="5" height="5"/></a><foreignObject><div>x</div></foreignObject><image href="http://x/y.png"/><rect width="4" height="4" fill="url(http://x)" onclick="alert(4)"/><text x="1" y="5">&lt;b&gt;ok</text></svg>\n```';
      const out = md(evil); const broken = md('```схема Битая\n<svg><rect></svg>\n```'); const notsvg = md('```схема X\n<div onclick=1>x</div>\n```');
      return { out, broken, notsvg };
    });
    check(`safeSvg вырезает скрипты, обработчики, ссылки, стили, внешние ресурсы (${vp.width})`, /<figure class="lec-fig">/.test(san.out) && !/script|onload|onclick|<a[\s>]|href|style|foreignObject|image|url\(/i.test(san.out) && /<rect/.test(san.out) && /&lt;b&gt;ok/.test(san.out), san.out);
    check(`битая разметка и не-SVG не выводятся (${vp.width})`, san.broken === '' && san.notsvg === '', san);
    await ctx.close();
  }
  check('схемы встроены в текст: отдельных запросов за картинками нет', !extra.length, extra);
  check(`минимальный кегль текста схем на экране ≥ 8.5 px (${minFont.toFixed(1)} px)`, minFont >= 8.5, minFont);
  check('без JS-ошибок', !errs.length, errs); await b.close();
  const ok = results.filter(x => x.ok).length; console.log(`\nИТОГО: ${ok}/${results.length} PASS`);
  process.exit(ok === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
