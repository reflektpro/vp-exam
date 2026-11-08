/* Демо консольной главной. Нет сети, нет входа, нет боевых данных. */
'use strict';
const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)');

const SECTIONS = [
  { id: 'study', group: 'Служба', who: 'staff', label: 'Учёба', hint: 'курсы', title: 'Учёба',
    lead: 'Курсы по званиям и должностям: тема, лекции, в конце экзамен курса.',
    route: '#/study', real: 'экран «Учебный отдел»',
    actions: [{ id: 'open', label: 'Открыть учебный отдел', primary: true }],
    preview: { title: 'Пример курсов', rows: [
      ['Внутренний устав', 'ДЕМО · тем 1 из 4, экзамен после лекций'],
      ['Стажёр ВП', 'ДЕМО · система должностей, черновик']
    ] } },
  { id: 'exams', group: 'Служба', who: 'staff', label: 'Экзамены', hint: 'сдать', title: 'Экзамены',
    lead: 'Список экзаменов сотрудника. Конкретный экзамен выбирается уже здесь, не через конструктор.',
    route: '#/exams', real: 'экран «Экзамены», дальше карточка #/exam/…',
    actions: [{ id: 'open', label: 'К списку экзаменов', primary: true }],
    preview: { title: 'Пример списка', rows: [
      ['Зачёт по уставу', 'ДЕМО · закрыт, пока не просмотрены лекции'],
      ['Процессуальный кодекс', 'ДЕМО · можно открыть']
    ] } },
  { id: 'reatt', group: 'Служба', who: 'staff', label: 'Переаттестация', hint: 'допуск', title: 'Переаттестация',
    lead: 'Только виды, к которым администратор выдал доступ, срок и число попыток.',
    route: '#/reatt', real: 'экран «Переаттестация»',
    actions: [{ id: 'open', label: 'Мои переаттестации', primary: true }],
    preview: { title: 'Пример допуска', rows: [
      ['Упрощённая', 'ДЕМО · доступ до конца дня, попыток 2']
    ] } },
  { id: 'reports', group: 'Служба', who: 'staff', label: 'Отчёты', hint: 'неделя', title: 'Отчёты',
    lead: 'Статус текущей недели. Бланк заполняется на сайте бланков, список своих отчётов — на этом же экране.',
    route: '#/reports', real: 'экран «Отчёты»',
    actions: [
      { id: 'fill', label: 'Заполнить отчёт', primary: true, real: 'кнопка «Заполнить отчёт» (или «Изменить отчёт», если неделя уже отправлена) ведёт на сайт бланков, тот же вход. В демо переход туда выключен.' },
      { id: 'mine', label: 'Мои отчёты', real: 'блок «Мои отчёты» на экране #/reports: неделя, кому, статус, версия. Отдельного адреса нет.' }
    ],
    preview: { title: 'Мои отчёты · ДЕМО', rows: [
      ['Текущая неделя', 'ДЕМО · не отправлен'],
      ['Прошлая неделя', 'ДЕМО · принят, адресат — начальник ГУ ВП']
    ] } },
  { id: 'premiums', group: 'Служба', who: 'staff', label: 'Премии', hint: 'неделя', title: 'Премии',
    lead: 'Кто сколько получил за выбранную неделю. До срока неделя закрыта.',
    route: '#/premiums', real: 'экран «Премирование»',
    actions: [{ id: 'open', label: 'Открыть премии', primary: true }],
    preview: { title: 'Пример', rows: [['Ваша строка', 'ДЕМО · сумма появится после срока']] } },
  { id: 'promo', group: 'Служба', who: 'staff', label: 'Повышение', hint: 'ступени', title: 'Повышение',
    lead: 'Ступени званий, баллы и обязательные пункты. Правка правил — отдельная кнопка только у администратора на этом же экране.',
    route: '#/promo', real: 'экран «Система повышения»',
    actions: [{ id: 'open', label: 'Открыть ступени', primary: true }],
    preview: { title: 'Пример', rows: [['Лейтенант → старший лейтенант', 'ДЕМО · баллы и пункты из правил']] } },
  { id: 'docs', group: 'Служба', who: 'staff', label: 'База', hint: 'статьи', title: 'База',
    lead: 'Инструкции и документы. Доступна всем, кто вошёл, даже без других ролей.',
    route: '#/docs', real: 'экран «База данных»',
    actions: [{ id: 'open', label: 'Открыть базу', primary: true }],
    preview: { title: 'Пример', rows: [['Памятка', 'ДЕМО · выдуманная статья']] } },
  { id: 'people', group: 'Руководство', who: 'admin', label: 'Личные дела', hint: 'досье', title: 'Личные дела',
    lead: 'Досье сотрудников. Видит старший состав, руководство и администратор.',
    route: '#/people', real: 'экран «Личные дела»',
    actions: [{ id: 'open', label: 'К списку дел', primary: true }],
    preview: { title: 'Пример', rows: [['Демонстрационный курсант', 'ДЕМО · статик 0000, не настоящий человек']] } },
  { id: 'lead', group: 'Руководство', who: 'admin', label: 'Неделя', hint: 'премии', title: 'Неделя',
    lead: 'Сводная таблица отчётов и премий. Отсюда открывается конкретный отчёт.',
    route: '#/lead', real: 'экран недели руководства',
    actions: [{ id: 'open', label: 'Открыть неделю', primary: true }],
    preview: { title: 'Рядом на этом же участке', rows: [
      ['Нарушения', '#/lead/violations'],
      ['Бюджет', '#/lead/budget'],
      ['Состав', '#/lead/staff']
    ] } },
  { id: 'viol', group: 'Руководство', who: 'admin', label: 'Нарушения', hint: 'срок', title: 'Нарушения',
    lead: 'Несданные и сданные после срока отчёты. Снятие — уважительная причина, без отправки в Discord.',
    route: '#/lead/violations', real: 'экран «Нарушения»',
    actions: [{ id: 'open', label: 'Открыть нарушения', primary: true }],
    preview: { title: 'Пример', rows: [['Курс 0000', 'ДЕМО · одно предупреждение']] } },
  { id: 'budget', group: 'Руководство', who: 'admin', label: 'Бюджет', hint: 'фонд', title: 'Бюджет',
    lead: 'Баланс ГУ ВП: взносы, остатки фонда, поступления и снятия.',
    route: '#/lead/budget', real: 'экран «Бюджет ГУ ВП»',
    actions: [{ id: 'open', label: 'Открыть бюджет', primary: true }],
    preview: { title: 'Пример', rows: [['Баланс', 'ДЕМО · 0 ₽, не боевая цифра']] } },
  { id: 'staff', group: 'Руководство', who: 'admin', label: 'Состав', hint: 'учёт', title: 'Состав',
    lead: 'Кто в составе ГУ ВП и с какой недели ведётся учёт нарушений.',
    route: '#/lead/staff', real: 'экран «Состав»',
    actions: [{ id: 'open', label: 'Открыть состав', primary: true }],
    preview: { title: 'Пример', rows: [['Курс 0000', 'ДЕМО · не отмечен в составе']] } },
  { id: 'attempts', group: 'Администратору', who: 'admin', label: 'Проверка', hint: 'работы', title: 'Проверка',
    lead: 'Попытки экзаменов и переаттестаций, которые ждут проверяющего.',
    route: '#/admin/attempts', real: 'экран проверки попыток',
    actions: [{ id: 'open', label: 'К работам', primary: true }],
    preview: { title: 'Пример', rows: [['Попытка экзамена', 'ДЕМО · на проверке, без ответов']] } },
  { id: 'users', group: 'Администратору', who: 'admin', label: 'Люди и роли', hint: 'доступ', title: 'Люди и роли',
    lead: 'Роли ВП, переаттестация, руководство, проверяющий, администратор, профиль.',
    route: '#/admin/users', real: 'экран «Пользователи и роли»',
    actions: [{ id: 'open', label: 'К списку людей', primary: true }],
    preview: { title: 'Пример', rows: [['Демо-пользователь', 'ДЕМО · роль не меняется, это не база']] } },
  { id: 'courses', group: 'Администратору', who: 'admin', label: 'Курсы', hint: 'правка', title: 'Курсы',
    lead: 'Сборка курсов: какие темы, лекции и экзамен входят. Это не экран, где сотрудник учится.',
    route: '#/admin/courses', real: 'редактор курсов',
    actions: [{ id: 'open', label: 'Открыть курсы', primary: true }],
    preview: { title: 'Пример', rows: [['Курс-черновик', 'ДЕМО · не опубликован']] } },
  { id: 'lectures', group: 'Администратору', who: 'admin', label: 'Лекции', hint: 'правка', title: 'Лекции',
    lead: 'Видео или текст, длительность, публикация.',
    route: '#/admin/lectures', real: 'редактор лекций',
    actions: [{ id: 'open', label: 'Открыть лекции', primary: true }],
    preview: { title: 'Пример', rows: [['Лекция без видео', 'ДЕМО']] } },
  { id: 'examEdit', group: 'Администратору', who: 'admin', label: 'Конструктор', hint: 'экзамены', title: 'Конструктор экзаменов',
    lead: 'Создание экзамена и вопросов. Сдача сотрудником — отдельный раздел «Экзамены».',
    route: '#/admin/exams', real: 'редактор экзаменов',
    actions: [{ id: 'open', label: 'Открыть конструктор', primary: true }],
    preview: { title: 'Пример', rows: [['Черновик зачёта', 'ДЕМО · не виден кандидатам']] } },
  { id: 'bank', group: 'Администратору', who: 'admin', label: 'Банк вопросов', hint: 'база', title: 'Банк вопросов',
    lead: 'Вопросы переаттестации: фильтр, правка, добавление.',
    route: '#/admin/bank', real: 'банк вопросов',
    actions: [{ id: 'open', label: 'Открыть банк', primary: true }],
    preview: { title: 'Пример', rows: [['Вопрос по уставу', 'ДЕМО · без правильного ответа']] } },
  { id: 'access', group: 'Администратору', who: 'admin', label: 'Доступ к тестам', hint: 'ключ', title: 'Доступ к тестам',
    lead: 'Кому, до какого момента и сколько попыток на переаттестацию.',
    route: '#/admin/reatt', real: 'список видов переаттестации и кнопка «Доступ»',
    actions: [{ id: 'open', label: 'Открыть доступы', primary: true }],
    preview: { title: 'Пример', rows: [['Упрощённая', 'ДЕМО · выдач нет']] } },
  { id: 'laws', group: 'Администратору', who: 'admin', label: 'Законодательство', hint: 'сверка', title: 'Законодательство',
    lead: 'Опубликованные сверки документов. Решение человека не переписывает ответы вопросов.',
    route: '#/admin/laws', real: 'экран мониторинга законов',
    actions: [{ id: 'open', label: 'Открыть сверки', primary: true }],
    preview: { title: 'Пример', rows: [
      ['ПК', 'ДЕМО · есть расхождение, не живой форум'],
      ['ДУ', 'ДЕМО · только вручную, Яндекс.Диск']
    ] } }
];

