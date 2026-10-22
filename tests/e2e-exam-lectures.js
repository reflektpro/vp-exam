// E2E: обязательные лекции для каждого экзамена. Запуск: wrangler dev (tests/wrangler.toml, TEST_MODE=1) на :8787 и serve.js на :8080.
const { chromium } = require('playwright');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || (__dirname + '/shots/');
const ADMIN = '417660389723996170', CAND = '300000000000000011', CAND2 = '300000000000000012';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 400) : '')); };
async function call(method, path, token, body) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let d = null; try { d = await r.json(); } catch (_) {}
  return { status: r.status, d };
}
const login = async (id, name) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}`)).json()).token;
const sleep = ms => new Promise(r => setTimeout(r, ms));
// «Просмотр» 5-секундной лекции через heartbeat в реальном времени (античит не обходится).
async function watch(tok, id) {
  await call('POST', `/api/lectures/${id}/heartbeat`, tok, { position: 0 });
  await sleep(3000); await call('POST', `/api/lectures/${id}/heartbeat`, tok, { position: 3 });
  await sleep(2500); const r = await call('POST', `/api/lectures/${id}/heartbeat`, tok, { position: 5 });
  return r.d && r.d.completed;
}
const VURL = 'http://localhost:8080/__media/test20.webm';

(async () => {
  const A = await login(ADMIN, 'Шерман'), C = await login(CAND, 'Кандидат Орлов'), C2 = await login(CAND2, 'Кандидат Белов');
  await call('PUT', '/api/admin/settings', A, { sequential_lectures: true });
  const mk = async (title, pub) => (await call('POST', '/api/admin/lectures', A, { title, video_url: VURL, duration_sec: 5, published: pub, required: true })).d.lecture.id;
  const L1 = await mk('Лекция 1. Устав ГУ ВП', true), L2 = await mk('Лекция 2. Закон об обороне', true), L3 = await mk('Лекция 3. Черновик о задержании', false);
  const mkExam = async (title, required_lectures) => {
    let r = await call('POST', '/api/admin/exams', A, { title, time_limit_min: 0, max_attempts: 0, cooldown_min: 0, pass_pct: 50, published: false, ...(required_lectures !== undefined ? { required_lectures } : {}) });
    const id = r.d.exam.id;
    await call('POST', `/api/admin/exams/${id}/questions`, A, { type: 'single', text: 'Кому подчиняется ГУ ВП?', points: 1, options: [{ text: 'Министру обороны', correct: true }, { text: 'Мэру' }] });
    r = await call('PUT', '/api/admin/exams/' + id, A, { published: true });
    return { id, r };
  };
  const EA = await mkExam('Экзамен A (нужна лекция 1)', [L1]);
  check('A создан с required_lectures=[L1]', EA.r.d.exam.lecture_mode === 'selected' && JSON.stringify(EA.r.d.exam.required_lecture_ids) === JSON.stringify([L1]), EA.r.d.exam);
  const EB = await mkExam('Экзамен B (нужна лекция 2)', [L2]);
  const EC = await mkExam('Экзамен C (по умолчанию — все)');
  check('по умолчанию режим «все опубликованные»', EC.r.d.exam.lecture_mode === 'all' && EC.r.d.exam.requires_lectures === 1, EC.r.d.exam);
  const ED = await mkExam('Экзамен D (без лекций)', []);
  check('пустой список → лекции не нужны', ED.r.d.exam.lecture_mode === 'none' && ED.r.d.exam.requires_lectures === 0, ED.r.d.exam);
  const EE = await mkExam('Экзамен E (только черновик)', [L3]);
  check('черновик в обязательных → предупреждение', EE.r.d.exam.lecture_warnings.some(w => /черновик/.test(w)) && EE.r.d.exam.lecture_warnings.some(w => /открыт без лекций/.test(w)), EE.r.d.exam.lecture_warnings);

  // валидация
  let r = await call('PUT', '/api/admin/exams/' + EA.id, A, { required_lectures: [999999] }); check('несуществующая лекция → 400', r.status === 400 && /не найдена/.test(r.d.error), r.d);
  r = await call('PUT', '/api/admin/exams/' + EA.id, A, { required_lectures: ['abc'] }); check('некорректный id → 400', r.status === 400, r.d);
  r = await call('PUT', '/api/admin/exams/' + EA.id, A, { required_lectures: 'some' }); check('неверный формат → 400', r.status === 400, r.d);
  r = await call('GET', '/api/admin/exams/' + EA.id, A); check('после ошибок A по-прежнему требует L1', JSON.stringify(r.d.exam.required_lecture_ids) === JSON.stringify([L1]), r.d.exam);
  r = await call('PUT', '/api/admin/exams/' + EA.id, C, { required_lectures: [] }); check('кандидат не может менять экзамен (403)', r.status === 403);

  // кандидат до просмотра
  const ex = async (tok) => Object.fromEntries((await call('GET', '/api/exams', tok)).d.exams.map(e => [e.id, e]));
  let E = await ex(C);
  check('до лекций: A закрыт', !E[EA.id].can_start && E[EA.id].lectures_left === 1, E[EA.id]);
  check('до лекций: B закрыт, L2 под замком порядка', !E[EB.id].can_start && E[EB.id].lectures[0].locked === true, E[EB.id]);
  check('до лекций: C (все) закрыт, 2 лекции', !E[EC.id].can_start && E[EC.id].lectures.length === 2, E[EC.id]);
  check('D (без лекций) открыт сразу', E[ED.id].can_start && E[ED.id].lecture_mode === 'none', E[ED.id]);
  check('E (только черновик) открыт — черновик игнорируется', E[EE.id].can_start && E[EE.id].lectures.length === 0, E[EE.id]);
  r = await call('POST', `/api/exams/${EA.id}/start`, C); check('start A до лекции → 403', r.status === 403 && /Устав/.test(r.d.error), r.d);

  // смотрим только лекцию 1
  check('лекция 1 засчитана', await watch(C, L1));
  E = await ex(C);
  check('после L1: A открыт', E[EA.id].can_start && E[EA.id].lectures_done, E[EA.id]);
  check('после L1: B закрыт, осталось «Закон об обороне»', !E[EB.id].can_start && E[EB.id].lectures_left === 1 && /Закон об обороне/.test(E[EB.id].reason), E[EB.id]);
  check('после L1: C закрыт (нужны все)', !E[EC.id].can_start && E[EC.id].lectures_left === 1, E[EC.id]);
  r = await call('POST', `/api/exams/${EB.id}/start`, C); check('start B → 403', r.status === 403, r.d);

  // submit проверяет лекции этого экзамена
  r = await call('POST', `/api/exams/${EA.id}/start`, C); check('start A → попытка', r.status === 200 && r.d.attempt_id, r.d); const AT = r.d.attempt_id;
  await call('PUT', '/api/admin/exams/' + EA.id, A, { required_lectures: [L1, L2] });
  r = await call('POST', `/api/attempts/${AT}/submit`, C, { answers: {} }); check('submit при невыполненных лекциях экзамена → 403', r.status === 403 && /Закон об обороне/.test(r.d.error), r.d);
  await call('PUT', '/api/admin/exams/' + EA.id, A, { required_lectures: [L1] });
  r = await call('POST', `/api/attempts/${AT}/submit`, C, { answers: {} }); check('submit после возврата условия → ok', r.status === 200 && r.d.ok, r.d);

  // удалённая лекция в обязательных
  const L4 = await mk('Лекция 4. Временная', true);
  await call('PUT', '/api/admin/exams/' + EE.id, A, { required_lectures: [L3, L4] });
  await call('DELETE', '/api/admin/lectures/' + L4, A);
  r = await call('GET', '/api/admin/exams', A); const ee = r.d.exams.find(x => x.id === EE.id);
  check('удалённая лекция → предупреждение в списке', ee.lecture_warnings.some(w => /удалена/.test(w)) && ee.required_lectures.some(l => l.deleted), ee);
  E = await ex(C); check('E с удалённой и черновиком — открыт', E[EE.id].can_start, E[EE.id]);

  // --- UI ---
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => check('нет JS-ошибок: ' + e.message, false));
  // войти под токеном и открыть страницу
  const as = async (tok, hash) => { await page.goto(SITE + '#/'); await page.evaluate(t => localStorage.setItem('vpexam_token', t), tok); await page.reload(); await page.waitForSelector('#logoutBtn'); await page.goto(SITE + '#' + hash); };
  await as(A, '/admin/exam/' + EB.id);
  await page.waitForSelector('#reqbox');
  check('форма: чекбокс на каждую лекцию', (await page.$$('.reql')).length === 3);
  check('форма: черновик помечен', /черновик/.test(await page.textContent('#reqList')));
  check('форма: отмечена лекция 2', await page.isChecked(`.reql[value="${L2}"]`) && !(await page.isChecked('#reqAll')));
  check('форма: подсказка про порядок', /строго по порядку/.test(await page.textContent('#reqHint')), await page.textContent('#reqHint'));
  await (await page.$('#reqbox')).scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOTS + '27_admin_exam_required_lectures.png', fullPage: true });
  await page.uncheck(`.reql[value="${L2}"]`);
  check('форма: ничего не выбрано → подсказка «открыт сразу»', /открыт сразу/.test(await page.textContent('#reqHint')));
  await page.screenshot({ path: SHOTS + '28_admin_exam_no_lectures_hint.png', fullPage: true });
  await page.check('#reqAll');
  check('форма: «все» блокирует список', await page.isDisabled(`.reql[value="${L1}"]`) && /всех опубликованных/.test(await page.textContent('#reqHint')));
  await page.uncheck('#reqAll'); await page.check(`.reql[value="${L2}"]`); await page.check(`.reql[value="${L3}"]`);
  check('форма: выбран черновик → предупреждение', /Черновики не учитываются/.test(await page.textContent('#reqHint')));
  await page.click('.pubbox [data-pub="1"]'); await sleep(1200);
  r = await call('GET', '/api/admin/exams/' + EB.id, A);
  check('UI-сохранение: B требует [L2, L3]', JSON.stringify(r.d.exam.required_lecture_ids) === JSON.stringify([L2, L3]), r.d.exam);
  await page.goto(SITE + '#/admin/exams'); await page.waitForSelector('table');
  check('список экзаменов: показаны лекции и предупреждения', /Закон об обороне/.test(await page.textContent('table')) && /не нужны/.test(await page.textContent('table')) && /удалена/.test(await page.textContent('table')));
  await page.screenshot({ path: SHOTS + '29_admin_exams_list_lectures.png', fullPage: true });
  await page.goto(SITE + '#/admin/settings'); await page.waitForSelector('#sf');
  await page.screenshot({ path: SHOTS + '30_admin_settings_order_hint.png', fullPage: true });

  // кандидат
  await as(C, '/exams'); await page.waitForSelector('.exam-card');
  const cardB = await page.textContent(`.exam-card[data-exam="${EB.id}"]`);
  check('карточка B: «Осталось посмотреть» + лекция 2', /Осталось посмотреть/.test(cardB) && /Закон об обороне/.test(cardB), cardB);
  check('карточка B: ссылка на лекцию', !!(await page.$(`.exam-card[data-exam="${EB.id}"] a.lchip[href="#/lecture/${L2}"]`)));
  const cardA = await page.textContent(`.exam-card[data-exam="${EA.id}"]`);
  check('карточка A: все лекции просмотрены', /Все нужные лекции просмотрены/.test(cardA), cardA);
  check('карточка D: лекции не требуются', /не требуются/.test(await page.textContent(`.exam-card[data-exam="${ED.id}"]`)));
  await page.screenshot({ path: SHOTS + '31_candidate_exams_left.png', fullPage: true });
  await page.goto(SITE + '#/exam/' + EB.id); await page.waitForSelector('#app .card .alert.warn');
  check('страница B: причина со списком лекций', /Сначала просмотрите лекции/.test(await page.textContent('#app')));
  await page.screenshot({ path: SHOTS + '32_candidate_exam_locked_left.png', fullPage: true });

  // кандидат 2 (ничего не смотрел): лекция 2 под замком порядка
  await as(C2, '/exams'); await page.waitForSelector('.exam-card');
  check('кандидат 2: замок порядка на лекции 2 в карточке B', /🔒/.test(await page.textContent(`.exam-card[data-exam="${EB.id}"]`)));
  await page.screenshot({ path: SHOTS + '33_candidate2_exams_sequential.png', fullPage: true });

  // досмотреть L2 → B и C открыты
  check('лекция 2 засчитана', await watch(C, L2));
  E = await ex(C);
  check('после L2: B открыт (L3 черновик не учитывается)', E[EB.id].can_start, E[EB.id]);
  check('после L2: C (все) открыт', E[EC.id].can_start, E[EC.id]);
  await as(C, '/exams'); await page.waitForSelector('.exam-card');
  await page.screenshot({ path: SHOTS + '34_candidate_exams_all_done.png', fullPage: true });
  await browser.close();
  const fail = results.filter(x => !x.ok).length;
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
