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
const ROLE_RU = { candidate: 'Пользователь', examiner: 'Проверяющий', admin: 'Администратор' };
// Роли доступа (сервер присылает caps): vp, reatt, examiner, admin, lead, ss (старший состав), super. Проверка — на сервере, здесь только меню.
function can(c) { return !!(App.me && App.me.caps && App.me.caps[c]); }
function isLeadUser() { return can('lead'); }
const CAP_RU = { vp: '«ВП»', reatt: '«Переаттестация»', examiner: '«Проверяющий» или «Администратор»', admin: '«Администратор»', lead: '«Руководство ГУ ВП»' };

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
    const m = r.re.exec(path.split("?")[0]);
    if (!m) continue;
    if (r.opts.role && !hasRole(r.opts.role)) { setView('<div class="alert err">Недостаточно прав для этого раздела.</div>'); return; }
    if (r.opts.cap && !can(r.opts.cap)) { setView(noAccess(r.opts.cap)); return; }
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
function noAccess(c) { return `<div class="card noacc"><h2>Раздел недоступен</h2><p>Этот раздел открывается с ролью ${CAP_RU[c] || ''}. Роли назначает администратор — обратитесь к руководству ГУ ВП.</p>
  <p class="small mut">Без ролей доступны «База данных» и «Личные дела».</p><div class="row"><a class="btn" href="#/">На главную</a><a class="btn" href="#/docs">База данных</a><a class="btn" href="#/people">Личные дела</a></div></div>`; }