const QUIET = [
  { label: 'изображения', route: '#/admin/media', real: 'загрузка картинок к вопросам' },
  { label: 'параметры', route: '#/admin/settings', real: 'название сайта и порядок лекций' },
  { label: 'журнал', route: '#/admin/audit', real: 'журнал действий' },
  { label: 'сводка баз', route: '#/admin/bases', real: 'сводка баз переаттестации и проверка качества' },
  { label: 'таблицы выплат', route: '#/lead/config', real: 'правила премий, правка у главного администратора' },
  { label: 'фон', route: '#/theme', real: 'выбор фотографии фона' }
];

const rail = document.getElementById('rail');
const stage = document.getElementById('stage');
const sheet = document.getElementById('sheet');
const quiet = document.getElementById('quiet');
let mode = 'staff';
let index = 0;
let pointer = null;
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

function visible() { return SECTIONS.filter(s => mode === 'admin' || s.who === 'staff'); }
function current() { return visible()[index] || visible()[0]; }

function renderRail() {
  const items = visible();
  if (index >= items.length) index = 0;
  let html = '';
  let group = '';
  items.forEach((s, i) => {
    if (s.group !== group) {
      group = s.group;
      html += `<div class="rail-label">${group}</div>`;
    }
    html += `<button type="button" class="rail-item" role="option" id="sec-${s.id}" data-i="${i}" aria-selected="${i === index ? 'true' : 'false'}"><b>${s.label}</b><small>${s.hint}</small></button>`;
  });
  rail.innerHTML = html;
  rail.querySelectorAll('.rail-item').forEach(btn => {
    btn.addEventListener('click', () => select(Number(btn.dataset.i), { focus: false }));
  });
  const node = rail.querySelector('[aria-selected="true"]');
  if (node) {
    const behavior = REDUCE.matches ? 'auto' : 'smooth';
    node.scrollIntoView({ inline: 'center', block: 'nearest', behavior });
  }
  updateChevrons();
}

