// Переаттестации v2: сборка баз вопросов из документов проекта.
// Источники: /workspace/vp_reatt_sources (уставы, законы — с цитатами), /workspace/vp_course_pk (банк курса ПК, ВП),
// content/reatt6/items/*.json (вопросы новых типов, составленные по документам). Каждый вопрос проверяется:
// документ есть в проекте, указан пункт/статья, цитата дословно найдена в тексте документа, у пропусков «из списка» — 4 варианта,
// правильный вариант не угадывается по длине. Не прошедшие — не попадают в базу (список — в content/reatt6/REPORT.md).
// Результат: content/reatt6/docs/*.md (копии документов), worker/migrations/0017_reatt6_content.sql, content/reatt6/bases.json, REPORT.md.
// Запуск: node tools/reatt6/build.js
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..');
const src = fs.readFileSync(path.join(ROOT, 'worker/worker.js'), 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '');
const W = new Function(src + '\nreturn { questionInput, lintQuestion, SOURCE_DOCS, R6_BASES, wordSet, nearDup };')();
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));
const SRC = '/workspace/vp_reatt_sources', PKC = '/workspace/vp_course_pk/questions.json';

// ---------- документы ----------
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„'’`*_#>|]/g, '').replace(/[–—−‑]/g, '-').replace(/[\u00a0\s]+/g, ' ').replace(/\s*-\s*/g, '-').trim();
const docText = {}, docNorm = {};
for (const [id, file] of Object.entries(CFG.docs)) {
  const t = fs.readFileSync(file, 'utf8');
  const out = path.join(ROOT, 'content/reatt6/docs', id + '.md');
  if (!fs.existsSync(out) || fs.readFileSync(out, 'utf8') !== t) fs.writeFileSync(out, t);
  docText[id] = t; docNorm[id] = norm(t);
}
for (const d of W.SOURCE_DOCS) if (!CFG.docs[d.id]) throw new Error('Нет файла документа ' + d.id);
const qstr = (q) => Array.isArray(q) ? q.join('\n') : String(q || '');
function quoteParts(q) {
  const s = qstr(q); let parts = /^\s*«/.test(s) ? [...s.matchAll(/«([^»]+)»/g)].map(m => m[1]) : [];
  if (!parts.length) parts = [s];
  return parts.flatMap(p => p.split(/…|\.\.\.|\[\.\.\.\]|\n/)).map(x => x.trim()).filter(x => norm(x).length >= 8);
}
function quoteOk(doc, q) { const ps = quoteParts(q); return ps.length > 0 && ps.every(p => docNorm[doc].includes(norm(p))); }

// ---------- распределение по базам ----------
const PAT = {
  ustav: { 1: ['simple', 'simple', 'medium', 'full'], 2: ['simple', 'medium', 'full', 'simple', 'medium', 'vp'], 3: ['vp', 'full', 'medium'] },
  core: { 1: ['medium', 'full'], 2: ['medium', 'full', 'full', 'vp'], 3: ['vp', 'full', 'vp', 'medium'] },
  other: { 1: ['full'], 2: ['full', 'full', 'vp'], 3: ['vp', 'full'] },
};
const groupOf = (doc) => ['vu', 'du', 'kps', 'su'].includes(doc) ? 'ustav' : ['uk', 'tk'].includes(doc) ? 'other' : 'core';
const D3 = { easy: 1, medium: 2, hard: 3, 'базовый': 1, 'средний': 2, 'сложный': 3 };
const SHORT = Object.fromEntries(W.SOURCE_DOCS.map(d => [d.id, d.short]));

const items = [], excluded = [], conflicts = [], missing = [];
const add = (it) => items.push(it);
const exclude = (id, why, extra) => excluded.push({ id, why, ...(extra || {}) });

