/* Оболочка портала: шапка, лента разделов (режимы «Сотрудник» / «Администратор») и главная.
   Права проверяет сервер; лента показывает только разделы, доступные по ролям из /api/me. */
'use strict';
const FORMS_SITE = CFG.REPORTS_URL.replace(/otchet\.html$/, '');

// Раздел: id, подпись плитки, кто видит (cap — по caps, role — по уровню роли), заголовок, пояснение, действия, карточки, маршруты.
const STAFF_SECTIONS = [
  { id: 'study', label: 'Учёба', cap: 'vp', lead: 'Курсы по званиям и должностям: темы, лекции и экзамен в конце курса.',
    acts: [{ label: 'Курсы', href: '#/study', primary: true }, { label: 'Все лекции', href: '#/lectures' }],
    points: [['Курсы', 'Что назначено по должности и званию'], ['Экзамен курса', 'Открывается после лекций']],
    match: /^\/(study|course|topic|lectures?)(\/|$)/, data: 'courses' },
  { id: 'exams', label: 'Экзамены', cap: 'vp', lead: 'Список экзаменов сотрудника. Конкретный экзамен выбирается здесь.',
    acts: [{ label: 'К списку экзаменов', href: '#/exams', primary: true }],
    points: [['Список', 'Какие экзамены доступны сейчас'], ['Допуск', 'Закрытый экзамен ждёт просмотра лекций']],
    match: /^\/(exams?|attempt)(\/|$)/, data: 'exams' },
  { id: 'reatt', label: 'Переаттестация', cap: 'reatt', lead: 'Только виды, к которым выдан доступ: срок и число попыток.',
    acts: [{ label: 'Мои переаттестации', href: '#/reatt', primary: true }],
    points: [['Допуск', 'Вид, до какого момента и сколько попыток осталось']],
    match: /^\/reatt(\/|$)/, data: 'reatt' },
  { id: 'reports', label: 'Отчёты', cap: 'vp', lead: 'Еженедельный отчёт: бланк текущей недели, отправка руководству и свои прошлые отчёты.',
    acts: [{ label: 'Отчёт за неделю', href: '#/reports', primary: true }],
    points: [['Текущая неделя', 'Кому адресован отчёт и сдан ли он'], ['Прошлые недели', 'Кому, статус и версия']],
    match: /^\/reports(\/|$)/, data: 'report' },
  { id: 'forms', label: 'Бланки', cap: 'vp', lead: 'Сайт бланков ГУ ВП: еженедельный отчёт, рапорт на повышение и остальные формы.',
    acts: [{ label: 'Бланки', href: '#/forms', primary: true }],
    points: [['Каталог', 'Все бланки на одном сайте'], ['Отчёт', 'Еженедельный бланк — в разделе «Отчёты»']], match: /^\/forms(\/|$)/ },
  { id: 'premiums', label: 'Премии', cap: 'vp', lead: 'Кто сколько получил за выбранную неделю. До срока неделя закрыта.',
    acts: [{ label: 'Открыть премии', href: '#/premiums', primary: true }],
    points: [['Выбранная неделя', 'Суммы видны после срока']], match: /^\/premiums(\/|$)/ },
  { id: 'promo', label: 'Повышение', cap: 'vp', lead: 'Ступени званий, баллы и обязательные пункты.',
    acts: [{ label: 'Открыть ступени', href: '#/promo', primary: true }],
    points: [['Ступень', 'Сколько баллов и какие пункты нужны']], match: /^\/promo(\/|$)/ },
  { id: 'docs', label: 'База', lead: 'Инструкции и документы. Доступны всем, кто вошёл.',
    acts: [{ label: 'Открыть базу', href: '#/docs', primary: true }],
    points: [['Материалы', 'Статьи и памятки']], match: /^\/(docs|doc|doc-edit)(\/|$)/ }
];
const ADMIN_SECTIONS = [
  { id: 'users', label: 'Люди и роли', role: 'examiner', lead: 'Роли ВП, переаттестация, руководство, проверяющий, администратор и профиль.',
    acts: [{ label: 'К списку людей', href: '#/admin/users', primary: true }],
    points: [['Список', 'Кому какая роль назначена']], match: /^\/admin\/users?(\/|$)/, stats: s => [['Пользователей', s.users]] },
  { id: 'attempts', label: 'Проверка', role: 'examiner', lead: 'Попытки экзаменов и переаттестаций, которые ждут проверяющего.',
    acts: [{ label: 'Работы на проверке', href: '#/admin/attempts', primary: true }, { label: 'Сводка', href: '#/admin' }],
    points: [['Очередь', 'Работы на проверке']], match: /^\/admin(\/attempts?(\/.*)?)?$/,
    stats: s => [['Ждут проверки', s.pending_review], ['Переаттестаций на проверке', `${s.reatt_pending} из ${s.reatt_total}`], ['Идёт сейчас', s.in_progress], ['Сдали экзамен', s.passed]] },
  { id: 'courses', label: 'Курсы', role: 'admin', lead: 'Состав курса: темы, лекции и экзамен. Это правка, не экран, где сотрудник учится.',
    acts: [{ label: 'Открыть курсы', href: '#/admin/courses', primary: true }],
    points: [['Сборка', 'Что входит в курс']], match: /^\/admin\/(courses|course|topic)(\/|$)/ },
  { id: 'lectures', label: 'Лекции', role: 'admin', lead: 'Видео или текст, длительность и публикация.',
    acts: [{ label: 'Открыть лекции', href: '#/admin/lectures', primary: true }],
    points: [['Материал', 'Ролик или текст и выложен ли он']], match: /^\/admin\/lectures?(\/|$)/, stats: s => [['Опубликовано лекций', `${s.lectures_published} из ${s.lectures}`]] },
  { id: 'examEdit', label: 'Конструктор', role: 'admin', title: 'Конструктор экзаменов', lead: 'Создание экзамена и вопросов. Сдача сотрудником — в разделе «Экзамены».',
    acts: [{ label: 'Открыть конструктор', href: '#/admin/exams', primary: true }],
    points: [['Черновик', 'Экзамен, пока его не видят кандидаты']], match: /^\/admin\/exams?(\/|$)/, stats: s => [['Экзаменов', s.exams]] },
  { id: 'bank', label: 'Банк вопросов', role: 'admin', lead: 'Вопросы переаттестации: фильтр, правка, добавление.',
    acts: [{ label: 'Открыть банк', href: '#/admin/bank', primary: true }],
    points: [['Вопросы', 'База, из которой собирается переаттестация']], match: /^\/admin\/bank(\/|$)/, stats: s => [['Вопросов и кейсов', `${s.bank_questions} + ${s.bank_cases}`]] },
  { id: 'access', label: 'Доступ к тестам', role: 'admin', lead: 'Виды переаттестации: квоты вопросов, кому выдан доступ, до какого момента и сколько попыток.',
    acts: [{ label: 'Открыть доступы', href: '#/admin/reatt', primary: true }],
    points: [['Выдачи', 'Срок и число попыток']], match: /^\/admin\/reatt(\/|$)/ },
  { id: 'laws', label: 'Законодательство', role: 'admin', lead: 'Сверки документов. Решение человека само не переписывает ответы вопросов.',
    acts: [{ label: 'Сверки', href: '#/admin/laws', primary: true }, { label: 'История', href: '#/admin/laws/history' }],
    points: [['Сверка', 'Что изменилось в документе и какие вопросы это затрагивает']], match: /^\/admin\/laws(\/|$)/ },
  { id: 'people', label: 'Личные дела', cap: 'ss', lead: 'Досье сотрудников. Видит старший состав, руководство и администратор.',
    acts: [{ label: 'К списку дел', href: '#/people', primary: true }],
    points: [['Досье', 'Карточка сотрудника']], match: /^\/(people|person)(\/|$)/ },
  { id: 'lead', label: 'Неделя', cap: 'lead', title: 'Неделя', lead: 'Сводная таблица отчётов и премий. Отсюда открывается конкретный отчёт.',
    acts: [{ label: 'Открыть неделю', href: '#/lead', primary: true }],
    points: [['Таблица', 'Кто сдал отчёт и какая премия']], match: /^\/lead(\/report(\/.*)?)?$/ },
  { id: 'viol', label: 'Нарушения', cap: 'lead', lead: 'Несданные и сданные после срока отчёты.',
    acts: [{ label: 'Открыть нарушения', href: '#/lead/violations', primary: true }],
    points: [['Срок', 'Кто не сдал или сдал позже']], match: /^\/lead\/violations(\/|$)/ },
  { id: 'budget', label: 'Бюджет', cap: 'lead', lead: 'Баланс ГУ ВП: взносы, остатки фонда, поступления и снятия.',
    acts: [{ label: 'Открыть бюджет', href: '#/lead/budget', primary: true }],
    points: [['Баланс', 'Фонд и движение средств']], match: /^\/lead\/budget(\/|$)/ },
  { id: 'roster', label: 'Состав', cap: 'lead', lead: 'Кто в составе ГУ ВП и с какой недели ведётся учёт нарушений.',
    acts: [{ label: 'Открыть состав', href: '#/lead/staff', primary: true }],
    points: [['Учёт', 'Сотрудник и неделя начала учёта']], match: /^\/lead\/staff(\/|$)/ },
  { id: 'audit', label: 'Журнал', role: 'admin', lead: 'Журнал действий на портале.',
    acts: [{ label: 'Открыть журнал', href: '#/admin/audit', primary: true }],
    points: [['Записи', 'Кто и что изменил']], match: /^\/admin\/audit(\/|$)/ },
  { id: 'settings', label: 'Параметры', role: 'admin', lead: 'Название сайта и порядок лекций.',
    acts: [{ label: 'Открыть параметры', href: '#/admin/settings', primary: true }],
    points: [['Настройки', 'То, что видит весь портал']], match: /^\/admin\/settings(\/|$)/ },
  { id: 'media', label: 'Изображения', role: 'admin', lead: 'Картинки к вопросам.',
    acts: [{ label: 'Открыть изображения', href: '#/admin/media', primary: true }],
    points: [['Файлы', 'Что можно вставить в вопрос']], match: /^\/admin\/media(\/|$)/ },
  { id: 'bases', label: 'Сводка баз', role: 'admin', lead: 'Базы переаттестации и проверка качества.',
    acts: [{ label: 'Открыть сводку', href: '#/admin/bases', primary: true }],
    points: [['Базы', 'Состав и замечания']], match: /^\/admin\/bases(\/|$)/ },
  { id: 'pay', label: 'Таблицы выплат', cap: 'lead', lead: 'Правила премий. Правка у главного администратора.',
    acts: [{ label: 'Открыть таблицы', href: '#/lead/config', primary: true }],
    points: [['Правила', 'Как считается премия']], match: /^\/lead\/config(\/|$)/ }
];

