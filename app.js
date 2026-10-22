/* ГУ ВП — Учебный центр. Клиентская часть (без сборки). */
'use strict';
const CFG = window.VP_CONFIG;
const TOKEN_KEY = 'vpexam_token';
const App = { me: null, config: null, routes: [], cleanup: [], seq: 0, doneSeq: 0 };

// ---------- утилиты ----------
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return [...(root || document).querySelectorAll(sel)]; }
function fmtTime(sec) { sec = Math.max(0, Math.floor(sec || 0)); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s).padStart(2, '0'); }
function fmtDate(ms) { if (!ms) return '—'; return new Date(ms).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }); }
function toast(msg, isErr) { const t = $('#toast'); t.textContent = msg; t.className = 'toast' + (isErr ? ' err' : ''); t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, isErr ? 9000 : 4000); }
function token() { return localStorage.getItem(TOKEN_KEY); }
function setView(html) { $('#app').innerHTML = html; window.scrollTo(0, 0); }
function onCleanup(fn) { App.cleanup.push(fn); }
function userName(u) { return u ? (u.ic_name || u.global_name || u.username || u.id) : '—'; }
const STATUS_RU = {
  in_progress: ['В процессе', 'info'], pending_review: ['На проверке', 'warn'], passed: ['Сдан', 'ok'], failed: ['Не сдан', 'err'],
  watched: ['Просмотрена', 'ok'], not_started: ['Не начата', ''], locked: ['Закрыта', 'lock'],
};
function badge(st) { const x = STATUS_RU[st] || [st, '']; return `<span class="badge ${x[1]}">${esc(x[0])}</span>`; }
const ROLE_RU = { candidate: 'Кандидат', examiner: 'Проверяющий', admin: 'Администратор' };

async function api(method, path, body) {
  const h = {};
  const t = token(); if (t) h.Authorization = 'Bearer ' + t;
  if (body !== undefined) h['Content-Type'] = 'application/json';
  let res;
  try { res = await fetch(CFG.API_BASE + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined }); }
  catch (e) { throw new Error('Нет связи с сервером. Проверьте интернет и попробуйте ещё раз.'); }
  let data = null; try { data = await res.json(); } catch (_) {}
  if (res.status === 401 && path.startsWith('/api/')) { localStorage.removeItem(TOKEN_KEY); App.me = null; renderHeader(); if (location.hash !== '#/') location.hash = '#/'; }
  if (!res.ok) { const e = new Error((data && data.error) || ('Ошибка ' + res.status)); e.status = res.status; e.data = data; throw e; }
  return data;
}

// ---------- роутер ----------
function route(pattern, fn, opts = {}) { App.routes.push({ p: pattern, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '([^/]+)') + '$'), fn, opts }); }
async function render() {
  App.cleanup.forEach(f => { try { f(); } catch (_) {} }); App.cleanup = [];
  const path = (location.hash || '#/').slice(1) || '/';
  renderHeader();
  if (!App.me && path !== '/') { location.hash = '#/'; return; }
  for (const r of App.routes) {
    const m = r.re.exec(path);
    if (!m) continue;
    if (r.opts.role && !hasRole(r.opts.role)) { setView('<div class="alert err">Недостаточно прав для этого раздела.</div>'); return; }
    const mine = ++App.seq;
    try { await r.fn(...m.slice(1).map(decodeURIComponent)); }
    catch (e) { if (mine === App.seq) setView(`<div class="alert err">${esc(e.message)}</div><a class="btn" href="#/">На главную</a>`); }
    // Устаревшая отрисовка (пользователь уже перешёл на другую страницу) могла затереть новую — перерисовать актуальную.
    if (mine !== App.seq && App.doneSeq > mine) { render(); return; }
    App.doneSeq = Math.max(App.doneSeq, mine);
    return;
  }
  setView('<div class="alert warn">Страница не найдена.</div><a class="btn" href="#/">На главную</a>');
}
function hasRole(role) { const l = { candidate: 0, examiner: 1, admin: 2 }; return App.me && (l[App.me.role] || 0) >= l[role]; }
function renderHeader() {
  const s = App.config && App.config.settings;
  if (s) { $('#siteTitle').textContent = s.site_title; document.title = s.site_title; }
  const path = (location.hash || '#/').slice(1);
  const link = (href, txt) => `<a href="#${href}" class="${(href === '/' ? path === '/' : path.startsWith(href)) ? 'on' : ''}">${txt}</a>`;
  if (!App.me) { $('#nav').innerHTML = ''; $('#userbox').innerHTML = ''; return; }
  $('#nav').innerHTML = link('/', 'Главная') + link('/lectures', 'Лекции') + link('/exams', 'Экзамены') + link('/profile', 'Профиль') + (hasRole('examiner') ? link('/admin', 'Управление') : '');
  const u = App.me;
  $('#userbox').innerHTML = `${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : ''}<span>${esc(userName(u))}</span><button class="btn sm" id="logoutBtn">Выйти</button>`;
  $('#logoutBtn').onclick = async () => { try { await api('POST', '/api/logout'); } catch (_) {} localStorage.removeItem(TOKEN_KEY); App.me = null; location.hash = '#/'; render(); };
}