const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/reatt6/fixes.json'), 'utf8')); const fixed = [];
// уставы
for (const doc of ['vu', 'du', 'kps', 'su']) {
  const d = JSON.parse(fs.readFileSync(`${SRC}/ustavy/${doc}.json`, 'utf8'));
  for (const q of d.questions) {
    const isCase = q.kind === 'case' || q.type === 'case';
    const base = { orig: q.ext_id, doc, ref: q.article || q.articles || '', quote: q.quote || '', explanation: q.explanation || '' };
    if (isCase) {
      const np = ((q.reference || '') + ' ' + (q.article || '')).match(/п\.\s*\d|пп\.\s*\d/g) || [];
      add({ ...base, kind: 'case', type: 'case', difficulty: np.length >= 5 ? 3 : np.length >= 3 ? 2 : 1, diff_note: 'по числу пунктов в эталоне',
        body: { type: 'case', kind: 'case', text: q.text, reference: q.reference, criteria: q.criteria } });
      continue;
    }
    const body = { type: q.type, text: q.text };
    if (q.options) { body.options = q.options; body.correct = q.correct; }
    if (FIX[q.ext_id]) { const f = FIX[q.ext_id]; body.options = Array.isArray(f) ? f : f.options; if (f.correct !== undefined) body.correct = f.correct; fixed.push(q.ext_id); }
    for (const k of ['pairs', 'distractors', 'items', 'answer', 'tolerance', 'unit']) if (q[k] !== undefined) body[k] = q[k];
    add({ ...base, kind: 'question', type: q.type, difficulty: D3[q.difficulty] || 2, body });
  }
}
// законы
for (const [doc, f] of Object.entries(CFG.law_files)) {
  const d = JSON.parse(fs.readFileSync(`${SRC}/laws/${f}.json`, 'utf8'));
  for (const q of d.questions) {
    const t = q.type === 'multiple' ? 'multi' : q.type;
    const body = { type: t, text: q.question };
    if (q.options) { body.options = q.options; body.correct = q.correct; }
    if (t === 'order' && q.options) { body.items = q.correct.map(i => q.options[i]); delete body.options; delete body.correct; }
    for (const k of ['pairs', 'distractors', 'answer', 'tolerance', 'unit']) if (q[k] !== undefined) body[k] = q[k];
    add({ orig: q.id, doc, ref: q.article || '', quote: q.quote || '', explanation: q.explanation || '', kind: 'question', type: t, difficulty: D3[q.difficulty] || 2, body });
  }
  for (const c of d.cases) {
    const crit = (c.criteria || []).map(x => typeof x === 'string' ? { text: x.replace(/\s*\((\d+)\s*балл\S*\)\s*$/, ''), points: +((x.match(/\((\d+)\s*балл/) || [])[1] || 1) } : x);
    add({ orig: c.id, doc, ref: [].concat(c.articles || c.article || []).join('; '), quote: c.quote || '', explanation: '', kind: 'case', type: 'case', difficulty: D3[c.difficulty] || 2,
      body: { type: 'case', kind: 'case', text: 'Ситуация: ' + c.situation + '\n\nВопрос: ' + c.question, reference: c.reference_answer, criteria: crit } });
  }
}
// банк курса ПК (ВП: задержание)
const pkc = JSON.parse(fs.readFileSync(PKC, 'utf8'));
for (const q of pkc.questions) {
  const doc = CFG.pkc_law[q.law];
  if (!doc) { exclude(q.id, `документ «${q.law}» не входит в перечень документов переаттестаций (УПК)`); continue; }
  const t = q.type === 'multiple' ? 'multi' : q.type;
  const body = { type: t, text: q.question };
  if (q.options) { body.options = q.options; body.correct = q.correct; }
  if (t === 'order' && q.options) { body.items = q.correct.map(i => q.options[i]); delete body.options; delete body.correct; }
  for (const k of ['pairs', 'distractors', 'answer', 'tolerance', 'unit']) if (q[k] !== undefined) body[k] = q[k];
  add({ orig: q.id, doc, ref: q.article || '', quote: q.quote || '', explanation: q.explanation || '', kind: 'question', type: t, difficulty: D3[q.difficulty] || 2, topic: q.topic, body, forceBase: 'vp' });
}
// собственные вопросы новых типов (уже с базой)
for (const f of fs.readdirSync(path.join(ROOT, 'content/reatt6/items')).filter(x => x.endsWith('.json')).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/reatt6/items', f), 'utf8'));
  for (const q of d.items || []) {
    const { id, base, difficulty, source_doc, source_ref, quote, explanation, topic, ...body } = q;
    add({ orig: id, topic, doc: source_doc, ref: source_ref, quote, explanation: explanation || '', kind: body.kind || (body.type === 'case' ? 'case' : 'question'), type: body.type, difficulty, body, forceBase: base, own: f });
  }
}
// резерв (вопросы, признанные неподходящими ранее)
let reserve = new Set();
try { const r = JSON.parse(fs.readFileSync(path.join(ROOT, 'content/bank-review/reserve.json'), 'utf8')); for (const x of (r.questions || r.items || r)) reserve.add(String(x.ext_id || x.id || x).replace(/-q0*/, '-q').toLowerCase()); } catch (_) {}

// ---------- проверка и распределение ----------
const counters = {};
const out = [];
const reserveHit = (orig) => { const k = String(orig).toLowerCase(); return [...reserve].some(r => r === k || r === k.replace(/-q0*/, '-q')); };
// вопросы, опирающиеся на противоречивые места документов (см. content/reatt6/GAPS.md) — не включаются
const CONFLICT = { 'fkz_rezhimy-c04': 'опирается на ФКЗ ч. 12.4, где противоречие: «указ Председателя Правительства» при введении Губернатором (ст. 11–12)' };
for (const it of items) {
  const id = it.orig;
  if (CONFLICT[id]) { exclude(id, 'конфликт в документе: ' + CONFLICT[id]); continue; }
  if (!it.forceBase && reserveHit(id)) { exclude(id, 'в резерве (content/bank-review/reserve.json) — не относится к службе'); continue; }
  if (!it.doc || !docNorm[it.doc]) { exclude(id, 'документ не загружен в проект: ' + it.doc); continue; }
  if (!it.ref) { exclude(id, 'не указан пункт/статья'); continue; }
  if (it.kind !== 'case' && !it.quote) { exclude(id, 'нет цитаты из документа'); continue; }
  if (it.quote && !quoteOk(it.doc, it.quote)) { exclude(id, 'цитата не найдена дословно в тексте документа', { doc: it.doc, ref: it.ref }); continue; }
  if (it.body.content) { // текст с пропусками / фрагмент для поиска — с правильными ответами должен дословно совпадать с документом
    const filled = it.body.content.replace(/\[\[([^\]]*)\]\]/g, (m, a) => { const alts = a.split('|'); return (alts.find(x => x.startsWith('*')) || alts[0]).replace(/^\*/, ''); });
    if (!quoteOk(it.doc, filled)) { exclude(id, 'текст с пропусками не совпадает с документом', { doc: it.doc, ref: it.ref }); continue; }
  }
  const grp = groupOf(it.doc);
  let base = it.forceBase;
  if (!base) {
    if (it.kind === 'case') base = grp === 'ustav' ? 'cases_int' : 'cases_gen';
    else { const k = grp + it.difficulty; counters[k] = (counters[k] || 0) + 1; const p = PAT[grp][it.difficulty]; base = p[(counters[k] - 1) % p.length]; }
  }
  let o;
  try {
    o = W.questionInput({ ...it.body, base, difficulty: it.difficulty, source_doc: it.doc, source_ref: it.ref, quote: it.quote ? qstr(it.quote).split('\n').map(x => x.trim()).filter(Boolean).join(' … ') : undefined, explanation: it.explanation || undefined,
      article: it.ref, category: 'Переаттестация: ' + W.R6_BASES[base], ext_id: 'r6-' + id, topic: it.topic ? 'r6-' + it.topic : undefined, active: true }, null);
  } catch (e) { exclude(id, 'не прошёл проверку формата: ' + e.message); continue; }
  const row = { id: 0, ...o, options: JSON.stringify(o.options), correct: JSON.stringify(o.correct), data: JSON.stringify(o.data) };
  const lint = W.lintQuestion(row).filter(x => x.level === 'err' || x.code === 'length_hint');
  if (lint.length) { exclude(id, lint.map(x => x.msg).join('; '), { doc: it.doc, ref: it.ref }); continue; }
  out.push({ o, it, base });
}
// почти одинаковые вопросы внутри базы — остаётся первый
const kept = []; const sets = [];
for (const x of out) {
  const ws = W.wordSet(x.o.text + ' ' + (x.o.data.content || ''));
  const dup = sets.find(s => s.base === x.base && s.doc === x.it.doc && W.nearDup(ws, s.ws));
  if (dup) { exclude(x.it.orig, `почти совпадает с ${dup.id} (та же база)`); continue; }
  sets.push({ base: x.base, doc: x.it.doc, ws, id: x.it.orig }); kept.push(x);
}

