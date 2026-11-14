// Главный администратор (ADMIN_IDS): вся учёба открыта без порядка — лекции, выгрузки, экзамены тем; прохождение само не засчитывается.
// Администратор сайта, руководство (СС) и обычный ВП по-прежнему идут по порядку.
// Запуск: bash /tmp/reset.sh; node tools/content/build.js; node tools/content/apply-local.js; node tests/e2e-super-unlock.js
const { chromium } = require('playwright');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const SUPER = '417660389723996170', ADM = '850000000000000001', MGR = '850000000000000002', VP = '850000000000000003';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 500) : '')); };
async function call(method, path, token, body) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch (_) {} return { status: r.status, d };
}
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, args) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args }) })).json()).results;
(async () => {
  const S = await login(SUPER, 'ГА'), A = await login(ADM, 'Админ сайта', 'admin,vp'), V = await login(VP, 'ВП', 'vp');
  const M = await login(MGR, 'СС', 'vp'); await sql("UPDATE users SET role = 'manager' WHERE id = ?1", [MGR]);
  await call('PUT', '/api/admin/settings', S, { sequential_lectures: true });
  const tid = (await sql("SELECT id FROM topics WHERE slug = 'su'"))[0].id;
  const who = { 'ГА': S, 'админ сайта': A, 'СС': M, 'ВП': V };
  const topic = {}; for (const [k, t] of Object.entries(who)) topic[k] = (await call('GET', '/api/topics/' + tid, t)).d;
  const L = topic['ГА'].lectures; const last = L[L.length - 1];
  check('ГА: в теме СУ ни одной закрытой лекции', L.length === 4 && L.every(l => !l.locked && l.status !== 'locked'), L.map(l => l.status));
  check('ГА: экзамены темы открыты без лекций', topic['ГА'].exams.length > 0 && topic['ГА'].exams.every(e => e.lectures_done && (e.can_start || e.active_attempt_id || e.attempts.length)), topic['ГА'].exams.map(e => [e.title, e.can_start, e.reason]));
  let r = await call('GET', '/api/lectures/' + last.id, S); check('ГА: последняя лекция темы открывается (200)', r.status === 200 && r.d.lecture.body.length > 100, r.status);
  r = await call('POST', `/api/lectures/${last.id}/heartbeat`, S, { position: 0 }); check('ГА: прогресс по последней лекции принимается', r.status === 200, r.d);
  for (const k of ['админ сайта', 'СС', 'ВП']) {
    const tl = topic[k].lectures;
    check(`${k}: лекции 2–4 под замком порядка`, tl.length === 4 && !tl[0].locked && tl.slice(1).every(l => l.locked), tl.map(l => l.status));
    r = await call('GET', '/api/lectures/' + last.id, who[k]); check(`${k}: последняя лекция → 403`, r.status === 403, r.status);
    check(`${k}: экзамен темы закрыт до лекций`, topic[k].exams.every(e => !e.lectures_done && !e.can_start), topic[k].exams.map(e => [e.can_start, e.reason]));
  }
  // ГА: ничего не засчитано автоматически
  const prog = await sql('SELECT COUNT(*) AS c FROM lecture_progress WHERE user_id = ?1 AND completed_at IS NOT NULL', [SUPER]);
  const t2 = (await call('GET', '/api/topics/' + tid, S)).d;
  check('ГА: ни одна лекция не засчитана, тема не пройдена', prog[0].c === 0 && !t2.progress.done && t2.progress.required_done === 0, { prog, p: t2.progress });
  const cs = (await call('GET', '/api/courses', S)).d.courses;
  check('ГА: курсы без замков лекций и не отмечены пройденными', cs.every(c => c.lectures.every(l => !l.locked)) && cs.every(c => !c.complete), cs.map(c => [c.title, c.complete]));
  const ex = (await call('GET', '/api/exams', S)).d.exams;
  check('ГА: все экзамены без требования лекций', ex.every(e => e.lectures_done), ex.filter(e => !e.lectures_done).map(e => e.title));
  // UI: на странице темы у ГА нет 🔒, у админа сайта — есть
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  for (const [k, t, want] of [['ГА', S, 0], ['админ сайта', A, 3]]) {
    for (const vp of [{ width: 1300, height: 900 }, { width: 390, height: 800 }]) {
      const ctx = await b.newContext({ viewport: vp }); await ctx.addInitScript(x => localStorage.setItem('vpexam_token', x), t);
      const p = await ctx.newPage(); await p.goto(SITE + '#/topic/' + tid); await p.waitForSelector('.step'); await p.waitForTimeout(300);
      const n = await p.$$eval('li.step.locked:not(.exam)', x => x.filter(e => /^🔒/.test(e.querySelector('.dot').textContent)).length);
      check(`UI ${k} (${vp.width}): замков на лекциях — ${want}`, n === want, n); await ctx.close();
    }
  }
  await b.close();
  const ok = results.filter(x => x.ok).length; console.log(`\nИТОГО: ${ok}/${results.length} PASS`); process.exit(ok === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