// ---------- старт ----------
async function boot() {
  const qs = new URLSearchParams(location.search);
  let authError = qs.get('auth_error');
  const code = qs.get('login_code');
  if (code || authError) history.replaceState(null, '', location.pathname + location.hash);
  try { App.config = await api('GET', '/api/config'); } catch (e) { App.configError = e.message; }
  if (code) {
    try { const r = await api('POST', '/auth/exchange', { code }); localStorage.setItem(TOKEN_KEY, r.token); }
    catch (e) { authError = e.message; }
  }
  if (token()) { try { App.me = (await api('GET', '/api/me')).user; } catch (e) { if (e.status !== 401) authError = authError || e.message; } }
  App.authError = authError;
  window.addEventListener('hashchange', render);
  checkVersion(); setInterval(checkVersion, 5 * 60 * 1000);
  render();
}

// Если на сервере вышла новая версия сайта — предложить обновить страницу.
async function checkVersion() {
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const { version } = await r.json();
    if (version && window.VP_VERSION && version !== window.VP_VERSION && !$('#updbar')) {
      const d = document.createElement('div'); d.id = 'updbar'; d.className = 'updbar';
      d.innerHTML = '<span>Вышла новая версия сайта.</span><button class="btn sm gold">Обновить</button>';
      d.querySelector('button').onclick = () => location.reload();
      document.body.appendChild(d);
    }
  } catch (_) {}
}

// ---------- страницы кандидата ----------
route('/', async () => {
  if (!App.me) return loginPage();
  const s = App.config ? App.config.settings : {};
  const [L, E] = await Promise.all([api('GET', '/api/lectures'), api('GET', '/api/exams')]);
  const done = L.lectures.filter(l => l.status === 'watched').length;
  setView(`
    <div class="card"><h1>${esc(s.site_title || 'Учебный центр')}</h1><div class="welcome">${esc(s.welcome_text || '')}</div></div>
    <div class="grid">
      <div class="card flat"><h3>Лекции</h3><div class="stat"><b>${done} / ${L.lectures.length}</b>просмотрено</div>
        <p><a class="btn" href="#/lectures">К лекциям</a></p></div>
      <div class="card flat"><h3>Экзамен</h3>${E.exams.length ? E.exams.map(e => `<div class="row between" style="margin-bottom:8px"><span>${esc(e.title)}</span>${examBadge(e)}</div>`).join('') : '<p class="mut">Экзамен пока не опубликован.</p>'}
        <p><a class="btn" href="#/exams">К экзаменам</a></p></div>
      <div class="card flat"><h3>Профиль</h3><p class="mut small">${App.me.ic_name ? 'Игровое имя: ' + esc(App.me.ic_name) : 'Укажите игровое имя и статик, чтобы проверяющему было проще вас найти.'}</p><p><a class="btn" href="#/profile">Открыть</a></p></div>
    </div>`);
});

