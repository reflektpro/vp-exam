// Применение content/build/content.json к ЛОКАЛЬНОМУ воркеру через API админки (проверка всей валидации сервера).
// node tools/content/apply-local.js [API=http://localhost:8787]
const fs = require('fs'), path = require('path');
const API = process.argv[2] || 'http://localhost:8787';
const C = JSON.parse(fs.readFileSync(path.join(__dirname, '../../content/build/content.json'), 'utf8'));
const META = (slug) => JSON.parse(fs.readFileSync(path.join(__dirname, '../../content', slug, 'meta.json'), 'utf8'));
(async () => {
  const tok = (await (await fetch(`${API}/__test/login?id=417660389723996170&name=content`)).json()).token;
  const call = async (m, p, b) => { const r = await fetch(API + p, { method: m, headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }); const d = await r.json(); if (r.status >= 300) throw new Error(`${m} ${p}: ${r.status} ${JSON.stringify(d).slice(0, 300)}`); return d; };
  const { topics } = await call('GET', '/api/admin/topics');
  const docs = (await call('GET', '/api/docs')).docs;
  for (const t of C) {
    const tp = topics.find(x => x.slug === t.slug); if (!tp) throw new Error('нет темы ' + t.slug);
    const ex = docs.find(d => d.title === t.doc.title);
    const doc = ex ? (await call('PUT', '/api/docs/' + ex.id, t.doc)).doc : (await call('POST', '/api/docs', t.doc)).doc;
    await call('PUT', '/api/admin/topics/' + tp.id, { doc_id: doc.id, video_plan: t.video_plan, status: t.status });
    const cur = (await call('GET', '/api/admin/topics/' + tp.id)).lectures;
    for (const l of t.lectures) {
      const body = { title: l.title, body: l.body, duration_sec: l.duration_sec, published: true, required: true, topic_id: tp.id, position: tp.id * 100 + l.n * 10 };
      const e = cur.find(x => x.title === l.title);
      await call(e ? 'PUT' : 'POST', '/api/admin/lectures' + (e ? '/' + e.id : ''), body);
    }
    if (t.questions.length) { const r = await call('POST', '/api/admin/bank/import', { data: { questions: t.questions } }); console.log(t.slug, 'вопросы:', JSON.stringify(r.report).slice(0, 120)); }
    const m = META(t.slug);
    if (m.publish_exams) { const { exams } = await call('GET', '/api/admin/exams'); for (const title of m.publish_exams) { const e = exams.find(x => x.title === title); if (!e) throw new Error('нет экзамена ' + title); await call('PUT', '/api/admin/exams/' + e.id, { published: true }); } }
    console.log(t.slug, 'ok: doc', doc.id, 'лекций', t.lectures.length);
  }
})().catch(e => { console.error(e.message); process.exit(1); });