// ---------- SQL ----------
const q = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const NOW = 'CAST(strftime(\'%s\',\'now\') AS INTEGER) * 1000';
const lines = [
  '-- 0017: контент переаттестаций v2 (сгенерировано tools/reatt6/build.js — не править руками).',
  '-- Вопросы баз: только из документов проекта (content/reatt6/docs), у каждого — документ, пункт/статья и цитата (у кейсов — эталон с пунктами).',
  '-- Идемпотентно: вопрос вставляется, только если такого ext_id ещё нет. Прежние вопросы банка не меняются.',
  '-- Прежние виды (simple, full, cases) переводятся на выборку из своих баз; прежний состав блоков сохраняется в записи (можно вернуть в админке).',
];
let pos = 0;
for (const { o } of kept) {
  pos += 10;
  lines.push(`INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, topic, base, difficulty, source_doc, source_ref, created_at, updated_at) SELECT 0, ${q(o.type)}, ${q(o.text)}, ${q(JSON.stringify(o.options))}, ${q(JSON.stringify(o.correct))}, ${q(o.reference)}, ${o.points}, ${pos}, ${q(JSON.stringify(o.data))}, ${q(o.category)}, ${q(o.kind)}, 0, 1, ${q(o.ext_id)}, ${q(o.topic || null)}, ${q(o.base)}, ${o.difficulty}, ${q(o.source_doc)}, ${q(o.source_ref)}, ${NOW}, ${NOW} WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = ${q(o.ext_id)});`);
}
const cfg = (base, count, mix, extra) => JSON.stringify({ base, count, mix, pts: [1, 2, 3], topics: {}, types: [], max_topic_pct: 40, max_type_pct: 50, partial: 'question', pass_points: null, unique_ref: true, avoid_repeat: true, ...(extra || {}) });
lines.push(`UPDATE reattestations SET mode = 'bank', cfg = ${q(cfg('simple', 12, [50, 50, 0]))}, title = 'Переаттестация — упрощённая', description = 'Внутренние уставы: ВУ, ДУ, КПС, СУ. 12 вопросов, лёгкие и средние. Проверяется автоматически.', updated_at = ${NOW} WHERE key = 'simple' AND mode = 'groups';`);
lines.push(`UPDATE reattestations SET mode = 'bank', cfg = ${q(cfg('full', 28, [20, 45, 35], { max_topic_pct: 25 }))}, title = 'Переаттестация — полная общая', description = 'ТК, ФЗ, ФКЗ, КоАП, УК, ПК и внутренние уставы. 28 вопросов. Проверяется автоматически.', updated_at = ${NOW} WHERE key = 'full' AND mode = 'groups';`);
lines.push(`UPDATE reattestations SET mode = 'bank', cfg = ${q(cfg('cases_gen', 16, [15, 40, 45], { max_topic_pct: 25, max_type_pct: 0 }))}, title = 'Переаттестация по общим кейсам', description = 'Ситуационные задачи по законодательству (ПК, УК, КоАП, ТК, ФЗ, ФКЗ). Ответы проверяет экзаменатор по критериям.', updated_at = ${NOW} WHERE key = 'cases' AND mode = 'groups';`);
lines.push(`UPDATE reattestations SET cfg = ${q(cfg('cases_int', 8, [25, 50, 25], { max_topic_pct: 50, max_type_pct: 0 }))}, description = 'Ситуационные задачи по внутренним уставам (ВУ, ДУ, КПС, СУ). Ответы проверяет экзаменатор по критериям.', updated_at = ${NOW} WHERE key = 'cases_int' AND updated_at = created_at;`);
fs.writeFileSync(path.join(ROOT, 'worker/migrations/0017_reatt6_content.sql'), lines.join('\n') + '\n');

