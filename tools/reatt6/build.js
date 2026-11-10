// Переаттестации v2: сборка баз вопросов из документов проекта.
// Источники: /workspace/vp_reatt_sources (уставы, законы — с цитатами), /workspace/vp_course_pk (банк курса ПК, ВП),
// content/reatt6/items/*.json (вопросы новых типов, составленные по документам). Каждый вопрос проверяется:
// документ есть в проекте, указан пункт/статья, цитата дословно найдена в тексте документа, у пропусков «из списка» — 4 варианта,
// правильный вариант не угадывается по длине. Не прошедшие — не попадают в базу (список — в content/reatt6/REPORT.md).
// Поверх исходных наборов: content/reatt6/fixes.json (варианты уставов), content/reatt6/overrides/*.json (переписанные вопросы: варианты
// сопоставимой длины, single → multi, формулировки без номеров пунктов), content/reatt6/items/*.json (свои вопросы, в т. ч. УПК).
// В тексте вопроса и вариантах не должно быть ссылок на номера пунктов/статей (номер — только в source_ref, показывается после ответа).
// Результат: worker/migrations/<MIG> (по умолчанию 0018_reatt6_v3.sql — только новые/изменённые вопросы + выключение устаревших),
// content/reatt6/registry.json (какая версия каждого вопроса уже в базе), quotes.json (цитаты для tools/update_laws.py), bases.json, REPORT.md.
// 0017 (первичная загрузка) не перегенерируется. Запуск: node tools/reatt6/build.js [--mig 0019_name.sql] [--baseline]
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../..');
const src = fs.readFileSync(path.join(ROOT, 'worker/worker.js'), 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '').replace(/^import .*$/gm, '');
const W = new Function(src + '\nreturn { questionInput, lintQuestion, SOURCE_DOCS, R6_BASES, wordSet, nearDup };')();
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, 'sources.json'), 'utf8'));
const SRC = '/workspace/vp_reatt_sources', PKC = '/workspace/vp_course_pk/questions.json';

