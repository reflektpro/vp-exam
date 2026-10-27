// E2E «Личные дела (досье сотрудников ГУ ВП)»: права (ВП не пишет, СС пишет), скрытие чувствительных полей, автоданные,
// повышение обновляет профиль, архив, журнал, вёрстка на телефоне. Headless, вход — /__test/login, без Discord.
// Запуск: bash /tmp/reset.sh (миграции 0001–0010), node serve.js (:8080).
const { chromium } = require('playwright');
const fs = require('fs');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || (__dirname + '/shots/'); fs.mkdirSync(SHOTS, { recursive: true });
const SUPER = '417660389723996170';
const U = { vp: '810000000000000001', vp2: '810000000000000002', none: '810000000000000003', ss: '810000000000000004', lead: '810000000000000005', vp3: '810000000000000006' };
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
const mondayMsk = (ms) => { const d = new Date(ms + 3 * 3600000); const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const addD = (w, n) => { const d = new Date(w + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const WEEK = mondayMsk(Date.now()), PREV = addD(WEEK, -7), P3 = addD(WEEK, -21);
const today = new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);

(async () => {
  const T = { super: await login(SUPER, 'super-admin'), vp: await login(U.vp, 'vp_ivan', 'vp'), vp2: await login(U.vp2, 'vp_petr', 'vp'), none: await login(U.none, 'nobody', 'none'),
    ss: await login(U.ss, 'ss_senior', 'vp'), lead: await login(U.lead, 'boss', 'leader'), vp3: await login(U.vp3, 'vp_new', 'vp') };
  await sql('UPDATE users SET senior = 1, staff = 1 WHERE id = ?1', [U.ss]);
  await call('PUT', '/api/me', T.vp, { ic_name: 'Иван Петров', rank: 'Лейтенант', static_id: '4455', position: 'Инспектор ВП' });

  // ---------- 1. кто старший состав ----------
  let r = await call('GET', '/api/me', T.ss); check('отметка «СС» (users.senior) → caps.ss', r.d.user.caps.ss === true && !r.d.user.caps.lead);
  r = await call('GET', '/api/me', T.lead); check('«Руководство ГУ ВП» → caps.ss', r.d.user.caps.ss === true);
  r = await call('GET', '/api/me', T.vp); check('обычный ВП — не СС', r.d.user.caps.ss === false);
  r = await call('GET', '/api/me', T.super); check('главный администратор — СС', r.d.user.caps.ss === true);

  // ---------- 2. заведение дела ----------
  r = await call('GET', '/api/people', T.vp); check('ВП: дел на тестовых сотрудников нет, кандидатов не видит, править нельзя', r.status === 200 && !r.d.people.some(p => Object.values(U).includes(p.id)) && r.d.candidates.length === 0 && r.d.can_edit === false, r.d);
  r = await call('GET', '/api/people', T.ss); check('СС: видит кандидатов (с ролью ВП — можно завести)', r.d.can_edit && r.d.candidates.some(c => c.id === U.vp && c.eligible) && r.d.candidates.some(c => c.id === U.none && !c.eligible), r.d.candidates);
  r = await call('POST', '/api/people/' + U.vp, T.vp2, {}); check('ВП не может завести дело (403)', r.status === 403, r.d);
  r = await call('POST', '/api/people/' + U.vp, T.none, {}); check('без ролей — 403', r.status === 403);
  r = await call('POST', '/api/people/' + U.none, T.lead, {}); check('дело только на сотрудника ГУ ВП (без роли ВП — 400)', r.status === 400, r.d);
  r = await call('POST', '/api/people/' + U.vp, T.ss, {}); check('СС заводит дело', r.status === 200 && r.d.dossier && r.d.dossier.status === 'active' && r.d.dossier.joined_on === today, r.d);
  r = await call('POST', '/api/people/' + U.vp, T.ss, {}); check('повторно — 409', r.status === 409);
  r = await call('POST', '/api/people/' + U.ss, T.lead, {}); check('руководство заводит дело на СС', r.status === 200);
  r = await call('POST', '/api/people/' + U.vp2, T.lead, {}); await call('POST', '/api/people/' + U.lead, T.super, {}).catch(() => {});

  // ---------- 3. ручные поля ----------
  const full = { ic_name: 'Иван Петров', static_id: '4455', rank: 'Лейтенант', position: 'Инспектор ВП', joined_on: '2026-03-15', discord: 'ivan#1', age: 23, timezone: 'МСК+2 (Екатеринбург)', online_hours: '4,5', online_time: '18:00–23:00 МСК',
    vehicles: [{ model: 'BMW M5', plate: 'а777аа77' }], service_cars: [{ model: 'УАЗ Патриот', plate: 'ВП 0123', main: true }, { model: 'Lada Vesta', plate: 'ВП 0456' }],
    law_score: 4, law_comment: 'Хорошо знает ПК, путается в КоАП', notes: 'Исполнительный, **надёжный**. СЕКРЕТНАЯ_ХАРАКТЕРИСТИКА' };
  r = await call('PUT', '/api/people/' + U.vp, T.vp2, full); check('ВП не может править дело (403)', r.status === 403);
  r = await call('PUT', '/api/people/' + U.vp, T.vp, full); check('сотрудник не правит своё дело сам (403)', r.status === 403);
  r = await call('PUT', '/api/people/' + U.vp, T.ss, { ...full, age: 7 }); check('проверка на сервере: возраст 7 — 400', r.status === 400);
  r = await call('PUT', '/api/people/' + U.vp, T.ss, { ...full, law_score: 6 }); check('оценка 6 — 400', r.status === 400);
  r = await call('PUT', '/api/people/' + U.vp, T.ss, { ...full, service_cars: [{ model: 'УАЗ' }] }); check('служебный авто без номера — 400', r.status === 400);
  r = await call('PUT', '/api/people/' + U.vp, T.ss, full);
  const z = r.d && r.d.dossier;
  check('СС сохраняет все ручные поля', r.status === 200 && z.age === 23 && z.timezone.startsWith('МСК+2') && z.online_hours === 4.5 && z.vehicles[0].plate === 'А777АА77' && z.service_cars.length === 2 && z.service_cars[0].main && !z.service_cars[1].main && z.law_score === 4 && z.notes.includes('надёжный') && z.joined_on === '2026-03-15', z);
  r = await call('PUT', '/api/people/' + U.ss, T.ss, { notes: 'сам себе' }); check('СС не правит СВОЁ дело (403)', r.status === 403);
  r = await call('PUT', '/api/people/' + U.vp, T.ss, { rank: 'Старший лейтенант' }); check('СС правит звание — обновляется профиль', r.status === 200 && r.d.person.rank === 'Старший лейтенант');
  r = await call('GET', '/api/me', T.vp); check('профиль сотрудника: звание из дела', r.d.user.rank === 'Старший лейтенант');

  // ---------- 4. скрытие чувствительных полей (сервер) ----------
  const SENS = ['age', 'timezone', 'law_score', 'law_comment', 'notes'];
  for (const [who, tok, vis] of [['другой ВП', T.vp2, false], ['без ролей', T.none, false], ['сам сотрудник', T.vp, true], ['СС', T.ss, true], ['руководство', T.lead, true]]) {
    r = await call('GET', '/api/people/' + U.vp, tok);
    const has = SENS.filter(k => r.d.dossier[k] !== undefined);
    const leak = r.raw.includes('СЕКРЕТНАЯ_ХАРАКТЕРИСТИКА') || r.raw.includes('МСК+2') || r.raw.includes('путается');
    check(`${who}: чувствительные поля ${vis ? 'видны' : 'скрыты на сервере'}`, r.status === 200 && (vis ? has.length === SENS.length && r.d.show_private : has.length === 0 && !leak && r.d.dossier.sensitive_hidden && r.d.log.length === 0), { has, leak });
    if (!vis) check(`${who}: открытые поля видны (ТС, служебные авто, онлайн, дата вступления)`, r.d.dossier.service_cars.length === 2 && r.d.dossier.vehicles.length === 1 && r.d.dossier.online_hours === 4.5 && r.d.dossier.joined_on === '2026-03-15');
  }

  // ---------- 5. записи в историю ----------
  r = await call('POST', `/api/people/${U.vp}/events`, T.vp2, { kind: 'penalty', subtype: 'Выговор', on_date: today, reason: 'x' }); check('ВП не добавляет взыскание (403)', r.status === 403);
  r = await call('POST', `/api/people/${U.vp}/events`, T.ss, { kind: 'penalty', subtype: 'Выговор', on_date: today, reason: '' }); check('взыскание без причины — 400', r.status === 400);
  r = await call('POST', `/api/people/${U.vp}/events`, T.ss, { kind: 'penalty', subtype: 'Выговор', on_date: today, reason: 'x', evidence: 'javascript:alert(1)' }); check('доказательство — только http(s)-ссылка', r.status === 400);
  r = await call('POST', `/api/people/${U.vp}/events`, T.ss, { kind: 'penalty', subtype: 'Выговор', on_date: '2026-10-01', reason: 'Нарушение устава п. 3.1', evidence: 'https://imgur.com/a/abc', issued_by: 'Майор Смирнов' });
  const pen1 = r.d.events.find(e => e.kind === 'penalty');
  check('СС добавляет выговор (дата, кем, основание, ссылка)', r.status === 200 && pen1 && pen1.active && pen1.issued_by === 'Майор Смирнов' && pen1.evidence.startsWith('https://imgur.com') && r.d.penalties_active === 1, r.d);
  r = await call('POST', `/api/people/${U.vp}/events`, T.ss, { kind: 'penalty', subtype: 'Строгий выговор', on_date: '2026-10-10', reason: 'Повторное нарушение' });
  const pen2 = r.d.events.find(e => e.subtype === 'Строгий выговор');
  r = await call('POST', `/api/people/${U.vp}/events`, T.ss, { kind: 'reward', subtype: 'Благодарность', on_date: '2026-09-20', reason: 'Задержание особо опасного' });
  check('поощрение', r.status === 200 && r.d.rewards_total === 1 && !r.d.events.find(e => e.kind === 'reward').issued_by === false);
  r = await call('POST', `/api/people/${U.vp}/events`, T.ss, { kind: 'note', on_date: today, reason: 'Просил перевод в ОМП' }); check('заметка', r.status === 200 && r.d.events.some(e => e.kind === 'note'));
  r = await call('POST', `/api/people/${U.vp}/events/${pen1.id}/lift`, T.ss, {}); check('снятие без основания — 400', r.status === 400);
  r = await call('POST', `/api/people/${U.vp}/events/${pen1.id}/lift`, T.vp2, { reason: 'x' }); check('ВП не снимает взыскание', r.status === 403);
  r = await call('POST', `/api/people/${U.vp}/events/${pen1.id}/lift`, T.ss, { reason: 'Отработал' });
  check('взыскание снято с отметкой (кем, когда, основание)', r.status === 200 && r.d.penalties_active === 1 && r.d.events.find(e => e.id === pen1.id).lift_reason === 'Отработал' && !!r.d.events.find(e => e.id === pen1.id).lifted_by);
  r = await call('PUT', `/api/people/${U.vp}/events/${pen2.id}`, T.ss, { reason: 'Повторное нарушение устава' }); check('запись можно исправить', r.status === 200 && r.d.events.find(e => e.id === pen2.id).reason === 'Повторное нарушение устава');

  // повышение → профиль
  r = await call('POST', `/api/people/${U.vp}/events`, T.ss, { kind: 'promotion', on_date: today, to_rank: 'Капитан', to_position: 'Командир роты ВП', reason: 'Приказ № 15' });
  const pr = r.d.events.find(e => e.kind === 'promotion');
  check('повышение: «с» — из профиля, «на» — новое', r.status === 200 && pr.from_rank === 'Старший лейтенант' && pr.to_rank === 'Капитан' && pr.from_position === 'Инспектор ВП' && pr.to_position === 'Командир роты ВП', pr);
  r = await call('GET', '/api/me', T.vp); check('повышение обновило звание и должность в профиле', r.d.user.rank === 'Капитан' && r.d.user.position === 'Командир роты ВП', r.d.user);
  r = await call('GET', '/api/admin/users/' + U.vp, T.super); check('в журнале профиля — изменение через личное дело', (r.d.profile_log || []).some(x => x.changes.rank && x.changes.rank[1] === 'Капитан'));
  r = await call('POST', `/api/people/${U.vp}/events`, T.ss, { kind: 'promotion', on_date: today, reason: 'нет «на»' }); check('повышение без нового звания/должности — 400', r.status === 400);

  // ---------- 6. автоданные ----------
  const rep = (week, n) => ({ week, position: 'Инспектор ВП', header: {}, items: [{ key: 'postavka', n, links: ['https://imgur.com/a/p'] }, { key: 'otbitie', n: 3, links: ['https://imgur.com/a/o'] }, { key: 'training', n: 2, links: ['https://imgur.com/a/t'] }] });
  r = await call('POST', '/api/reports', T.vp, rep(PREV, 10)); const repP = r.d.report;
  await sql('UPDATE reports SET late = 0, first_submitted_at = ?1 WHERE id = ?2', [Date.parse(PREV + 'T12:00:00Z'), repP.id]);
  await call('POST', `/api/lead/reports/${repP.id}/review`, T.lead, { status: 'approved' });
  await call('PUT', `/api/lead/week/${PREV}/fund`, T.lead, { fund: 10000000 });
  await sql('UPDATE users SET staff = 1, staff_since = ?1 WHERE id = ?2', [P3, U.vp]);
  const now = Date.now();
  await sql("INSERT INTO attempts (exam_id, user_id, status, started_at, submitted_at, score_pct, max_score) VALUES (1, ?1, 'passed', ?2, ?2, 80, 10)", [U.vp, now - 86400000 * 3]);
  await sql("INSERT INTO attempts (exam_id, user_id, status, started_at, submitted_at, score_pct, max_score) VALUES (1, ?1, 'failed', ?2, ?2, 50, 10)", [U.vp, now - 86400000 * 4]);
  const lec = (await sql('SELECT id FROM lectures WHERE published = 1 ORDER BY id LIMIT 1'))[0];
  if (lec) await sql('INSERT OR REPLACE INTO lecture_progress (user_id, lecture_id, max_pos, last_pos, watched_sec, started_at, completed_at) VALUES (?1, ?2, 100, 100, 100, ?3, ?3)', [U.vp, lec.id, now - 86400000 * 5]);
  r = await call('GET', '/api/people/' + U.vp, T.vp2);
  const D = r.d; const rp = D.reports.find(x => x.week === PREV);
  check('отчёты: неделя, дата отправки, в срок, уровень плана, баллы, статус', rp && rp.submitted_at && rp.late === false && ['normal', 'min', 'none'].includes(rp.plan) && rp.plan_final && rp.status === 'approved' && typeof rp.points === 'number', rp);
  check('отчёты: премия видна роли ВП (неделя проверена)', rp && rp.premium && !rp.premium.pending && typeof rp.premium.total === 'number', rp && rp.premium);
  r = await call('GET', '/api/people/' + U.vp, T.none); check('без роли ВП премия не отдаётся', !r.d.show_money && !r.d.reports.some(x => x.premium));
  check('авто-нарушения по отчётам (недели без отчёта в срок)', D.violations.length >= 1 && D.strikes >= 1 && D.violations.every(v => v.measure), D.violations);
  check('попытки экзаменов: дата, балл, сдан/нет', D.attempts.length === 2 && D.attempts.some(a => a.passed && a.score_pct === 80) && D.attempts.some(a => !a.passed && a.score_pct === 50));
  check('знание законодательства по тестам: лучший/средний %', D.law_auto.all && D.law_auto.all.best === 80 && D.law_auto.all.avg === 65 && D.law_auto.exams.n === 2, D.law_auto);
  check('обучение: прогресс курсов/лекций', !lec || (D.lectures_done === 1 && D.courses.some(c => c.done >= 1)), D.courses);
  const types = new Set(D.timeline.map(t => t.type));
  check('единая хронология: записи СС + отчёты + нарушения + экзамены + лекции', ['penalty', 'reward', 'promotion', 'note', 'report', 'violation', 'exam'].every(t => types.has(t)) && (!lec || types.has('lecture')), [...types]);
  check('хронология отсортирована (новые сверху)', D.timeline.every((t, i) => i === 0 || (D.timeline[i - 1].at || 0) >= (t.at || 0)));
  r = await call('GET', '/api/lead/violations', T.lead); const lv = r.d.users.find(u => u.user_id === U.vp);
  check('нарушения (руководство): рядом показаны ручные взыскания из дела', lv && lv.dossier_penalties === 1 && lv.strikes >= 1, lv);
  r = await call('GET', '/api/people', T.vp2); const card = r.d.people.find(p => p.id === U.vp);
  check('список: активные взыскания, авто-нарушения, основной служебный авто', card && card.pen_active === 1 && card.strikes >= 1 && card.car === 'УАЗ Патриот · ВП 0123', card);

  // ---------- 7. журнал ----------
  r = await call('GET', '/api/people/' + U.vp, T.vp);
  const acts = new Set(r.d.log.map(x => x.action));
  check('журнал: все правки с автором', ['dossier.create', 'dossier.update', 'dossier.event.add', 'dossier.event.lift', 'dossier.event.update', 'profile.update'].every(a => acts.has(a)) && r.d.log.every(x => x.by), [...acts]);
  const upd = r.d.log.find(x => x.action === 'dossier.update' && x.details.age !== undefined);
  check('журнал не хранит значения чувствительных полей (только факт)', upd && upd.details.age === true && upd.details.notes === true && !JSON.stringify(r.d.log).includes('СЕКРЕТНАЯ'), upd);
  r = await call('DELETE', `/api/people/${U.vp}/events/${pen2.id}`, T.vp2); check('ВП не удаляет запись', r.status === 403);
  r = await call('DELETE', `/api/people/${U.vp}/events/${pen2.id}`, T.ss); check('удаление записи — мягкое, в журнале', r.status === 200 && !r.d.events.some(e => e.id === pen2.id) && r.d.log.some(x => x.action === 'dossier.event.delete'));
  check('после удаления активных взысканий нет', r.d.penalties_active === 0);
  await call('POST', `/api/people/${U.vp}/events`, T.ss, { kind: 'penalty', subtype: 'Предупреждение', on_date: today, reason: 'Опоздание на построение' });

  // ---------- 8. архив ----------
  r = await call('POST', `/api/people/${U.vp2}/archive`, T.vp, { reason: 'x' }); check('ВП не переводит в архив', r.status === 403);
  r = await call('POST', `/api/people/${U.vp2}/archive`, T.ss, {}); check('архив без причины — 400', r.status === 400);
  r = await call('POST', `/api/people/${U.vp2}/archive`, T.ss, { reason: 'Уволен по собственному желанию' });
  check('увольнение: дело в архиве, не удалено, запись в истории', r.status === 200 && r.d.dossier.status === 'archived' && r.d.events.some(e => e.kind === 'archive'));
  r = await call('GET', '/api/people', T.none); const ac = r.d.people.find(p => p.id === U.vp2); check('архивное дело остаётся в списке с отметкой', ac && ac.archived && ac.archive_reason.includes('Уволен'));
  r = await call('POST', `/api/people/${U.vp2}/restore`, T.ss, { reason: 'Восстановлен' }); check('возврат из архива', r.status === 200 && r.d.dossier.status === 'active');
  await call('POST', `/api/people/${U.vp2}/archive`, T.ss, { reason: 'Уволен' });

  // ---------- 9. заведение дел миграцией 0010 (тот же SQL) ----------
  const mig = fs.readFileSync(__dirname + '/../worker/migrations/0010_dossiers.sql', 'utf8');
  const seed = mig.slice(mig.indexOf('INSERT OR IGNORE INTO dossiers'));
  await sql(seed.trim().replace(/;\s*$/, ''));
  const cnt = await sql('SELECT user_id, status FROM dossiers ORDER BY user_id');
  check('миграция заводит дела на всех с ролью ВП / в составе, существующие не трогает', cnt.some(x => x.user_id === U.vp3) && !cnt.some(x => x.user_id === U.none) && cnt.find(x => x.user_id === U.vp2).status === 'archived', cnt);

  // ---------- 10. интерфейс ----------
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  async function page(tok, vp) { const ctx = await b.newContext(vp ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript(t => { localStorage.setItem('vpexam_token', t); }, tok); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept(d.type() === 'prompt' ? 'Основание из теста' : undefined)); return p; }
  const go = async (p, h, sel) => { await p.goto(SITE + '#' + h); await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(150); };
  const P = await page(T.ss);
  await go(P, '/people', '.pcard');
  check('UI СС: список дел + кнопка «Завести дело»', await P.isVisible('#newdz') && (await P.$$('.pcard')).length >= 3);
  await P.click('#newdz'); await P.waitForSelector('.crow');
  check('UI СС: кандидаты без роли ВП недоступны', await P.locator('.crow', { hasText: 'nobody' }).locator('text=нет роли «ВП»').count() === 1);
  await go(P, '/people?pen=1', '.people');
  const penNames = await P.$$eval('.pcard b', l => l.map(x => x.textContent));
  check('UI фильтр «есть активные взыскания»', penNames.includes('Иван Петров') && !penNames.includes('vp_new'), penNames);
  await go(P, '/people?st=archived', '.people'); check('UI фильтр «Архив»', (await P.$$eval('.pcard b', l => l.map(x => x.textContent))).join() === 'vp_petr');
  await go(P, '/person/' + U.vp, '.dztabs');
  await P.screenshot({ path: SHOTS + 'dossier-main.png', fullPage: true });
  check('UI карточка: вкладки, кнопки СС, характеристика видна', (await P.$$('.dztabs a')).length === 8 && await P.isVisible('a:has-text("Редактировать")') && (await P.textContent('#dzbody')).includes('надёжный'));
  const tabs = ['timeline', 'cars', 'reports', 'discipline', 'service', 'study', 'log']; const tabBad = [];
  for (const t of tabs) { await go(P, `/person/${U.vp}?tab=${t}`, '#dzbody'); const txt = await P.textContent('#dzbody'); if (!txt || txt.length < 20) tabBad.push(t); if (t === 'discipline' || t === 'reports') await P.screenshot({ path: SHOTS + `dossier-${t}.png`, fullPage: true }); }
  check('UI все вкладки открываются', !tabBad.length, tabBad);
  await go(P, `/person/${U.vp}?tab=cars`, '.plate'); check('UI транспорт: номера ТС и служебных авто', (await P.textContent('#dzbody')).includes('ВП 0123') && (await P.textContent('#dzbody')).includes('А777АА77'));
  // редактирование через форму
  await go(P, `/person/${U.vp}/edit`, '#dzf');
  await P.fill('[name=online_time]', '20:00–02:00 МСК'); await P.click('#addveh'); const vr = P.locator('#pcars .vrow').last(); await vr.locator('[name=model]').fill('Mercedes G63'); await vr.locator('[name=plate]').fill('о001оо77');
  await P.click('.lp:has(input[value="5"])'); await P.click('#dzf button.gold'); await P.waitForSelector('.dztabs');
  r = await call('GET', '/api/people/' + U.vp, T.ss);
  check('UI форма редактирования сохраняет (время онлайна, новое ТС, оценка 5)', r.d.dossier.online_time === '20:00–02:00 МСК' && r.d.dossier.vehicles.length === 2 && r.d.dossier.law_score === 5, r.d.dossier);
  // запись через форму
  await go(P, `/person/${U.vp}/event?kind=reward`, '#evf'); await P.fill('[name=reason]', 'Лучший патруль недели'); await P.click('#evf button.gold'); await P.waitForSelector('.dztabs');
  r = await call('GET', '/api/people/' + U.vp, T.ss); check('UI форма записи: поощрение добавлено', r.d.events.some(e => e.kind === 'reward' && e.reason === 'Лучший патруль недели' && e.subtype === 'Благодарность'));
  await go(P, `/person/${U.vp}/event?kind=promotion`, '#evf');
  check('UI повышение: поля «с → на», «с» заполнено из профиля', await P.isVisible('[name=to_rank]') && (await P.inputValue('[name=from_rank]')) === 'Капитан');
  await go(P, `/person/${U.vp}?tab=discipline`, '[data-lift]'); await P.click('[data-lift]'); await P.waitForTimeout(800);
  r = await call('GET', '/api/people/' + U.vp, T.ss); check('UI кнопка «Снять» снимает взыскание (с основанием)', r.d.penalties_active === 0 && r.d.events.some(e => e.lift_reason === 'Основание из теста'));
  // ВП — только просмотр
  const V = await page(T.vp2);
  await go(V, '/person/' + U.vp, '.dztabs');
  const vt = await V.textContent('main');
  check('UI ВП: нет кнопок правки, чувствительное скрыто, есть пометка 🔒', !(await V.isVisible('a:has-text("Редактировать")')) && !vt.includes('надёжный') && !vt.includes('Возраст (ИРЛ)') && !vt.includes('Часовой пояс') && vt.includes('видны только старшему составу') && (await V.$$('.dztabs a')).length === 7);
  await go(V, `/person/${U.vp}/edit`, '.alert.err'); check('UI ВП: страница правки закрыта', (await V.textContent('.alert.err')).includes('старший состав'));
  await go(V, '/people', '.pcard'); check('UI ВП: нет «Завести дело»', !(await V.isVisible('#newdz')));
  // телефон
  const M = await page(T.ss, true); const mob = [];
  for (const [h, sel, shot] of [['/people', '.pcard', 'm-list'], ['/person/' + U.vp, '.dztabs', 'm-main'], [`/person/${U.vp}?tab=reports`, '#dzbody', 'm-reports'], [`/person/${U.vp}?tab=discipline`, '.ev', 'm-discipline'], [`/person/${U.vp}?tab=timeline`, 'ol.tl', 'm-timeline'], [`/person/${U.vp}/edit`, '#dzf', 'm-edit'], [`/person/${U.vp}/event`, '#evf', 'm-event']]) {
    await go(M, h, sel); const w = await M.evaluate(() => document.documentElement.scrollWidth); if (w > 392) mob.push(h + ':' + w);
    await M.screenshot({ path: SHOTS + `dossier-${shot}.png`, fullPage: shot !== 'm-edit' });
  }
  check('телефон 390px: без горизонтальной прокрутки (список, карточка, отчёты, взыскания, хронология, формы)', !mob.length, mob);
  await go(M, `/person/${U.vp}?tab=reports`, 'table.dzt'); const hd = await M.$eval('table.dzt tr', tr => getComputedStyle(tr).display);
  check('телефон: таблица отчётов — карточками', hd === 'none');
  check('UI без ошибок JS', !errs.length, errs);
  await b.close();
  const ok = results.filter(x => x.ok).length;
  console.log(`\nИТОГО: ${ok}/${results.length} PASS`);
  fs.writeFileSync(__dirname + '/e2e-dossier-results.json', JSON.stringify(results, null, 1));
  process.exit(ok === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
