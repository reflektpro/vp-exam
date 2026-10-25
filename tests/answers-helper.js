// Общий помощник для тестов: правильный ответ по полной строке вопроса (админ-данные) и публичному виду.
// Используется только в тестах (знает правильные ответы — кандидату они не отдаются).
function parseJ(s, d) { try { return typeof s === 'string' ? JSON.parse(s) : (s ?? d); } catch (_) { return d; } }
function evalSimple(formula, p) { return Function(...Object.keys(p), 'return (' + formula.replace(/\^/g, '**') + ')')(...Object.values(p)); }
// row: {type, options, correct, data} (как в БД); pub: publicQuestion; params: значения переменных (для param)
function correctAnswer(row, pub, params) {
  const d = parseJ(row.data, {}); const correct = parseJ(row.correct, []); const options = parseJ(row.options, []);
  switch (row.type) {
    case 'single': return correct[0];
    case 'multi': return correct;
    case 'eliminate': return options.map(o => o.id).filter(id => id !== correct[0]);
    case 'number': case 'slider': return d.answer;
    case 'param': return evalSimple(d.formula, params);
    case 'text': return (d.accepted[0] || '').toUpperCase().replace(/е/g, 'ё');
    case 'long': case 'case': return 'Развёрнутый ответ кандидата для ручной проверки.';
    case 'order': return d.items.map(x => x.id);
    case 'match': return Object.fromEntries(d.pairs.map(p => [p.l.id, p.r.id]));
    case 'blanks_input': return d.blanks.map(b => b.accepted[b.accepted.length - 1]);
    case 'blanks_select': case 'dictation': return d.blanks.map(b => b.correct);
    case 'find': { const out = []; d.tokens.forEach((t, i) => { if (t.c) out.push(i); }); return out; }
    case 'letters': { const used = new Set(); return d.word.replace(/\s/g, '').split('').map(ch => { const k = pub.letters.findIndex((x, i) => x === ch && !used.has(i)); used.add(k); return k; }); }
    case 'words': { const used = new Set(); return d.phrase.split(/\s+/).map(w => { const k = pub.words.findIndex((x, i) => x === w && !used.has(i)); used.add(k); return k; }); }
    default: return null;
  }
}
function wrongAnswer(row, pub) {
  const d = parseJ(row.data, {}); const correct = parseJ(row.correct, []); const options = parseJ(row.options, []);
  switch (row.type) {
    case 'single': return options.find(o => !correct.includes(o.id)).id;
    case 'multi': return [options.find(o => !correct.includes(o.id)).id];
    case 'eliminate': return [correct[0]];
    case 'number': case 'param': return 999999;
    case 'slider': return d.answer === d.min ? d.max : d.min;
    case 'text': return 'неправильно';
    case 'order': return d.items.map(x => x.id).reverse();
    case 'match': { const ids = d.pairs.map(p => p.r.id); return Object.fromEntries(d.pairs.map((p, i) => [p.l.id, ids[(i + 1) % ids.length]])); }
    case 'blanks_input': return d.blanks.map(() => 'zzz');
    case 'blanks_select': case 'dictation': return d.blanks.map(b => b.opts.find(o => o.id !== b.correct).id);
    case 'find': { const i = d.tokens.findIndex(t => !t.c && !t.br); return [i]; }
    case 'letters': return pub.letters.map((_, i) => i).reverse().slice(0, 2);
    case 'words': return [pub.words.length - 1];
    default: return null;
  }
}
module.exports = { correctAnswer, wrongAnswer, parseJ };