function renderStage() {
  const s = current();
  stage.innerHTML = `<p class="kicker">${s.group}</p><h1>${s.title}</h1><p class="lead">${s.lead}</p>
    <div class="acts">${s.actions.map(a => `<button type="button" class="act${a.primary ? '' : ' ghost'}" data-act="${a.id}">${a.label}</button>`).join('')}</div>
    <div class="preview"><h2>${s.preview.title}</h2>${s.preview.rows.map(r => `<div class="card"><b>${r[0]}</b><div class="meta">${r[1]}</div></div>`).join('')}</div>`;
  stage.querySelectorAll('.act').forEach(btn => btn.addEventListener('click', () => openAction(s, btn.dataset.act)));
  sheet.hidden = true;
  sheet.innerHTML = '';
}

function renderQuiet() {
  if (mode !== 'admin') { quiet.hidden = true; quiet.innerHTML = ''; return; }
  quiet.hidden = false;
  quiet.innerHTML = `<span>Реже, тоже сразу:</span>` + QUIET.map(q => `<a href="#demo-${q.route.slice(2)}" data-quiet="${q.route}">${q.label}</a>`).join('');
  quiet.querySelectorAll('a').forEach(a => a.addEventListener('click', (e) => {
    e.preventDefault();
    const q = QUIET.find(x => x.route === a.dataset.quiet);
    showSheet(q.label, q.route, q.real);
  }));
}