const Shell = { mode: 'staff', index: 0, sig: '', drag: null, navT: 0 };
function ssGet(k) { try { return sessionStorage.getItem(k); } catch (_) { return null; } }
function ssSet(k, v) { try { sessionStorage.setItem(k, v); } catch (_) {} }
function sectionOk(s) { return s.role ? hasRole(s.role) : s.cap ? can(s.cap) : true; }
function adminAllowed() { return !!App.me && ADMIN_SECTIONS.some(sectionOk); }
function sections(mode) { return (mode === 'admin' ? ADMIN_SECTIONS : STAFF_SECTIONS).filter(sectionOk); }
function visibleSections() { return sections(Shell.mode); }
function currentSection() { const v = visibleSections(); return v[Shell.index] || v[0]; }
function curPath() { return ((location.hash || '#/').slice(1) || '/').split('?')[0]; }
function onHome() { return curPath() === '/'; }
function isCalm() { return /^\/(attempt|exam|lecture)(\/|$)/.test(curPath()); }
const railEl = () => document.getElementById('rail');
const primaryHref = (s) => ((s.acts || []).find(a => a.primary && a.href) || (s.acts || [])[0] || { href: '#/' }).href;

// Запросы, которые делает страница раздела (запоминаются после первого захода) — для подгрузки заранее.
const PF_DEFAULT = { '/study': ['/api/courses'], '/exams': ['/api/exams'], '/reatt': ['/api/reatt'], '/reports': ['/api/reports/my', '/api/report-config', '/api/promo-config'],
  '/admin/users': ['/api/admin/users?q='], '/admin/attempts': ['/api/admin/attempts?status=pending_review&kind='], '/admin/reatt': ['/api/admin/reatt'], '/admin/laws': ['/api/admin/laws'],
  '/lead': ['/api/lead/week'], '/lead/budget': ['/api/lead/budget', '/api/lead/staff'], '/admin/bank': ['/api/admin/bank/stats'] };