function loginPage() {
  const s = App.config ? App.config.settings : null;
  const oauthOk = App.config && App.config.oauth_configured;
  let msg = '';
  if (App.configError) msg += `<div class="alert err">Сервер недоступен: ${esc(App.configError)}</div>`;
  else if (!oauthOk) msg += `<div class="alert warn"><b>OAuth не настроен.</b> Вход через Discord временно недоступен — администратору нужно указать DISCORD_CLIENT_ID и DISCORD_CLIENT_SECRET в настройках сервера.</div>`;
  if (App.authError) msg += `<div class="alert err">Не удалось войти: ${esc(App.authError)}</div>`;
  setView(`<div class="login card">
      <img src="assets/emblem.png" alt="">
      <h1>${esc(s ? s.site_title : 'ГУ ВП — Учебный центр')}</h1>
      <p class="welcome mut">${esc(s ? s.welcome_text : '')}</p>
      ${msg}
      <p><button class="btn discord" id="loginBtn" ${oauthOk ? '' : 'disabled'}>Войти через Discord</button></p>
      <p class="small mut">Мы получаем только ваш Discord ID, имя и аватар.</p>
    </div>`);
  $('#loginBtn').onclick = () => {
    const ret = location.origin + location.pathname;
    location.href = CFG.API_BASE + '/auth/login?return=' + encodeURIComponent(ret);
  };
}

function examBadge(e) {
  const last = e.attempts && e.attempts[0];
  if (last) return badge(last.status);
  if (e.can_start) return '<span class="badge ok">Доступен</span>';
  return '<span class="badge lock">Закрыт</span>';
}

route('/lectures', async () => {
  const L = await api('GET', '/api/lectures');
  const items = L.lectures.map((l, i) => {
    const pct = l.duration_sec ? Math.min(100, Math.round((l.progress ? l.progress.max_pos : 0) / l.duration_sec * 100)) : 0;
    const st = l.status === 'in_progress' ? `<span class="badge info">Просмотрено ${pct}%</span>` : badge(l.status);
    return `<a class="lec ${l.locked ? 'locked' : ''}" href="#/lecture/${l.id}">
      <div class="num">${l.locked ? '🔒' : i + 1}</div>
      <div class="body"><div class="title">${esc(l.title)} ${l.required ? '' : '<span class="badge">необязательная</span>'}</div>
        <div class="small mut">${fmtTime(l.duration_sec)}${l.description ? ' · ' + esc(l.description.slice(0, 140)) : ''}</div>
        <div class="bar"><i style="width:${l.status === 'watched' ? 100 : pct}%"></i></div></div>
      <div>${st}</div></a>`;
  }).join('');
  setView(`<h1>Лекции</h1>
    ${L.all_required_done && L.lectures.length ? '<div class="alert ok">Все обязательные лекции просмотрены. Какие лекции нужны для каждого экзамена — смотрите в разделе «Экзамены».</div>' : `<p class="mut">${App.config && App.config.settings && App.config.settings.sequential_lectures ? 'Лекции открываются по порядку. ' : ''}Перематывать вперёд нельзя — лекция засчитывается после полного просмотра. Для каждого экзамена нужны свои лекции — список есть в разделе «Экзамены».</p>`}
    ${items || '<div class="alert info">Лекции пока не добавлены.</div>'}`);
});

route('/lecture/:id', async (id) => {
  const { lecture: l } = await api('GET', '/api/lectures/' + encodeURIComponent(id));
  setView(`<p><a href="#/lectures">← Все лекции</a></p>
    <h1>${esc(l.title)}</h1>
    <div id="playerBox"></div>
    <div class="pmsg" id="pmsg"></div>
    ${l.description ? `<div class="card flat" style="margin-top:14px"><div class="welcome">${esc(l.description)}</div></div>` : ''}`);
  window.VPPlayer.mount($('#playerBox'), l, $('#pmsg'));
});

