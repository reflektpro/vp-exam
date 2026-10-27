// E2E контента тем (stage 3): после tools/content/apply-local.js — у каждой темы с контентом 4–5 лекций, выгрузка закрыта до
// прохождения лекций, лекции рендерятся (Markdown, таблицы), экзамены из банков темы. Headless, без Discord.
// Запуск: bash /tmp/reset.sh; node tools/content/build.js; node tools/content/apply-local.js; node tests/e2e-content.js
const { chromium } = require('playwright');
const fs = require('fs');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || (__dirname + '/shots/'); fs.mkdirSync(SHOTS, { recursive: true });
const SUPER = '417660389723996170';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 600) : '')); };
async function call(method, path, token, body) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch (_) {}
  return { status: r.status, d, raw: t };
}
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, args) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args }) })).json()).results;
const U = { vp: '830000000000000001', vp2: '830000000000000002', none: '830000000000000003' };
const done = (uid, l) => sql('INSERT OR REPLACE INTO lecture_progress (user_id, lecture_id, max_pos, last_pos, watched_sec, last_hb_at, started_at, completed_at) VALUES (?1, ?2, ?3, ?3, ?3, ?4, ?4, ?4)', [uid, l.id, l.duration_sec, Date.now()]);
const B = JSON.parse(fs.readFileSync(__dirname + '/../content/build/content.json', 'utf8'));
(async () => {
  const A = await login(SUPER, 'super-admin'); const uid = '840000000000000001'; const T = await login(uid, 'vp_content', 'vp');
  let r = await call('GET', '/api/courses', T); const topics = r.d.courses.flatMap(c => c.topics.map(t => ({ ...t, course: c })));
  const items = Array.isArray(B) ? B : B.topics;
  for (const b of items) {
    const tid = ((await sql('SELECT id FROM topics WHERE slug = ?1', [b.slug]))[0] || {}).id; const t = topics.find(x => x.id === tid);
    let tp = (await call('GET', '/api/topics/' + (t && t.id), T)).d;
    check(`${b.slug}: тема найдена`, !!(t && tp), b.slug); if (!t || !tp) continue;
    const lecs = (tp.lectures || tp.topic && tp.topic.lectures || []);
    if (!b.keep_lectures) check(`${b.slug}: лекций ${b.lectures.length} (4–5)`, lecs.length === b.lectures.length && lecs.length >= 4 && lecs.length <= 5, lecs.length);
    const did = (await sql('SELECT doc_id FROM topics WHERE id=?1', [t.id]))[0].doc_id;
    check(`${b.slug}: выгрузка привязана`, !!did);
    if (!b.keep_lectures) {
      r = await call('GET', '/api/docs/' + did, T); check(`${b.slug}: выгрузка закрыта до лекций (403)`, r.status === 403, r.status);
      for (const l of lecs) await done(uid, (await sql('SELECT id, duration_sec FROM lectures WHERE id=?1', [l.id]))[0]);
      r = await call('GET', '/api/docs/' + did, T); check(`${b.slug}: выгрузка открыта после лекций`, r.status === 200 && r.d.doc.body.length > 3000, r.status);
      tp = (await call('GET', '/api/topics/' + t.id, T)).d; check(`${b.slug}: план ролика скрыт от курсанта`, !JSON.stringify(tp).includes('План ролика'));
    }
    const ta = (await call('GET', '/api/admin/topics/' + t.id, A)).d; check(`${b.slug}: план ролика у админа`, JSON.stringify(ta).includes('План ролика'));
    if (b.questions.length) { const n = (await sql('SELECT COUNT(*) c FROM questions WHERE ext_id LIKE ?1 AND active=1', [b.slug + '-q%']))[0].c; check(`${b.slug}: вопросов в банке ${b.questions.length}`, n === b.questions.length, n); }
  }
  // экзамен ФТ + КрАЗ: опубликован, после лекций обеих тем стартует, 15 вопросов только из двух категорий
  r = await call('GET', '/api/courses', T); const ex = r.d.courses.flatMap(c => c.exams).find(e => /федеральная тюрьма/.test(e.title));
  check('экзамен ФТ + КрАЗ виден курсанту', !!ex);
  const pubT = (await sql('SELECT title FROM exams WHERE published = 1')).map(x => x.title).join('|');
  check('опубликованы экзамены УК + КоАП, ФЗ, ТК, Уставы', ['УК + КоАП', 'Федеральные законы', 'Трудовой кодекс', 'Уставы'].every(t => pubT.includes(t)), pubT);
  r = await call('POST', `/api/exams/${ex.id}/start`, T); check('экзамен ФТ + КрАЗ стартует после лекций', !!r.d.attempt_id, r.d);
  const qs = (await call('GET', '/api/attempts/' + r.d.attempt_id, T)).d.attempt.questions;
  const cats = await sql(`SELECT DISTINCT category FROM questions WHERE id IN (${qs.map(q => +q.id).join(',')})`);
  check('15 вопросов только из «OOC — федеральная тюрьма» и «OOC — КрАЗ»', qs.length === 15 && cats.every(c => /OOC — (федеральная тюрьма|КрАЗ)/.test(c.category)), { n: qs.length, cats, keys: Object.keys(qs[0] || {}) });
  // UI: лекция и выгрузка рендерятся, без ошибок; мобильная ширина без горизонтальной прокрутки
  const b = await chromium.launch({ args: ['--no-sandbox'] }); const errs = [];
  for (const vp of [{ width: 1300, height: 900 }, { width: 390, height: 800 }]) {
    const ctx = await b.newContext({ viewport: vp, locale: 'ru-RU' }); await ctx.addInitScript(t => localStorage.setItem('vpexam_token', t), T);
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    const lid = (await sql("SELECT l.id FROM lectures l JOIN topics t ON t.id=l.topic_id WHERE t.slug='osnovy' ORDER BY l.position LIMIT 1"))[0].id;
    await page.goto(SITE + '#/lecture/' + lid); await page.waitForSelector('.lec-title');
    check(`лекция «Основы» рендерится (${vp.width})`, (await page.$$eval('.lecture-text h2, .lecture-text table', x => x.length)) > 0);
    const did = (await sql("SELECT doc_id FROM topics WHERE slug='ooc-nalety'"))[0].doc_id;
    await page.goto(SITE + '#/doc/' + did); await page.waitForTimeout(1200);
    check(`выгрузка «Налёты» открывается (${vp.width})`, /Правила открытия огня/.test(await page.textContent('#app')));
    const ow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth); check(`без горизонтальной прокрутки (${vp.width})`, ow <= 1, ow);
    await page.screenshot({ path: SHOTS + `content-${vp.width}.png`, fullPage: false }); await ctx.close();
  }
  check('без JS-ошибок', !errs.length, errs); await b.close();
  const ok = results.filter(x => x.ok).length; console.log(`\nИТОГО: ${ok}/${results.length} PASS`);
  fs.writeFileSync(__dirname + '/e2e-content-results.json', JSON.stringify(results, null, 1)); process.exit(ok === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
