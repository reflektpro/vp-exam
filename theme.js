/* Фон портала: три тёмных кадра (assets/bg). Выбор случайный, один раз за заход (sessionStorage),
   ставится в <head> до отрисовки. Здесь — только страница «Фон», где кадр можно сменить до конца захода. */
'use strict';
const BACKGROUNDS = [
  { id: 'kremlin', title: 'Кремль' },
  { id: 'formation', title: 'Построение' },
  { id: 'tanks', title: 'Техника' }
];
function vpPickBackground(random) {
  const n = BACKGROUNDS.length;
  const raw = typeof random === 'function' ? random() : random;
  const r = Number(raw);
  let i = Math.floor((Number.isFinite(r) ? r : 0) * n);
  if (i < 0) i = 0;
  if (i >= n) i = n - 1;
  return BACKGROUNDS[i];
}
function currentBg() {
  const id = document.documentElement.dataset.bg;
  return BACKGROUNDS.some(b => b.id === id) ? id : BACKGROUNDS[0].id;
}
function setBg(id) {
  if (!BACKGROUNDS.some(b => b.id === id)) return;
  try { sessionStorage.setItem('vp_bg', id); } catch (_) {}
  document.documentElement.dataset.bg = id;
}
window.vpPickBackground = vpPickBackground;
window.vpBackgrounds = BACKGROUNDS;

route('/theme', async () => {
  const cur = currentBg();
  setView(`<div class="theme-page">
    <p class="kicker">Оформление</p>
    <h1>Фон</h1>
    <p class="lead">При входе кадр выбирается случайно и не меняется до конца захода. Здесь его можно сменить. На экзамене и в лекции фото скрывается, чтобы не мешать чтению.</p>
    <div class="bg-grid" role="radiogroup" aria-label="Фон" id="bgGrid">
      ${BACKGROUNDS.map(b => `<button type="button" class="bgopt" role="radio" data-bg="${b.id}" aria-checked="${b.id === cur ? 'true' : 'false'}" tabindex="${b.id === cur ? '0' : '-1'}">
        <img src="assets/bg/${b.id}-m.webp" alt="" width="480" height="270" loading="lazy" decoding="async">
        <span class="bgt"><b>${esc(b.title)}</b></span>
      </button>`).join('')}
    </div>
    <p><a class="btn" href="#/">На главную</a></p>
  </div>`);
  const buttons = $$('#bgGrid .bgopt');
  const select = (btn, focus) => {
    setBg(btn.dataset.bg);
    buttons.forEach(b => { const on = b === btn; b.setAttribute('aria-checked', on ? 'true' : 'false'); b.tabIndex = on ? 0 : -1; });
    if (focus) btn.focus();
  };
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