route('/exams', async () => {
  const E = await api('GET', '/api/exams');
  setView(`<h1>Экзамены</h1>
    <p class="mut small">Каждый экзамен открывается после просмотра своих лекций — список под названием экзамена.</p>
    ${E.exams.map(e => `<div class="card flat exam-card" data-exam="${e.id}"><div class="row between"><h2 style="margin:0">${esc(e.title)}</h2>${examBadge(e)}</div>
      <p class="mut small">${examMeta(e)}</p>
      ${examLecturesHtml(e)}
      <a class="btn" href="#/exam/${e.id}">Подробнее</a></div>`).join('') || '<div class="alert info">Экзамены пока не опубликованы.</div>'}`);
});
// Блок «какие лекции нужны для этого экзамена»: просмотренные и оставшиеся (со ссылками).
function examLecturesHtml(e) {
  const ls = e.lectures || [];
  if (e.lecture_mode === 'none' || !ls.length) return '<div class="exlec"><span class="small mut">Лекции для допуска не требуются.</span></div>';
  const left = ls.filter(l => !l.watched), done = ls.filter(l => l.watched);
  const chip = (l) => `<a class="lchip ${l.watched ? 'ok' : 'todo'}" href="#/lecture/${l.id}">${l.watched ? '✔' : l.locked ? '🔒' : '○'} ${esc(l.title)}</a>`;
  return `<div class="exlec">
    ${left.length ? `<div class="exlec-h warn">Осталось посмотреть: ${left.length} из ${ls.length}</div><div class="lchips">${left.map(chip).join('')}</div>
      ${left.some(l => l.locked) ? '<div class="small mut">🔒 — лекция откроется после просмотра предыдущих лекций (лекции идут по порядку).</div>' : ''}`
      : `<div class="exlec-h ok">✔ Все нужные лекции просмотрены (${ls.length})</div>`}
    ${done.length && left.length ? `<div class="small mut" style="margin-top:6px">Просмотрено:</div><div class="lchips">${done.map(chip).join('')}</div>` : ''}
  </div>`;
}
function examMeta(e) {
  return [`Вопросов: ${e.question_count}`, e.time_limit_min ? `Время: ${e.time_limit_min} мин` : 'Без ограничения времени',
    `Проходной балл: ${e.pass_pct}%`, e.max_attempts ? `Попыток: ${e.max_attempts}` : 'Попытки не ограничены',
    e.cooldown_min ? `Пауза между попытками: ${e.cooldown_min} мин` : ''].filter(Boolean).join(' · ');
}

route('/exam/:id', async (id) => {
  const { exam: e } = await api('GET', '/api/exams/' + encodeURIComponent(id));
  const atts = e.attempts.map(a => `<tr class="click" data-href="#/attempt/${a.id}"><td>#${a.id}</td><td>${fmtDate(a.started_at)}</td><td>${badge(a.status)}</td><td>${a.score_pct != null ? a.score_pct + '%' : '—'}</td></tr>`).join('');
  setView(`<p><a href="#/exams">← Экзамены</a></p>
    <div class="card"><h1>${esc(e.title)}</h1>
      ${e.description ? `<div class="welcome">${esc(e.description)}</div>` : ''}
      <p class="mut small">${examMeta(e)}</p>
      ${examLecturesHtml(e)}
      ${e.active_attempt_id ? `<a class="btn primary" href="#/attempt/${e.active_attempt_id}">Продолжить попытку</a>`
        : e.can_start ? `<button class="btn primary" id="startBtn">Начать экзамен</button>`
        : `<div class="alert warn">${esc(e.reason || 'Экзамен недоступен')}${e.next_at ? ' — ' + fmtDate(e.next_at) : ''}</div>`}
    </div>
    ${atts ? `<div class="card flat"><h3>Мои попытки</h3><table><tr><th>№</th><th>Начата</th><th>Статус</th><th>Результат</th></tr>${atts}</table></div>` : ''}`);
  $$('tr.click').forEach(tr => tr.onclick = () => { location.hash = tr.dataset.href; });
  const sb = $('#startBtn');
  if (sb) sb.onclick = async () => {
    if (!confirm(e.time_limit_min ? `После начала пойдёт таймер (${e.time_limit_min} мин). Начать?` : 'Начать экзамен?')) return;
    sb.disabled = true;
    try { const r = await api('POST', `/api/exams/${e.id}/start`); location.hash = '#/attempt/' + r.attempt_id; }
    catch (err) { toast(err.message, true); sb.disabled = false; }
  };
});

