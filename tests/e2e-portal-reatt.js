// E2E «Портал и доступ к переаттестации» (миграция 0012): нейтральная главная без приветствия, типографика лекций,
// полная переаттестация — 28 вопросов, упрощённая — 12; переаттестация скрыта, пока админ не выдаст доступ
// (лично или всем с ролью) до определённого времени и на N попыток; отзыв; админ видит всё; UI выдачи.
// Headless, вход — /__test/login, без Discord. Запуск: bash /tmp/reset.sh (0001–0012), node serve.js (:8080).
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
const U = { r1: '820000000000000001', r2: '820000000000000002', r3: '820000000000000003', vp: '820000000000000004' };

(async () => {
  const A = await login(SUPER, 'super-admin');
  const T = { r1: await login(U.r1, 'reatt_one', 'reatt'), r2: await login(U.r2, 'reatt_two', 'vp,reatt'), r3: await login(U.r3, 'reatt_three', 'reatt'), vp: await login(U.vp, 'vp_only', 'vp') };
  await sql("UPDATE reattestations SET cooldown_min = 0, max_attempts = 0");

  // ---------- 1. главная ----------
  let r = await call('GET', '/api/config');
  const st = (r.d && (r.d.settings || r.d)) || {};
  check('название портала — «ГУ ВП — портал»', st.site_title === 'ГУ ВП — портал', st.site_title);
  check('приветствие «Добро пожаловать в учебный центр…» убрано', !st.welcome_text && !/Добро пожаловать в учебный центр/.test(r.raw), st.welcome_text);

  // ---------- 2. состав переаттестаций ----------
  r = await call('GET', '/api/admin/reatt', A);
  const byKey = (k) => r.d.items.find(x => x.key === k); const full = byKey('full'), simple = byKey('simple'), cases = byKey('cases');
  const sum = (v) => v.groups.reduce((s, g) => s + g.questions + g.cases, 0);
  check('полная: 28 вопросов, только «один ответ», 60 мин', sum(full) === 28 && full.groups.every(g => g.cases === 0 && g.pref_types.join() === 'single' && g.pref_count === g.questions) && full.time_limit_min === 60, full);
  check('упрощённая: 12 вопросов (только уставы), 30 мин', sum(simple) === 12 && simple.groups.map(g => g.label).sort().join() === 'ВУ,ДУ,КПС,СУ' && simple.time_limit_min === 30, simple);
  check('кейсы: без изменений (10 кейсов)', sum(cases) === 10);
  check('по умолчанию доступ никому не выдан', r.d.items.every(v => v.access && v.access.active === 0), r.d.items.map(v => v.access));

  // ---------- 3. без доступа — не видно и не начать ----------
  r = await call('GET', '/api/reatt', T.r1); check('без доступа: список пуст', r.status === 200 && r.d.versions.length === 0, r.d);
  r = await call('POST', '/api/reatt/full/start', T.r1); check('без доступа: старт → 403', r.status === 403, r.d);
  r = await call('GET', '/api/reatt', A); check('админ видит все включённые без выдачи', r.d.versions.length >= 3, r.d.versions && r.d.versions.map(v => v.key));

  // ---------- 4. права на выдачу ----------
  r = await call('GET', `/api/admin/reatt/${full.id}/access`, T.r1); check('кандидат не видит выдачи (403)', r.status === 403);
  r = await call('POST', `/api/admin/reatt/${full.id}/access`, T.r1, { user_id: U.r1 }); check('кандидат не выдаёт себе доступ (403)', r.status === 403);
  r = await call('POST', `/api/admin/reatt/${full.id}/access`, A, { user_id: U.vp, attempts: 1 }); check('нельзя выдать без роли «Переаттестация» (400)', r.status === 400, r.d);
  r = await call('POST', `/api/admin/reatt/${full.id}/access`, A, { user_id: U.r1, expires_at: Date.now() - 1000, attempts: 1 }); check('срок в прошлом → 400', r.status === 400, r.d);
  r = await call('POST', `/api/admin/reatt/${full.id}/access`, A, { user_id: U.r1, expires_at: Date.now() + 400 * 864e5 }); check('срок больше года → 400', r.status === 400, r.d);
  r = await call('POST', `/api/admin/reatt/${full.id}/access`, A, { user_id: U.r1, attempts: 0 }); check('0 попыток → 400', r.status === 400, r.d);

  // ---------- 5. личный доступ: срок + 2 попытки ----------
  const until = Date.now() + 3 * 3600000;
  r = await call('POST', `/api/admin/reatt/${full.id}/access`, A, { user_id: U.r1, expires_at: until, attempts: 2, note: 'пересдача' });
  check('выдан личный доступ (201/200)', r.status < 300 && r.d.grant && r.d.grant.attempts === 2, r.d); const G1 = r.d.grant && r.d.grant.id;
  r = await call('GET', '/api/reatt', T.r1); let v = r.d.versions.find(x => x.key === 'full');
  check('видна только «полная», с доступом до … и 2 попытками', r.d.versions.length === 1 && v && v.can_start && v.access.expires_at === until && v.access.left === 2, r.d.versions);
  r = await call('GET', '/api/reatt', T.r2); check('другому кандидату личный доступ не виден', r.d.versions.length === 0);
  for (let k = 1; k <= 2; k++) {
    r = await call('POST', '/api/reatt/full/start', T.r1); const id = r.d.attempt_id; check(`попытка ${k}: старт`, !!id, r.d);
    r = await call('GET', '/api/attempts/' + id, T.r1); check(`попытка ${k}: 28 вопросов`, r.d.attempt.questions.length === 28, r.d.attempt && r.d.attempt.questions.length);
    if (k === 1) { const qc = await sql(`SELECT DISTINCT category c FROM questions WHERE id IN (${r.d.attempt.questions.map(q => +q.id).join(',')})`); check('полная (0014): вопросы только из простого пула «Общая переаттестация — …»', qc.length && qc.every(x => x.c.startsWith('Общая переаттестация — ')), qc); }
    if (k === 1) {
      const qs = r.d.attempt.questions; let expS = 0;
      for (const gr of full.groups) { const cond = gr.categories.map(c => c.endsWith('*') ? `category LIKE '${c.slice(0, -1)}%'` : `category = '${c}'`).join(' OR ');
        const n = (await sql(`SELECT COUNT(*) AS n FROM questions WHERE type = 'single' AND (${cond}) AND exam_id = 0 AND active = 1`))[0].n; expS += Math.min(n, gr.questions); }
      check(`полная: в первую очередь вопросы с одним ответом (${expS} из 28 при текущем банке)`, qs.filter(q => q.type === 'single').length >= expS && expS > 0, [expS, qs.map(q => q.type).join()]);
      check('полная: без повторов', new Set(qs.map(q => q.id)).size === 28);
      r = await call('POST', '/api/reatt/full/start', T.r1); check('повторный старт → та же незавершённая попытка', r.d.attempt_id === id);
    }
    await sql("UPDATE attempts SET status = 'failed', submitted_at = ?1, score_pct = 10 WHERE id = ?2", [Date.now(), id]);
  }
  r = await call('GET', '/api/reatt', T.r1); v = r.d.versions.find(x => x.key === 'full');
  check('попытки исчерпаны: видна, но начать нельзя', v && !v.can_start && v.access.left === 0 && /закончились/.test(v.reason), v);
  r = await call('POST', '/api/reatt/full/start', T.r1); check('3-я попытка → 403', r.status === 403, r.d);
  r = await call('GET', `/api/admin/reatt/${full.id}/access`, A); let g = r.d.grants.find(x => x.id === G1);
  check('админ видит выдачу: использовано 2 из 2, примечание, кто выдал', g && g.used === 2 && g.attempts === 2 && g.note === 'пересдача' && g.granted_by && !g.active, g);
  check('в форме — только пользователи с ролью «Переаттестация»', r.d.users.some(u => u.id === U.r1) && !r.d.users.some(u => u.id === U.vp), r.d.users);

  // ---------- 6. простая: срок истёк ----------
  r = await call('POST', `/api/admin/reatt/${simple.id}/access`, A, { user_id: U.r2, expires_at: Date.now() + 3600000, attempts: 1 }); const G2 = r.d.grant.id;
  r = await call('GET', '/api/reatt', T.r2); check('упрощённая видна по доступу', r.d.versions.some(x => x.key === 'simple'));
  r = await call('POST', '/api/reatt/simple/start', T.r2); const SA = r.d.attempt_id; r = await call('GET', '/api/attempts/' + SA, T.r2);
  check('упрощённая: 12 вопросов', r.d.attempt.questions.length === 12, r.d.attempt && r.d.attempt.questions.length);
  await sql('UPDATE reatt_access SET expires_at = ?1 WHERE id = ?2', [Date.now() - 1000, G2]);
  r = await call('GET', '/api/reatt', T.r2); check('срок истёк, но начатую попытку можно завершить', r.d.versions.some(x => x.key === 'simple' && x.active_attempt_id === SA));
  await sql("UPDATE attempts SET status = 'failed', submitted_at = ?1 WHERE id = ?2", [Date.now(), SA]);
  r = await call('GET', '/api/reatt', T.r2); check('срок истёк → переаттестация скрыта', !r.d.versions.some(x => x.key === 'simple'), r.d.versions);
  r = await call('POST', '/api/reatt/simple/start', T.r2); check('срок истёк → старт 403', r.status === 403);

  // ---------- 7. доступ всем с ролью, отзыв ----------
  r = await call('POST', `/api/admin/reatt/${cases.id}/access`, A, { user_id: null, expires_at: Date.now() + 3600000, attempts: 1 }); const G3 = r.d.grant && r.d.grant.id;
  check('выдан доступ всем с ролью', r.status < 300 && r.d.grant.user_id === null, r.d);
  r = await call('GET', '/api/reatt', T.r2); const c2 = r.d.versions.find(x => x.key === 'cases');
  r = await call('GET', '/api/reatt', T.r3); const c3 = r.d.versions.find(x => x.key === 'cases');
  check('общий доступ виден обоим кандидатам, у каждого — своя 1 попытка', c2 && c3 && c2.access.left === 1 && c3.access.left === 1);
  r = await call('GET', '/api/reatt', T.vp); check('без роли «Переаттестация» — 403 или пусто', r.status === 403 || (r.d.versions || []).length === 0, r.status);
  r = await call('POST', '/api/reatt/cases/start', T.r3); check('кандидат 3 начал кейсы по общему доступу', !!r.d.attempt_id, r.d);
  r = await call('GET', '/api/admin/reatt', A); check('в списке — число действующих выдач', r.d.items.find(x => x.key === 'cases').access.active === 1 && r.d.items.find(x => x.key === 'cases').access.global === 1);
  r = await call('DELETE', '/api/admin/reatt/access/' + G3, T.r2); check('кандидат не отзывает (403)', r.status === 403);
  r = await call('DELETE', '/api/admin/reatt/access/' + G3, A); check('админ отозвал доступ', r.status === 200, r.d);
  r = await call('GET', '/api/reatt', T.r2); check('после отзыва — скрыта', !r.d.versions.some(x => x.key === 'cases'));
  r = await call('POST', '/api/reatt/cases/start', T.r2); check('после отзыва — старт 403', r.status === 403);
  const au = await sql("SELECT action FROM audit_log WHERE action IN ('reatt.grant','reatt.revoke')");
  check('журнал: выдача и отзыв', au.some(x => x.action === 'reatt.grant') && au.some(x => x.action === 'reatt.revoke'), au);

  // ---------- 8. UI ----------
  const b = await chromium.launch(); const errs = [];
  async function page(tok, mob) { const ctx = await b.newContext(mob ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 900 } });
    if (tok) await ctx.addInitScript(t => { localStorage.setItem('vpexam_token', t); }, tok); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return p; }
  const go = async (p, h, sel) => { await p.goto(SITE + '#' + h); await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(200); };
  const P0 = await page(null); await P0.goto(SITE); await P0.waitForSelector('h1', { timeout: 15000 }); await P0.waitForTimeout(300);
  const body0 = await P0.textContent('body');
  check('UI: главная — «ГУ ВП — портал», без «Учебный центр» и приветствия', /ГУ ВП — портал/.test(body0) && !/Учебный центр|Добро пожаловать/.test(body0) && (await P0.title()) === 'ГУ ВП — портал', body0.slice(0, 300));
  await P0.screenshot({ path: SHOTS + 'portal-login.png' });

  const P3 = await page(T.r3); await go(P3, '/reatt', 'h1'); await P3.waitForTimeout(500);
  const t3 = await P3.textContent('#app');
  check('UI: кандидат без доступа видит пояснение', /доступ к конкретной переаттестации выдаёт администратор/i.test(t3) || /cases|Продолжить/.test(t3), t3.slice(0, 300));
  await call('POST', `/api/admin/reatt/${full.id}/access`, A, { user_id: U.r2, expires_at: until, attempts: 3 });
  const P2 = await page(T.r2); await go(P2, '/reatt', '.access-note');
  check('UI: у кандидата — «Доступ до … МСК · осталось попыток 3 из 3»', /Доступ до .* МСК · осталось попыток: 3 из 3/.test(await P2.textContent('.access-note')));
  await P2.screenshot({ path: SHOTS + 'portal-reatt-candidate.png', fullPage: true });

  const PA = await page(A); await go(PA, '/admin/reatt', 'a[href*="/access"]');
  check('UI: в списке переаттестаций — кнопка «🔑 Доступ»', (await PA.$$('a[href*="/access"]')).length >= 3);
  await go(PA, `/admin/reatt/${simple.id}/access`, '#gf');
  await PA.click('[data-q="eod"]'); const eod = await PA.inputValue('#gf [name=until]');
  check('UI: «до конца дня» → сегодня 23:59 МСК', eod === new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10) + 'T23:59', eod);
  await PA.selectOption('#gf [name=user_id]', U.r3); await PA.fill('#gf [name=attempts]', '2'); await PA.fill('#gf [name=note]', 'из UI');
  await PA.click('#gf button.gold'); await PA.waitForFunction(() => /из UI/.test(document.body.textContent), null, { timeout: 10000 });
  r = await call('GET', `/api/admin/reatt/${simple.id}/access`, A); g = r.d.grants.find(x => x.note === 'из UI');
  check('UI: выдача сохранена (до 23:59 МСК, 2 попытки)', g && g.user_id === U.r3 && g.attempts === 2 && g.expires_at === Date.parse(eod + ':00+03:00'), g);
  await PA.screenshot({ path: SHOTS + 'portal-reatt-access-admin.png', fullPage: true });
  await PA.click(`.g-rev[data-g="${g.id}"]`); await PA.waitForTimeout(1200);
  r = await call('GET', `/api/admin/reatt/${simple.id}/access`, A); check('UI: отзыв из интерфейса', r.d.grants.find(x => x.id === g.id).revoked_at > 0);
  await go(PA, '/admin/audit', 'h1'); await PA.waitForTimeout(600); check('UI: журнал — «Выдан доступ к переаттестации»', /Выдан доступ к переаттестации/.test(await PA.textContent('#app')));

  // типографика лекции
  r = await call('POST', '/api/admin/lectures', A, { title: 'Типографика: проверка', body: '# Раздел\n\nОбычный абзац текста лекции.\n\n## Подраздел\n\n- пункт один\n- пункт два\n\n> Важно: это выноска.', duration_sec: 60, published: true, required: false });
  const LID = r.d.lecture && r.d.lecture.id; check('текстовая лекция создана', !!LID, r.d);
  const PV = await page(A); await go(PV, '/lecture/' + LID, '.lecture-text');
  const ty = await PV.$eval('.lecture-text', el => { const s = getComputedStyle(el); const h = getComputedStyle(el.querySelector('h2')); return { ff: s.fontFamily, fs: parseFloat(s.fontSize), lh: parseFloat(s.lineHeight) / parseFloat(s.fontSize), mw: s.maxWidth, htt: h.textTransform, hff: h.fontFamily }; });
  check('лекция: шрифт Golos Text, 18px, межстрочный ≈1.7, ширина ≤72ch', /Golos Text/.test(ty.ff) && ty.fs === 18 && ty.lh > 1.6 && ty.lh < 1.8 && /ch|px/.test(ty.mw), ty);
  check('лекция: заголовки без капса и без Oswald', ty.htt === 'none' && !/Oswald/.test(ty.hff), ty);
  await PV.click('#fsUp'); await PV.click('#fsUp'); const fs2 = await PV.$eval('.lecture-text', el => parseFloat(getComputedStyle(el).fontSize));
  check('лекция: A+ увеличивает шрифт и запоминает', fs2 === 20 && (await PV.evaluate(() => localStorage.getItem('vp_lec_fs'))) === '20', fs2);
  await PV.click('#fsDn'); await PV.click('#fsDn');
  await PV.screenshot({ path: SHOTS + 'portal-lecture.png', fullPage: true });
  const PM = await page(A, true); await go(PM, '/lecture/' + LID, '.lecture-text');
  const mw = await PM.evaluate(() => document.documentElement.scrollWidth); check('лекция на телефоне: без горизонтальной прокрутки', mw <= 392, mw);
  await PM.screenshot({ path: SHOTS + 'portal-lecture-mobile.png', fullPage: true });
  await go(PM, `/admin/reatt/${full.id}/access`, '#gf'); const mw2 = await PM.evaluate(() => document.documentElement.scrollWidth);
  check('выдача доступа на телефоне: без горизонтальной прокрутки', mw2 <= 392, mw2);
  check('UI без ошибок JS', !errs.length, errs);
  await b.close();
  const ok = results.filter(x => x.ok).length;
  console.log(`\nИТОГО: ${ok}/${results.length} PASS`);
  fs.writeFileSync(__dirname + '/e2e-portal-reatt-results.json', JSON.stringify(results, null, 1));
  process.exit(ok === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
