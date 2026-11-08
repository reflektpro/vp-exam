'use strict';

const FORMS_SITE = 'https://reflektpro.github.io/vp-raport-offline/';
const REPORT_FORM = 'https://reflektpro.github.io/vp-raport-offline/otchet.html';
const REDUCE = window.matchMedia('(prefers-reduced-motion: reduce)');

const STAFF = [
  {
    id: 'study', label: 'Учёба', title: 'Учёба',
    lead: 'Курсы по званиям и должностям: темы, лекции и экзамен в конце курса.',
    points: [
      ['Курсы', 'Что назначено по должности и званию'],
      ['Экзамен курса', 'Открывается после лекций']
    ],
    actions: [{ id: 'open', label: 'Открыть учебный отдел', primary: true }]
  },
  {
    id: 'exams', label: 'Экзамены', title: 'Экзамены',
    lead: 'Список экзаменов сотрудника. Конкретный экзамен выбирается здесь.',
    points: [
      ['Список', 'Какие экзамены доступны сейчас'],
      ['Допуск', 'Закрытый экзамен ждёт просмотра лекций']
    ],
    actions: [{ id: 'open', label: 'К списку экзаменов', primary: true }]
  },
  {
    id: 'reatt', label: 'Переаттестация', title: 'Переаттестация',
    lead: 'Только виды, к которым выдан доступ: срок и число попыток.',
    points: [['Допуск', 'Вид, до какого момента и сколько попыток осталось']],
    actions: [{ id: 'open', label: 'Мои переаттестации', primary: true }]
  },
  {
    id: 'reports', label: 'Отчёты', title: 'Отчёты',
    lead: 'Свой отчёт за неделю. Бланк заполняется на сайте бланков, статус и список своих отчётов — здесь.',
    points: [
      ['Текущая неделя', 'Кому адресован отчёт и сдан ли он'],
      ['Прошлые недели', 'Кому, статус и версия']
    ],
    actions: [
      { id: 'fill', label: 'Заполнить отчёт', primary: true, href: REPORT_FORM },
      { id: 'mine', label: 'Мои отчёты' }
    ]
  },
  {
    id: 'forms', label: 'Бланки', title: 'Бланки',
    lead: 'Сайт бланков ГУ ВП: еженедельный отчёт, рапорт на повышение и остальные формы.',
    points: [
      ['Каталог', 'Все бланки на одном сайте'],
      ['Отчёт', 'Еженедельный бланк открывается отдельно из раздела «Отчёты»']
    ],
    actions: [{ id: 'open', label: 'Открыть бланки', primary: true, href: FORMS_SITE }]
  },
  {
    id: 'premiums', label: 'Премии', title: 'Премии',
    lead: 'Кто сколько получил за выбранную неделю. До срока неделя закрыта.',
    points: [['Выбранная неделя', 'Суммы видны после срока']],
    actions: [{ id: 'open', label: 'Открыть премии', primary: true }]
  },
  {
    id: 'promo', label: 'Повышение', title: 'Повышение',
    lead: 'Ступени званий, баллы и обязательные пункты.',
    points: [['Ступень', 'Сколько баллов и какие пункты нужны']],
    actions: [{ id: 'open', label: 'Открыть ступени', primary: true }]
  },
  {
    id: 'docs', label: 'База', title: 'База',
    lead: 'Инструкции и документы. Доступны всем, кто вошёл.',
    points: [['Материалы', 'Статьи и памятки']],
    actions: [{ id: 'open', label: 'Открыть базу', primary: true }]
  }
];

