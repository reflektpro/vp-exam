'use strict';

const FORMS_SITE = 'https://reflektpro.github.io/vp-raport-offline/';
const REPORT_FORM = 'https://reflektpro.github.io/vp-raport-offline/otchet.html';

const STAFF = [
  { id: 'forms', label: 'Бланки', href: FORMS_SITE },
  { id: 'study', label: 'Учёба' },
  { id: 'exams', label: 'Экзамены' },
  { id: 'reatt', label: 'Переаттестация' },
  { id: 'reports', label: 'Отчёты', actions: [{ label: 'Заполнить отчёт', href: REPORT_FORM }] },
  { id: 'premiums', label: 'Премии' },
  { id: 'promo', label: 'Повышение' },
  { id: 'docs', label: 'База' }
];

const ADMIN = [
  { id: 'users', label: 'Люди и роли' },
  { id: 'attempts', label: 'Проверка' },
  { id: 'courses', label: 'Курсы' },
  { id: 'lectures', label: 'Лекции' },
  { id: 'examEdit', label: 'Конструктор' },
  { id: 'bank', label: 'Банк вопросов' },
  { id: 'access', label: 'Доступ к тестам' },
  { id: 'laws', label: 'Законодательство' },
  { id: 'people', label: 'Личные дела' },
  { id: 'lead', label: 'Неделя' },
  { id: 'viol', label: 'Нарушения' },
  { id: 'budget', label: 'Бюджет' },
  { id: 'roster', label: 'Состав' },
  { id: 'audit', label: 'Журнал' },
  { id: 'settings', label: 'Параметры' },
  { id: 'media', label: 'Изображения' },
  { id: 'bases', label: 'Сводка баз' },
  { id: 'pay', label: 'Таблицы выплат' }
];

const BACKGROUNDS = [
  { id: 'mp-nv-check', file: 'bg/mp-nv-check.webp' },
  { id: 'mp-nv-vehicle', file: 'bg/mp-nv-vehicle.webp' },
  { id: 'mp-mrzr', file: 'bg/mp-mrzr.webp' },
  { id: 'mp-sinai', file: 'bg/mp-sinai.webp' }
];

const rail = document.getElementById('rail');
const stage = document.getElementById('stage');
let mode = 'staff';
let index = 0;
let backgroundId = null;
let pointer = null;

function vpPickBackground(random) {
  const n = BACKGROUNDS.length;
  const raw = typeof random === 'function' ? random() : random;
  const r = Number(raw);
  let i = Math.floor((Number.isFinite(r) ? r : 0) * n);
  if (i < 0) i = 0;
  if (i >= n) i = n - 1;
  return BACKGROUNDS[i];
}

function installBackground(randomFn) {
  if (backgroundId) return backgroundId;
  const pick = vpPickBackground(randomFn || Math.random);
  backgroundId = pick.id;
  document.documentElement.dataset.bg = pick.id;
  document.querySelector('.scene-photo').style.backgroundImage = 'url("' + pick.file + '")';
  return backgroundId;
}

function visible() { return mode === 'admin' ? ADMIN : STAFF; }
function current() { return visible()[index] || visible()[0]; }

function tileHtml(s, i) {
  const on = i === index;
  const attrs = `class="rail-item" role="option" id="sec-${s.id}" data-i="${i}" aria-selected="${on ? 'true' : 'false'}" tabindex="${on ? '0' : '-1'}"`;
  if (s.href) {
    return `<a ${attrs} href="${s.href}" target="_blank" rel="noopener noreferrer"><span class="label">${s.label}</span><span class="ext" aria-hidden="true">↗</span></a>`;
  }
  return `<button type="button" ${attrs}><span class="label">${s.label}</span></button>`;
}

function renderedIds() {
  return [...rail.querySelectorAll('.rail-item')].map(el => el.id.slice(4)).join(',');
}