function select(i, opts = {}) {
  const items = visible();
  index = (i + items.length) % items.length;
  renderRail();
  renderStage();
  if (opts.focus) {
    const node = rail.querySelector('[aria-selected="true"]');
    if (node) node.focus();
  }
}

function openAction(section, actId) {
  const action = section.actions.find(a => a.id === actId) || section.actions[0];
  const real = action.real || section.real;
  showSheet(action.label, section.route, real);
  if (actId === 'mine') {
    const block = stage.querySelector('.preview');
    if (block) block.scrollIntoView({ block: 'nearest', behavior: REDUCE.matches ? 'auto' : 'smooth' });
  }
}

function showSheet(label, route, real) {
  sheet.hidden = false;
  sheet.innerHTML = `<h2>ДЕМО · ${label}</h2><p>Боевой сайт, база и Discord отсюда не вызываются. Показана фикстура.</p><p>В портале: ${real}.</p><p class="route">${route}</p>`;
}

function updateChevrons() {
  const overflow = rail.scrollWidth > rail.clientWidth + 8;
  document.getElementById('chevL').hidden = !overflow;
  document.getElementById('chevR').hidden = !overflow;
}

function setMode(next) {
  mode = next;
  index = 0;
  document.querySelectorAll('.mode').forEach(b => b.setAttribute('aria-checked', b.dataset.mode === mode ? 'true' : 'false'));
  const hint = document.getElementById('hint');
  hint.textContent = mode === 'staff'
    ? 'Демо сотрудника: роли ВП и «Переаттестация». Клик, ← → и сдвиг ленты выбирают раздел сразу.'
    : 'Демо администратора: те же разделы плюс руководство и инструменты правки. Редкие экраны — строка под лентой, тоже в один клик.';
  renderRail();
  renderStage();
  renderQuiet();
}

document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.getElementById('homeMark').addEventListener('click', () => { select(0, { focus: true }); window.scrollTo(0, 0); });
document.getElementById('chevL').addEventListener('click', () => select(index - 1, { focus: true }));
document.getElementById('chevR').addEventListener('click', () => select(index + 1, { focus: true }));

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (t && t.closest && t.closest('.modes')) return;
  const onRail = t && t.closest && t.closest('.rail, .chev, #homeMark');
  const onPage = t === document.body || t === document.documentElement;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    if (onRail || onPage) {
      e.preventDefault();
      select(index + (e.key === 'ArrowRight' ? 1 : -1), { focus: true });
    }
  } else if (e.key === 'ArrowDown' && t.closest && t.closest('.rail')) {
    e.preventDefault();
    const first = stage.querySelector('.act');
    if (first) first.focus();
  } else if (e.key === 'ArrowUp' && t.closest && t.closest('.acts')) {
    e.preventDefault();
    const node = rail.querySelector('[aria-selected="true"]');
    if (node) node.focus();
  } else if (e.key === 'Enter' && t.classList && t.classList.contains('rail-item')) {
    e.preventDefault();
    openAction(current(), (current().actions.find(a => a.primary) || current().actions[0]).id);
  }
});

function endPointer(e) {
  if (!pointer || e.pointerId !== pointer.id) return;
  const dx = e.clientX - pointer.x;
  const dy = e.clientY - pointer.y;
  pointer = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.25) {
    swallowNextClick();
    select(index + (dx < 0 ? 1 : -1), { focus: false });
  }
}
rail.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  pointer = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', (e) => { if (pointer && e.pointerId === pointer.id) pointer = null; });
window.addEventListener('resize', updateChevrons);

document.getElementById('colophon').textContent = 'Фон: Wilfredor, Château Frontenac at night, CC0, Wikimedia Commons. В прототипе один уменьшенный кадр, галерея не загружается.';

setMode('staff');
requestAnimationFrame(updateChevrons);