// Разделы сайта (шторка): [путь, название, иконка, нужная роль (null — всем, кто вошёл), подпись]
const MENU = [
  ['/', 'Главная', '⌂', null],
  ['/study', 'Учебный отдел', '🎓', 'vp', 'курсы, лекции, экзамены'],
  ['/reatt', 'Переаттестация', '📋', 'reatt'],
  ['/reports', 'Отчёты', '📝', 'vp', 'еженедельный отчёт'],
  ['/premiums', 'Премирование', '₽', 'vp', 'премии недели'],
  ['/promo', 'Система повышения', '⭐', 'vp'],
  ['/docs', 'База данных', '📚', null, 'документация'],
  ['/people', 'Личные дела', '🗂', null],
  ['/lead', 'Руководство', '🛡', 'lead', 'проверка отчётов, фонд, бюджет'],
  ['/admin', 'Админка', '⚙', 'examiner'],
  ['/profile', 'Профиль', '👤', null],
];
const MENU_ALIAS = { '/lectures': '/study', '/lecture': '/study', '/exams': '/study', '/exam': '/study', '/course': '/study', '/attempt': '/study', '/doc': '/docs', '/doc-edit': '/docs', '/person': '/people' };
function menuActive(path) {
  const top = '/' + (path.split('/')[1] || '').split('?')[0];
  const t = MENU_ALIAS[top] || top;
  return t === '/' ? '/' : t;
}
function openDrawer(open) {
  const d = $('#drawer'), ov = $('#drawerOv'), b = $('#burger');
  document.body.classList.toggle('drawer-open', open);
  d.setAttribute('aria-hidden', open ? 'false' : 'true'); ov.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (open) { const a = d.querySelector('a.on') || d.querySelector('a'); if (a) a.focus({ preventScroll: true }); }
}
function renderHeader() {
  const s = App.config && App.config.settings;
  if (s) { $('#siteTitle').textContent = s.site_title; document.title = s.site_title; }
  const path = (location.hash || '#/').slice(1) || '/';
  const burger = $('#burger'), drawer = $('#drawer');
  if (!App.me) { $('#userbox').innerHTML = ''; burger.hidden = true; drawer.innerHTML = ''; openDrawer(false); $('#secTitle').textContent = 'Главное управление Военной полиции'; return; }
  const act = menuActive(path);
  const items = MENU.filter(m => !m[3] || can(m[3]));
  const cur = MENU.find(m => m[0] === act);
  $('#secTitle').textContent = cur && cur[0] !== '/' ? cur[1] : 'Главное управление Военной полиции';
  const u = App.me;
  drawer.innerHTML = `<div class="drawer-head"><img src="assets/emblem.png" alt=""><div><b>ГУ ВП</b><div class="small mut">${esc(userName(u))}${u.rank ? ' · ' + esc(u.rank) : ''}</div></div>
      <button type="button" class="drawer-x" id="drawerX" aria-label="Закрыть меню">✕</button></div>
    <nav class="drawer-nav">${items.map(m => `<a href="#${m[0]}" class="${m[0] === act ? 'on' : ''}"><i>${m[2]}</i><span>${esc(m[1])}${m[4] ? `<small>${esc(m[4])}</small>` : ''}</span></a>`).join('')}</nav>
    <div class="drawer-foot">${can('vp') ? `<a href="${esc(CFG.REPORTS_URL.replace(/otchet\.html$/, ''))}" target="_blank" rel="noopener">Сайт бланков ↗</a>` : ''}
      <div class="small mut">${rolesText(u)}</div></div>`;
  burger.hidden = false;
  burger.onclick = () => openDrawer(!document.body.classList.contains('drawer-open'));
  $('#drawerOv').onclick = () => openDrawer(false);
  $('#drawerX').onclick = () => openDrawer(false);
  drawer.querySelectorAll('a[href^="#"]').forEach(a => a.addEventListener('click', () => openDrawer(false)));
  $('#userbox').innerHTML = `<a href="#/profile" class="ub-me" title="Профиль">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : ''}<span>${esc(userName(u))}</span></a><button class="btn sm" id="logoutBtn">Выйти</button>`;
  $('#logoutBtn').onclick = async () => { try { await api('POST', '/api/logout'); } catch (_) {} localStorage.removeItem(TOKEN_KEY); App.me = null; location.hash = '#/'; render(); };
}
function rolesText(u) {
  const r = [];
  if (u.super) r.push('Главный администратор'); else if (u.role === 'admin') r.push('Администратор'); else if (u.role === 'examiner') r.push('Проверяющий');
  if (u.leader) r.push('Руководство ГУ ВП'); if (u.senior) r.push('Старший состав'); if (u.vp) r.push('ВП'); if (u.reatt) r.push('Переаттестация');
  return r.length ? 'Роли: ' + r.join(', ') : 'Ролей пока нет';
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('drawer-open')) { openDrawer(false); $('#burger').focus(); } });

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
  return homePage();
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
      <p class="login-note small mut"><svg class="login-note-ic" viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" d="M6 11V8a6 6 0 0 1 12 0v3M5 11h14v10H5z"/></svg><span>Вход идёт через официальную авторизацию Discord. Сайт получает только ваш ник, аватар и Discord ID — пароль, почта, серверы и сообщения нам недоступны.</span></p>
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
}, { cap: 'vp' });