function updateSelection() {
  rail.querySelectorAll('.rail-item').forEach(el => {
    const on = Number(el.dataset.i) === index;
    el.setAttribute('aria-selected', on ? 'true' : 'false');
    el.tabIndex = on ? 0 : -1;
  });
}

function renderStage() {
  const actions = current().actions || [];
  if (!actions.length) {
    stage.hidden = true;
    stage.innerHTML = '';
    return;
  }
  stage.hidden = false;
  stage.innerHTML = `<div class="acts">${actions.map(a =>
    `<a class="act" href="${a.href}" target="_blank" rel="noopener noreferrer">${a.label}<span class="ext" aria-hidden="true">↗</span></a>`
  ).join('')}</div>`;
}

function renderRail() {
  const items = visible();
  if (index >= items.length) index = 0;
  if (index < 0) index = 0;
  rail.innerHTML = items.map(tileHtml).join('');
  rail.querySelectorAll('.rail-item').forEach(el => {
    el.addEventListener('click', () => select(Number(el.dataset.i), { focus: false, reveal: false }));
  });
  renderStage();
}

function reveal(node) {
  if (!node) return;
  const r = node.getBoundingClientRect();
  if (r.top >= 8 && r.bottom <= window.innerHeight - 8) return;
  node.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'auto' });
}

function select(i, opts = {}) {
  const n = visible().length;
  index = ((i % n) + n) % n;
  const want = visible().map(s => s.id).join(',');
  if (want !== renderedIds()) renderRail();
  else {
    updateSelection();
    renderStage();
  }
  const node = rail.querySelector('[aria-selected="true"]');
  if (opts.focus && node) node.focus({ preventScroll: true });
  if (opts.reveal !== false) reveal(node);
}

function columnCount() {
  const items = [...rail.querySelectorAll('.rail-item')];
  if (items.length < 2) return 1;
  const top = items[0].offsetTop;
  let count = 0;
  for (const el of items) {
    if (el.offsetTop - top > 6) break;
    count += 1;
  }
  return Math.max(1, count);
}

function setMode(next) {
  if (next !== 'staff' && next !== 'admin') return;
  mode = next;
  index = 0;
  document.querySelectorAll('.mode').forEach(b => {
    b.setAttribute('aria-checked', b.dataset.mode === mode ? 'true' : 'false');
  });
  renderRail();
  window.scrollTo(0, 0);
  rail.scrollTop = 0;
  rail.scrollLeft = 0;
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

document.querySelectorAll('.mode').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
document.getElementById('homeMark').addEventListener('click', () => {
  select(0, { focus: true });
  window.scrollTo(0, 0);
});
document.getElementById('chevL').addEventListener('click', () => select(index - 1, { focus: true }));
document.getElementById('chevR').addEventListener('click', () => select(index + 1, { focus: true }));

function fromIndex(t) {
  const item = t && t.closest && t.closest('.rail-item');
  if (item && item.dataset.i !== undefined) return Number(item.dataset.i);
  return index;
}

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
  } else if (e.key === 'ArrowDown') {
    if (t && t.closest && t.closest('.rail')) {
      const act = stage.querySelector('.act');
      if (act && t.id === 'sec-' + current().id) {
        e.preventDefault();
        act.focus();
        return;
      }
      e.preventDefault();
      select(fromIndex(t) + columnCount(), { focus: true });
    }
  } else if (e.key === 'ArrowUp') {
    if (t && t.closest && t.closest('.acts')) {
      e.preventDefault();
      const node = rail.querySelector('[aria-selected="true"]');
      if (node) node.focus();
      return;
    }
    if (t && t.closest && t.closest('.rail')) {
      e.preventDefault();
      select(fromIndex(t) - columnCount(), { focus: true });
    }
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

window.vpPickBackground = vpPickBackground;
window.vpBackgrounds = BACKGROUNDS;
installBackground(Math.random);
renderRail();