route('/attempt/:id', async (id) => {
  const { attempt: a } = await api('GET', '/api/attempts/' + encodeURIComponent(id));
  if (a.status !== 'in_progress') return attemptResult(a);
  const lsKey = 'vpexam_ans_' + a.id;
  const answers = Object.assign({}, a.saved_answers, JSON.parse(localStorage.getItem(lsKey) || '{}'));
  const skew = a.server_now - Date.now();
  setView(`<p><a href="#/exam/${a.exam.id}">← ${esc(a.exam.title)}</a></p>
    <div class="timer" id="timer"><span>${esc(a.exam.title)}</span><span>${a.deadline_at ? 'Осталось: <b id="tleft">—</b>' : '<span class="mut">Без ограничения времени</span>'}</span></div>
    <form id="examForm">${a.questions.map((q, i) => questionHtml(q, i, answers[q.id])).join('')}
    <div class="row"><button class="btn primary" type="submit" id="submitBtn">Завершить и отправить</button><span class="small mut" id="saveState"></span></div></form>`);
  const form = $('#examForm');
  const collect = () => {
    const out = {};
    for (const q of a.questions) {
      if (q.type === 'single') { const c = form.querySelector(`input[name="q${q.id}"]:checked`); out[q.id] = c ? c.value : null; }
      else if (q.type === 'multi') out[q.id] = $$(`input[name="q${q.id}"]:checked`, form).map(x => x.value);
      else out[q.id] = form.querySelector(`[name="q${q.id}"]`).value;
    }
    return out;
  };
  let dirty = false, saving = false, finished = false;
  const save = async () => {
    if (!dirty || saving || finished) return; saving = true; dirty = false;
    try { await api('PUT', `/api/attempts/${a.id}/answers`, { answers: collect() }); $('#saveState').textContent = 'Ответы сохранены ' + new Date().toLocaleTimeString('ru-RU'); }
    catch (e) { dirty = true; $('#saveState').textContent = 'Не удалось сохранить: ' + e.message; }
    saving = false;
  };
  form.addEventListener('input', () => { dirty = true; localStorage.setItem(lsKey, JSON.stringify(collect())); });
  const si = setInterval(save, 15000); onCleanup(() => clearInterval(si));
  const submit = async (auto) => {
    if (finished) return; finished = true;
    $('#submitBtn').disabled = true;
    try { await api('POST', `/api/attempts/${a.id}/submit`, { answers: collect() }); localStorage.removeItem(lsKey); toast(auto ? 'Время вышло — ответы отправлены' : 'Ответы отправлены'); render(); }
    catch (e) { finished = false; $('#submitBtn').disabled = false; toast(e.message, true); }
  };
  form.onsubmit = (ev) => { ev.preventDefault(); if (confirm('Отправить ответы? Изменить их после отправки будет нельзя.')) submit(false); };
  if (a.deadline_at) {
    const tick = () => {
      const left = (a.deadline_at - (Date.now() + skew)) / 1000;
      const el = $('#tleft'); if (!el) return;
      el.textContent = fmtTime(Math.max(0, left));
      $('#timer').classList.toggle('low', left < 60);
      if (left <= 0) submit(true);
    };
    tick(); const ti = setInterval(tick, 1000); onCleanup(() => clearInterval(ti));
  }
});
function questionHtml(q, i, val) {
  let body = '';
  if (q.type === 'single') body = q.options.map(o => `<label class="opt"><input type="radio" name="q${q.id}" value="${esc(o.id)}" ${val === o.id ? 'checked' : ''}><span>${esc(o.text)}</span></label>`).join('');
  else if (q.type === 'multi') body = '<div class="small mut">Можно выбрать несколько вариантов</div>' + q.options.map(o => `<label class="opt"><input type="checkbox" name="q${q.id}" value="${esc(o.id)}" ${Array.isArray(val) && val.includes(o.id) ? 'checked' : ''}><span>${esc(o.text)}</span></label>`).join('');
  else if (q.type === 'text') body = `<input type="text" name="q${q.id}" maxlength="1000" value="${esc(val || '')}" placeholder="Краткий ответ">`;
  else body = `<textarea name="q${q.id}" maxlength="8000" rows="6" placeholder="Развёрнутый ответ">${esc(val || '')}</textarea>`;
  return `<div class="q"><div class="row between"><span class="small mut">Вопрос ${i + 1}</span><span class="small mut">${q.points} балл(ов)</span></div><div class="qt">${esc(q.text)}</div>${body}</div>`;
}
function attemptResult(a) {
  let big, cls;
  if (a.status === 'passed') { big = 'СДАН'; cls = 'ok'; }
  else if (a.status === 'failed') { big = 'НЕ СДАН'; cls = 'err'; }
  else { big = 'НА ПРОВЕРКЕ'; cls = 'warn'; }
  setView(`<p><a href="#/exam/${a.exam ? a.exam.id : ''}">← ${esc(a.exam ? a.exam.title : 'Экзамен')}</a></p>
    <div class="card result"><div class="mut">Попытка #${a.id} · отправлена ${fmtDate(a.submitted_at)}${a.expired ? ' (автоматически, время вышло)' : ''}</div>
      <div class="big ${cls}">${big}</div>
      ${a.score_pct != null ? `<p>Результат: <b>${a.score_pct}%</b> (проходной — ${a.exam ? a.exam.pass_pct : '?'}%)</p>` : '<p class="mut">Ваши развёрнутые ответы проверит экзаменатор. Результат появится здесь.</p>'}
      ${a.reviewer_comment ? `<div class="alert info" style="text-align:left"><b>Комментарий проверяющего:</b><br><span class="welcome">${esc(a.reviewer_comment)}</span></div>` : ''}
      ${a.reviewed_at ? `<p class="small mut">Проверено ${fmtDate(a.reviewed_at)}</p>` : ''}
    </div>`);
}