let PF = {}; try { PF = JSON.parse(localStorage.getItem('vp_pf') || '{}') || {}; } catch (_) { PF = {}; }
function pfPaths(routePath) { return (PF[routePath] || PF_DEFAULT[routePath] || []).filter(p => cacheable(p)); }
function pfSection(s) { if (s) pfPaths(primaryHref(s).slice(1)).forEach(prefetch); }
// Что запросить вместе с входом (сервер отдаёт только разрешённое по ролям).
// Адреса всех действий каждой видимой плитки: сначала режим сотрудника, затем администратора (для проверок меню).
window.vpMenu = function () {
  const out = []; const take = (m) => sections(m).forEach(s => s.acts.forEach(a => out.push(a.href)));
  take('staff'); if (adminAllowed()) take('admin'); return out;
};
window.bootWants = function () {
  let path = curPath();
  if (path === '/') {
    const mode = ssGet('vp_mode') === 'admin' ? 'admin' : 'staff';
    const id = ssGet('vp_sec_' + mode);
    const s = (mode === 'admin' ? ADMIN_SECTIONS : STAFF_SECTIONS).find(x => x.id === id) || STAFF_SECTIONS[0];
    path = primaryHref(s).slice(1);
  }
  return pfPaths(path).slice(0, 8);
};