route('/lecture/:id', async (id) => {
  const { lecture: l } = await api('GET', '/api/lectures/' + encodeURIComponent(id));
  const back = l.course_id ? `#/course/${l.course_id}` : '#/study';
  setView(`<p><a href="${back}">← К курсу</a></p>
    <h1>${esc(l.title)}</h1>
    ${l.kind === 'text' ? `<div class="reader-bar" id="rbar"><div class="row between small"><span id="rtxt">Чтение…</span><span id="rtime"></span></div><div class="bar"><i id="rfill" style="width:0%"></i></div></div>
      <article class="card lecture-text md">${md(l.body)}</article>` : '<div id="playerBox"></div>'}
    <div class="pmsg" id="pmsg"></div>
    ${l.description ? `<div class="card flat" style="margin-top:14px"><div class="welcome">${esc(l.description)}</div></div>` : ''}
    ${l.kind === 'text' ? `<p><a class="btn" href="${back}">← К курсу</a></p>` : ''}`);
  if (l.kind === 'text') textReader(l); else window.VPPlayer.mount($('#playerBox'), l, $('#pmsg'));
}, { cap: 'vp' });
// Текстовая лекция: засчитывается по времени чтения (длительность лекции). Время идёт, только пока вкладка открыта и активна;
// сервер проверяет прирост по реальному времени (тот же heartbeat, что у видео), поэтому «пролистать» лекцию нельзя.
function textReader(l) {
  const dur = l.duration_sec || 0, p = l.progress || {};
  let pos = Math.min(p.last_pos || 0, dur), done = !!p.completed_at, lastTick = Date.now(), sending = false, stopped = false;
  const fmt = (x) => { x = Math.max(0, Math.ceil(x)); return Math.floor(x / 60) + ':' + String(x % 60).padStart(2, '0'); };
  const paint = (msg) => {
    const pct = dur ? Math.min(100, Math.round(pos / dur * 100)) : 0;
    $('#rfill').style.width = (done ? 100 : pct) + '%';
    $('#rtxt').textContent = done ? '✔ Лекция прочитана и засчитана' : (msg || (document.hidden ? 'Пауза: вкладка неактивна' : 'Читайте лекцию — время чтения засчитывается'));
    $('#rtime').textContent = done ? '' : `осталось ~${fmt(dur - pos)}`;
    $('#rbar').classList.toggle('ok', done);
  };
  const send = async () => {
    if (sending || stopped || !document.getElementById('rbar')) return;
    sending = true;
    try {
      const r = await api('POST', `/api/lectures/${l.id}/heartbeat`, { position: Math.round(pos * 10) / 10, event: 'read' });
      if (!r.accepted) pos = r.last_pos;
      if (r.completed && !done) { done = true; toast('Лекция засчитана'); }
    } catch (e) { paint('Нет связи с сервером — время не засчитывается'); }
    finally { sending = false; if (document.getElementById('rbar')) paint(); }
  };
  const tick = () => {
    const now = Date.now(), dt = (now - lastTick) / 1000; lastTick = now;
    if (!document.hidden && !done) pos = Math.min(dur, pos + Math.min(dt, 6));
    paint();
  };
  paint();
  send();
  const t1 = setInterval(tick, 1000), t2 = setInterval(() => { if (!done) send(); }, 5000);
  const vis = () => { lastTick = Date.now(); paint(); };
  document.addEventListener('visibilitychange', vis);
  App.cleanup.push(() => { stopped = true; clearInterval(t1); clearInterval(t2); document.removeEventListener('visibilitychange', vis); if (!done && pos > 0) api('POST', `/api/lectures/${l.id}/heartbeat`, { position: Math.round(pos * 10) / 10, event: 'leave' }).catch(() => {}); });
}

