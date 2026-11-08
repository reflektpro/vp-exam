// Мониторинг законодательства и консольный интерфейс.
// Вход только через /__test/login. Отчёт в тесте — фикстура (offline: true), не живой форум.
// Не вызывает боевой API, не шлёт Discord, не трогает /admin/recovery.
const { chromium } = require('playwright');
const fs = require('fs');
const API = process.env.API || 'http://127.0.0.1:8787';
const SITE = process.env.SITE || 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || '/tmp/vp-shots/';
fs.mkdirSync(SHOTS, { recursive: true });
const SUPER = '417660389723996170';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 500) : '')); };
async function call(method, path, token, body, headers) {
  const h = { ...(headers || {}) };
  if (token) h.Authorization = 'Bearer ' + token;
  if (body !== undefined && !h['Content-Type']) h['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch (_) {}
  return { status: r.status, d, raw: t };
}
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name || 'tester')}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, args) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args }) })).json()).results;

const DOCS = ['vu','du','kps','su','pk','uk','koap','tk','fz_oborona','fz_oruzhie','fz_territorii','fz_gostayna','fz_gossluzhba','fz_vozduh','fkz_rezhimy','upk'];
function shell(over, opt = {}) {
  const map = {};
  for (const id of DOCS) map[id] = id === 'du'
    ? { id, status: 'manual' }
    : { id, status: 'unchanged', text_changed: false, edition_old: 'ред. A', edition_new: 'ред. A', quotes_checked: 1 };
  Object.assign(map, over);
  return {
    mode: 'check', offline: true, partial: false, applied_locally: false, source: 'upload',
    runner: 'e2e-fixture', generated_at: Date.now(), documents: DOCS.map(id => map[id]), ...opt,
  };
}