const ADMIN = [
  {
    id: 'users', label: 'Люди и роли', title: 'Люди и роли',
    lead: 'Роли ВП, переаттестация, руководство, проверяющий, администратор и профиль.',
    points: [['Список', 'Кому какая роль назначена']],
    actions: [{ id: 'open', label: 'К списку людей', primary: true }]
  },
  {
    id: 'attempts', label: 'Проверка', title: 'Проверка',
    lead: 'Попытки экзаменов и переаттестаций, которые ждут проверяющего.',
    points: [['Очередь', 'Работы на проверке']],
    actions: [{ id: 'open', label: 'К работам', primary: true }]
  },
  {
    id: 'courses', label: 'Курсы', title: 'Курсы',
    lead: 'Состав курса: темы, лекции и экзамен. Это правка, не экран, где сотрудник учится.',
    points: [['Сборка', 'Что входит в курс']],
    actions: [{ id: 'open', label: 'Открыть курсы', primary: true }]
  },
  {
    id: 'lectures', label: 'Лекции', title: 'Лекции',
    lead: 'Видео или текст, длительность и публикация.',
    points: [['Материал', 'Ролик или текст и выложен ли он']],
    actions: [{ id: 'open', label: 'Открыть лекции', primary: true }]
  },
  {
    id: 'examEdit', label: 'Конструктор', title: 'Конструктор экзаменов',
    lead: 'Создание экзамена и вопросов. Сдача сотрудником — в разделе «Экзамены».',
    points: [['Черновик', 'Экзамен, пока его не видят кандидаты']],
    actions: [{ id: 'open', label: 'Открыть конструктор', primary: true }]
  },
  {
    id: 'bank', label: 'Банк вопросов', title: 'Банк вопросов',
    lead: 'Вопросы переаттестации: фильтр, правка, добавление.',
    points: [['Вопросы', 'База, из которой собирается переаттестация']],
    actions: [{ id: 'open', label: 'Открыть банк', primary: true }]
  },
  {
    id: 'access', label: 'Доступ к тестам', title: 'Доступ к тестам',
    lead: 'Кому, до какого момента и сколько попыток на переаттестацию.',
    points: [['Выдачи', 'Срок и число попыток']],
    actions: [{ id: 'open', label: 'Открыть доступы', primary: true }]
  },
  {
    id: 'laws', label: 'Законодательство', title: 'Законодательство',
    lead: 'Сверки документов. Решение человека само не переписывает ответы вопросов.',
    points: [['Сверка', 'Что изменилось в документе и какие вопросы это затрагивает']],
    actions: [{ id: 'open', label: 'Открыть сверки', primary: true }]
  },
  {
    id: 'people', label: 'Личные дела', title: 'Личные дела',
    lead: 'Досье сотрудников. Видит старший состав, руководство и администратор.',
    points: [['Досье', 'Карточка сотрудника']],
    actions: [{ id: 'open', label: 'К списку дел', primary: true }]
  },
  {
    id: 'lead', label: 'Неделя', title: 'Неделя',
    lead: 'Сводная таблица отчётов и премий. Отсюда открывается конкретный отчёт.',
    points: [['Таблица', 'Кто сдал отчёт и какая премия']],
    actions: [{ id: 'open', label: 'Открыть неделю', primary: true }]
  },
  {
    id: 'viol', label: 'Нарушения', title: 'Нарушения',
    lead: 'Несданные и сданные после срока отчёты.',
    points: [['Срок', 'Кто не сдал или сдал позже']],
    actions: [{ id: 'open', label: 'Открыть нарушения', primary: true }]
  },
  {
    id: 'budget', label: 'Бюджет', title: 'Бюджет',
    lead: 'Баланс ГУ ВП: взносы, остатки фонда, поступления и снятия.',
    points: [['Баланс', 'Фонд и движение средств']],
    actions: [{ id: 'open', label: 'Открыть бюджет', primary: true }]
  },
  {
    id: 'roster', label: 'Состав', title: 'Состав',
    lead: 'Кто в составе ГУ ВП и с какой недели ведётся учёт нарушений.',
    points: [['Учёт', 'Сотрудник и неделя начала учёта']],
    actions: [{ id: 'open', label: 'Открыть состав', primary: true }]
  },
  {
    id: 'audit', label: 'Журнал', title: 'Журнал',
    lead: 'Журнал действий на портале.',
    points: [['Записи', 'Кто и что изменил']],
    actions: [{ id: 'open', label: 'Открыть журнал', primary: true }]
  },
  {
    id: 'settings', label: 'Параметры', title: 'Параметры',
    lead: 'Название сайта и порядок лекций.',
    points: [['Настройки', 'То, что видит весь портал']],
    actions: [{ id: 'open', label: 'Открыть параметры', primary: true }]
  },
  {
    id: 'media', label: 'Изображения', title: 'Изображения',
    lead: 'Картинки к вопросам.',
    points: [['Файлы', 'Что можно вставить в вопрос']],
    actions: [{ id: 'open', label: 'Открыть изображения', primary: true }]
  },
  {
    id: 'bases', label: 'Сводка баз', title: 'Сводка баз',
    lead: 'Базы переаттестации и проверка качества.',
    points: [['Базы', 'Состав и замечания']],
    actions: [{ id: 'open', label: 'Открыть сводку', primary: true }]
  },
  {
    id: 'pay', label: 'Таблицы выплат', title: 'Таблицы выплат',
    lead: 'Правила премий. Правка у главного администратора.',
    points: [['Правила', 'Как считается премия']],
    actions: [{ id: 'open', label: 'Открыть таблицы', primary: true }]
  }
];

const rail = document.getElementById('rail');
const stage = document.getElementById('stage');
let mode = 'staff';
let index = 0;
let pointer = null;

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function visible() { return mode === 'admin' ? ADMIN : STAFF; }
function current() { return visible()[index] || visible()[0]; }

function tileHtml(s, i) {
  const on = i === index;
  return `<button type="button" class="rail-item" role="option" id="sec-${s.id}" data-i="${i}" aria-selected="${on ? 'true' : 'false'}" tabindex="${on ? '0' : '-1'}"><span class="label">${esc(s.label)}</span></button>`;
}

