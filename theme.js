/* Выбор фона. Каталог — assets/bg/catalog.json, картинки локальные. */
'use strict';
const BG_FALLBACK = 'quebec-night';
let BgCatalog = null;

function bgIdOk(id) { return /^[a-z0-9-]{1,40}$/.test(id || ''); }
function currentBg() {
  try { const id = localStorage.getItem('vp_bg') || document.documentElement.dataset.bg || BG_FALLBACK; return bgIdOk(id) ? id : BG_FALLBACK; }
  catch (_) { return BG_FALLBACK; }
}
function bgUrl(item, kind) {
  const rel = kind === 'thumb' ? item.thumb : kind === 'avif' ? item.avif : item.webp;
  return rel;
}
function paintBg(id, animate) {
  const item = (BgCatalog && BgCatalog.items || []).find(x => x.id === id) || null;
  const photo = document.getElementById('scenePhoto');
  if (!photo) return;
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const apply = () => {
    document.documentElement.dataset.bg = id;
    if (item) photo.style.backgroundImage = `image-set(url("${bgUrl(item, 'avif')}") type("image/avif"), url("${bgUrl(item, 'webp')}") type("image/webp"))`;
    else photo.style.backgroundImage = '';
  };
  if (!animate || reduce) { apply(); return; }
  photo.style.opacity = '0';
  window.setTimeout(() => { apply(); photo.style.opacity = ''; }, 220);
}
function rememberBg(id) {
  if (!bgIdOk(id)) return;
  try { localStorage.setItem('vp_bg', id); } catch (_) {}
  paintBg(id, true);
}

async function loadCatalog() {
  if (BgCatalog) return BgCatalog;
  const res = await fetch('assets/bg/catalog.json', { cache: 'force-cache' });
  if (!res.ok) throw new Error('Каталог фонов не открылся');
  const data = await res.json();
  if (!data || !Array.isArray(data.items) || !data.items.length) throw new Error('Каталог фонов пуст');
  BgCatalog = data;
  return data;
}

route('/theme', async () => {
  let data;
  try { data = await loadCatalog(); }
  catch (e) { setView(`<div class="alert err">${esc(e.message)}</div>`); return; }
  const cur = currentBg();
  if (!data.items.some(x => x.id === cur)) rememberBg(data.default || BG_FALLBACK);
  const selected = data.items.some(x => x.id === currentBg()) ? currentBg() : (data.default || BG_FALLBACK);
  setView(`<div class="theme-page">
    <p class="kicker">Оформление</p>
    <h1>Фон</h1>
    <p class="lead">Тёмный кадр на заднем плане. На экзамене и в попытке фото скрывается, чтобы не мешать чтению. Снимки — со свободных лицензий, источник указан под кадром.</p>
    <div class="bg-grid" role="radiogroup" aria-label="Фоновые фотографии" id="bgGrid">
      ${data.items.map(item => `<button type="button" class="bgopt" role="radio" data-bg="${esc(item.id)}" aria-checked="${item.id === selected ? 'true' : 'false'}" tabindex="${item.id === selected ? '0' : '-1'}">
        <img src="${esc(item.thumb)}" alt="" width="480" height="270" loading="lazy" decoding="async">
        <span class="bgt"><b>${esc(item.title)}</b><small>${esc(item.place)}</small></span>
      </button>`).join('')}
    </div>
    <p class="credit" id="bgCredit"></p>
    <p><a class="btn" href="#/">На главную</a></p>
  </div>`);
  const credit = $('#bgCredit');
  const buttons = $$('#bgGrid .bgopt');
  const showCredit = (id) => {
    const item = data.items.find(x => x.id === id);
    if (!item) { credit.textContent = ''; return; }
    credit.innerHTML = `${esc(item.title)}. Фото: ${esc(item.author)}. Лицензия <a href="${esc(item.license_url)}" target="_blank" rel="noopener">${esc(item.license)}</a>. <a href="${esc(item.source)}" target="_blank" rel="noopener">Источник</a>.`;
  };
  const select = (btn, focus) => {
    rememberBg(btn.dataset.bg);
    buttons.forEach(b => { const on = b === btn; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    showCredit(btn.dataset.bg);
    if (focus) btn.focus();
  };
  showCredit(selected);
  buttons.forEach(btn => { btn.onclick = () => select(btn, false); });
  $('#bgGrid').addEventListener('keydown', (ev) => {
    const keys = ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(ev.key)) return;
    const i = buttons.findIndex(b => b.getAttribute('aria-checked') === 'true');
    let n = i < 0 ? 0 : i;
    if (ev.key === 'Home') n = 0;
    else if (ev.key === 'End') n = buttons.length - 1;
    else if (ev.key === 'ArrowLeft' || ev.key === 'ArrowUp') n = (n - 1 + buttons.length) % buttons.length;
    else n = (n + 1) % buttons.length;
    ev.preventDefault();
    select(buttons[n], true);
  });
});

document.addEventListener('DOMContentLoaded', () => {
  const id = currentBg();
  document.documentElement.dataset.bg = id;
  loadCatalog().then(data => {
    if (!data.items.some(x => x.id === currentBg())) { rememberBg(data.default || BG_FALLBACK); return; }
    paintBg(currentBg(), false);
  }).catch(() => {});
});