// ---------- отчёт ----------
const order = ['cases_int', 'cases_gen', 'simple', 'medium', 'full', 'vp'];
const stat = {};
for (const b of order) stat[b] = { total: 0, d: { 1: 0, 2: 0, 3: 0 }, types: {}, docs: {}, cases: 0 };
for (const { o } of kept) { const s = stat[o.base]; s.total++; s.d[o.difficulty]++; s.types[o.type] = (s.types[o.type] || 0) + 1; s.docs[SHORT[o.source_doc]] = (s.docs[SHORT[o.source_doc]] || 0) + 1; if (o.kind === 'case') s.cases++; }
fs.writeFileSync(path.join(ROOT, 'content/reatt6/bases.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), bases: stat, excluded: excluded.length }, null, 1));
const byWhy = {}; for (const e of excluded) { const k = e.why.replace(/ с .*$| \(.*$|: .*$/, ''); byWhy[k] = (byWhy[k] || 0) + 1; }
let rep = `# Переаттестации v2 — базы вопросов\n\nСгенерировано \`node tools/reatt6/build.js\`. Документы — \`content/reatt6/docs/\`.\n\n## Размеры баз\n\n| База | Всего | Лёгк. | Сред. | Сложн. | Кейсов (ручн.) | Типы | Документы |\n|---|---|---|---|---|---|---|---|\n`;
for (const b of order) { const s = stat[b]; rep += `| ${W.R6_BASES[b]} | ${s.total} | ${s.d[1]} | ${s.d[2]} | ${s.d[3]} | ${s.cases} | ${Object.entries(s.types).map(([k, v]) => k + ' ' + v).join(', ')} | ${Object.entries(s.docs).map(([k, v]) => k + ' ' + v).join(', ')} |\n`; }
rep += `\n## Не вошли в базы: ${excluded.length}\n\n${Object.entries(byWhy).sort((a, b) => b[1] - a[1]).map(([k, v]) => `- ${k}: ${v}`).join('\n')}\n\n<details><summary>Список</summary>\n\n${excluded.map(e => `- ${e.id}: ${e.why}${e.doc ? ` (${e.doc} ${e.ref || ''})` : ''}`).join('\n')}\n\n</details>\n`;
fs.writeFileSync(path.join(ROOT, 'content/reatt6/REPORT.md'), rep);
console.log(JSON.stringify(Object.fromEntries(order.map(b => [b, { total: stat[b].total, d: stat[b].d, cases: stat[b].cases }]))), '\nexcluded', excluded.length, byWhy);