function restoreShell() {
  const m = ssGet('vp_mode');
  Shell.mode = m === 'admin' && adminAllowed() ? 'admin' : 'staff';
  const id = ssGet('vp_sec_' + Shell.mode);
  const i = visibleSections().findIndex(s => s.id === id);
  Shell.index = i < 0 ? 0 : i;
}
function saveShell() {
  ssSet('vp_mode', Shell.mode);
  const s = currentSection(); if (s) ssSet('vp_sec_' + Shell.mode, s.id);
}
// Раздел, к которому относится открытая страница: переключает режим и подсвечивает плитку.
function syncToRoute() {
  const p = curPath();
  if (p === '/' || p === '/profile' || p === '/theme') return;
  for (const mode of [Shell.mode, Shell.mode === 'admin' ? 'staff' : 'admin']) {
    const list = sections(mode);
    const i = list.findIndex(s => s.match && s.match.test(p));
    if (i >= 0) { Shell.mode = mode; Shell.index = i; saveShell(); return; }
  }
}

// ---------- шапка ----------
function renderHeader() {
  const s = App.config && App.config.settings;
  if (s && s.site_title) document.title = s.site_title;
  const u = App.me;
  const box = $('#userbox'), modes = $('#modes'), nav = $('#secnav');
  $('#formsLink').href = FORMS_SITE;
  if (!u) { box.innerHTML = ''; modes.hidden = true; nav.hidden = true; Shell.sig = ''; Shell.userSig = ''; return; }
  if (!Shell.restored) { restoreShell(); Shell.restored = true; }
  if (Shell.mode === 'admin' && !adminAllowed()) Shell.mode = 'staff';
  syncToRoute();
  modes.hidden = !adminAllowed();
  modes.querySelectorAll('.mode').forEach(b => b.setAttribute('aria-checked', b.dataset.mode === Shell.mode ? 'true' : 'false'));
  nav.hidden = isCalm() || !visibleSections().length;
  const usig = [u.id, u.avatar_url, userName(u)].join('|');
  if (Shell.userSig !== usig) {
    box.innerHTML = `<a href="#/profile" class="ub-me" title="Профиль">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" alt="">` : `<span class="ub-ini">${esc(initials(userName(u)))}</span>`}<span class="ub-name">${esc(userName(u))}</span></a><button type="button" class="ub-out" id="logoutBtn">Выйти</button>`;
    $('#logoutBtn').onclick = async () => { try { await api('POST', '/api/logout'); } catch (_) {} localStorage.removeItem(TOKEN_KEY); App.me = null; cacheClear(); location.hash = '#/'; render(); };
    Shell.userSig = usig;
  }
  renderRail();
}

function tileHtml(s, i) {
  const on = i === Shell.index;
  return `<button type="button" class="rail-item" role="option" id="sec-${s.id}" data-i="${i}" aria-selected="${on ? 'true' : 'false'}" tabindex="${on ? '0' : '-1'}"><span class="label">${esc(s.label)}</span></button>`;
}
function renderRail() {
  const rail = railEl(), list = visibleSections();
  if (Shell.index >= list.length || Shell.index < 0) Shell.index = 0;
  const sig = Shell.mode + ':' + list.map(s => s.id).join(',');
  if (sig !== Shell.sig) {
    rail.innerHTML = list.map(tileHtml).join('');
    rail.scrollLeft = 0;
    Shell.sig = sig;
  }
  markSelected();
  if (!rail.closest('[hidden]')) reveal(rail.querySelector('[aria-selected="true"]'), 0);
}
function markSelected() {
  const rail = railEl();
  const other = ['/profile', '/theme'].includes(curPath());
  rail.querySelectorAll('.rail-item').forEach(el => {
    const on = Number(el.dataset.i) === Shell.index;
    el.setAttribute('aria-selected', on ? 'true' : 'false');
    el.tabIndex = on ? 0 : -1;
    el.classList.toggle('here', on && !other);
  });
}

// ---------- лента: выбор, прокрутка, перетаскивание ----------
function tileBox(node) {
  const rail = railEl();
  const railBox = rail.getBoundingClientRect();
  const box = node.getBoundingClientRect();
  const left = box.left - railBox.left + rail.scrollLeft;
  return { left, right: left + box.width, width: box.width };
}
function reveal(node, dir) {
  const rail = railEl();
  if (!node) return;
  const pad = 8, gap = 10;
  const tile = tileBox(node);
  const view = rail.clientWidth;
  const max = Math.max(0, rail.scrollWidth - view);
  let next = rail.scrollLeft;
  if (dir < 0) {
    next = Math.max(0, next - (tile.width + gap));
    if (tile.left < next) next = Math.max(0, tile.left - pad);
    else if (tile.left >= next + view) next = Math.min(max, Math.max(0, tile.left - pad));
  } else if (tile.left < next + pad) {
    next = Math.max(0, tile.left - pad);
  } else if (tile.right > next + view - pad) {
    next = Math.min(max, tile.right - view + pad);
  } else {
    return;
  }
  next = Math.max(0, Math.min(max, next));
  if (Math.abs(next - rail.scrollLeft) < 1) return;
  rail.scrollLeft = next;
}
// Плитка сразу открывает рабочую страницу раздела (без промежуточной панели).
function openSection(s) {
  if (!s) return;
  const h = primaryHref(s);
  if (location.hash === h) render(); else location.hash = h;
}
function select(i, opts = {}) {
  const n = visibleSections().length;
  if (!n) return;
  const prev = Shell.index;
  Shell.index = ((i % n) + n) % n;
  saveShell();
  markSelected();
  clearTimeout(Shell.navT);
  // стрелками можно пролистать несколько плиток подряд — страница открывается, когда выбор остановился
  if (opts.defer) { pfSection(currentSection()); Shell.navT = setTimeout(() => openSection(currentSection()), 180); }
  else openSection(currentSection());
  const node = railEl().querySelector('[aria-selected="true"]');
  if (opts.focus && node) node.focus({ preventScroll: true });
  let dir = opts.dir;
  if (dir === undefined) {
    if (Shell.index === prev) dir = 0;
    else dir = ((Shell.index - prev + n) % n) <= ((prev - Shell.index + n) % n) ? 1 : -1;
  }
  reveal(node, dir);
}
function setMode(next) {
  if (next !== 'staff' && next !== 'admin') return;
  if (next === 'admin' && !adminAllowed()) return;
  Shell.mode = next;
  Shell.index = 0;
  saveShell();
  $$('#modes .mode').forEach(b => b.setAttribute('aria-checked', b.dataset.mode === Shell.mode ? 'true' : 'false'));
  renderRail();
  railEl().scrollTo({ left: 0, behavior: 'auto' });
  openSection(currentSection());
  window.scrollTo(0, 0);
  const node = railEl().querySelector('[aria-selected="true"]');
  if (node) node.focus({ preventScroll: true });
}
function swallowNextClick() {
  const eat = (e) => {
    document.removeEventListener('click', eat, true);
    if (!(e.target && e.target.closest && e.target.closest('#rail'))) return;
    e.preventDefault();
    e.stopPropagation();
  };
  document.addEventListener('click', eat, true);
  setTimeout(() => document.removeEventListener('click', eat, true), 350);
}
function fromIndex(t) {
  const item = t && t.closest && t.closest('.rail-item');
  if (item && item.dataset.i !== undefined) return Number(item.dataset.i);
  return Shell.index;
}
function clearDrag() { Shell.drag = null; railEl().classList.remove('is-grabbing'); }
function moveDrag(e) {
  const drag = Shell.drag, rail = railEl();
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.originX;
  const dy = e.clientY - drag.originY;
  if (!drag.moved) {
    if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
    if (Math.abs(dy) > Math.abs(dx)) { clearDrag(); return; }
    drag.moved = true;
    rail.classList.add('is-grabbing');
    try { rail.setPointerCapture(e.pointerId); drag.captured = true; } catch (err) { /* указатель уже ушёл */ }
  }
  rail.scrollLeft = drag.originScroll - dx;
  if (e.cancelable) e.preventDefault();
}
function endDrag(e) {
  const drag = Shell.drag, rail = railEl();
  if (!drag || e.pointerId !== drag.id) return;
  const dx = e.clientX - drag.originX;
  const dy = e.clientY - drag.originY;
  const horizontal = drag.moved || (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.25);
  if (horizontal) { rail.scrollLeft = drag.originScroll - dx; swallowNextClick(); }
  const id = drag.id, captured = drag.captured;
  clearDrag();
  if (captured) { try { rail.releasePointerCapture(id); } catch (err) { /* захват уже снят */ } }
}
function bindShell() {
  const rail = railEl();
  rail.addEventListener('click', (e) => {
    const el = e.target.closest && e.target.closest('.rail-item');
    if (el) select(Number(el.dataset.i), { focus: false, dir: 0 });
  });
  rail.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!(e.target && e.target.closest && e.target.closest('#rail'))) return;
    Shell.drag = { id: e.pointerId, originX: e.clientX, originY: e.clientY, originScroll: rail.scrollLeft, moved: false, captured: false };
  });
  window.addEventListener('pointermove', moveDrag);
  window.addEventListener('pointerup', endDrag);
  window.addEventListener('pointercancel', (e) => { if (Shell.drag && e.pointerId === Shell.drag.id) clearDrag(); });
  rail.addEventListener('lostpointercapture', (e) => { if (Shell.drag && e.pointerId === Shell.drag.id) clearDrag(); });
  $$('#modes .mode').forEach(b => { b.addEventListener('click', () => setMode(b.dataset.mode)); b.addEventListener('pointerenter', () => { if (App.me) pfSection(sections(b.dataset.mode)[0]); }); });
  // наведение на плитку — данные раздела начинают грузиться ещё до клика
  rail.addEventListener('pointerover', (e) => { const el = e.target.closest && e.target.closest('.rail-item'); if (el) pfSection(visibleSections()[Number(el.dataset.i)]); });
  rail.addEventListener('focusin', (e) => { const el = e.target.closest && e.target.closest('.rail-item'); if (el) pfSection(visibleSections()[Number(el.dataset.i)]); });
  $('#homeMark').addEventListener('click', () => {
    if (!App.me) { if (!onHome()) location.hash = '#/'; return; }
    select(0, { focus: true });
    railEl().scrollTo({ left: 0, behavior: 'auto' });
    window.scrollTo(0, 0);
  });
  $('#chevL').addEventListener('click', () => select(Shell.index - 1, { focus: true, dir: -1 }));
  $('#chevR').addEventListener('click', () => select(Shell.index + 1, { focus: true, dir: 1 }));
  document.addEventListener('keydown', (e) => {
    if (!App.me || $('#secnav').hidden) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
    if (t && t.closest && t.closest('.modes')) return;
    const onRail = t && t.closest && t.closest('.rail, .chev, #homeMark');
    const onPage = (t === document.body || t === document.documentElement);
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (!(onRail || onPage)) return;
      e.preventDefault();
      const step = e.key === 'ArrowRight' ? 1 : -1;
      select(fromIndex(t) + step, { focus: true, dir: step, defer: true });
    } else if (e.key === 'ArrowDown' && t && t.closest && t.closest('.rail')) {
      const first = document.querySelector('#app a[href], #app button, #app input, #app select, #app textarea');
      const s = currentSection();
      if (first && s && t.id === 'sec-' + s.id) { e.preventDefault(); first.focus(); }
    } else if (e.key === 'ArrowUp' && t && t.closest && t.closest('#app .subnav')) {
      e.preventDefault();
      const node = railEl().querySelector('[aria-selected="true"]');
      if (node) node.focus();
    }
  });
}

// ---------- главная ----------
// Главная — это рабочая страница выбранного раздела (тот же вид, что по плитке), плюс напоминания о профиле и ролях.
async function homePage() {
  const s = currentSection();
  if (!s) { setView(`<section class="stage" id="stage"><p class="kicker">Сотрудник</p><h1>ГУ ВП</h1>${noticesHtml()}</section>`); return; }
  const path = primaryHref(s).slice(1);
  const r = App.routes.find(x => x.p !== '/' && x.re.test(path));
  if (!r) return;
  if ((r.opts.role && !hasRole(r.opts.role)) || (r.opts.cap && !can(r.opts.cap))) { setView(noAccess(r.opts.cap || 'admin')); return; }
  await r.fn(...r.re.exec(path).slice(1));
}
function noticesHtml() {
  const u = App.me, out = [];
  const anyRole = can('vp') || can('reatt') || can('examiner') || can('lead') || can('ss');
  if (!anyRole) out.push(`<div class="alert info"><b>У вас пока нет ролей.</b> Учёба, отчёты и премии открываются с ролью «ВП», переаттестация — с ролью «Переаттестация». Роли назначает администратор — обратитесь к руководству ГУ ВП.</div>`);
  const miss = profileMissing(u);
  if (miss.length) out.push(`<div class="alert warn">Заполните профиль: ${esc(miss.join(', '))}. Эти данные подставляются в отчёты и документы. <a href="#/profile">Открыть профиль</a></div>`);
  return out.join('');
}
// Строка действий раздела (если их несколько) — над страницей, без отдельного экрана.
function secActsHtml(s, path) {
  const acts = (s.acts || []).filter(a => a.href);
  if (acts.length < 2) return '';
  const here = acts.find(a => a.href.slice(1) === path) || acts[0];
  return `<nav class="subnav secacts" aria-label="${esc(s.label)}">${acts.map(a => `<a href="${esc(a.href)}" class="${a === here ? 'on' : ''}"${a === here ? ' aria-current="page"' : ''}>${esc(a.label)}</a>`).join('')}</nav>`;
}
// После каждой страницы: строка действий раздела, напоминания на главной, запоминание запросов и подгрузка соседних плиток.
window.afterRoute = function (fullPath, used) {
  document.body.dataset.shown = fullPath;
  if (!App.me) return;
  const path = fullPath.split('?')[0];
  const home = path === '/';
  const s = currentSection();
  const shown = home && s ? primaryHref(s).slice(1) : path;
  const app = $('#app');
  if (s && app && !app.querySelector('.secacts') && (s.acts || []).some(a => a.href && a.href.slice(1) === shown)) {
    const h = secActsHtml(s, shown); if (h) app.insertAdjacentHTML('afterbegin', h);
  }
  if (home && app) { const n = noticesHtml(); if (n) app.insertAdjacentHTML('afterbegin', n); }
  const list = [...(used || [])].filter(p => cacheable(p));
  if (list.length && JSON.stringify(PF[shown]) !== JSON.stringify(list)) {
    PF[shown] = list.slice(0, 8);
    const keys = Object.keys(PF); if (keys.length > 60) delete PF[keys[0]];
    try { localStorage.setItem('vp_pf', JSON.stringify(PF)); } catch (_) {}
  }
  if (window.warmReport && !isCalm()) warmReport();
  const v = visibleSections(), n = v.length;
  if (n > 1 && !isCalm()) setTimeout(() => { pfSection(v[(Shell.index + 1) % n]); pfSection(v[(Shell.index - 1 + n) % n]); }, 500);
};

// ---------- бланки ----------
const FORMS = [['index.html', 'Рапорт на взыскание'], ['povyshenie.html', 'Рапорт на повышение'], ['otchet.html', 'Еженедельный отчёт (отдельная страница)'], ['vygovor.html', 'Приказ'], ['ugolovnoe.html', 'Уголовные дела'], ['gajd.html', 'Гайд УД']];
route('/forms', async () => {
  setView(`<h1>Бланки</h1><p class="mut small">Бланки открываются на сайте бланков ГУ ВП в новой вкладке. Еженедельный отчёт заполняется прямо здесь — в разделе «Отчёты».</p>
    <div class="forms-grid">${FORMS.map(f => `<a class="card flat form-tile" href="${esc(FORMS_SITE + f[0])}" target="_blank" rel="noopener noreferrer"><b>${esc(f[1])}</b><span class="ext" aria-hidden="true">↗</span></a>`).join('')}</div>`);
}, { cap: 'vp' });

document.addEventListener('DOMContentLoaded', bindShell);
