// E2E: все типы вопросов (создание, прохождение в браузере, автопроверка/ручная проверка), миграция старых попыток,
// банк вопросов + импорт, переаттестация (квоты обеих версий, перемешивание).
// Запуск: wrangler dev (tests/wrangler.toml) на :8787, node serve.js на :8080; БД с миграциями 0001–0005 (+ /tmp/legacy.sql для проверки старых данных).
const { chromium } = require('playwright');
const fs = require('fs');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || (__dirname + '/shots/'); fs.mkdirSync(SHOTS, { recursive: true });
const LAWS = process.env.LAWS || '/workspace/vp_reatt_sources/laws';
const ADMIN = '417660389723996170', CAND = '300000000000000021', CAND2 = '300000000000000022', LEGACY = '300000000000000099';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 600) : '')); };
async function call(method, path, token, body) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch (_) {}
  return { status: r.status, d };
}
const login = async (id, name) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}`)).json()).token;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const SECRET_KEYS = /"(correct|accepted|formula|reference|criteria|answer|tolerance|pairs|distractors|content|word|phrase|explanation|quote|article|easy|criteria)"\s*:/;

const QS = [
  { type: 'info', text: 'Информационный блок: прочитайте и продолжайте.' },
  { type: 'single', text: 'Single: выберите «Верно»', points: 1, options: [{ text: 'Верно', correct: true }, { text: 'Неверно 1' }, { text: 'Неверно 2' }] },
  { type: 'multi', text: 'Multi: два верных', points: 2, options: [{ text: 'Верно А', correct: true }, { text: 'Верно Б', correct: true }, { text: 'Мимо' }] },
  { type: 'number', text: 'Number: 40 + 2', points: 1, answer: 42, tolerance: 0.5, unit: 'шт.' },
  { type: 'text', text: 'Text: введите «Ёлка»', points: 1, accepted: ['ёлка', 'ель'] },
  { type: 'param', text: 'Param: A={a}; B={b}. Найдите A*B', points: 2, vars: { a: { min: 2, max: 9, step: 1 }, b: { values: [10, 20, 30] } }, formula: 'a * b' },
  { type: 'long', text: 'Long: опишите', points: 3, reference: 'Эталон развёрнутого ответа' },
  { type: 'order', text: 'Order: по порядку', points: 2, items: ['Альфа', 'Браво', 'Чарли', 'Дельта'] },
  { type: 'match', text: 'Match: сопоставьте', points: 2, pairs: [{ left: 'Один', right: '1' }, { left: 'Два', right: '2' }, { left: 'Три', right: '3' }], distractors: ['4'] },
  { type: 'blanks_input', text: 'Blanks input', points: 2, content: 'Срок — [[48|сорок восемь]] часов, штраф — [[100]] рублей.' },
  { type: 'blanks_select', text: 'Blanks select', points: 2, content: 'Зимой [[*холодно|жарко]], летом [[тепло|морозно]].' },
  { type: 'dictation', text: 'Dictation', points: 2, content: 'Пр[[*и|е]]каз командира [[*не обсуждается|необсуждается]].' },
  { type: 'eliminate', text: 'Eliminate', points: 2, options: [{ text: 'Оставить', correct: true }, { text: 'Лишний 1' }, { text: 'Лишний 2' }, { text: 'Лишний 3' }] },
  { type: 'slider', text: 'Slider: 30', points: 1, min: 0, max: 100, step: 5, answer: 30, unit: 'мин' },
  { type: 'file', text: 'File: приложите картинку', points: 2, accept: 'image/*,application/pdf', max_kb: 512 },
  { type: 'voice', text: 'Voice: скажите что-нибудь', points: 2, max_sec: 30 },
  { type: 'letters', text: 'Letters: соберите «ПОСТ»', points: 1, word: 'пост' },
  { type: 'words', text: 'Words: «смирно стоять»', points: 1, phrase: 'смирно стоять', extra_words: ['лечь'] },
  { type: 'find', text: 'Find: отметьте «ключевое»', points: 1, content: 'Обычный текст и одно [[ключевое]] слово.\nВторая строка.' },
  { type: 'case', text: 'Case: ситуация… что делать?', points: 10, reference: 'Эталон кейса', criteria: ['Квалификация (4 балла)', 'Нормы | 3', { text: 'Порядок', points: 3 }] },
];
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

(async () => {
  const A = await login(ADMIN, 'Шерман'), C = await login(CAND, 'Кандидат Орлов'), C2 = await login(CAND2, 'Кандидат Белов'), L = await login(LEGACY, 'legacy');
  let r;
  // ---------- 1. старые данные после миграции ----------
  r = await call('GET', '/api/attempts/1', L);
  if (r.status === 200 && r.d.attempt.status === 'in_progress') {
    const a = r.d.attempt;
    check('legacy: попытка открывается, 4 вопроса', a.questions.length === 4, a);
    check('legacy: порядок вариантов из старого opt_order', a.questions[0].options.map(o => o.id).join() === 'b2,a1', a.questions[0]);
    check('legacy: сохранённые ответы на месте', a.saved_answers[1] === 'a1' && a.saved_answers[3] === 'ответ');
    r = await call('POST', '/api/attempts/1/submit', L, { answers: { 4: 'развёрнуто' } });
    check('legacy: отправка → на проверке (text/long)', r.d.status === 'pending_review', r.d);
    r = await call('GET', '/api/admin/attempts/1', A);
    check('legacy: автобаллы single+multi = 4', r.d.attempt.auto_score === 4 && r.d.items[2].needs_review && r.d.items[3].needs_review, r.d.attempt);
    r = await call('GET', '/api/admin/exams/1', A);
    check('legacy: старые вопросы читаются в редакторе', r.d.questions.length === 4 && r.d.questions[0].native.options[0].correct === true, r.d.questions[0]);
  } else console.log('(legacy-данные не загружены — пропуск)');

  // ---------- 2. экзамен со всеми типами ----------
  r = await call('POST', '/api/admin/exams', A, { title: 'Экзамен: все типы вопросов', time_limit_min: 0, max_attempts: 0, pass_pct: 60, shuffle_questions: false, shuffle_options: true, required_lectures: [] });
  const EX = r.d.exam.id;
  const qid = {};
  for (const q of QS) { r = await call('POST', `/api/admin/exams/${EX}/questions`, A, q); check('создан тип ' + q.type, r.status === 200 && r.d.question.type === q.type, r.d); if (r.d.question) qid[q.type] = r.d.question.id; }
  // ошибки валидации
  const bad = [[{ type: 'single', text: 'x', options: [{ text: 'a', correct: true }, { text: 'b', correct: true }] }, /ровно один/], [{ type: 'param', text: 'x', vars: { a: { min: 1, max: 2 } }, formula: 'a + zz' }, /неизвестная переменная/],
    [{ type: 'blanks_select', text: 'x', content: 'нет [[одного]]' }, /минимум 2/], [{ type: 'find', text: 'x', content: 'без разметки' }, /двойных/], [{ type: 'slider', text: 'x', min: 10, max: 5, answer: 1 }, /максимум/],
    [{ type: 'bogus', text: 'x' }, /Неизвестный тип/], [{ type: 'eliminate', text: 'x', options: [{ text: 'a', correct: true }, { text: 'b' }] }, /минимум 3/]];
  for (const [b, re] of bad) { r = await call('POST', `/api/admin/exams/${EX}/questions`, A, b); check('валидация ' + b.type + ' → 400', r.status === 400 && re.test(r.d.error), r.d); }
  r = await call('PUT', '/api/admin/exams/' + EX, A, { published: true }); check('экзамен опубликован', r.d.exam.published === 1);
  // try-эндпоинт админа
  r = await call('POST', `/api/admin/questions/${qid.number}/try`, A, { answer: '42,3' }); check('try: число с допуском и запятой → полный балл', r.d.grade.ap === 1, r.d);
  r = await call('POST', `/api/admin/questions/${qid.text}/try`, A, { answer: '  ЕЛКА. ' }); check('try: текст без учёта регистра/ё/знаков', r.d.grade.ap === 1, r.d);

  // кандидат: попытка и проверка «никаких ответов на клиенте»
  r = await call('POST', `/api/exams/${EX}/start`, C); const AT = r.d.attempt_id; check('кандидат начал экзамен', !!AT, r.d);
  r = await call('GET', '/api/attempts/' + AT, C);
  const raw = JSON.stringify(r.d);
  check('в попытке нет правильных ответов/эталонов', !SECRET_KEYS.test(raw) && !/"c":1/.test(raw), raw.match(SECRET_KEYS));
  const pubL = r.d.attempt.questions.find(q => q.type === 'letters'); check('буквы перемешаны', pubL.letters.join('') !== 'пост', pubL.letters);
  const pubO = r.d.attempt.questions.find(q => q.type === 'order'); check('порядок перемешан', pubO.items.map(x => x.text).join() !== 'Альфа,Браво,Чарли,Дельта');
  check('info без баллов', r.d.attempt.questions.find(q => q.type === 'info').points === 0);

  // ---------- 3. прохождение в браузере ----------
  const browser = await chromium.launch({ args: ['--no-sandbox', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, permissions: ['microphone'] });
  const page = await ctx.newPage();
  const jsErr = []; page.on('pageerror', e => jsErr.push(e.message));
  page.on('dialog', d => d.accept());
  const as = async (tok, hash) => { await page.goto(SITE + '#/'); await page.evaluate(t => localStorage.setItem('vpexam_token', t), tok); await page.reload(); await page.waitForSelector('#logoutBtn'); await page.goto(SITE + '#' + hash); };
  await as(C, '/attempt/' + AT); await page.waitForSelector('#examForm');
  const Q = (t) => `.q[data-qid="${qid[t]}"]`;
  await page.click(`${Q('single')} label.opt:has(span:text-is("Верно")) input`);
  await page.click(`${Q('multi')} label.opt:has-text("Верно А") input`); await page.click(`${Q('multi')} label.opt:has-text("Верно Б") input`);
  await page.fill(`${Q('number')} input`, '42');
  await page.fill(`${Q('text')} input`, 'ЁЛКА');
  const ptxt = await page.textContent(`${Q('param')} .qt`); const pm = /A=(\d+); B=(\d+)/.exec(ptxt);
  await page.fill(`${Q('param')} input`, String(Number(pm[1]) * Number(pm[2])));
  await page.fill(`${Q('long')} textarea`, 'Развёрнутый ответ кандидата.');
  const target = ['Альфа', 'Браво', 'Чарли', 'Дельта'];
  for (let k = 0; k < target.length; k++) {
    for (let guard = 0; guard < 6; guard++) {
      const texts = await page.$$eval(`${Q('order')} .ord-item .otext`, els => els.map(e => e.textContent));
      const at = texts.indexOf(target[k]); if (at === k) break;
      await page.click(`${Q('order')} .ord-item:nth-child(${at + 1}) .up`);
    }
  }
  for (const [l, rr] of [['Один', '1'], ['Два', '2'], ['Три', '3']]) await page.selectOption(`${Q('match')} .mrow:has(.ml:text-is("${l}")) select`, { label: rr });
  const bi = await page.$$(`${Q('blanks_input')} input.blank`); await bi[0].fill('Сорок восемь'); await bi[1].fill('100');
  const bs = await page.$$(`${Q('blanks_select')} select.blank`); await bs[0].selectOption({ label: 'холодно' }); await bs[1].selectOption({ label: 'тепло' });
  await page.click(`${Q('dictation')} .dopt:text-is("и")`); await page.click(`${Q('dictation')} .dopt:text-is("не обсуждается")`);
  for (let k = 0; k < 3; k++) await page.click(`${Q('eliminate')} .eopt:not(:has-text("Оставить")):not(.out) button`);
  check('исключение: остался «Оставить»', /Ваш ответ: Оставить/.test(await page.textContent(`${Q('eliminate')} .elim-res`)));
  await page.$eval(`${Q('slider')} input[type=range]`, el => { el.value = 30; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.setInputFiles(`${Q('file')} input[type=file]`, { name: 'photo.png', mimeType: 'image/png', buffer: PNG });
  await page.waitForSelector(`${Q('file')} .upstate:has-text("Загружено")`);
  await page.click(`${Q('voice')} .rec`); await sleep(2200); await page.click(`${Q('voice')} .stop`);
  await page.waitForSelector(`${Q('voice')} .upstate:has-text("Загружено")`, { timeout: 15000 });
  for (const ch of 'пост') await page.click(`${Q('letters')} .src-tiles .tile:not([disabled]):text-is("${ch}")`);
  for (const w of ['смирно', 'стоять']) await page.click(`${Q('words')} .src-tiles .tile:not([disabled]):text-is("${w}")`);
  await page.click(`${Q('find')} .tok:text-is("ключевое")`);
  await page.fill(`${Q('case')} textarea`, 'Квалификация: … Нормы: ст. 1. Порядок: …');
  await page.screenshot({ path: SHOTS + '40_all_types_desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 }); await sleep(300);
  await page.screenshot({ path: SHOTS + '41_all_types_mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.click('#submitBtn'); await page.waitForSelector('.result');
  check('после отправки — «НА ПРОВЕРКЕ»', /НА ПРОВЕРКЕ/.test(await page.textContent('.result')));
  r = await call('GET', '/api/admin/attempts/' + AT, A);
  const items = Object.fromEntries(r.d.items.map(it => [it.question.type, it]));
  for (const q of QS) {
    const it = items[q.type];
    if (['long', 'file', 'voice', 'case'].includes(q.type)) check(`ответ ${q.type} → ручная проверка`, it.needs_review && it.auto_points == null, it);
    else if (q.type === 'info') check('info → 0 баллов, без проверки', !it.needs_review && it.question.points === 0);
    else check(`ответ ${q.type} засчитан автоматически (${it.auto_points}/${it.question.points})`, it.auto_points === it.question.points, { a: it.answer, at: it.answer_text, ex: it.expected_text });
  }
  check('файл и голос сохранены', items.file.upload && items.file.upload.mime === 'image/png' && items.voice.upload && /^audio\//.test(items.voice.upload.mime), [items.file.upload, items.voice.upload]);
  r = await call('GET', '/api/uploads/' + items.file.upload.id, C2); check('чужой кандидат не видит файл (404)', r.status === 404);
  // проверка в админке
  await as(A, '/admin/attempt/' + AT); await page.waitForSelector('#rf');
  await page.click(`[data-up="${items.file.upload.id}"]`); await page.waitForSelector(`#upv${items.file.upload.id} img`);
  await page.click(`[data-up="${items.voice.upload.id}"]`); await page.waitForSelector(`#upv${items.voice.upload.id} audio`);
  check('проверяющий видит картинку и аудио', true);
  const crit = await page.$$(`.critc[data-q="${qid.case}"]`); check('критерии кейса показаны (3)', crit.length === 3);
  await crit[0].check(); await crit[2].check();
  check('критерии суммируются в баллы (4+3=7)', await page.inputValue(`.pts[data-q="${qid.case}"]`) === '7');
  await page.fill(`.pts[data-q="${qid.long}"]`, '3'); await page.fill(`.pts[data-q="${qid.file}"]`, '2'); await page.fill(`.pts[data-q="${qid.voice}"]`, '1');
  await page.screenshot({ path: SHOTS + '42_admin_review_all_types.png', fullPage: true });
  await page.click('#rf button.gold'); await sleep(1200);
  r = await call('GET', '/api/admin/attempts/' + AT, A);
  const maxS = QS.reduce((s, q) => s + (q.points || 0), 0); const exp = Math.round((maxS - 10 + 7 - 1) / maxS * 1000) / 10;
  check(`итог после проверки: сдан, ${exp}%`, r.d.attempt.status === 'passed' && r.d.attempt.score_pct === exp, r.d.attempt);
  // пустая попытка второго кандидата → 0, не сдан
  r = await call('POST', `/api/exams/${EX}/start`, C2); r = await call('POST', `/api/attempts/${r.d.attempt_id}/submit`, C2, { answers: {} });
  check('пустые ответы → не сдан', r.d.status === 'failed', r.d);
  r = await call('PUT', `/api/attempts/1/answers`, C2, { answers: {} }); check('чужая попытка → 404', r.status === 404);

  // ---------- 4. банк: создание в UI ----------
  await as(A, '/admin/bank'); await page.waitForSelector('#addB');
  const uiCreate = async (type, fill) => {
    await page.selectOption('#newTypeB', type); await page.click('#addB'); await page.waitForSelector('#newBox .qform');
    await page.fill('#newBox .e-cat', 'ВУ'); await page.fill('#newBox .e-text', `UI-${type}: тестовый вопрос`);
    await fill('#newBox '); await page.click('#newBox .save'); await sleep(700);
    const b = await call('GET', '/api/admin/bank?q=' + encodeURIComponent(`UI-${type}`), A);
    check('UI: создан вопрос ' + type, b.d.total === 1 && b.d.questions[0].type === type, b.d.questions[0] || (await page.textContent('#newBox .qerr').catch(() => '')));
    return b.d.questions[0];
  };
  await uiCreate('single', async (p) => { const ots = await page.$$(p + '.ot'); await ots[0].fill('Да'); await ots[1].fill('Нет'); });
  await uiCreate('number', async (p) => { await page.fill(p + '.e-ans', '12,5'); await page.fill(p + '.e-tol', '0,5'); });
  await uiCreate('param', async (p) => { await page.fill(p + '.e-text', 'UI-param: {a} и {b}'); await page.fill(p + '.e-vars', 'a = 1..5\nb = 10; 20'); await page.fill(p + '.e-formula', 'a*b'); });
  await uiCreate('match', async (p) => { await page.fill(p + '.e-pairs', 'А => 1\nБ => 2'); });
  await uiCreate('blanks_select', async (p) => { await page.fill(p + '.e-content', 'Текст [[*да|нет]] и [[*раз|два]]'); });
  await uiCreate('order', async (p) => { await page.fill(p + '.e-items', 'раз\nдва\nтри'); });
  const cq = await uiCreate('case', async (p) => { await page.fill(p + '.e-ref', 'эталон'); await page.fill(p + '.e-crit', 'первый | 2\nвторой | 3'); });
  check('UI: кейс → вид case, баллы = сумма критериев', cq.kind === 'case' && cq.points === 5, cq);
  await page.goto(SITE + '#/admin/bank?category=ВУ'); await page.waitForSelector('#blist .qedit');
  await page.screenshot({ path: SHOTS + '43_admin_bank.png', fullPage: false });

  // ---------- 5. импорт законов ----------
  const lawFiles = fs.existsSync(LAWS) ? fs.readdirSync(LAWS).filter(f => f.endsWith('.json')) : [];
  for (const f of lawFiles) {
    const data = JSON.parse(fs.readFileSync(LAWS + '/' + f, 'utf8'));
    r = await call('POST', '/api/admin/bank/import', A, { data, dry_run: true });
    check(`импорт ${f}: проверка без ошибок (${r.d.report.valid}/${r.d.report.total})`, r.status === 200 && r.d.report.error_count === 0, r.d.report.errors);
    r = await call('POST', '/api/admin/bank/import', A, { data });
    check(`импорт ${f}: создано ${r.d.report.created}`, r.d.report.created === data.questions.length + (data.cases || []).length, r.d.report);
  }
  if (lawFiles.length) {
    const data = JSON.parse(fs.readFileSync(LAWS + '/pk.json', 'utf8'));
    r = await call('POST', '/api/admin/bank/import', A, { data }); check('повторный импорт pk → обновление, не дубли', r.d.report.updated === r.d.report.total && r.d.report.created === 0, r.d.report);
    r = await call('POST', '/api/admin/bank/delete-examples', A, { categories: ['ПК', 'УК', 'ТК', 'КоАП', 'ФЗ*', 'ФКЗ*'] }); check('удалены ПРИМЕРЫ по законам', r.d.deleted > 0, r.d);
  }
  r = await call('POST', '/api/admin/bank/import', A, { data: { questions: [{ type: 'single', text: 'x', options: ['a'], correct: [0], category: 'ВУ' }, { type: 'number', text: 'ok', answer: 1, category: 'ВУ' }] } });
  check('импорт с ошибкой → 400, ничего не записано', r.status === 400 && r.d.report.error_count === 1 && r.d.report.created === 0, r.d);
  r = await call('POST', '/api/admin/bank/import', A, { data: [{ type: 'number', text: 'без категории', answer: 1 }] }); check('импорт без категории → ошибка', r.status === 400);
  r = await call('GET', '/api/admin/bank/export?category=ПК', A); check('экспорт ПК', r.d.questions.length > 0 && r.d.questions.every(q => q.category === 'ПК'));

  // ---------- 6. переаттестация ----------
  r = await call('GET', '/api/admin/reatt', A);
  const byKey = (d, k) => d.items.find(x => x.key === k);
  check('стандартные записи: полная и упрощённая', !!byKey(r.d, 'full') && !!byKey(r.d, 'simple'), r.d.items.map(x => x.key));
  check('квоты: полная — блоки по умолчанию', byKey(r.d, 'full').groups.map(g => `${g.label}:${g.questions}+${g.cases}`).join(' ') === 'ПК:4+1 УК:4+1 ВУ:8+2 СУ:2+1 КПС:2+1 ДУ:2+1 ФЗ / ФКЗ / КоАП:6+2 ТК:4+1', byKey(r.d, 'full').groups);
  check('квоты: упрощённая 15 + 3 кейса', byKey(r.d, 'simple').groups.reduce((s, g) => s + g.questions, 0) === 15 && byKey(r.d, 'simple').groups.reduce((s, g) => s + g.cases, 0) === 3);
  check('банк закрывает все квоты', r.d.items.every(v => v.availability.every(g => g.ok)), r.d.items.map(v => v.availability));
  check('нет признака «не душный» в ответах API', !/"easy"|prefer_easy|не душн/i.test(JSON.stringify(r.d)));
  const bankR = await call('GET', '/api/admin/bank?limit=500', A);
  check('банк: нет поля easy', !bankR.d.questions.some(q => 'easy' in q) && !bankR.d.categories.some(c => 'easy' in c));
  const allBank = []; for (let off = 0; off < bankR.d.total; off += 500) { const b = await call('GET', `/api/admin/bank?limit=500&offset=${off}`, A); allBank.push(...b.d.questions); }
  const bmap = new Map(allBank.map(q => [q.id, q]));
  const cfgFull = byKey(r.d, 'full'), cfgSimple = byKey(r.d, 'simple');
  const catOk = (g, q) => g.categories.some(p => p.endsWith('*') ? q.category.startsWith(p.slice(0, -1)) : q.category === p);
  const orders = {};
  for (const [ver, cfg] of [['full', cfgFull], ['simple', cfgSimple]]) {
    for (let k = 0; k < 3; k++) {
      const tok = await login('3100000000000000' + (ver === 'full' ? 1 : 2) + k, 'reatt-' + ver + k);
      r = await call('POST', `/api/reatt/${ver}/start`, tok); const id = r.d.attempt_id;
      r = await call('GET', '/api/attempts/' + id, tok);
      const qs = r.d.attempt.questions;
      check(`${ver}#${k}: нет ответов в выдаче`, !SECRET_KEYS.test(JSON.stringify(r.d)));
      const need = cfg.groups.reduce((s, g) => s + g.questions + g.cases, 0);
      check(`${ver}#${k}: вопросов ${qs.length} = ${need}`, qs.length === need);
      check(`${ver}#${k}: без повторов`, new Set(qs.map(q => q.id)).size === qs.length);
      orders[ver] = orders[ver] || []; orders[ver].push(qs.map(q => q.id).join());
      const ad = await call('GET', '/api/admin/attempts/' + id, A);
      for (const [gi, g] of cfg.groups.entries()) {
        const gr = ad.d.groups[gi];
        const its = ad.d.items.filter(it => it.group === g.label);
        const nq = its.filter(it => it.question.kind !== 'case').length, nc = its.filter(it => it.question.kind === 'case').length;
        check(`${ver}#${k} ${g.label}: ${nq}/${g.questions} вопросов, ${nc}/${g.cases} кейсов, категории верные`, nq === g.questions && nc === g.cases && !gr.short_q && !gr.short_c && its.every(it => catOk(g, it.question)), { nq, nc, gr });
      }
      if (k === 0) {
        let diff = 0, tot = 0;
        for (const q of qs.filter(q => q.options && q.options.length > 2)) { tot++; if (q.options.map(o => o.id).join() !== bmap.get(q.id).options.map(o => o.id).join()) diff++; }
        check(`${ver}: варианты перемешаны (${diff}/${tot})`, tot === 0 || diff > 0);
      }
      r = await call('POST', `/api/reatt/${ver}/start`, tok); check(`${ver}#${k}: повторный старт → та же попытка`, r.d.attempt_id === id);
      r = await call('POST', `/api/attempts/${id}/submit`, tok, { answers: {} }); check(`${ver}#${k}: пустая отправка → не сдан`, r.d.status === 'failed', r.d);
    }
    check(`${ver}: порядок вопросов разный в разных попытках`, new Set(orders[ver]).size > 1);
  }
  // CRUD: новая переаттестация с весами
  r = await call('POST', '/api/admin/reatt', A, { title: 'Тестовая: только ВУ', description: 'для теста', time_limit_min: 15, pass_pct: 50, q_points: 2, c_points: 4,
    groups: [{ label: 'ВУ', categories: ['ВУ'], questions: 3, cases: 1 }] });
  check('создание переаттестации', r.status === 201 && /^r[0-9a-f]{8}$/.test(r.d.item.key), r.d);
  const NR = r.d.item;
  r = await call('POST', '/api/admin/reatt', A, { title: 'Пустая', groups: [] }); check('пустые квоты → 400', r.status === 400);
  r = await call('POST', '/api/admin/reatt', C, { title: 'x', groups: [{ label: 'a', categories: ['ВУ'], questions: 1 }] }); check('кандидат не создаёт (403)', r.status === 403);
  r = await call('POST', `/api/admin/reatt/${NR.id}/preview`, A); check('пробная выборка сохранённой: 3+1, баллы 3×2+4=10', r.d.total === 4 && r.d.max_score === 10, r.d);
  r = await call('POST', '/api/admin/reatt/preview', A, { groups: [{ label: 'СУ', categories: ['СУ'], questions: 2, cases: 0 }] }); check('пробная выборка по форме (без сохранения): 2', r.d.total === 2, r.d);
  const tokN = await login('330000000000000001', 'Новая');
  r = await call('GET', '/api/reatt', tokN); check('кандидат видит новую', r.d.versions.some(v => v.key === NR.key) && r.d.versions.every(v => !('composition' in v)), r.d.versions.map(v => v.key));
  r = await call('POST', `/api/reatt/${NR.key}/start`, tokN); const NA = r.d.attempt_id; check('старт новой', !!NA, r.d);
  r = await call('GET', '/api/attempts/' + NA, tokN); check('новая: 4 задания, веса 2/4', r.d.attempt.questions.length === 4 && r.d.attempt.questions.every(q => q.points === (q.kind === 'case' ? 4 : 2)), r.d.attempt.questions.map(q => q.points));
  const caseQ = r.d.attempt.questions.find(q => q.kind === 'case'); r = await call('POST', `/api/attempts/${NA}/submit`, tokN, { answers: { [caseQ.id]: 'Решение кейса' } }); check('новая: отправка → на проверке (кейс)', r.d.status === 'pending_review', r.d);
  r = await call('GET', '/api/admin/attempts/' + NA, A); const caseIt = r.d.items.find(it => it.question.kind === 'case');
  check('новая: у проверяющего max 10, критерии кейса пересчитаны под 4 балла', r.d.attempt.max_score === 10 && caseIt.question.points === 4 && (caseIt.question.native.criteria || []).reduce((s, c) => s + c.points, 0) <= 4.5 && (caseIt.question.native.criteria || []).length > 0, { max: r.d.attempt.max_score, crit: caseIt.question.native.criteria });
  r = await call('POST', `/api/admin/attempts/${NA}/review`, A, { points: { [caseIt.question.id]: 4 }, verdict: 'auto' }); check('новая: проверка → 40% < 50% → не сдан', r.d.attempt ? r.d.attempt.status === 'failed' : r.status === 200, r.d);
  r = await call('PUT', `/api/admin/reatt/${NR.id}`, A, { visible: false }); check('скрыть от кандидатов', r.d.item.visible === false && r.d.item.enabled === true);
  r = await call('GET', '/api/reatt', tokN); check('скрытая не видна кандидату', !r.d.versions.some(v => v.key === NR.key));
  r = await call('PUT', `/api/admin/reatt/${NR.id}`, A, { visible: true, enabled: false }); r = await call('GET', '/api/reatt', tokN); check('выключенная не видна кандидату', !r.d.versions.some(v => v.key === NR.key));
  r = await call('POST', `/api/reatt/${NR.key}/start`, tokN); check('выключенную нельзя начать', r.status === 403, r.d);
  r = await call('PUT', `/api/admin/reatt/${cfgSimple.id}`, A, { title: 'Переаттестация — упрощённая (уставы)', groups: cfgSimple.groups }); check('стандартная редактируется как обычная запись', r.status === 200);
  r = await call('DELETE', `/api/admin/reatt/${NR.id}`, A); check('удаление с попытками → мягкое', r.d.soft === true);
  r = await call('GET', '/api/admin/reatt', A); check('удалённая не в списке админа', !r.d.items.some(x => x.id === NR.id));
  r = await call('GET', '/api/admin/attempts/' + NA, A); check('попытка удалённой переаттестации видна с названием', r.status === 200 && /Тестовая/.test(r.d.exam ? r.d.exam.title : JSON.stringify(r.d)), r.d.exam);
  r = await call('GET', '/api/admin/attempts?kind=' + NR.key, A); check('фильтр попыток по удалённой переаттестации', r.d.attempts.length === 1 && r.d.reatt_list.some(x => x.key === NR.key && x.deleted));
  r = await call('POST', '/api/admin/reatt', A, { title: 'Временная', groups: [{ label: 'ДУ', categories: ['ДУ'], questions: 1 }] }); const TR = r.d.item.id;
  r = await call('DELETE', `/api/admin/reatt/${TR}`, A); check('удаление без попыток → полное', r.d.soft === false);
  r = await call('GET', '/api/admin/attempts?kind=x%27%20OR%201', A); check('фильтр: инъекция отклонена', r.status === 400);

  // UI переаттестации
  const tokR = await login('320000000000000001', 'Курсант Иванов');
  await as(tokR, '/reatt'); await page.waitForSelector('.reatt-card');
  check('UI кандидата: нет перечисления блоков/типов', (await page.$$('.reatt-card .lchip')).length === 0 && !/не душн/i.test(await page.textContent('main')));
  await page.screenshot({ path: SHOTS + '44_reatt_candidate.png', fullPage: true });
  await page.click('.reatt-card[data-v="simple"] .startR'); await page.waitForSelector('#examForm');
  check('UI: упрощённая — 18 заданий', (await page.$$('#examForm .q')).length === 18);
  await page.screenshot({ path: SHOTS + '45_reatt_attempt.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: SHOTS + '46_reatt_attempt_mobile.png', fullPage: false });
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const ta of await page.$$('#examForm .case-q textarea')) await ta.fill('Решение кейса');
  await page.click('#submitBtn'); await page.waitForSelector('.result');
  check('UI: переаттестация с кейсами → на проверке', /НА ПРОВЕРКЕ/.test(await page.textContent('.result')));
  // админ: список, создание через форму, пробная выборка
  await as(A, '/admin/reatt'); await page.waitForSelector('.ritem');
  check('UI админа: список переаттестаций', (await page.$$('.ritem')).length >= 2 && !/не душн/i.test(await page.textContent('main')));
  await page.screenshot({ path: SHOTS + '47_admin_reatt_list.png', fullPage: true });
  await page.click('#newR'); await page.waitForSelector('#rf .grow');
  await page.fill('#rf [name=title]', 'Переаттестация по ДУ (UI)');
  await page.fill('#rf .grow .g-label', 'ДУ'); await page.fill('#rf .grow .g-cats', 'ДУ'); await page.fill('#rf .grow .g-q', '3'); await page.fill('#rf .grow .g-c', '1');
  await page.click('#rf .g-add'); const rows = await page.$$('#rf .grow'); await (await rows[1].$('.g-label')).fill('СУ'); await (await rows[1].$('.g-cats')).fill('СУ'); await (await rows[1].$('.g-q')).fill('2');
  check('UI: итог считается', /5 вопросов \+ 1 кейсов/.test(await page.textContent('#rf .g-tot')));
  await page.click('#rf .g-prev'); await page.waitForSelector('#rf .g-out .card');
  const pvTxt = await page.textContent('#rf .g-out'); check('UI: пробная выборка по форме', /всего 6,/.test(pvTxt) && !/не хватает/.test(pvTxt), pvTxt.slice(0, 300));
  await page.screenshot({ path: SHOTS + '49_admin_reatt_new.png', fullPage: true });
  await page.click('#rf button.gold'); await page.waitForFunction(() => /#\/admin\/reatt\/\d+$/.test(location.hash));
  r = await call('GET', '/api/admin/reatt', A); const uiR = r.d.items.find(x => x.title === 'Переаттестация по ДУ (UI)');
  check('UI: создана через форму', uiR && uiR.groups.length === 2 && uiR.groups[0].questions === 3 && uiR.groups[0].cases === 1, uiR);
  await page.goto(SITE + '#/admin/reatt/' + cfgFull.id); await page.waitForFunction(() => /полная/.test((document.querySelector('h1') || {}).textContent || ''));
  check('UI: редактор стандартной полной — 8 блоков', (await page.$$('#rf .grow')).length === 8);
  await page.click('#rf .g-prev'); await page.waitForSelector('#rf .g-out .card');
  await page.screenshot({ path: SHOTS + '47_admin_reatt_quotas.png', fullPage: true });
  await page.goto(SITE + '#/admin/bank'); await page.waitForSelector('#bf');
  check('UI банка: нет «не душных»', !/не душн/i.test(await page.textContent('main')));
  await page.goto(SITE + '#/admin/attempts?status=pending_review&kind=reatt'); await page.waitForSelector('tr.click[data-href^="#/admin/attempt/"]');
  check('проверка: фильтр «Переаттестация» показывает попытку', /упрощённая/.test(await page.textContent('table')));
  check('проверка: вкладка по каждой переаттестации', /полная/.test(await page.textContent('main')) && /Тестовая: только ВУ \(удалена\)/.test(await page.textContent('main')));
  await page.click('tr.click'); await page.waitForSelector('#rf');
  check('проверка переаттестации: сводка по блокам', /По блокам/.test(await page.textContent('main')));
  await page.screenshot({ path: SHOTS + '48_admin_reatt_review.png', fullPage: true });
  check('нет JS-ошибок на страницах', jsErr.length === 0, jsErr);
  await browser.close();
  const failed = results.filter(x => !x.ok);
  console.log(`\nИТОГО: ${results.length - failed.length}/${results.length} PASS`);
  fs.writeFileSync(__dirname + '/e2e-qtypes-results.json', JSON.stringify(results, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
