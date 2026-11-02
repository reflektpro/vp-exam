// Контент переаттестаций v2 (миграция 0017): у каждого вопроса баз — документ проекта, пункт и цитата, найденная в тексте документа;
// размеры баз совпадают с content/reatt6/bases.json; проверка привязки без ошибок; прежние виды переведены на базы; пробные выборки
// всех 6 видов полные. Только API (без браузера). Запуск: bash /tmp/reset.sh (чистая БД со всеми миграциями), node e2e-reatt6-content.js
const fs = require('fs'), path = require('path');
const API = 'http://localhost:8787', ROOT = path.join(__dirname, '..');
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 700) : '')); };
async function call(method, p, token, body) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + p, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch (_) {}
  return { status: r.status, d };
}
const sql = async (q, args) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args }) })).json()).results;
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„'’`*_#>|]/g, '').replace(/[–—−‑]/g, '-').replace(/[\u00a0\s]+/g, ' ').replace(/\s*-\s*/g, '-').trim();
(async () => {
  const A = (await (await fetch(`${API}/__test/login?id=417660389723996170&name=admin`)).json()).token;
  const exp = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/reatt6/bases.json'), 'utf8')).bases;
  const rows = await sql("SELECT id, ext_id, type, kind, base, difficulty, source_doc, source_ref, text, options, data, active FROM questions WHERE ext_id LIKE 'r6-%' AND active = 1");
  const old = await sql("SELECT COUNT(*) AS c FROM questions WHERE ext_id LIKE 'r6-%' AND active = 0");
  check('прежние версии изменённых вопросов отключены (active = 0), а не удалены — старые попытки не ломаются', old[0].c > 0, old);
  const docsDir = path.join(ROOT, 'content/reatt6/docs');
  const docIds = fs.readdirSync(docsDir).map(f => f.replace(/\.md$/, ''));
  const docN = Object.fromEntries(docIds.map(d => [d, norm(fs.readFileSync(path.join(docsDir, d + '.md'), 'utf8'))]));
  check('загружено вопросов баз = сумма bases.json', rows.length === Object.values(exp).reduce((s, b) => s + b.total, 0), rows.length);
  for (const [b, e] of Object.entries(exp)) {
    const m = rows.filter(r => r.base === b);
    check(`база ${b}: ${e.total} вопросов, сложность ${e.d[1]}/${e.d[2]}/${e.d[3]}`, m.length === e.total && [1, 2, 3].every(d => m.filter(r => r.difficulty === d).length === e.d[d]), m.length);
  }
  const bad = { doc: [], ref: [], quote: [], ext: [], diff: [] };
  for (const r of rows) {
    const d = JSON.parse(r.data || '{}'); const q = d.meta && d.meta.quote;
    if (!docN[r.source_doc]) bad.doc.push(r.ext_id);
    if (!String(r.source_ref || '').trim()) bad.ref.push(r.ext_id);
    if (![1, 2, 3].includes(r.difficulty)) bad.diff.push(r.ext_id);
    if (r.kind !== 'case' && !q) bad.quote.push(r.ext_id);
    if (q && docN[r.source_doc]) {
      const s = String(q); let parts = /^\s*«/.test(s) ? [...s.matchAll(/«([^»]+)»/g)].map(m => m[1]) : [];
      if (!parts.length) parts = [s];
      parts = parts.flatMap(p => p.split(/…|\.\.\.|\n/)).map(x => x.trim()).filter(x => norm(x).length >= 8);
      if (!parts.length || !parts.every(p => docN[r.source_doc].includes(norm(p)))) bad.quote.push(r.ext_id);
    }
    if (/https?:\/\//i.test(r.text + JSON.stringify(d.meta || {}))) bad.ext.push(r.ext_id);
  }
  check('у каждого вопроса — документ проекта (файл в content/reatt6/docs)', !bad.doc.length, bad.doc);
  check('у каждого вопроса — пункт/статья', !bad.ref.length, bad.ref);
  check('у каждого вопроса — сложность 1/2/3', !bad.diff.length, bad.diff);
  check('у каждого вопроса (кроме кейсов) — цитата, дословно найденная в документе', !bad.quote.length, bad.quote);
  check('нет внешних источников (ссылок) в тексте и пояснениях', !bad.ext.length, bad.ext);
  check('все документы баз — из перечня SOURCE_DOCS (16, с УПК)', docIds.length === 16 && docIds.includes('upk'));
  check('в базах есть вопросы по УПК (полная общая, полная ВП, средняя, общие кейсы)', ['full', 'vp', 'medium', 'cases_gen'].every(b => rows.some(r => r.base === b && r.source_doc === 'upk')), ['full', 'vp', 'medium', 'cases_gen'].map(b => rows.filter(r => r.base === b && r.source_doc === 'upk').length));
  // п. 5: в формулировках и вариантах нет ссылок на номера пунктов/статей (номер — только в source_ref / цитате)
  const { REF_RE } = require('../tools/reatt6/refre');
  const refBad = [];
  for (const r of rows) {
    if (r.kind === 'case') continue;
    const d = JSON.parse(r.data || '{}');
    const texts = [r.text, ...JSON.parse(r.options || '[]').map(o => o.text), ...(d.items || []).map(x => x.text), ...(d.pairs || []).flatMap(p => [p.l && p.l.text, p.r && p.r.text]), ...(d.distractors || []).map(x => x.text || x)];
    const hit = texts.find(t => typeof t === 'string' && REF_RE.test(t)); if (hit) refBad.push(r.ext_id + ': ' + hit.slice(0, 80));
  }
  check('нет ссылок на номера пунктов/статей в формулировках и вариантах (регэксп REF_RE)', !refBad.length, refBad.slice(0, 5));
  check('регэксп REF_RE ловит типовые ссылки', ['Что гласит п. 4.6 ВУ?', 'по ст. 62 УК', 'согласно ч. 2.3', 'пункт 2 устава', 'Статья 12.1'].every(t => REF_RE.test(t)) && !['Штраф 10 000 руб.', 'Губернатор ФО', '5 минут'].some(t => REF_RE.test(t)));
  // п. 3: правильный вариант не угадывается по длине
  const lenBad = [];
  for (const r of rows.filter(r => r.type === 'single' || r.type === 'multi')) {
    const o = JSON.parse(r.options), c = new Set(JSON.parse((await sql('SELECT correct FROM questions WHERE id = ?1', [r.id]))[0].correct));
    const R = o.filter(x => c.has(x.id)).map(x => x.text.length), Wl = o.filter(x => !c.has(x.id)).map(x => x.text.length); const av = a => a.reduce((x, y) => x + y, 0) / a.length;
    if (r.type === 'single' ? (R[0] > Math.max(...Wl) && R[0] > av(Wl) * 1.35 && R[0] - Math.max(...Wl) > 8) : (Math.min(...R) > Math.max(...Wl) && av(R) > av(Wl) * 1.35)) lenBad.push(r.ext_id);
  }
  check('правильные варианты не выделяются длиной (single и multi)', !lenBad.length, lenBad.slice(0, 5));
  const types = new Set(rows.map(r => r.type));
  check('в базах есть все механики: single, multi, number, match, order, text, blanks_select, blanks_input, find, hotspot, case',
    ['single', 'multi', 'number', 'match', 'order', 'text', 'blanks_select', 'blanks_input', 'find', 'hotspot', 'case'].every(t => types.has(t)), [...types]);
  const bs = rows.filter(r => r.type === 'blanks_select').map(r => JSON.parse(r.data).blanks);
  check('пропуски «из списка» — ровно 4 варианта', bs.length > 0 && bs.every(bl => bl.every(b => b.opts.length === 4)));
  for (const b of Object.keys(exp)) {
    const r = await call('GET', '/api/admin/bank/check?base=' + b, A);
    check(`проверка привязки базы ${b}: ошибок 0`, r.status === 200 && r.d.errors === 0, r.d && r.d.items && r.d.items.filter(x => x.issues.some(i => i.level === 'err')).slice(0, 3));
  }
  const list = (await call('GET', '/api/admin/reatt', A)).d.items;
  const K = (k) => list.find(x => x.key === k);
  for (const [k, base, count, mix] of [['simple', 'simple', 12, '50,50,0'], ['full', 'full', 28, '20,45,35'], ['cases', 'cases_gen', 16, '15,40,45']]) {
    const it = K(k);
    check(`прежний вид «${k}» переведён на базу ${base}: ${count} вопросов, ${mix}`, it && it.mode === 'bank' && it.cfg.base === base && it.cfg.count === count && it.cfg.mix.join() === mix && Array.isArray(it.groups) && it.groups.length > 0, it && { mode: it.mode, cfg: it.cfg });
  }
  for (const [k, n] of [['cases_int', 8], ['cases', 16], ['simple', 12], ['medium', 20], ['full', 28], ['full_vp', 30]]) {
    const r = await call('POST', `/api/admin/reatt/${K(k).id}/preview`, A, {});
    const ids = r.d.groups.flatMap(g => g.q.concat(g.c || []).map(x => x.id));
    check(`пробная выборка «${k}»: ${n} вопросов, без повторов, база не меньше попытки ×3`, r.d.total === n && new Set(ids).size === n && exp[K(k).cfg.base].total >= n * 3, { total: r.d.total, comp: r.d.comp });
    if (!['cases_int', 'cases'].includes(k)) for (let rep = 0; rep < 5; rep++) {
      const rr = rep ? await call('POST', `/api/admin/reatt/${K(k).id}/preview`, A, {}) : r;
      const ids2 = rr.d.groups.flatMap(g => g.q.concat(g.c || []).map(x => x.id));
      const ty = await sql(`SELECT type FROM questions WHERE id IN (${ids2.join(',')})`);
      const ns = ty.filter(x => x.type === 'single').length, nm = ty.filter(x => x.type === 'multi').length;
      if (rep === 0 || Math.abs(ns - nm) > 1) check(`«${k}»: вопросов с одним и с несколькими ответами поровну (${ns}/${nm})`, nm > 0 && Math.abs(ns - nm) <= 1, { ns, nm });
    }
  }
  const fail = results.filter(x => !x.ok).length;
  console.log(`\nИТОГО: ${results.length - fail}/${results.length} PASS`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
