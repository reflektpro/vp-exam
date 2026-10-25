// Проверка файлов банка (законы / уставы в JSON): каждый вопрос нормализуется, правильный ответ даёт полный балл, неверный — 0, в публичном виде нет ответов.
// Запуск: node tests/bank-check.js <dir_with_json>
const DIR = process.argv[2] || '/workspace/vp_reatt_sources/laws';
const fs = require('fs'), path = require('path');
const src = fs.readFileSync('/workspace/vp_exam/worker/worker.js', 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '');
const W = new Function(src + '\nreturn { questionInput, importItems, makeState, publicQuestion, gradeAnswer, validateAnswer };')();
const { correctAnswer, wrongAnswer } = require('/workspace/vp_exam/tests/answers-helper');
let tot = {}, errs = 0;
for (const f of fs.readdirSync(DIR).filter(f => f.endsWith('.json'))) {
  const d = JSON.parse(fs.readFileSync(path.join(DIR, f)));
  for (const it of W.importItems(d)) {
    try { const o = W.questionInput(it, null); const row = { id: 1, ...o, options: JSON.stringify(o.options), correct: JSON.stringify(o.correct), data: JSON.stringify(o.data) };
      const st = W.makeState(row, true); const pub = W.publicQuestion(row, st);
      const g = W.gradeAnswer(row, st, W.validateAnswer(row, st, JSON.parse(JSON.stringify(correctAnswer(row, pub, st && st.p)))));
      if (o.kind !== 'case' && g.ap !== o.points) { errs++; console.log('grade', it.id, g); }
      if (o.kind !== 'case') { const w = W.gradeAnswer(row, st, W.validateAnswer(row, st, JSON.parse(JSON.stringify(wrongAnswer(row, pub, st && st.p))))); if (w.ap !== 0) { errs++; console.log('wrong graded', it.id, w); } }
      if (o.type === 'match') { const ids = pub.right.map(r => r.id); if (new Set(ids).size !== ids.length || new Set(pub.right.map(r=>r.text)).size !== ids.length) { errs++; console.log('dup rights', it.id); } }
      if (JSON.stringify(pub).match(/"correct"|quote|explanation|criteria|reference/)) { errs++; console.log('leak', it.id); }
      if (o.kind === 'case' && o.data.criteria.reduce((s, c) => s + c.points, 0) < o.points) console.log('crit sum', it.id, o.points, o.data.criteria.map(c => c.points));
      const k = o.category + '/' + o.kind; tot[k] = (tot[k] || 0) + 1;
    } catch (e) { errs++; console.log(f, it.id, e.message); }
  }
}
console.log(tot, 'errors', errs);