route('/exams', async () => {
  const E = await api('GET', '/api/exams');
  setView(`<h1>Экзамены</h1>
    <p class="mut small">Каждый экзамен открывается после просмотра своих лекций — список под названием экзамена.</p>
    ${E.exams.map(e => `<div class="card flat exam-card" data-exam="${e.id}"><div class="row between"><h2 style="margin:0">${esc(e.title)}</h2>${examBadge(e)}</div>
      <p class="mut small">${examMeta(e)}</p>
      ${examLecturesHtml(e)}
      <a class="btn" href="#/exam/${e.id}">Подробнее</a></div>`).join('') || '<div class="alert info">Экзамены пока не опубликованы.</div>'}`);
}, { cap: 'vp' });
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
  setView(`<p><a href="#/course/${e.course_id || 0}">← К курсу</a></p>
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
}, { cap: 'vp' });

route('/attempt/:id', async (id) => {
  const { attempt: a } = await api('GET', '/api/attempts/' + encodeURIComponent(id));
  if (a.status !== 'in_progress') return attemptResult(a);
  const lsKey = 'vpexam_ans_' + a.id;
  let local = {}; try { local = JSON.parse(localStorage.getItem(lsKey) || '{}'); } catch (_) {}
  const answers = Object.assign({}, a.saved_answers, local);
  // загруженные файлы — всегда с сервера (там имя/размер)
  for (const [k, v] of Object.entries(a.saved_answers || {})) if (v && v.upload_id) answers[k] = v;
  const skew = a.server_now - Date.now();
  const back = attemptBack(a);
  let num = 0;
  setView(`<p><a href="${back.href}">← ${esc(back.title)}</a></p>
    <div class="timer" id="timer"><span>${esc(a.exam.title)}</span><span>${a.deadline_at ? 'Осталось: <b id="tleft">—</b>' : '<span class="mut">Без ограничения времени</span>'}</span></div>
    <div class="small mut" style="margin:-8px 0 12px">Вопросов: ${a.questions.filter(q => q.type !== 'info').length}. Ответы сохраняются автоматически.</div>
    <form id="examForm" novalidate>${a.questions.map(q => `<div class="q ${q.type === 'info' ? 'info-q' : ''} ${q.kind === 'case' ? 'case-q' : ''}" data-qid="${q.id}" data-type="${esc(q.type)}"><div class="row between"><span class="small mut">${q.type === 'info' ? 'Информация' : (q.kind === 'case' ? 'Кейс' : 'Вопрос') + ' ' + (++num)}${q.category ? ' · ' + esc(q.category) : ''}</span>${q.type === 'info' ? '' : `<span class="small mut">${q.points} балл(ов)</span>`}</div><div class="qt">${esc(q.text)}</div></div>`).join('')}
    <div class="row"><button class="btn primary" type="submit" id="submitBtn">Завершить и отправить</button><span class="small mut" id="saveState"></span></div></form>`);
  const form = $('#examForm');
  let dirty = false, saving = false, finished = false;
  const ctl = {};
  const onChange = () => { dirty = true; try { localStorage.setItem(lsKey, JSON.stringify(collect(true))); } catch (_) {} };
  const ctx = { upload: (qid, f) => api('POST', `/api/attempts/${a.id}/upload`, { question_id: qid, ...f }) };
  for (const q of a.questions) ctl[q.id] = window.QT.mount(form.querySelector(`.q[data-qid="${q.id}"]`), q, answers[q.id], onChange, ctx);
  function collect(forLocal) {
    const out = {};
    for (const q of a.questions) {
      if (q.type === 'info') continue;
      let v = ctl[q.id].get();
      if (forLocal && (q.type === 'file' || q.type === 'voice')) continue;
      out[q.id] = v === undefined ? null : v;
    }
    return out;
  }
  const save = async () => {
    if (!dirty || saving || finished) return; saving = true; dirty = false;
    try { await api('PUT', `/api/attempts/${a.id}/answers`, { answers: collect() }); $('#saveState').textContent = 'Ответы сохранены ' + new Date().toLocaleTimeString('ru-RU'); }
    catch (e) { dirty = true; $('#saveState').textContent = 'Не удалось сохранить: ' + e.message; }
    saving = false;
  };
  const si = setInterval(save, 15000); onCleanup(() => clearInterval(si));
  const submit = async (auto) => {
    if (finished) return; finished = true;
    $('#submitBtn').disabled = true;
    try { await api('POST', `/api/attempts/${a.id}/submit`, { answers: collect() }); localStorage.removeItem(lsKey); toast(auto ? 'Время вышло — ответы отправлены' : 'Ответы отправлены'); render(); }
    catch (e) { finished = false; $('#submitBtn').disabled = false; toast(e.message, true); }
  };
  form.onsubmit = (ev) => {
    ev.preventDefault();
    const vals = collect(); const empty = a.questions.filter(q => q.type !== 'info' && (vals[q.id] == null || vals[q.id] === '' || (Array.isArray(vals[q.id]) && !vals[q.id].length))).length;
    if (confirm((empty ? `Без ответа: ${empty}. ` : '') + 'Отправить ответы? Изменить их после отправки будет нельзя.')) submit(false);
  };
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
function attemptBack(a) { return a.reatt ? { href: '#/reatt', title: 'Переаттестация' } : { href: '#/exam/' + (a.exam ? a.exam.id : ''), title: a.exam ? a.exam.title : 'Экзамен' }; }
function attemptResult(a) {
  let big, cls;
  if (a.status === 'passed') { big = 'СДАН'; cls = 'ok'; }
  else if (a.status === 'failed') { big = 'НЕ СДАН'; cls = 'err'; }
  else { big = 'НА ПРОВЕРКЕ'; cls = 'warn'; }
  const back = attemptBack(a);
  setView(`<p><a href="${back.href}">← ${esc(back.title)}</a></p>
    <div class="card result"><h2>${esc(a.exam ? a.exam.title : '')}</h2><div class="mut">Попытка #${a.id} · отправлена ${fmtDate(a.submitted_at)}${a.expired ? ' (автоматически, время вышло)' : ''}</div>
      <div class="big ${cls}">${big}</div>
      ${a.score_pct != null ? `<p>Результат: <b>${a.score_pct}%</b> (проходной — ${a.exam ? a.exam.pass_pct : '?'}%)</p>` : '<p class="mut">Ваши развёрнутые ответы (кейсы, файлы, голосовые) проверит экзаменатор. Результат появится здесь.</p>'}
      ${a.reviewer_comment ? `<div class="alert info" style="text-align:left"><b>Комментарий проверяющего:</b><br><span class="welcome">${esc(a.reviewer_comment)}</span></div>` : ''}
      ${a.reviewed_at ? `<p class="small mut">Проверено ${fmtDate(a.reviewed_at)}</p>` : ''}
    </div>`);
}

route('/reatt', async () => {
  const { versions } = await api('GET', '/api/reatt');
  setView(`<h1>Переаттестация</h1>
    <p class="mut small">В каждой попытке вопросы выбираются случайно, порядок вопросов и вариантов перемешивается. Тесты проверяются автоматически — результат сразу после отправки; кейсы проверяет экзаменатор.</p>
    <div class="reatt-grid">${versions.map(v => `<div class="card reatt-card" data-v="${v.key}">
      <div class="row between"><h2 style="margin:0">${esc(v.title)}</h2>${v.attempts[0] ? badge(v.attempts[0].status) : v.enabled ? '<span class="badge ok">Доступна</span>' : '<span class="badge lock">Выключена</span>'}</div>
      ${v.description ? `<p class="welcome small">${esc(v.description)}</p>` : ''}
      <p class="small mut">Всего: ${[v.total_questions ? v.total_questions + ' вопросов' : '', v.total_cases ? v.total_cases + ' кейсов' : ''].filter(Boolean).join(' + ') || '—'} · ${v.total_cases ? 'кейсы проверяет экзаменатор' : 'автопроверка'} · ${v.time_limit_min ? 'время ' + v.time_limit_min + ' мин' : 'без ограничения времени'} · проходной ${v.pass_pct}%${v.max_attempts ? ' · попыток: ' + v.max_attempts : ''}${v.cooldown_min ? ' · пауза ' + v.cooldown_min + ' мин' : ''}</p>
      ${v.active_attempt_id ? `<a class="btn primary" href="#/attempt/${v.active_attempt_id}">Продолжить попытку</a>`
        : v.can_start ? `<button class="btn primary startR" data-v="${v.key}" data-t="${v.time_limit_min}">Начать</button>`
        : `<div class="alert warn">${esc(v.reason || 'Недоступно')}${v.next_at ? ' — ' + fmtDate(v.next_at) : ''}</div>`}
      ${v.attempts.length ? `<table style="margin-top:12px"><tr><th>№</th><th>Дата</th><th>Статус</th><th>Результат</th></tr>${v.attempts.map(x => `<tr class="click" data-href="#/attempt/${x.id}"><td>#${x.id}</td><td>${fmtDate(x.submitted_at || x.started_at)}</td><td>${badge(x.status)}</td><td>${x.score_pct != null ? x.score_pct + '%' : '—'}</td></tr>`).join('')}</table>` : ''}
    </div>`).join('') || '<p class="mut">Сейчас нет доступных переаттестаций.</p>'}</div>`);
  $$('tr.click').forEach(tr => tr.onclick = () => { location.hash = tr.dataset.href; });
  $$('.startR').forEach(b => b.onclick = async () => {
    if (!confirm(Number(b.dataset.t) ? `После начала пойдёт таймер (${b.dataset.t} мин). Начать?` : 'Начать переаттестацию?')) return;
    b.disabled = true;
    try { const r = await api('POST', `/api/reatt/${b.dataset.v}/start`); location.hash = '#/attempt/' + r.attempt_id; }
    catch (err) { toast(err.message, true); b.disabled = false; }
  });
}, { cap: 'reatt' });


document.addEventListener('DOMContentLoaded', boot);
