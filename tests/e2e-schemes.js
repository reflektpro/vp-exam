// Вопросы по схемам (content/reatt6/items/schemes.json → миграция 0025): в базе, SVG проходит фильтр и лёгкий,
// зоны в пределах картинки, правильный ответ даёт полный балл, в браузере (телефон и ПК) схема видна, правильные зоны
// не перекрыты и нажимаются. Запуск: wrangler dev :8787 и serve.js :8080 на БД со всеми миграциями.
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const src = fs.readFileSync(path.join(__dirname, '../worker/worker.js'), 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '').replace(/^import .*$/gm, '');
const W = new Function(src + '\nreturn { publicQuestion, gradeAnswer, sanitizeSvg };')();
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 600) : '')); };
const sql = async (q, args) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args }) })).json()).results;
const SRC = JSON.parse(fs.readFileSync(path.join(__dirname, '../content/reatt6/items/schemes.json'), 'utf8')).items;
(async () => {
  const rows = await sql("SELECT * FROM questions WHERE exam_id = 0 AND ext_id LIKE 'r6-sch-%' AND active = 1 ORDER BY ext_id");
  check(`все вопросы по схемам в базе (${SRC.length})`, rows.length === SRC.length, rows.length);
  const by = {}; for (const r of rows) by[r.base] = (by[r.base] || 0) + 1;
  check('распределены по базам simple/medium/full/vp', ['simple', 'medium', 'full', 'vp'].every(b => by[b] > 0), by);
  const bad = [], heavy = [], zbad = [], grade = [], leak = [];
  for (const r of rows) {
    const d = JSON.parse(r.data);
    const svgs = (d.media || []).map(m => m.svg).concat(JSON.parse(r.options || '[]').filter(o => o.media).map(o => o.media.svg)).filter(Boolean);
    if (!svgs.length) bad.push(r.ext_id + ': нет схемы');
    for (const s of svgs) { try { W.sanitizeSvg(s); } catch (e) { bad.push(r.ext_id + ': ' + e.message); } if (s.length > 12000) heavy.push(r.ext_id + ' ' + s.length); }
    if (!d.meta || !d.meta.quote || !r.source_doc || !r.source_ref) bad.push(r.ext_id + ': нет цитаты/источника');
    const pub = W.publicQuestion(r, null);
    let ans;
    if (r.type === 'hotspot') {
      for (const z of d.zones) if (z.x < 0 || z.y < 0 || z.x + z.w > 100.01 || z.y + z.h > 100.01 || z.w < 3 || z.h < 3) zbad.push(r.ext_id + ' ' + z.label);
      if (pub.zones.some(z => /\D/.test(z.label)) || JSON.stringify(pub).includes('"correct"')) leak.push(r.ext_id);
      ans = d.zones.filter(z => z.correct).map(z => z.id);
      const all = d.zones.map(z => z.id); if (all.length > ans.length && W.gradeAnswer(r, null, all).ap >= r.points) grade.push(r.ext_id + ': все зоны дают полный балл');
    } else if (r.type === 'single') ans = JSON.parse(r.correct)[0];
    else if (r.type === 'match') { ans = {}; for (const p of d.pairs) ans[p.l.id] = p.r.id; if (JSON.stringify(pub).includes('"pairs"')) leak.push(r.ext_id); }
    const g = W.gradeAnswer(r, null, ans); if (!(g.ap === r.points)) grade.push(r.ext_id + ': правильный ответ — ' + g.ap + ' из ' + r.points);
  }
  check('SVG проходят фильтр безопасности, у каждого вопроса есть цитата и источник', !bad.length, bad);
  check('схемы лёгкие (до 12 КБ каждая)', !heavy.length, heavy);
  check('зоны внутри картинки и не мельче 3%', !zbad.length, zbad);
  check('кандидату не уходят правильные ответы и подписи зон', !leak.length, leak);
  check('правильный ответ — полный балл, «все зоны подряд» — нет', !grade.length, grade);

  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  for (const vp of [{ width: 390, height: 844, name: 'телефон' }, { width: 1280, height: 900, name: 'ПК' }]) {
    const p = await b.newPage({ viewport: { width: vp.width, height: vp.height } }); p.on('pageerror', e => errs.push(e.message));
    await p.goto(SITE); await p.waitForFunction(() => window.QT && window.QT.mount);
    const pubs = rows.map(r => ({ pub: W.publicQuestion(r, null), correct: r.type === 'hotspot' ? JSON.parse(r.data).zones.filter(z => z.correct).map(z => z.id) : null, ext: r.ext_id }));
    const res = await p.evaluate(async (list) => {
      const out = [];
      for (const { pub, correct, ext } of list) {
        document.body.innerHTML = '<main id="app" style="padding:8px"><div id="box"></div></main>';
        const box = document.getElementById('box'); const ctl = window.QT.mount(box, pub, null, () => {}, {});
        await new Promise(r => requestAnimationFrame(() => r()));
        const svgs = [...box.querySelectorAll('svg')]; const vis = svgs.length && svgs.every(s => { const r = s.getBoundingClientRect(); return r.width > 60 && r.height > 40; });
        const o = { ext, vis, ok: true, minZone: 999, overflow: document.documentElement.scrollWidth > innerWidth + 1 };
        if (pub.type === 'hotspot') {
          for (const id of correct) {
            const z = box.querySelector(`.hs-zone[data-id="${id}"]`); z.scrollIntoView({ block: 'center' }); const r = z.getBoundingClientRect();
            o.minZone = Math.min(o.minZone, r.width, r.height);
            const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
            if (!hit || hit.closest('.hs-zone') !== z) o.ok = false; else z.click();
          }
          const got = ctl.get() || []; o.ok = o.ok && got.length === correct.length && correct.every(x => got.includes(x)) && box.querySelectorAll('.hs-zone.on').length === correct.length;
        }
        out.push(o);
      }
      return out;
    }, pubs);
    check(`${vp.name}: все схемы видны`, res.every(x => x.vis), res.filter(x => !x.vis).map(x => x.ext));
    check(`${vp.name}: правильные зоны не перекрыты и нажимаются`, res.every(x => x.ok), res.filter(x => !x.ok).map(x => x.ext));
    check(`${vp.name}: без горизонтальной прокрутки`, res.every(x => !x.overflow), res.filter(x => x.overflow).map(x => x.ext));
    const mz = Math.min(...res.map(x => x.minZone)); check(`${vp.name}: правильные зоны не мельче ${vp.width < 500 ? 16 : 24} px (мин. ${Math.round(mz)})`, mz >= (vp.width < 500 ? 16 : 24));
    await p.close();
  }
  check('нет ошибок JS', !errs.length, errs);
  await b.close();
  const okN = results.filter(x => x.ok).length; console.log(`\nИТОГО: ${okN}/${results.length} PASS`);
  process.exit(okN === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
