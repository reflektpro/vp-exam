// Сборка контента тем: content/<slug>/{meta.json, vygruzka.md, video_plan.md, questions.json} → content/build/content.json
// vygruzka.md — полная выгрузка; разделы с пометкой <!-- lec: N --> идут в короткую лекцию N, <!-- lec: - --> — только в выгрузку.
// Проверка: объём лекций ≈ 70% выгрузки (допуск 55–85%), 4–5 лекций; длительность лекции — по 160 слов/мин.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '../../content');
const out = [];
for (const slug of fs.readdirSync(ROOT).filter(d => fs.existsSync(path.join(ROOT, d, 'meta.json'))).sort()) {
  const dir = path.join(ROOT, slug), meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const src = fs.readFileSync(path.join(dir, 'vygruzka.md'), 'utf8');
  if (meta.keep_lectures) { // лекции уже есть на сайте (тема ПК) — собираем только выгрузку, план и вопросы
    const vp0 = fs.existsSync(path.join(dir, 'video_plan.md')) ? fs.readFileSync(path.join(dir, 'video_plan.md'), 'utf8') : '';
    out.push({ slug, status: meta.status || 'draft', keep_lectures: true, doc: { ...meta.doc, body: src.replace(/^<!-- lec: [0-9-]+ -->\s*$/mg, '').trim() }, lectures: [], video_plan: vp0, questions: [] });
    console.log(`${slug}: только выгрузка (${src.length} зн.) и план ролика`); continue;
  }
  const parts = src.split(/^<!-- lec: ([0-9-]+) -->\s*$/m); // [pre, n, text, n, text...]
  const lec = new Map(meta.lectures.map(l => [l.n, []]));
  let doc = parts[0].trim() + '\n';
  for (let i = 1; i < parts.length; i += 2) {
    const n = parts[i], text = parts[i + 1].trim();
    doc += '\n' + text + '\n';
    if (n !== '-') { if (!lec.has(Number(n))) throw new Error(`${slug}: раздел для лекции ${n}, которой нет в meta.json`); lec.get(Number(n)).push(text); }
  }
  const plain = (s) => s.replace(/[#>*|`\-]/g, ' ').replace(/\s+/g, ' ').trim();
  const lectures = meta.lectures.map(l => {
    const body = (l.intro ? l.intro.trim() + '\n\n' : '') + lec.get(l.n).join('\n\n') + (l.outro ? '\n\n' + l.outro.trim() : '');
    if (!lec.get(l.n).length) throw new Error(`${slug}: у лекции ${l.n} нет разделов`);
    const words = plain(body).split(' ').length;
    return { n: l.n, title: l.title, body, duration_sec: Math.max(120, Math.round(words / 160 * 60 / 10) * 10), words };
  });
  const docPlain = plain(doc).length, lecPlain = lectures.reduce((s, l) => s + plain(l.body).length, 0);
  const ratio = Math.round(lecPlain / docPlain * 100);
  const vp = fs.existsSync(path.join(dir, 'video_plan.md')) ? fs.readFileSync(path.join(dir, 'video_plan.md'), 'utf8') : '';
  const qs = fs.existsSync(path.join(dir, 'questions.json')) ? JSON.parse(fs.readFileSync(path.join(dir, 'questions.json'), 'utf8')).questions : [];
  qs.forEach((q, i) => { q.ext_id = q.ext_id || `${slug}-q${String(i + 1).padStart(2, '0')}`; });
  if (lectures.length < 4 || lectures.length > 5) console.warn(`! ${slug}: лекций ${lectures.length} (нужно 4–5)`);
  if (ratio < 55 || ratio > 85) console.warn(`! ${slug}: лекции = ${ratio}% выгрузки (цель ≈70%)`);
  out.push({ slug, status: meta.status || 'draft', doc: { ...meta.doc, body: doc.trim() }, lectures, video_plan: vp, questions: qs, ratio });
  console.log(`${slug}: лекций ${lectures.length} (${lectures.map(l => Math.round(l.duration_sec / 60) + ' мин').join(', ')}), лекции = ${ratio}% выгрузки, выгрузка ${doc.length} зн., вопросов ${qs.length}, план ролика ${vp ? 'есть' : 'нет'}`);
}
fs.mkdirSync(path.join(ROOT, 'build'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'build/content.json'), JSON.stringify(out, null, 1));
