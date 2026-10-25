// Юнит-тест движка вопросов без сервера: node tests/engine-unit.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../worker/worker.js'), 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '');
const W = new Function(src + '\nreturn { questionInput, makeState, publicQuestion, validateAnswer, gradeAnswer, describeQA, toNative, sampleReatt, importItems, evalFormula };')();
const { correctAnswer, wrongAnswer } = require('./answers-helper');
const ex = JSON.parse(fs.readFileSync(path.join(__dirname, '../tools/examples.json'), 'utf8')).questions;
let fail = 0; const ok = (n, c, x) => { if (!c) { fail++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x).slice(0, 300) : ''); } };
let id = 1; const rows = [];
for (const it of ex) {
  const o = W.questionInput(it, null);
  const row = { id: id++, ...o, options: JSON.stringify(o.options), correct: JSON.stringify(o.correct), data: JSON.stringify(o.data) };
  rows.push(row);
  for (let rep = 0; rep < 3; rep++) {
    const st = W.makeState(row, true);
    const pub = W.publicQuestion(row, st);
    const pubS = JSON.stringify(pub);
    ok(row.type + ' no secrets', !/"correct"|"accepted"|"answer"|"formula"|"reference"|"criteria"|"tokens":\[\{/.test(pubS), pub);
    const ca = correctAnswer(row, pub, st && st.p);
    const v = W.validateAnswer(row, st, JSON.parse(JSON.stringify(ca)));
    const g = W.gradeAnswer(row, st, v);
    const manual = ['long', 'case', 'file', 'voice'].includes(row.type);
    if (manual) ok(row.type + ' manual', g.nr === 1 || row.type === 'file' || row.type === 'voice', g);
    else ok(row.type + ' correct → full', g.ap === row.points, { g, ca, pub });
    const wa = wrongAnswer(row, pub);
    if (wa !== null) { const g2 = W.gradeAnswer(row, st, W.validateAnswer(row, st, wa)); ok(row.type + ' wrong → 0', g2.ap === 0, { g2, wa }); }
    const dq = W.describeQA(row, st, v); ok(row.type + ' describe', typeof dq.answer_text === 'string');
    const nat = W.toNative(row); const again = W.questionInput(nat, row); ok(row.type + ' roundtrip type', again.type === row.type && JSON.stringify(again.correct) === row.correct, { again: again.correct, row: row.correct });
  }
}
// квоты — стандартные записи из миграции 0006 на синтетическом банке
const CATS = ['ПК', 'УК', 'ВУ', 'СУ', 'КПС', 'ДУ', 'ФЗ-1', 'ФКЗ-1', 'КоАП', 'ТК'], TYPES = ['single', 'single', 'single', 'multi', 'match', 'order', 'number'];
const bank = []; let nid = 0;
for (const c of CATS) { for (let i = 0; i < 30; i++) bank.push({ id: ++nid, category: c, kind: 'question', type: TYPES[i % TYPES.length] }); for (let i = 0; i < 5; i++) bank.push({ id: ++nid, category: c, kind: 'case', type: 'case' }); }
const types = new Map(bank.map(q => [q.id, q.type]));
const mig = fs.readFileSync(path.join(__dirname, '../worker/migrations/0006_reatt_auto_and_cases.sql'), 'utf8');
const DEF = {}; for (const m of mig.matchAll(/groups = '(\[\{.*?\}\])'[\s\S]*?key = '(full|simple)'/g)) DEF[m[2]] = JSON.parse(m[1]);
{ const m = mig.match(/\('cases'[\s\S]*?'(\[\{.*?\}\])'/); if (m) DEF.cases = JSON.parse(m[1]); }
ok('migration 0006 defaults parsed', DEF.full && DEF.simple && DEF.cases && DEF.full.length === 8 && DEF.simple.length === 4 && DEF.cases.length === 8, Object.keys(DEF));
const EXP = { full: [42, 0], simple: [15, 0], cases: [0, 10] };
for (const v of ['full', 'simple', 'cases']) {
  for (let rep = 0; rep < 20; rep++) {
    const g = W.sampleReatt(bank, DEF[v]);
    const all = g.flatMap(x => x.q.concat(x.c));
    ok(v + ' no dups', new Set(all).size === all.length);
    g.forEach((x, k) => { ok(`${v} ${x.label} quota`, x.short_q === 0 && x.short_c === 0, x); const pc = DEF[v][k].pref_count || 0; if (pc) ok(`${v} ${x.label} pref ≥ ${pc}`, x.q.filter(id => DEF[v][k].pref_types.includes(types.get(id))).length >= pc); });
    ok(`${v} totals`, g.reduce((s, x) => s + x.q.length, 0) === EXP[v][0] && g.reduce((s, x) => s + x.c.length, 0) === EXP[v][1]);
    if (!rep) console.log(v, g.map(x => `${x.label}:${x.q.length}+${x.c.length}`).join(' '), 'total', all.length);
  }
}
// предпочтительные типы при нехватке — добираются любые
{ const g = W.sampleReatt(bank.filter(q => q.category !== 'ПК' || q.type !== 'match'), [{ label: 'ПК', categories: ['ПК'], questions: 6, cases: 0, pref_types: ['match'], pref_count: 3 }]);
  ok('pref shortage filled with others', g[0].q.length === 6 && g[0].short_q === 0); }
// импорт формата «файл закона»
const law = { law: 'Процессуальный кодекс', code: 'pk', questions: [
  { id: 'pk-q001', type: 'single', difficulty: 'easy', article: 'Статья 1', question: 'Q?', options: ['a', 'b', 'c'], correct: [1] },
  { id: 'pk-q002', type: 'multiple', question: 'Q2?', options: ['a', 'b', 'c'], correct: [0, 2] },
  { id: 'pk-q003', type: 'number', question: 'Q3?', answer: 48, unit: 'часов' },
  { id: 'pk-q004', type: 'match', question: 'Q4?', pairs: [{ left: 'x', right: '1' }, { left: 'y', right: '2' }] },
  { id: 'pk-q005', type: 'order', question: 'Q5?', options: ['второй', 'первый', 'третий'], correct: [1, 0, 2] }],
  cases: [{ id: 'pk-c01', difficulty: 'medium', situation: 'Ситуация', question: 'Что делать?', reference_answer: 'Эталон', articles: ['ст. 1'], criteria: ['Квалификация (4 балла)', 'Порядок (6 баллов)'], max_score: 10 }] };
const li = W.importItems(law).map(x => W.questionInput(x, null));
ok('law import count', li.length === 6);
ok('law single correct', li[0].correct.length === 1 && li[0].options[1].id === li[0].correct[0] && li[0].easy === 0 && li[0].category === 'ПК' && li[0].ext_id === 'pk-q001', li[0]);
ok('law multi', li[1].type === 'multi' && li[1].correct.length === 2);
ok('law order', li[4].data.items.map(x => x.text).join() === 'первый,второй,третий', li[4].data);
ok('law case', li[5].kind === 'case' && li[5].points === 10 && li[5].data.criteria[1].points === 6 && /Ситуация/.test(li[5].text), li[5]);
ok('formula', W.evalFormula('round(a/3, 2) + 2^3', { a: 10 }) === 11.33);
let threw = false; try { W.evalFormula('constructor', {}); } catch (_) { threw = true; } ok('formula unknown var throws', threw);
console.log(fail ? `FAILED ${fail}` : 'ALL OK', 'rows', rows.length);
process.exit(fail ? 1 : 0);