function renderStage() {
  const s = current();
  const acts = (s.actions || []).map(a => {
    if (a.href) {
      return `<a class="act${a.primary ? '' : ' ghost'}" data-act="${esc(a.id)}" href="${esc(a.href)}" target="_blank" rel="noopener noreferrer">${esc(a.label)}<span class="ext" aria-hidden="true">↗</span></a>`;
    }
    return `<button type="button" class="act${a.primary ? '' : ' ghost'}" data-act="${esc(a.id)}">${esc(a.label)}</button>`;
  }).join('');
  const points = (s.points || []).map(p => `<div class="card"><b>${esc(p[0])}</b><div class="meta">${esc(p[1])}</div></div>`).join('');
  stage.hidden = false;
  stage.innerHTML = `<p class="kicker">${mode === 'admin' ? 'Администратор' : 'Сотрудник'}</p><h1>${esc(s.title)}</h1><p class="lead">${esc(s.lead)}</p><div class="acts">${acts}</div>${points ? `<div class="preview" id="detail-points"><h2>На экране</h2>${points}</div>` : ''}`;
  stage.querySelectorAll('.act').forEach(el => {
    el.addEventListener('click', (e) => {
      if (el.tagName === 'A') return;
      e.preventDefault();
      stage.querySelectorAll('.act').forEach(b => {
        if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', b === el ? 'true' : 'false');
      });
      const block = document.getElementById('detail-points');
      if (block) block.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    });
  });
}

function renderRail() {
  const items = visible();
  if (index >= items.length) index = 0;
  if (index < 0) index = 0;
  rail.innerHTML = items.map(tileHtml).join('');
  rail.querySelectorAll('.rail-item').forEach(el => {
    el.addEventListener('click', () => select(Number(el.dataset.i), { focus: false }));
  });
  renderStage();
}

function reveal(node) {
  if (!node) return;
  const left = node.offsetLeft;
  const right = left + node.offsetWidth;
  const viewL = rail.scrollLeft;
  const viewR = viewL + rail.clientWidth;
  let next = null;
  if (left < viewL + 4) next = Math.max(0, left - 8);
  else if (right > viewR - 4) next = right - rail.clientWidth + 8;
  if (next === null) return;
  rail.scrollTo({ left: next, behavior: REDUCE.matches ? 'auto' : 'smooth' });
}

function select(i, opts = {}) {
  const n = visible().length;
  index = ((i % n) + n) % n;
  rail.querySelectorAll('.rail-item').forEach(el => {
    const on = Number(el.dataset.i) === index;
    el.setAttribute('aria-selected', on ? 'true' : 'false');
    el.tabIndex = on ? 0 : -1;
  });
  renderStage();
  const node = rail.querySelector('[aria-selected="true"]');
  if (opts.focus && node) node.focus({ preventScroll: true });
  if (opts.reveal !== false) reveal(node);
}

function setMode(next) {
  if (next !== 'staff' && next !== 'admin') return;
  mode = next;
  index = 0;
  document.querySelectorAll('.mode').forEach(b => {
    b.setAttribute('aria-checked', b.dataset.mode === mode ? 'true' : 'false');
  });
  renderRail();
  rail.scrollTo({ left: 0, behavior: 'auto' });
  window.scrollTo(0, 0);
  const node = rail.querySelector('[aria-selected="true"]');
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
  return index;
}

document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.getElementById('homeMark').addEventListener('click', () => {
  select(0, { focus: true });
  rail.scrollTo({ left: 0, behavior: 'auto' });
  window.scrollTo(0, 0);
});
document.getElementById('chevL').addEventListener('click', () => select(index - 1, { focus: true }));
document.getElementById('chevR').addEventListener('click', () => select(index + 1, { focus: true }));

document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t && t.closest && t.closest('input, textarea, select, [contenteditable="true"]')) return;
  if (t && t.closest && t.closest('.modes')) return;
  const onRail = t && t.closest && t.closest('.rail, .chev, #homeMark');
  const onPage = t === document.body || t === document.documentElement;
  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    if (!(onRail || onPage)) return;
    e.preventDefault();
    select(fromIndex(t) + (e.key === 'ArrowRight' ? 1 : -1), { focus: true });
  } else if (e.key === 'ArrowDown' && t && t.closest && t.closest('.rail')) {
    const act = stage.querySelector('.act');
    if (act && t.id === 'sec-' + current().id) {
      e.preventDefault();
      act.focus();
    }
  } else if (e.key === 'ArrowUp' && t && t.closest && t.closest('.acts')) {
    e.preventDefault();
    const node = rail.querySelector('[aria-selected="true"]');
    if (node) node.focus();
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
document.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'mouse' && e.button !== 0) return;
  const area = rail.getBoundingClientRect();
  if (e.clientX < area.left || e.clientX > area.right || e.clientY < area.top || e.clientY > area.bottom) return;
  pointer = { x: e.clientX, y: e.clientY, id: e.pointerId };
});
window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', (e) => { if (pointer && e.pointerId === pointer.id) pointer = null; });

function installBackground() {
  if (document.documentElement.dataset.bg) return;
  document.documentElement.dataset.bg = 'neutral';
}

installBackground();
renderRail();