// ---------- документы ----------
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[«»"“”„'’`*_#>|]/g, '').replace(/[–—−‑]/g, '-').replace(/[\u00a0\s]+/g, ' ').replace(/\s*-\s*/g, '-').trim();
const docText = {}, docNorm = {};
// content/reatt6/docs/<id>.md — канонические тексты (обновляются python3 tools/update_laws.py --apply с forum.rmrp.ru)
for (const [id, file] of Object.entries(CFG.docs)) {
  const t = fs.readFileSync(path.isAbsolute(file) ? file : path.join(ROOT, file), 'utf8');
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
const ARGV = process.argv.slice(2); const BASELINE = ARGV.includes('--baseline'); const DRY = ARGV.includes('--dry');   // --dry: не писать миграцию и registry
const MIG = (ARGV[ARGV.indexOf('--mig') + 1] && ARGV.includes('--mig')) ? ARGV[ARGV.indexOf('--mig') + 1] : '0018_reatt6_v3.sql';
// переписанные вопросы: content/reatt6/overrides/*.json → { "<orig id>": { text?, options?, correct?, type?, base?, difficulty?, items?, pairs?, drop? } }
const OVR = {}; const OVR_DIR = path.join(ROOT, 'content/reatt6/overrides');
if (!BASELINE && fs.existsSync(OVR_DIR)) for (const f of fs.readdirSync(OVR_DIR).filter(x => x.endsWith('.json')).sort()) {
  const d = JSON.parse(fs.readFileSync(path.join(OVR_DIR, f), 'utf8'));
  for (const [k, v] of Object.entries(d)) { if (k.startsWith('_')) continue; OVR[k] = { ...(OVR[k] || {}), ...v, _files: [...((OVR[k] || {})._files || []), f] }; }
}
const ovrUsed = new Set(), ovrStat = {};
function applyOvr(it) {
  const p = OVR[it.orig]; if (!p) return;
  ovrUsed.add(it.orig); for (const f of p._files) ovrStat[f] = (ovrStat[f] || 0) + 1;
  if (p.drop) { it.drop = p.drop; return; }
  if (p.type) { it.type = p.type; it.body.type = p.type; if (p.type !== 'order') delete it.body.items; }
  for (const k of ['text', 'options', 'correct', 'items', 'pairs', 'distractors', 'answer', 'tolerance', 'unit', 'content', 'accepted', 'reference', 'criteria']) if (p[k] !== undefined) it.body[k] = p[k];
  if (p.replace) for (const [a, b] of p.replace) {   // точечная замена (перенумерация пунктов в источнике, эталоне кейса)
    const r = (v) => typeof v === 'string' ? v.split(a).join(b) : v;
    it.ref = r(it.ref); it.body.reference = r(it.body.reference); it.explanation = r(it.explanation);
  }
  if (p.base) it.forceBase = p.base;
  if (p.difficulty) it.difficulty = p.difficulty;
  if (p.quote) it.quote = p.quote;
  if (p.ref) it.ref = p.ref;
  if (p.explanation) it.explanation = p.explanation;
  it.ovr = true;
}
// ---------- ссылки на номера пунктов/статей в формулировках ----------
// Регэксп проверки (тот же — в tests/e2e-reatt6-content.js и tests/reatt6-unit.js): вопрос должен проверять смысл, а не номер.
const { REF_RE } = require('./refre');   // ссылки на номера пунктов/статей (тот же шаблон — в тесте e2e-reatt6-content.js)
const DOCAB = '(?:настоящего\\s+Устава|ВУ|ДУ|УКПС|КПС|СУ|ПК|УПК|УК|КоАП|ТК|ФКЗ|ФЗ(?:\\s*«[^»]+»)?|Устава|Кодекса|Закона|Приложения\\s*№\\s*\\d+)';
const RTOK = '(?:(?:пп?|подп|ч|ст|гл|разд|абз)\\.\\s*«?[\\dа-я][\\dа-я.\\-–]*»?|(?:пункт|подпункт|стать|част|глав|раздел|примечани)\\p{L}*\\s+(?:№\\s*)?«?\\d[\\d.\\-–]*»?(?:\\s*\\([^)]*\\))?|№\\s*\\d+)';
const RSEQ = `${RTOK}(?:\\s*(?:,|и|или|–|-|—)?\\s*${RTOK})*`;
function stripRefs(t) {
  if (!t || typeof t !== 'string') return t;
  let s = t;
  s = s.replace(new RegExp(`\\s*\\(\\s*(?:см\\.\\s*)?(?:${RSEQ})(?:\\s*,?\\s*${DOCAB})?\\s*\\)`, 'giu'), '');            // «(п. 4.6)», «(ст. 7 ПК)»
  s = s.replace(new RegExp(`(?:,\\s*)?(${RSEQ})(\\s+)(${DOCAB})`, 'giu'), (m, a, sp, d) => (m.startsWith(',') ? ', ' : '') + d);  // «по ч. 7.1 ст. 7 ПК» → «по ПК»
  s = s.replace(new RegExp(`\\s*\\(\\s*${DOCAB}\\s*,?\\s*(?:${RSEQ})\\s*\\)`, 'gu'), '');                                    // «(ВУ, п. 4.3)»
  const W_ = (a) => new RegExp('(?<!\\p{L})' + a + '(?!\\p{L})', 'gu');
  s = s.replace(W_('(по|согласно) устава'), '$1 уставу').replace(W_('(в|во) устава'), 'в уставе').replace(W_('(установлен\\p{L}*|предусмотрен\\p{L}*) устава'), '$1 уставом')
    .replace(W_('(в|во) Устава'), 'в Уставе').replace(W_('по Устава'), 'по Уставу').replace(W_('из устава'), 'из устава');
  s = s.replace(/\s{2,}/g, ' ').replace(/\s+([?.,:;])/g, '$1').trim();
  return s;
}
const hasRef = (t) => typeof t === 'string' && REF_RE.test(t);
function refTexts(b) {
  const out = [b.text];
  for (const o of b.options || []) out.push(typeof o === 'string' ? o : o && o.text);
  for (const x of b.items || []) out.push(typeof x === 'string' ? x : x && x.text);
  for (const p of b.pairs || []) { out.push(Array.isArray(p) ? p[0] : p.left || p.l); out.push(Array.isArray(p) ? p[1] : p.right || p.r); }
  for (const x of b.distractors || []) out.push(typeof x === 'string' ? x : x && x.text);
  return out.filter(x => typeof x === 'string');
}
const refFixed = [];
function fixRefs(it) {
  const b = it.body; let changed = false; it.t0 = b.text;
  const f = (v) => { const n = stripRefs(v); if (n !== v) changed = true; return n; };
  b.text = f(b.text);
  // варианты ответа автоматически не правятся: номер в варианте — это и есть проверяемый ответ, такие вопросы переписаны вручную (overrides)
  if (changed) refFixed.push(it.orig);
}
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
  if (!doc || (BASELINE && doc === 'upk')) { exclude(q.id, `документ «${q.law}» не входит в перечень документов переаттестаций (УПК)`); continue; }
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
const REG_PATH = path.join(ROOT, 'content/reatt6/registry.json');
const REG = BASELINE || !fs.existsSync(REG_PATH) ? { items: {} } : JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));
const refLeft = [];
for (const it of items) {
  const id = it.orig;
  applyOvr(it);
  if (it.drop) { exclude(id, 'исключён при переработке: ' + it.drop, { doc: it.doc, ref: it.ref }); continue; }
  if (!BASELINE && it.kind !== 'case') fixRefs(it);
  if (!BASELINE && it.kind !== 'case') { const bad = refTexts(it.body).filter(hasRef); if (bad.length) { refLeft.push({ id, t: bad[0] }); exclude(id, 'ссылка на номер пункта/статьи в формулировке: ' + bad[0].slice(0, 160), { doc: it.doc, ref: it.ref }); continue; } }
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
  let base = it.forceBase || (REG.items[id] && REG.items[id].base);
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
  if (!BASELINE && o.type === 'multi') {   // multi: правильные варианты не должны выделяться длиной
    const ops = o.options, cs = new Set(o.correct); const R = ops.filter(x => cs.has(x.id)).map(x => x.text.length), Wr = ops.filter(x => !cs.has(x.id)).map(x => x.text.length);
    const av = (a) => a.reduce((x, y) => x + y, 0) / a.length;
    if (Wr.length && Math.min(...R) > Math.max(...Wr) && av(R) > av(Wr) * 1.35) lint.push({ msg: 'Правильные варианты заметно длиннее неверных — угадываются по длине' });
    if (!Wr.length) lint.push({ msg: 'В множественном выборе нет неверных вариантов' });
    if (R.length < 2) lint.push({ msg: 'В множественном выборе меньше двух верных вариантов' });
  }
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

// ---------- SQL (инкрементально: только новые/изменённые вопросы) ----------
const crypto = require('crypto');
const q = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const NOW = 'CAST(strftime(\'%s\',\'now\') AS INTEGER) * 1000';
const { hashOf } = require('./hash');   // хэш без случайных id вариантов (см. hash.js)
const newReg = { _comment: 'Версии вопросов баз переаттестаций, уже записанные миграциями (orig → ext_id, hash, base). Пишется tools/reatt6/build.js — не править руками.', items: {} };
const fresh = [];
for (const x of kept) {
  const o = x.o, orig = x.it.orig, h = hashOf({ ...o, ext_id: undefined });
  const r = REG.items[orig];
  let ext = 'r6-' + orig;
  if (r && r.hash === h) ext = r.ext_id;
  else if (r) { const v = (r.v || 1) + 1; ext = `r6-${orig}~v${v}`; o.ext_id = ext; newReg.items[orig] = { ext_id: ext, hash: h, base: o.base, v }; fresh.push(o); continue; }
  else fresh.push(o);
  o.ext_id = ext; newReg.items[orig] = { ext_id: ext, hash: h, base: o.base, v: r ? r.v || 1 : 1 };
}
const keepIds = kept.map(x => x.o.ext_id);
if (BASELINE) {
  fs.writeFileSync(REG_PATH, JSON.stringify(newReg, null, 0).replace(/\},"/g, '},\n"'));
  console.log('baseline registry:', Object.keys(newReg.items).length); process.exit(0);
}
const lines = [
  `-- ${MIG.replace(/\.sql$/, '')}: обновление баз переаттестаций (сгенерировано tools/reatt6/build.js — не править руками).`,
  '-- Новые и изменённые вопросы вставляются новыми строками (новый ext_id ~vN), прежние версии выключаются (active = 0) — история попыток сохраняется.',
  '-- Вопросы, которые администратор правил в админке (updated_at != created_at), не трогаются.',
];
let pos = 20000;
for (const o of fresh) {
  pos += 10;
  lines.push(`INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, topic, base, difficulty, source_doc, source_ref, created_at, updated_at) SELECT 0, ${q(o.type)}, ${q(o.text)}, ${q(JSON.stringify(o.options))}, ${q(JSON.stringify(o.correct))}, ${q(o.reference)}, ${o.points}, ${pos}, ${q(JSON.stringify(o.data))}, ${q(o.category)}, ${q(o.kind)}, 0, 1, ${q(o.ext_id)}, ${q(o.topic || null)}, ${q(o.base)}, ${o.difficulty}, ${q(o.source_doc)}, ${q(o.source_ref)}, ${NOW}, ${NOW} WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id = 0 AND ext_id = ${q(o.ext_id)});`);
}
// выключить всё автоматическое r6-, чего нет в текущих базах; включить обратно то, что вернулось
for (let i = 0; i < 1; i++) {
  const list = keepIds.map(q).join(', ');
  lines.push(`UPDATE questions SET active = 0 WHERE exam_id = 0 AND ext_id LIKE 'r6-%' AND active = 1 AND updated_at = created_at AND ext_id NOT IN (${list});`);
  lines.push(`UPDATE questions SET active = 1 WHERE exam_id = 0 AND active = 0 AND updated_at = created_at AND ext_id IN (${list});`);
}
const DESC = JSON.parse(fs.readFileSync(path.join(__dirname, 'descriptions.json'), 'utf8'));
for (const [key, d] of Object.entries(DESC.reatt)) lines.push(`UPDATE reattestations SET description = ${q(d.new)} WHERE key = ${q(key)} AND description IN (${d.old.map(q).join(', ')});`);
if (!DRY) { fs.writeFileSync(path.join(ROOT, 'worker/migrations', MIG), lines.join('\n') + '\n'); fs.writeFileSync(REG_PATH, JSON.stringify(newReg, null, 0).replace(/\},"/g, '},\n"')); }
// цитаты для tools/update_laws.py
fs.writeFileSync(path.join(ROOT, 'content/reatt6/quotes.json'), JSON.stringify({ _comment: 'Цитаты вопросов баз (для tools/update_laws.py). Пишется build.js.', items: kept.filter(x => x.it.quote).map(x => ({ ext_id: x.o.ext_id, base: x.base, doc: x.it.doc, ref: x.it.ref, parts: quoteParts(x.it.quote) })) }, null, 0).replace(/\},\{/g, '},\n{'));

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
if (process.env.DUMP) {   // отладка: полный список (для переработки вопросов)
  const ex = new Map(excluded.map(e => [e.id, e.why]));
  const kb = new Map(kept.map(x => [x.it.orig, x.base]));
  fs.writeFileSync(process.env.DUMP, JSON.stringify(items.map(it => ({ orig: it.orig, doc: it.doc, ref: it.ref, kind: it.kind, type: it.type, difficulty: it.difficulty, base: kb.get(it.orig) || null, why: ex.get(it.orig) || null, refFixed: refFixed.includes(it.orig), t0: it.t0, text: it.body.text, options: it.body.options, correct: it.body.correct, items: it.body.items, pairs: it.body.pairs, quote: it.quote, explanation: it.explanation })), null, 1));
}
