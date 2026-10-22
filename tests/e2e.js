const { chromium } = require('playwright');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || (__dirname + '/shots/');
const ADMIN = '417660389723996170', CAND = '300000000000000001', CAND2 = '300000000000000002';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond, extra }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 300) : '')); };
async function call(method, path, token, body) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined, redirect: 'manual' });
  let d = null; try { d = await r.json(); } catch (_) {}
  return { status: r.status, d, headers: r.headers };
}
const login = async (id, name) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}`)).json()).token;
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // --- базовые проверки API ---
  let r = await call('GET', '/health'); check('health 200', r.status === 200, r.d);
  r = await call('GET', '/auth/login'); check('/auth/login без OAuth → 503 "OAuth не настроен"', r.status === 503 && r.d.error === 'OAuth не настроен', r.d);
  r = await call('GET', '/auth/login?return=' + encodeURIComponent(SITE)); check('/auth/login с return → редирект с auth_error', r.status === 302 && /auth_error=OAuth/.test(decodeURIComponent(r.headers.get('location') || '').replace(/\+/g, ' ')), r.headers.get('location'));
  r = await call('GET', '/auth/login?return=' + encodeURIComponent('https://evil.example/')); check('чужой return не принимается', r.status === 302 && !(r.headers.get('location') || '').includes('evil'), r.headers.get('location'));
  r = await call('GET', '/api/admin/stats'); check('admin без токена → 401', r.status === 401, r.d);
  r = await call('GET', '/api/me', 'x'.repeat(40)); check('левый токен → 401', r.status === 401);
  const cors = await fetch(API + '/api/config', { headers: { Origin: 'https://evil.example' } });
  check('CORS не отдаёт чужому origin', !cors.headers.get('access-control-allow-origin'));
  const cors2 = await fetch(API + '/api/config', { headers: { Origin: 'http://localhost:8080' } });
  check('CORS разрешён для localhost:8080', cors2.headers.get('access-control-allow-origin') === 'http://localhost:8080');

  const A = await login(ADMIN, 'Шерман'), C = await login(CAND, 'Кандидат Петров'), C2 = await login(CAND2, 'Кандидат Сидоров');
  r = await call('GET', '/api/me', A); check('супер-админ по ADMIN_IDS получает role=admin', r.d.user.role === 'admin' && r.d.user.super, r.d.user);
  for (const p of ['/api/admin/stats', '/api/admin/lectures', '/api/admin/users', '/api/admin/attempts', '/api/admin/settings', '/api/admin/audit']) {
    r = await call('GET', p, C); check('кандидат → 403 на ' + p, r.status === 403);
  }
  r = await call('POST', '/api/admin/lectures', C, { title: 'x' }); check('кандидат не может создать лекцию (403)', r.status === 403);

  // --- наполнение админом ---
  await call('PUT', '/api/me', C, { ic_name: 'Иван Петров', static_id: '12345', rank: 'Рядовой' });
  const vurl = 'http://localhost:8080/__media/test20.webm';
  r = await call('POST', '/api/admin/lectures', A, { title: 'Лекция 1. Устав и структура ГУ ВП', description: 'Тестовая лекция 20 секунд.', video_url: vurl, duration_sec: 20, published: true, required: true });
  check('создание лекции 1', r.status === 200, r.d); const L1 = r.d.lecture.id;
  r = await call('POST', '/api/admin/lectures', A, { title: 'Лекция 2. Процессуальные действия', description: 'Вторая тестовая лекция.', video_url: vurl, duration_sec: 20, published: true, required: true });
  const L2 = r.d.lecture.id;
  await call('POST', '/api/admin/lectures', A, { title: 'Лекция 3. Черновик', video_url: '', duration_sec: 0, published: false });
  // --- YouTube / форматы ссылок / черновики ---
  r = await call('POST', '/api/admin/lectures', A, { title: 'Черновик без длительности и видео', published: false });
  check('черновик без видео и длительности сохраняется', r.status === 200 && r.d.lecture.published === 0, r.d);
  const DRAFT = r.d.lecture.id;
  r = await call('POST', '/api/admin/lectures', A, { title: 'Черновик YouTube без длительности', video_url: 'https://www.youtube.com/watch?v=MaW7GrNHHCc', published: false });
  check('YouTube-черновик без длительности сохраняется', r.status === 200 && r.d.lecture.type === 'youtube' && r.d.lecture.youtube_id === 'MaW7GrNHHCc', r.d);
  await call('DELETE', '/api/admin/lectures/' + r.d.lecture.id, A);
  for (const u of ['https://youtu.be/MaW7GrNHHCc?si=xyz', 'https://www.youtube.com/shorts/MaW7GrNHHCc', 'https://www.youtube.com/embed/MaW7GrNHHCc', 'https://m.youtube.com/watch?v=MaW7GrNHHCc&t=5s']) {
    r = await call('PUT', '/api/admin/lectures/' + DRAFT, A, { video_url: u });
    check('YouTube-ссылка принимается и нормализуется: ' + u, r.status === 200 && r.d.lecture.video_url === 'https://www.youtube.com/watch?v=MaW7GrNHHCc', r.d);
  }
  for (const [u, re] of [['https://drive.google.com/file/d/1abc/view?usp=sharing', /Google Диск/], ['https://cdn.discordapp.com/attachments/1/2/v.mp4?ex=abc', /Discord/], ['https://youtube.com/watch?v=short', /YouTube/], ['https://vk.com/video1_2', /не поддерживается/]]) {
    r = await call('PUT', '/api/admin/lectures/' + DRAFT, A, { video_url: u });
    check('отклоняется с понятным сообщением: ' + u, r.status === 400 && re.test(r.d.error), r.d);
  }
  r = await call('PUT', '/api/admin/lectures/' + DRAFT, A, { duration_sec: '2:04' }); check('длительность "2:04" → 124 с', r.d.lecture.duration_sec === 124, r.d.lecture);
  r = await call('PUT', '/api/admin/lectures/' + DRAFT, A, { duration_sec: '1:02:03' }); check('длительность "1:02:03" → 3723 с', r.d.lecture.duration_sec === 3723);
  r = await call('PUT', '/api/admin/lectures/' + DRAFT, A, { duration_sec: '5:99' }); check('длительность "5:99" отклонена', r.status === 400, r.d);
  r = await call('PUT', '/api/admin/lectures/' + DRAFT, A, { duration_sec: 0, published: true }); check('публикация без длительности → 400 с объяснением', r.status === 400 && /длительность/.test(r.d.error), r.d);
  r = await call('POST', '/api/admin/lectures', A, { title: 'Прямой mp4 на другом хосте', video_url: 'https://example.com/media/lecture.mp4', duration_sec: '10:00', published: false });
  check('прямой mp4 на другом хосте принимается', r.status === 200 && r.d.lecture.type === 'file', r.d);
  await call('DELETE', '/api/admin/lectures/' + r.d.lecture.id, A);
  r = await call('POST', '/api/admin/lectures', A, { title: 'Относительный путь', video_url: 'videos/x.mp4', published: false });
  check('относительный путь videos/x.mp4 принимается', r.status === 200 && r.d.lecture.video_url === 'videos/x.mp4', r.d);
  await call('DELETE', '/api/admin/lectures/' + r.d.lecture.id, A);
  await call('DELETE', '/api/admin/lectures/' + DRAFT, A);
  r = await call('POST', '/api/admin/lectures', A, { title: 'bad', video_url: 'javascript:alert(1)' }); check('валидация ссылки на видео', r.status === 400, r.d);
  r = await call('POST', '/api/admin/lectures', A, { title: 'Нет длительности', video_url: vurl, published: true }); check('публикация без длительности запрещена', r.status === 400, r.d);
  r = await call('POST', '/api/admin/exams', A, { title: 'Экзамен на допуск в ГУ ВП', description: 'Ответьте на вопросы. Развёрнутые ответы проверит экзаменатор.', time_limit_min: 15, max_attempts: 2, cooldown_min: 0, pass_pct: 60, shuffle_questions: false, shuffle_options: true, published: false });
  const EX = r.d.exam.id; check('создание экзамена (черновик)', r.status === 200 && r.d.exam.published === 0, r.d.exam);
  r = await call('PUT', '/api/admin/exams/' + EX, A, { published: true }); check('экзамен без вопросов не публикуется (400 с причиной)', r.status === 400 && /вопрос/.test(r.d.error), r.d);
  r = await call('POST', '/api/admin/exams', A, { title: 'x', published: true }); check('создать сразу опубликованный пустой экзамен нельзя', r.status === 400, r.d);
  const q1 = await call('POST', `/api/admin/exams/${EX}/questions`, A, { type: 'single', text: 'Кому подчиняется ГУ ВП?', points: 2, options: [{ text: 'Министру обороны', correct: true }, { text: 'Губернатору' }, { text: 'Мэру' }] });
  const q2 = await call('POST', `/api/admin/exams/${EX}/questions`, A, { type: 'multi', text: 'Какие действия входят в полномочия ВП?', points: 2, options: [{ text: 'Задержание военнослужащих', correct: true }, { text: 'Патрулирование части', correct: true }, { text: 'Выдача водительских прав' }] });
  const q3 = await call('POST', `/api/admin/exams/${EX}/questions`, A, { type: 'text', text: 'Назовите позывной дежурной части.', points: 1, reference: 'Дежурный' });
  const q4 = await call('POST', `/api/admin/exams/${EX}/questions`, A, { type: 'long', text: 'Опишите порядок задержания военнослужащего.', points: 3, reference: 'Представиться, назвать причину, зачитать права, доставить в часть.' });
  r = await call('PUT', '/api/admin/exams/' + EX, A, { published: true }); check('экзамен опубликован после добавления вопросов', r.status === 200 && r.d.exam.published === 1, r.d);
  check('создание 4 вопросов', [q1, q2, q3, q4].every(x => x.status === 200), [q1, q2, q3, q4].map(x => x.status));
  r = await call('POST', `/api/admin/exams/${EX}/questions`, A, { type: 'single', text: 'bad', options: [{ text: 'a', correct: true }, { text: 'b', correct: true }] });
  check('single с двумя правильными отклонён', r.status === 400, r.d);

  // --- доступы кандидата ---
  r = await call('GET', '/api/lectures', C); check('кандидат видит 2 опубликованные лекции, 2-я закрыта', r.d.lectures.length === 2 && r.d.lectures[1].status === 'locked', r.d.lectures.map(l => l.status));
  r = await call('GET', '/api/lectures/' + L2, C); check('лекция 2 закрыта до просмотра 1-й (403)', r.status === 403, r.d);
  r = await call('POST', `/api/exams/${EX}/start`, C); check('экзамен нельзя начать до лекций (403)', r.status === 403, r.d);
  r = await call('GET', '/api/exams/' + EX, C); check('экзамен: can_start=false', r.d.exam.can_start === false, r.d.exam.reason);
  r = await call('POST', `/api/lectures/${L1}/heartbeat`, C2, { position: 0 });
  r = await call('POST', `/api/lectures/${L1}/heartbeat`, C2, { position: 19 }); check('heartbeat со скачком 0→19 отклонён', r.d.accepted === false && r.d.max_pos < 3, r.d);
  await sleep(3000);
  r = await call('POST', `/api/lectures/${L1}/heartbeat`, C2, { position: 12 }); check('heartbeat +12с за 3с реального времени отклонён', r.d.accepted === false, r.d);
  r = await call('POST', `/api/lectures/${L1}/heartbeat`, C2, { position: 20 }); check('лекция не засчитана после фейковых heartbeat', r.d.completed === false, r.d);

  // --- браузер ---
  const browser = await chromium.launch({ channel: process.env.PW_CHANNEL || 'chrome', args: ['--autoplay-policy=no-user-gesture-required'] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: 'ru-RU' });
  const page = await ctx.newPage();
  const jsErrors = []; page.on('pageerror', e => jsErrors.push(e.message));
  // --- админ создаёт YouTube-лекцию через интерфейс (автоопределение длительности) ---
  await page.goto(SITE); await page.evaluate(t => localStorage.setItem('vpexam_token', t), A); await page.reload(); await page.waitForSelector('#logoutBtn');
  await page.goto(SITE + '#/admin/lecture/new'); await page.waitForSelector('#lf');
  await page.fill('#lf [name=title]', 'Лекция 3. Видео с YouTube');
  await page.setViewportSize({ width: 1280, height: 800 });
  check('UI: в форме есть блок «Статус» с выбором и кнопками', await page.isVisible('.pubbox .pubsel') && await page.isVisible('.pubbox [data-pub="1"]') && await page.isVisible('.pubbox [data-pub="0"]'));
  await page.click('.pubbox [data-pub="1"]'); await page.waitForSelector('#ferr .alert.err');
  check('UI: ошибка сервера показывается в форме (публикация без видео)', /Не сохранено/.test(await page.textContent('#ferr')), await page.textContent('#ferr'));
  await page.screenshot({ path: SHOTS + '22_admin_lecture_error.png', fullPage: true });
  await page.fill('#lf [name=video_url]', 'https://www.youtube.com/watch?v=MaW7GrNHHCc');
  await page.dispatchEvent('#lf [name=video_url]', 'change');
  await page.waitForFunction(() => document.querySelector('#lf [name=duration_sec]').value !== '', null, { timeout: 30000 }).catch(() => {});
  const ytDur = await page.inputValue('#lf [name=duration_sec]');
  check('UI: длительность YouTube определена автоматически (getDuration)', ytDur === '2:04', { ytDur, info: await page.textContent('#dinfo') });
  await page.click('.pubbox [data-pub="0"]'); await page.waitForSelector('.alert.ok');
  r = await call('GET', '/api/admin/lectures', A); let L3 = r.d.lectures.find(l => l.title === 'Лекция 3. Видео с YouTube');
  check('UI «Сохранить черновик» → published=0', L3 && L3.published === 0 && L3.duration_sec === 124, L3);
  L3 = L3.id;
  await page.evaluate(() => document.querySelector('.pubbox').scrollIntoView({ block: 'center' }));
  await page.screenshot({ path: SHOTS + '25_admin_lecture_status_1280x800.png' });
  await page.click('.pubbox [data-pub="1"]'); await page.waitForFunction(() => /Опубликована/.test((document.querySelector('#pubNow') || {}).textContent || ''), null, { timeout: 10000 }).catch(() => {});
  r = await call('GET', '/api/admin/lectures', A); let l3 = r.d.lectures.find(l => l.id === L3);
  check('UI «Опубликовать» → published=1 в БД', l3.published === 1 && l3.type === 'youtube', l3);
  check('UI: статус в форме показывает «Опубликована»', /Опубликована/.test(await page.textContent('#pubNow')));
  await page.screenshot({ path: SHOTS + '23_admin_lecture_youtube.png', fullPage: true });
  // быстрые кнопки в списке
  await page.goto(SITE + '#/admin/lectures'); await page.waitForSelector(`[data-unpub="${L3}"]`);
  await page.click(`[data-unpub="${L3}"]`); await page.waitForSelector(`[data-pubnow="${L3}"]`);
  r = await call('GET', '/api/admin/lectures', A); check('список: «Снять с публикации» → published=0', r.d.lectures.find(l => l.id === L3).published === 0);
  await page.screenshot({ path: SHOTS + '26_admin_lectures_quick.png', fullPage: true });
  await page.click(`[data-pubnow="${L3}"]`); await page.waitForSelector(`[data-unpub="${L3}"]`);
  r = await call('GET', '/api/admin/lectures', A); check('список: «Опубликовать» → published=1', r.d.lectures.find(l => l.id === L3).published === 1);
  r = await call('GET', '/api/lectures', C); check('кандидат видит опубликованную YouTube-лекцию', r.d.lectures.some(l => l.id === L3), r.d.lectures.map(l => l.title));
  // экзамен: быстрые кнопки
  await page.goto(SITE + '#/admin/exams'); await page.waitForSelector(`[data-unpub="${EX}"]`);
  await page.click(`[data-unpub="${EX}"]`); await page.waitForSelector(`[data-pubnow="${EX}"]`);
  r = await call('GET', '/api/admin/exams/' + EX, A); check('экзамены: «Снять с публикации» работает', r.d.exam.published === 0);
  await page.click(`[data-pubnow="${EX}"]`); await page.waitForSelector(`[data-unpub="${EX}"]`);
  r = await call('GET', '/api/admin/exams/' + EX, A); check('экзамены: «Опубликовать» работает', r.d.exam.published === 1);
  await page.goto(SITE + '#/admin/exam/' + EX); await page.waitForSelector('#ef .pubbox');
  check('форма экзамена: блок статуса виден', await page.isVisible('#ef .pubsel'));
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.evaluate(() => localStorage.removeItem('vpexam_token')); await page.reload();
  await page.goto(SITE); await page.waitForSelector('#loginBtn');
  check('страница входа показывает "OAuth не настроен"', (await page.textContent('#app')).includes('OAuth не настроен'));
  check('кнопка входа неактивна без OAuth', await page.isDisabled('#loginBtn'));
  await page.screenshot({ path: SHOTS + '01_login.png', fullPage: true });
  await page.evaluate(t => localStorage.setItem('vpexam_token', t), C);
  await page.goto(SITE + '#/'); await page.reload(); await page.waitForSelector('#logoutBtn'); await page.waitForSelector('.welcome');
  await page.screenshot({ path: SHOTS + '02_dashboard.png', fullPage: true });
  await page.goto(SITE + '#/lectures'); await page.waitForSelector('.lec');
  await page.screenshot({ path: SHOTS + '03_lectures.png', fullPage: true });
  await page.goto(SITE + '#/exam/' + EX); await page.waitForSelector('.card');
  check('UI: экзамен закрыт до лекций', (await page.textContent('#app')).includes('Сначала просмотрите'));
  await page.screenshot({ path: SHOTS + '04_exam_locked.png', fullPage: true });

  for (const [n, L] of [[1, L1], [2, L2], [3, L3]]) {
    await page.goto(SITE + '#/lecture/' + L); await page.waitForSelector('.player .media');
    if (n < 3) await page.waitForFunction(() => document.querySelector('.player video') && document.querySelector('.player video').readyState >= 1);
    else await page.waitForSelector('.player iframe', { timeout: 30000 }), await sleep(3000);
    await page.click('.player .ov .big');
    await sleep(4000);
    if (n === 1) {
      const before = await page.evaluate(() => document.querySelector('.player video').currentTime);
      await page.evaluate(() => { document.querySelector('.player video').currentTime = 17; });
      await sleep(600);
      const after = await page.evaluate(() => document.querySelector('.player video').currentTime);
      check('плеер: перемотка вперёд (на 17с) заблокирована', after < 8, { before, after });
      check('плеер: нет нативных controls и полосы перемотки', await page.evaluate(() => !document.querySelector('.player video').controls));
      await page.evaluate(() => { document.querySelector('.player video').playbackRate = 2; });
      await sleep(300);
      check('плеер: скорость зафиксирована 1x', await page.evaluate(() => document.querySelector('.player video').playbackRate) === 1);
      await sleep(1500);
      await page.screenshot({ path: SHOTS + '05_player.png' });
    }
    if (n === 3) {
      await sleep(6000);
      const t1 = await page.evaluate(() => window.__vpPlayer.A.time());
      check('YouTube: воспроизведение идёт', t1 > 3, t1);
      await page.evaluate(() => window.__vpPlayer.A.seek(100));
      await sleep(1500);
      const t2 = await page.evaluate(() => window.__vpPlayer.A.time());
      check('YouTube: перемотка вперёд (на 100с) откатывается', t2 < 20, { t1, t2 });
      check('YouTube: клики по iframe перекрыты щитом', await page.evaluate(() => { const s = document.querySelector('.shield'); const r = s.getBoundingClientRect(); return document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 3) === s; }));
      r = await call('POST', `/api/lectures/${L}/heartbeat`, C, { position: 120 }); check('YouTube: фейковый heartbeat 120с отклонён', r.d.accepted === false, r.d);
      await page.screenshot({ path: SHOTS + '24_player_youtube.png' });
    }
    await page.waitForFunction(() => /Лекция засчитана/.test(document.querySelector('#pmsg').textContent), null, { timeout: n === 3 ? 200000 : 60000 }).catch(() => {});
    check(`лекция ${n} засчитана после полного просмотра`, (await page.textContent('#pmsg')).includes('засчитана'), await page.textContent('#pmsg'));
  }
  await page.screenshot({ path: SHOTS + '06_player_done.png' });
  r = await call('GET', '/api/lectures', C); check('API: все 3 лекции watched', r.d.lectures.every(l => l.status === 'watched') && r.d.all_required_done, r.d.lectures.map(l => [l.status, l.progress]));
  await page.goto(SITE + '#/lectures'); await page.waitForSelector('.lec'); await page.screenshot({ path: SHOTS + '07_lectures_done.png', fullPage: true });

  // --- экзамен ---
  await page.goto(SITE + '#/exam/' + EX); await page.waitForSelector('#startBtn');
  check('UI: экзамен открылся после лекций', true);
  page.once('dialog', d => d.accept());
  await page.click('#startBtn'); await page.waitForSelector('#examForm');
  const att = await call('GET', '/api/my/attempts', C); const AT = att.d.attempts[0].id;
  r = await call('GET', '/api/attempts/' + AT, C);
  check('клиенту не отправляются правильные ответы', !JSON.stringify(r.d).includes('"correct"') && !JSON.stringify(r.d).includes('reference'), Object.keys(r.d.attempt.questions[0]));
  // ответы: q1 правильно, q2 частично (неверно), q3/q4 текст
  const Q = Object.fromEntries(r.d.attempt.questions.map(q => [q.text.slice(0, 10), q]));
  const qa = r.d.attempt.questions;
  for (const q of qa) {
    if (q.type === 'single') await page.click(`label.opt:has-text("Министру обороны") input`);
    if (q.type === 'multi') await page.click(`label.opt:has-text("Задержание военнослужащих") input`);
    if (q.type === 'text') await page.fill(`[name="q${q.id}"]`, 'Дежурный');
    if (q.type === 'long') await page.fill(`[name="q${q.id}"]`, 'Представиться, назвать причину задержания, разъяснить права и доставить в расположение части.');
  }
  await page.screenshot({ path: SHOTS + '08_exam.png', fullPage: true });
  r = await call('POST', `/api/exams/${EX}/start`, C); check('повторный start возвращает ту же попытку', r.d.attempt_id === AT, r.d);
  r = await call('PUT', `/api/attempts/${AT}/answers`, C2, { answers: {} }); check('чужую попытку нельзя изменить (404)', r.status === 404);
  page.once('dialog', d => d.accept());
  await page.click('#submitBtn'); await page.waitForSelector('.result');
  check('после отправки статус "На проверке"', (await page.textContent('.result')).includes('НА ПРОВЕРКЕ'));
  await page.screenshot({ path: SHOTS + '09_result_pending.png', fullPage: true });
  r = await call('GET', '/api/admin/attempts/' + AT, A);
  const auto = r.d.attempt.auto_score;
  check('автопроверка: single верно (2), multi неверно (0) → auto_score=2', auto === 2, { auto, items: r.d.items.map(i => [i.question.type, i.auto_points, i.needs_review]) });
  r = await call('POST', `/api/exams/${EX}/start`, C); check('новая попытка запрещена пока идёт проверка', r.status === 403, r.d);
  r = await call('POST', `/api/admin/attempts/${AT}/review`, C, { verdict: 'passed' }); check('кандидат не может проверять (403)', r.status === 403);

  // --- админка ---
  await page.evaluate(t => localStorage.setItem('vpexam_token', t), A); await page.reload(); await page.waitForSelector('#logoutBtn');
  const shots = [['/admin', '10_admin_dashboard'], ['/admin/lectures', '11_admin_lectures'], ['/admin/lecture/' + L1, '12_admin_lecture_edit'], ['/admin/exams', '13_admin_exams'], ['/admin/exam/' + EX, '14_admin_exam_editor'], ['/admin/users', '15_admin_users'], ['/admin/user/' + CAND, '16_admin_user'], ['/admin/settings', '18_admin_settings']];
  for (const [h, f] of shots) { await page.goto(SITE + '#' + h); await page.waitForSelector('.subnav, h1'); await sleep(500); await page.screenshot({ path: SHOTS + f + '.png', fullPage: true }); }
  await page.goto(SITE + '#/admin/attempts'); await page.waitForSelector('tr.click'); await page.screenshot({ path: SHOTS + '17_admin_attempts.png', fullPage: true });
  await page.goto(SITE + '#/admin/attempt/' + AT); await page.waitForSelector('#rf');
  const pts = await page.$$('.pts');
  for (const p of pts) { const max = await p.getAttribute('max'); const ph = await p.getAttribute('placeholder'); if (ph !== 'авто') await p.fill(String(max === '3' ? 2.5 : max)); }
  await page.fill('#rf textarea[name=comment]', 'Хорошо. В развёрнутом ответе не хватает упоминания о докладе дежурному.');
  await page.screenshot({ path: SHOTS + '19_admin_review.png', fullPage: true });
  await page.click('#rf button.gold'); await sleep(1200);
  r = await call('GET', '/api/attempts/' + AT, C);
  check('после проверки: статус passed, процент (2+1+2.5)/8=68.8%', r.d.attempt.status === 'passed' && r.d.attempt.score_pct === 68.8, r.d.attempt);
  check('кандидат видит комментарий проверяющего', /докладе/.test(r.d.attempt.reviewer_comment || ''));
  await page.goto(SITE + '#/admin/audit'); await page.waitForSelector('table'); await page.screenshot({ path: SHOTS + '20_admin_audit.png', fullPage: true });
  r = await call('GET', '/api/admin/audit', A); check('журнал аудита пишет действия', r.d.log.some(l => l.action === 'attempt.review') && r.d.log.some(l => l.action === 'lecture.create'), r.d.log.length);
  await page.evaluate(t => localStorage.setItem('vpexam_token', t), C); await page.reload(); await page.waitForSelector('#logoutBtn');
  await page.goto(SITE + '#/attempt/' + AT); await page.waitForSelector('.result'); await page.screenshot({ path: SHOTS + '21_result_passed.png', fullPage: true });
  check('UI кандидата: СДАН + комментарий', (await page.textContent('.result')).includes('СДАН') && (await page.textContent('.result')).includes('докладе'));
  await page.goto(SITE + '#/admin'); await sleep(800);
  check('UI: кандидату раздел управления недоступен', (await page.textContent('#app')).includes('Недостаточно прав'));

  // --- роли, сбросы ---
  r = await call('PUT', '/api/admin/users/' + CAND2, A, { role: 'examiner' }); check('супер-админ назначает проверяющего', r.status === 200 && r.d.user.role === 'examiner');
  r = await call('GET', '/api/admin/attempts', C2); check('проверяющий видит попытки', r.status === 200);
  r = await call('GET', '/api/admin/lectures', C2); check('проверяющий НЕ может управлять лекциями (403)', r.status === 403);
  r = await call('PUT', '/api/admin/users/' + ADMIN, A, { role: 'candidate' }); check('роль главного админа не меняется', r.status === 400);
  r = await call('POST', `/api/admin/users/${CAND}/reset-progress`, A, { lecture_id: L2 }); check('сброс прогресса лекции', r.status === 200 && !r.d.lectures.find(l => l.id === L2).completed_at);
  r = await call('POST', `/api/admin/users/${CAND}/reset-attempts`, A, {}); check('сброс попыток', r.status === 200 && r.d.attempts.length === 0);
  r = await call('PUT', '/api/admin/users/' + CAND2, A, { blocked: true }); r = await call('GET', '/api/me', C2); check('заблокированный теряет доступ', r.status === 401 || r.status === 403, r.status);

  // --- таймер на сервере ---
  await call('PUT', '/api/admin/exams/' + EX, A, { requires_lectures: false, time_limit_min: 1 });
  const C3 = await login('300000000000000003', 'Таймер');
  r = await call('POST', `/api/exams/${EX}/start`, C3); const AT3 = r.d.attempt_id;
  await call('PUT', `/api/attempts/${AT3}/answers`, C3, { answers: {} });
  check('попытка с лимитом 1 мин создана', !!AT3, r.d);
  // искусственно сдвигаем дедлайн в прошлое нельзя через API — проверим через admin: деадлайн существует
  r = await call('GET', '/api/attempts/' + AT3, C3); check('сервер выдаёт deadline_at', r.d.attempt.deadline_at - r.d.attempt.started_at === 60000);

  check('нет JS-ошибок в браузере', jsErrors.length === 0, jsErrors);
  await browser.close();
  const fail = results.filter(x => !x.ok);
  console.log(`\nИТОГО: ${results.length - fail.length}/${results.length} пройдено`);
  require('fs').writeFileSync(__dirname + '/e2e-results.json', JSON.stringify(results, null, 1));
  process.exit(fail.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
