// Мини-проверка после лекции: подбор 1–3 вопросов к каждой лекции → content/build/lecture_quiz.json и миграция (INSERT в lecture_quiz).
// Связь: цитата вопроса (data.meta.quote) целиком встречается в тексте лекции; приоритет — вопросы курсов (не r6-*), затем базы переаттестации.
// Для тем без цитат (OOC, основы, психология) — вопросы темы (content/<slug>/questions.json) по совпадению слов верного ответа с лекцией;
// цитатой служит самый близкий абзац лекции. Берутся только «один/несколько ответов», активные; 3 вопроса — из разных мест лекции.
// Запуск: node tools/content/lecture-quiz.js <снимок вопросов.json> <снимок лекций.json> [migration.sql]
//   снимок вопросов: {qs:[{id,e:ext_id,t:type,a:active,qt:quote}]}, снимок лекций: [{id,title,slug,body?}] — SELECT из боевой D1.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../../content');
const [qsFile, lecFile, migFile] = process.argv.slice(2);
const QS = JSON.parse(fs.readFileSync(qsFile, 'utf8')).qs, LEC = JSON.parse(fs.readFileSync(lecFile, 'utf8'));
const content = JSON.parse(fs.readFileSync(path.join(ROOT, 'build/content.json'), 'utf8'));
const norm = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^0-9a-zа-я]+/g, ' ').trim();
const parts = (q) => String(q || '').split(/[«»\n]+/).map(norm).filter(x => x.length >= 15);
const STOP = new Set('и в во на не что как это для по из от до при или к ко с со о об а но же ли за без под над то так его ее их он она они все всех быть может должен если только также либо'.split(' '));
const words = (s) => norm(s).split(' ').filter(w => w.length > 3 && !STOP.has(w)).map(w => w.slice(0, 6));
const body = new Map(); // slug|title → текст лекции
for (const t of content) for (const l of t.lectures) body.set(t.slug + '|' + l.title, l.body);
for (const l of LEC) if (l.body) body.set(l.slug + '|' + l.title, l.body);
const usable = QS.filter(q => q.a && (q.t === 'single' || q.t === 'multi') && q.e);
const withQuote = usable.filter(q => parts(q.qt).length);
const byExt = new Map(usable.map(q => [q.e, q]));
const out = [];
for (const l of LEC) {
  const b = body.get(l.slug + '|' + l.title); if (!b) continue;
  const nb = norm(b);
  let cand = [];
  for (const q of withQuote) {
    const ps = parts(q.qt); if (!ps.every(p => nb.includes(p))) continue;
    cand.push({ q, pos: nb.indexOf(ps[0]) / nb.length, pri: q.e.startsWith('r6-') ? 1 : 0, len: ps.join(' ').length });
  }
  let src = 'quote';
  if (cand.length < 3) { // вопросы темы без цитат: совпадение слов верного ответа и вопроса с абзацем лекции
    const f = path.join(ROOT, l.slug, 'questions.json');
    if (fs.existsSync(f)) {
      const paras = b.split(/\n\s*\n/).map(t => t.trim()).filter(t => norm(t).length > 40);
      const pw = paras.map(t => new Set(words(t)));
      JSON.parse(fs.readFileSync(f, 'utf8')).questions.forEach((x, i) => {
        const e = x.ext_id || `${l.slug}-q${String(i + 1).padStart(2, '0')}`; const q = byExt.get(e);
        if (!q || cand.some(c => c.q.e === e)) return;
        const right = (x.options || []).filter((o, k) => (x.correct || []).includes(o.id ?? k)).map(o => o.text || o).join(' ');
        const w = [...new Set(words(right + ' ' + x.text))]; if (w.length < 3) return;
        let best = -1, bi = -1; pw.forEach((s, k) => { const sc = w.filter(t => s.has(t)).length / w.length; if (sc > best) { best = sc; bi = k; } });
        if (best >= 0.5) cand.push({ q, pos: bi / paras.length, pri: 2 - best, len: 0, quote: paras[bi].replace(/^#+\s*/, '').replace(/\s+/g, ' ').slice(0, 600) });
      });
      src = 'mixed';
    }
  }
  if (cand.length < 3) { // пересказ закона (ПК, СУ…): слова цитаты вопроса той же темы почти целиком в одном абзаце лекции
    const fam = l.slug.replace(/-/g, '_'), paras = b.split(/\n\s*\n/).map(t => new Set(words(t)));
    for (const q of withQuote) {
      const e = q.e.replace(/^r6-/, ''); if (!(e.startsWith(fam + '-') || (fam === 'pk' && e.startsWith('pkc-'))) || cand.some(c => c.q.e === q.e)) continue;
      const w = [...new Set(words(q.qt))]; if (w.length < 4) continue;
      let best = 0, bi = 0; paras.forEach((st, k) => { const sc = w.filter(t => st.has(t)).length / w.length; if (sc > best) { best = sc; bi = k; } });
      if (best >= 0.7) cand.push({ q, pos: bi / paras.length, pri: 3 - best + (q.e.startsWith('r6-') ? 1 : 0), len: 0 });
    }
  }
  cand.sort((a, b) => a.pri - b.pri);
  { const seen = new Set(); cand = cand.filter(c => { const k = c.q.e.replace(/^r6-/, ''); if (seen.has(k)) return false; seen.add(k); return true; }); } // r6-копии вопросов курса
  if (!cand.length) { out.push({ id: l.id, slug: l.slug, title: l.title, q: [] }); continue; }
  cand.sort((a, b) => a.pri - b.pri || b.len - a.len || a.q.id - b.q.id);
  const top = cand.filter(c => c.pri === cand[0].pri).length >= 3 ? cand.filter(c => c.pri === cand[0].pri) : cand;
  const pick = [];
  for (const target of [1 / 6, 1 / 2, 5 / 6]) { // по одному вопросу из начала, середины и конца лекции
    const c = top.filter(x => !pick.includes(x)).sort((a, b) => Math.abs(a.pos - target) - Math.abs(b.pos - target) || a.pri - b.pri)[0];
    if (c) pick.push(c);
  }
  pick.sort((a, b) => a.pos - b.pos);
  out.push({ id: l.id, slug: l.slug, title: l.title, src, q: pick.map(c => ({ ext_id: c.q.e, id: c.q.id, ...(c.quote ? { quote: c.quote } : {}) })) });
}
fs.writeFileSync(path.join(ROOT, 'build/lecture_quiz.json'), JSON.stringify(out, null, 1));
const n = out.filter(x => x.q.length).length;
console.log(`лекций: ${out.length}, с вопросами: ${n}, без: ${out.filter(x => !x.q.length).map(x => x.slug + ' «' + x.title + '»').join('; ') || '—'}`);
if (migFile) {
  const s = (v) => "'" + String(v).replace(/'/g, "''") + "'";
  const rows = [];
  // id лекций и вопросов — из снимка боевой БД; title/ext_id сверяются (поиск по первичному ключу, 2 строки на вставку)
  for (const l of out) l.q.forEach((q, i) => rows.push(`INSERT OR IGNORE INTO lecture_quiz (lecture_id, question_id, position, quote) SELECT l.id, q.id, ${i + 1}, ${q.quote ? s(q.quote) : "''"} FROM lectures l, questions q WHERE l.id = ${l.id} AND l.title = ${s(l.title)} AND q.id = ${q.id} AND q.ext_id = ${s(q.ext_id)};`));
  fs.appendFileSync(migFile, rows.join('\n') + '\n');
  console.log('строк в миграции:', rows.length);
}