route('/profile', async () => {
  const u = App.me;
  const { attempts } = await api('GET', '/api/my/attempts');
  setView(`<h1>Профиль</h1>
    <div class="card"><div class="row">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" style="width:64px;height:64px;border-radius:50%;border:2px solid var(--gold)">` : ''}
      <div><div><b>${esc(u.global_name || u.username)}</b> <span class="mut">@${esc(u.username)}</span></div><div class="small mut">Discord ID: ${esc(u.id)} · ${esc(ROLE_RU[u.role] || u.role)}${u.super ? ' (главный)' : ''}</div></div></div>
      <form id="pf" style="margin-top:16px"><div class="fgrid">
        <label class="f"><span>Игровое имя (Имя Фамилия)</span><input name="ic_name" maxlength="100" value="${esc(u.ic_name)}"></label>
        <label class="f"><span>Статик</span><input name="static_id" maxlength="30" value="${esc(u.static_id)}"></label>
        <label class="f"><span>Звание</span><input name="rank" maxlength="60" value="${esc(u.rank)}"></label></div>
        <button class="btn gold">Сохранить</button></form></div>
    <div class="card flat"><h3>Мои попытки</h3>${attempts.length ? `<table><tr><th>№</th><th>Экзамен</th><th>Дата</th><th>Статус</th><th>Результат</th></tr>${attempts.map(a => `<tr class="click" data-href="#/attempt/${a.id}"><td>#${a.id}</td><td>${esc(a.title)}</td><td>${fmtDate(a.submitted_at || a.started_at)}</td><td>${badge(a.status)}</td><td>${a.score_pct != null ? a.score_pct + '%' : '—'}</td></tr>`).join('')}</table>` : '<p class="mut">Попыток пока нет.</p>'}</div>`);
  $$('tr.click').forEach(tr => tr.onclick = () => { location.hash = tr.dataset.href; });
  $('#pf').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try { App.me = (await api('PUT', '/api/me', Object.fromEntries(f))).user; renderHeader(); toast('Профиль сохранён'); }
    catch (e) { toast(e.message, true); }
  };
});

document.addEventListener('DOMContentLoaded', boot);