(async () => {
  const A = await login(SUPER, 'super-admin', 'admin');
  const C = await login('860000000000000091', 'cand', 'none');
  const E = await login('860000000000000092', 'exam', 'examiner');
  const rows = await sql("SELECT id, ext_id, correct, text, source_ref, source_doc FROM questions WHERE active = 1 AND ext_id IS NOT NULL AND ext_id != '' LIMIT 1");
  check('в базе есть активный вопрос для сверки', rows && rows[0] && rows[0].ext_id, rows);
  const q = rows[0];
  const before = { correct: q.correct, text: q.text, source_ref: q.source_ref };

  let r = await call('GET', '/api/admin/laws');
  check('без сессии список проверок — 401', r.status === 401, r.d);
  r = await call('GET', '/api/admin/laws', C);
  check('кандидат не видит мониторинг — 403', r.status === 403, r.d);
  r = await call('GET', '/api/admin/laws', E);
  check('проверяющий без прав администратора — 403', r.status === 403, r.d);
  r = await call('GET', '/api/admin/laws', A);
  check('до отчёта портал честно пуст и не скачивает форум', r.status === 200 && r.d.checks_total === 0 && r.d.pipeline && r.d.pipeline.fetches_forum === false && r.d.pipeline.rewrites_answers === false, r.d && r.d.pipeline);
  check('ДУ из каталога вручную, без успешной автопроверки', r.d.documents.find(d => d.id === 'du').monitor_status === 'manual' && r.d.documents.find(d => d.id === 'du').last_ok_at == null && /Яндекс/.test(r.d.documents.find(d => d.id === 'du').manual_reason));
  check('остальные документы ещё не проверены', r.d.documents.filter(d => d.id !== 'du').every(d => d.monitor_status === 'unchecked'));

  r = await call('POST', '/api/admin/laws/reports', A, shell());
  check('загрузка офлайн-отчёта без правок — 201', r.status === 201 && r.d.check && r.d.check.offline === true && r.d.questions_unchanged === true, r.d);
  r = await call('POST', '/api/admin/laws/reports', A, shell(), { Origin: 'https://evil.example', 'Content-Type': 'application/json' });
  check('чужой Origin не публикует отчёт', r.status === 403, r.d);
  r = await call('POST', '/api/admin/laws/reports', C, shell());
  check('кандидат не публикует отчёт', r.status === 403, r.d);
  r = await call('POST', '/api/admin/laws/reports', A, { mode: 'apply' });
  check('режим apply отклонён', r.status === 400, r.d);
  const badDu = shell({ du: { id: 'du', status: 'unchanged', text_changed: false } });
  r = await call('POST', '/api/admin/laws/reports', A, badDu);
  check('ДУ нельзя пометить автоматическим успехом', r.status === 400, r.d);

  const report = shell({
    pk: {
      id: 'pk', status: 'changed', text_changed: true, edition_old: 'ред. A', edition_new: 'ред. B',
      added: [], removed: [], added_count: 0, removed_count: 0, changed_count: 1, quotes_checked: 1,
      changed_units: [{ unit: 'ст. 1', diff: '- было\n+ <img src=x onerror=alert(1)>', old: 'было', new: '<img src=x onerror=alert(1)>' }],
      questions: [{ ext_id: q.ext_id, base: q.source_doc || 'simple', ref: 'тест', issue: 'missing', excerpt: 'цитаты нет в новом тексте' }],
    },
    uk: { id: 'uk', status: 'unavailable', error: 'форум не отдал страницу (фикстура)', text_changed: false, edition_old: '', edition_new: '' },
  });
  r = await call('POST', '/api/admin/laws/reports', A, report);
  check('отчёт с правкой и сбоем принят', r.status === 201 && r.d.check.status === 'partial', r.d);
  const dup = await call('POST', '/api/admin/laws/reports', A, report);
  check('повтор того же отчёта не плодит карточку', dup.status === 200 && dup.d.duplicate === true, dup.d);
  r = await call('GET', '/api/admin/laws', A);
  const pk = r.d.documents.find(d => d.id === 'pk');
  const uk = r.d.documents.find(d => d.id === 'uk');
  check('ПК ждёт решения, УК показывает сбой, а не успех', pk.monitor_status === 'changed' && pk.pending_proposal_id && uk.monitor_status === 'unavailable' && /фикстура/.test(uk.last_error) && uk.last_ok_at, { pk: pk.monitor_status, uk: uk.monitor_status, ok: uk.last_ok_at });
  // last_ok_at у УК должен остаться от первого успешного отчёта, сбой его не затирает
  check('сбой не стирает время прошлого успешного чтения УК', !!uk.last_ok_at && !!uk.last_error_at);
  const propId = pk.pending_proposal_id;
  r = await call('GET', '/api/admin/laws/proposals/' + propId, A);
  check('карточка содержит старый и новый фрагмент и не отдаёт правильный ответ', r.status === 200 && r.d.diff.units[0].old === 'было' && r.d.diff.units[0].new.includes('onerror') && !JSON.stringify(r.d).includes('"correct"'), r.d && r.d.proposal);
  const flagged = (r.d.questions || []).find(x => x.ext_id === q.ext_id);
  check('затронутый вопрос сопоставлен с банком', flagged && flagged.question_id === q.id && flagged.issue === 'missing', flagged);

  r = await call('POST', `/api/admin/laws/proposals/${propId}/decision`, A, { action: 'approve', generation: 1, note: 'нет' });
  check('короткий комментарий не проходит', r.status === 400, r.d);
  r = await call('POST', `/api/admin/laws/proposals/${propId}/decision`, A, { action: 'approve', generation: 99, note: 'сверка фикстуры' });
  check('чужое поколение не одобряет', r.status === 409, r.d);
  r = await call('POST', `/api/admin/laws/proposals/${propId}/decision`, E, { action: 'approve', generation: 1, note: 'сверка фикстуры' });
  check('проверяющий не одобряет', r.status === 403, r.d);
  const okDecision = await call('POST', `/api/admin/laws/proposals/${propId}/decision`, A, { action: 'approve', generation: 1, note: 'редакцию видел, ответы не трогаю' });
  check('одобрение честно не меняет ответы', okDecision.status === 200 && okDecision.d.questions_unchanged === true && /не измен/.test(okDecision.d.message), okDecision.d);
  const again = await call('POST', `/api/admin/laws/proposals/${propId}/decision`, A, { action: 'approve', generation: 1, note: 'повтор того же решения' });
  check('повторное одобрение — 409', again.status === 409, again.d);
  const after = (await sql('SELECT correct, text, source_ref FROM questions WHERE id = ?1', [q.id]))[0];
  check('строка вопроса в D1 не изменилась', after.correct === before.correct && after.text === before.text && after.source_ref === before.source_ref, after);

  r = await call('POST', '/api/admin/laws/flags/' + q.id + '/ack', A, { note: 'цитату сверим отдельно, ответ оставляю авторский' });
  check('пометку можно закрыть без правки ответа', r.status === 200 && r.d.questions_unchanged === true, r.d);
  r = await call('POST', '/api/admin/laws/flags/' + q.id + '/ack', A, { note: 'ещё раз то же самое' });
  check('повторное закрытие пометки — 409', r.status === 409, r.d);
  const hist = await call('GET', '/api/admin/laws/history', A);
  const actions = (hist.d.events || []).map(e => e.action);
  check('история хранит публикацию, одобрение и просмотр', ['report.ingest', 'proposal.approve', 'flag.ack'].every(a => actions.includes(a)), actions);

  // отказ на другой карточке
  const rejReport = shell({
    koap: { id: 'koap', status: 'changed', text_changed: true, edition_old: '1', edition_new: '2', added: ['п. 9'], removed: [], added_count: 1, removed_count: 0, changed_count: 0, changed_units: [], questions: [], quotes_checked: 0 },
  });
  r = await call('POST', '/api/admin/laws/reports', A, rejReport);
  const koapId = r.d && r.status === 201 ? (await call('GET', '/api/admin/laws', A)).d.documents.find(d => d.id === 'koap').pending_proposal_id : null;
  check('карточка КоАП создана', !!koapId, r.d);
  r = await call('POST', `/api/admin/laws/proposals/${koapId}/decision`, A, { action: 'reject', generation: 1, note: 'правка не подтверждена' });
  check('отклонение записано и ответы не трогает', r.status === 200 && r.d.proposal.status === 'rejected' && r.d.questions_unchanged === true, r.d);

  const browser = await chromium.launch({ executablePath: process.env.CHROME || '/usr/bin/google-chrome', headless: true, args: ['--no-sandbox'] });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await desktop.addInitScript(t => localStorage.setItem('vpexam_token', t), A);
  const page = await desktop.newPage();
  let dialog = false;
  page.on('dialog', () => { dialog = true; });
  await page.goto(SITE + '#/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.hub-main');
  check('главная: заголовок портала и фото на фоне', /ГУ ВП — портал/.test(await page.textContent('body')) && await page.locator('.scene-photo').count() === 1);
  await page.screenshot({ path: SHOTS + 'home-desktop.png' });
  await page.click('#burger');
  await page.waitForSelector('.drawer-nav a');
  check('меню с клавиатуры: шторка открыта', await page.getAttribute('#drawer', 'aria-hidden') === 'false');
  await page.screenshot({ path: SHOTS + 'drawer-desktop.png' });
  await page.keyboard.press('Escape');
  await page.goto(SITE + '#/theme', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.bgopt');
  const nBg = await page.locator('.bgopt').count();
  check('галерея фонов открывается и не пустая', nBg >= 8, nBg);
  await page.locator('.bgopt').nth(2).click();
  await page.waitForTimeout(400);
  check('выбор фона меняет data-bg', (await page.evaluate(() => document.documentElement.dataset.bg)) !== 'quebec-night');
  await page.screenshot({ path: SHOTS + 'theme-desktop.png' });
  await page.goto(SITE + '#/admin/laws', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.law-card');
  check('админка показывает офлайн-пометку, а не живой успех форума', /офлайн/.test(await page.textContent('body')) && /не скачивает/.test(await page.textContent('body')));
  await page.locator('.law-grid').scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOTS + 'laws-desktop.png' });
  await page.click('a[href="#/admin/laws/doc/pk"]');
  await page.waitForSelector('.diffbox');
  const html = await page.content();
  check('diff экранирован, скрипт из фикстуры не вставлен узлом', html.includes('&lt;img') && !html.includes('<img src=x onerror'));
  check('диалог alert из diff не всплыл', dialog === false);
  await page.locator('.diffbox').scrollIntoViewIfNeeded();
  await page.screenshot({ path: SHOTS + 'laws-diff-desktop.png' });

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await mobile.addInitScript(t => localStorage.setItem('vpexam_token', t), A);
  const mp = await mobile.newPage();
  await mp.goto(SITE + '#/', { waitUntil: 'domcontentloaded' });
  await mp.waitForSelector('#burger');
  await mp.screenshot({ path: SHOTS + 'home-mobile.png' });
  await mp.goto(SITE + '#/admin/laws', { waitUntil: 'domcontentloaded' });
  await mp.waitForSelector('.law-card');
  await mp.screenshot({ path: SHOTS + 'laws-mobile.png' });
  const dur = await mp.evaluate(() => getComputedStyle(document.querySelector('.scene-photo')).transitionDuration);
  check('reduced motion гасит переход фона', dur === '0s' || parseFloat(dur) < 0.05, dur);
  await mp.goto(SITE + '#/theme', { waitUntil: 'domcontentloaded' });
  await mp.waitForSelector('.bgopt');
  await mp.locator('.bgopt[aria-checked="true"]').focus();
  await mp.keyboard.press('ArrowRight');
  const pressed = await mp.evaluate(() => document.activeElement && document.activeElement.getAttribute('aria-checked'));
  check('стрелка выбирает соседний фон', pressed === 'true');
  await mp.screenshot({ path: SHOTS + 'theme-mobile.png' });

  // спокойный экран попытки: если нет своей попытки, достаточно класса calm на маршруте экзамена-заглушки
  await mp.goto(SITE + '#/exam/1', { waitUntil: 'domcontentloaded' });
  await mp.waitForFunction(() => document.body.classList.contains('calm'));
  const calm = await mp.evaluate(() => document.body.classList.contains('calm') && getComputedStyle(document.querySelector('.scene')).visibility === 'hidden');
  check('экран экзамена без фонового кадра', calm === true);
  await mp.screenshot({ path: SHOTS + 'exam-calm-mobile.png' });
  await browser.close();

  const failed = results.filter(x => !x.ok);
  fs.writeFileSync(SHOTS + 'e2e-laws-results.json', JSON.stringify({ ok: failed.length === 0, failed: failed.map(x => x.name), shots: 'test fixture, offline report, __test/login' }, null, 2));
  console.log(failed.length ? `FAILED ${failed.length}` : 'ALL PASS');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
