/* Еженедельный отчёт прямо в портале: бланк текущей недели (копия бланка с сайта бланков — папка report/),
   отправка руководству и свои прошлые отчёты на одной странице. Тяжёлые библиотеки PDF грузятся один раз и только здесь. */
'use strict';
window.VP_DOC_CONFIG = {
  header: ['МИНИСТЕРСТВО ОБОРОНЫ РОССИЙСКОЙ ФЕДЕРАЦИИ', 'ГЛАВНОЕ УПРАВЛЕНИЕ ВОЕННОЙ ПОЛИЦИИ'],
  unitLine: '1-я мотострелковая бригада | В/Ч №12132',
  to: 'Военному коменданту гарнизона, начальнику ГУ ВП',
  motto: 'ГУ ВП — ЗАКОН. ПОРЯДОК. ДИСЦИПЛИНА.',
  city: 'Москва'
};
window.VP_REPORT_BASE = 'report/';
const PROMO_FORM_HTML = `<div class="layout v2">
  <aside class="panel form-panel" id="form">
    <h2>Рапорт на повышение</h2>
    <div class="row2">
      <label class="plab">Номер рапорта
        <span class="numrow"><input id="num" autocomplete="off"><button type="button" class="mini" id="numNext" title="Следующий номер по счётчику этого браузера">след.</button></span>
      </label>
      <label class="plab">Дата подачи<input type="date" id="date"></label>
    </div>
    <h3>I. Общие сведения</h3>
    <div class="q">1. Военнослужащий</div>
    <div class="row2">
      <label class="plab">Текущее звание<input class="req" id="fromRank" list="ranks" placeholder="Лейтенант"></label>
      <label class="plab">Номер удостоверения<input class="req" id="fromStatic" placeholder="12345"></label>
    </div>
    <label class="plab">Имя Фамилия<input class="req" id="fromName" placeholder="Шерман Ассман" autocomplete="off"></label>
    <div class="q">2. Подразделение и должность</div>
    <div class="row2">
      <label class="plab">Подразделение<input class="req" id="fromUnit" list="units" placeholder="Батальон военной полиции"></label>
      <label class="plab">Должность<input class="req" id="fromPos" list="positions" placeholder="Инспектор ВП"></label>
    </div>
    <div class="q">3. Звание и период службы в текущем звании</div>
    <label class="plab">Испрашиваемое звание<input class="req" id="target" list="ranks" placeholder="подставится по системе повышений"></label>
    <div class="week-dates"><input type="date" id="fromDate" class="req" title="в текущем звании с"><span>—</span><input type="date" id="toDate" class="req" title="по"></div>

    <h3>Калькулятор повышения</h3>
    <div class="route" id="route"></div>
    <div class="bar"><div class="bar-fill" id="barFill"></div><span id="barText">0 баллов</span></div>
    <ul class="crit" id="crit"></ul>
    <div class="crit-note" id="critNote"></div>

    <h3>II. Результаты служебной деятельности</h3>
    <label class="chk"><input type="checkbox" id="showPts" checked> Указывать баллы в документе</label>
    <div class="acts-hint">Отмечай выполненное за период службы в текущем звании и прикладывай ссылки, по одной на строку. Пункты разбиты по официальной градации: основная отчётность, дополнительная отчётность, работа ГУ ВП.</div>
    <div id="acts"></div>

    <h3>III. Итоговая информация</h3>
    <label class="plab q">7. Общий результат работы за период<textarea id="result" rows="2"></textarea></label>
    <div class="norm-hint">Пусто — подставится автоматически: «выполнено мероприятий и служебных действий: N». Общее количество баллов печатается отдельной строкой перед датой.</div>
    <label class="plab q">8. Дополнительные сведения<textarea id="extra" rows="2" placeholder="другие заслуги, поощрения; пусто — «отсутствуют»"></textarea></label>
    <h3>Выгрузка</h3>
    <label class="chk"><input type="checkbox" id="stampOn" checked> Ставить печать</label>
    <button class="btn primary" id="pdf">Скачать PDF</button>
    <button class="btn" id="png">Скачать PNG</button>
    <button class="btn ghost" id="clear">Обнулить достижения</button>
    <div id="promoGate"></div>
    <div class="status" id="status"></div>
    <div class="note">PDF — векторный текст, ссылки на доказательства видны и кликабельны. PNG — тот же документ без ссылок: вместо адресов «Приложение №N». Данные хранятся только в этом браузере и никуда не отправляются.</div>
  </aside>
  <section class="preview-wrap">
    <div class="pv-bar"><span>Предпросмотр</span><span id="pvPages"></span>
      <span class="pv-mode"><label><input type="radio" name="pvMode" value="preview" checked> PDF</label><label><input type="radio" name="pvMode" value="png"> PNG</label></span></div>
    <div class="preview" id="preview"></div>
  </section>
</div>
<datalist id="ranks">
  <option>Рядовой</option><option>Ефрейтор</option><option>Младший сержант</option><option>Сержант</option>
  <option>Старший сержант</option><option>Старшина</option><option>Прапорщик</option><option>Старший прапорщик</option>
  <option>Младший лейтенант</option><option>Лейтенант</option><option>Старший лейтенант</option><option>Капитан</option>
  <option>Майор</option><option>Подполковник</option><option>Полковник</option><option>Генерал-майор</option><option>Генерал-лейтенант</option><option>Генерал-полковник</option><option>Генерал армии</option>
</datalist>
<datalist id="positions">
  <option>Стажёр ВП</option><option>Инспектор ВП</option><option>Дознаватель ВП</option><option>Инструктор ВП</option><option>Зам. Ком. Бат ВП</option><option>Ком. Бат ВП</option><option>Инспектор военной комендатуры</option><option>Дознаватель военной комендатуры</option><option>Заместитель коменданта гарнизона</option><option>Комендант гарнизона</option>
</datalist>
<datalist id="units"><option>Батальон военной полиции</option><option>Военная комендатура</option></datalist>`;
const REPORT_FORM_HTML = `<div class="layout v2">
  <aside class="panel form-panel" id="form">
    <h2>Еженедельный отчёт</h2>
    <div class="row2">
      <label class="plab">Номер рапорта
        <span class="numrow"><input id="num" autocomplete="off"><button type="button" class="mini" id="numNext" title="Следующий номер по счётчику этого браузера">след.</button></span>
      </label>
      <label class="plab">Дата подачи<input type="date" id="date"></label>
    </div>
    <label class="plab">Кому (адресат отчёта)<select id="toSel">
      <option value="gu">Военный комендант гарнизона, начальник ГУ ВП</option>
      <option value="zam_kombrig_rls">Заместитель командира бригады по РЛС</option>
      <option value="kombrig">Командир бригады</option></select></label>
    <div class="norm-hint" id="toHint">По умолчанию: командир батальона и комендант гарнизона — командиру бригады, старший состав (СС) — заместителю командира бригады по РЛС, остальные — начальнику ГУ ВП. Можно выбрать вручную.</div>
    <h3>I. Общие сведения</h3>
    <div class="q">1. Военнослужащий</div>
    <div class="row2">
      <label class="plab">Воинское звание<input class="req" id="fromRank" list="ranks" placeholder="Лейтенант"></label>
      <label class="plab">Номер удостоверения<input class="req" id="fromStatic" placeholder="12345"></label>
    </div>
    <label class="plab">Имя Фамилия<input class="req" id="fromName" placeholder="Шерман Ассман" autocomplete="off"></label>
    <div class="q">2. Подразделение и должность</div>
    <div class="row2">
      <label class="plab">Подразделение<input class="req" id="fromUnit" list="units" placeholder="Батальон военной полиции"></label>
      <label class="plab">Должность<select class="req" id="fromPos"><option value="">— выбрать —</option><option>Комендант Гарнизона</option><option>Ком. Бат. ВП</option><option>Зам. Ком. Бат. ВП</option><option>Инспектор Комендатуры</option><option>Инструктор ВП</option><option>Инспектор ВП</option><option>Стажёр ВП</option></select></label>
    </div>
    <div class="q">3. Отчётный период</div>
    <div class="week-dates"><input type="date" id="fromDate" class="req"><span>—</span><input type="date" id="toDate" class="req"></div>
    <div class="week-btns"><button type="button" class="mini" id="wkCur">текущая неделя</button><button type="button" class="mini" id="wkPrev">прошлая неделя</button><span class="norm-hint" id="wkHint"></span></div>

    <h3>II. Результаты служебной деятельности</h3>
    <div class="bar"><div class="bar-fill" id="barFill"></div><span id="barText">0 баллов</span></div>
    <label class="chk"><input type="checkbox" id="showPts" checked> Указывать баллы в документе</label>
    <div class="plan-box" id="planBox" hidden></div>
    <div class="acts-hint">Жми «+» за каждое дело и вставляй ссылки на доказательства, по одной на строку. В PDF ссылки видны и кликабельны, в PNG вместо них «Приложение №N». Свой пункт — кнопкой внизу списка. Пункты разбиты по официальной градации: основная отчётность, дополнительная отчётность, работа ГУ ВП. Баллы в отчёте дают только пункты основной отчётности; у «Организовать МП» и «Организовать ГМП» баллы зависят от мероприятия — впиши сумму в поле «баллы». Остальные пункты идут в отчёт и в число выполненных действий без баллов.</div>
    <div id="acts"></div>
    <div class="vygovor-note ok" id="vygNote">Выговор, который ты уже выдал рапортом на взыскание, второй раз не считается. Оставь что-то одно: либо рапорт, либо выговор.</div>

    <h3>III. Итоговая информация</h3>
    <label class="plab q">7. Общий результат работы за неделю<textarea id="result" rows="2"></textarea></label>
    <div class="norm-hint">Пусто — подставится автоматически: «выполнено мероприятий и служебных действий: N». Общее количество баллов печатается отдельной строкой перед датой.</div>
    <label class="plab q">8. Дополнительные сведения<textarea id="extra" rows="2" placeholder="сложности, предложения; пусто — «отсутствуют»"></textarea></label>
    <h3>Выгрузка</h3>
    <label class="chk"><input type="checkbox" id="stampOn" checked> Ставить печать</label>
    <button class="btn primary" id="pdf">Скачать PDF</button>
    <button class="btn" id="png">Скачать PNG</button>
    <button class="btn ghost" id="clear">Обнулить неделю</button>
    <div class="status" id="status"></div>
    <h3>Отправка руководству</h3>
    <div class="send-box" id="sendBox">
      <div class="send-info" id="sendInfo">Проверяю вход…</div>
      <button class="btn primary" id="sendBtn" type="button">Отправить отчёт</button>
      <div class="status" id="sendStatus"></div>
    </div>
    <div class="note">PDF — векторный текст, ссылки на доказательства видны и кликабельны. PNG — тот же документ без ссылок: вместо адресов «Приложение №N». PDF и PNG работают без входа. Данные хранятся в этом браузере; руководству они уходят только по кнопке «Отправить отчёт» (нужен вход через Discord). Срок — воскресенье 19:00 МСК, после срока отчёт сохраняется с отметкой «после срока», премия не начисляется.</div>
  </aside>
  <section class="preview-wrap">
    <div class="pv-bar"><span>Предпросмотр</span><span id="pvPages"></span>
      <span class="pv-mode"><label><input type="radio" name="pvMode" value="preview" checked> PDF</label><label><input type="radio" name="pvMode" value="png"> PNG</label></span></div>
    <div class="preview" id="preview"></div>
  </section>
</div>
<datalist id="ranks">
  <option>Рядовой</option><option>Ефрейтор</option><option>Младший сержант</option><option>Сержант</option>
  <option>Старший сержант</option><option>Старшина</option><option>Прапорщик</option><option>Старший прапорщик</option>
  <option>Младший лейтенант</option><option>Лейтенант</option><option>Старший лейтенант</option><option>Капитан</option>
  <option>Майор</option><option>Подполковник</option><option>Полковник</option><option>Генерал-майор</option><option>Генерал-лейтенант</option><option>Генерал-полковник</option><option>Генерал армии</option>
</datalist>
<datalist id="units"><option>Батальон военной полиции</option><option>Военная комендатура</option></datalist>`;
const RepLib = { core: null };
function repScript(src) {
  return new Promise((res, rej) => { const s = document.createElement('script'); s.src = src; s.async = false; s.onload = () => res(); s.onerror = () => rej(new Error('Бланк не загрузился. Обновите страницу.')); document.head.appendChild(s); });
}
// Скрипты бланка выполняются по порядку; pdfmake и pdf.js нужны только для предпросмотра и выгрузки — ими ждёт VP_PDF_READY.
function reportLibs() {
  if (!RepLib.core) {
    const v = '?v=' + encodeURIComponent(window.VP_VERSION || '');
    const core = ['vendor/fonts-data.js', 'assets-data.js', 'docs.js', 'promo-rules.js', 'criteria.js', 'otchet.js', 'povyshenie.js'].map(f => repScript('report/' + f + v));
    RepLib.core = Promise.all(core);
    window.VP_PDF_READY = Promise.all(['vendor/pdfmake.min.js', 'vendor/pdf.min.js'].map(f => repScript('report/' + f + v)));
    RepLib.core.catch(() => { RepLib.core = null; });
    window.VP_PDF_READY.catch(() => {});
  }
  return RepLib.core;
}
// Заранее (в простое) подтянуть бланк в кэш браузера, чтобы раздел «Отчёты» открывался сразу.
function warmReport() {
  if (warmReport.done || !can('vp')) return; warmReport.done = true;
  const v = '?v=' + encodeURIComponent(window.VP_VERSION || '');
  const idle = window.requestIdleCallback || ((f) => setTimeout(f, 1500));
  idle(() => ['vendor/fonts-data.js', 'assets-data.js', 'docs.js', 'promo-rules.js', 'criteria.js', 'otchet.js', 'povyshenie.js', 'vendor/pdfmake.min.js', 'vendor/pdf.min.js'].forEach(f => {
    const l = document.createElement('link'); l.rel = 'prefetch'; l.as = 'script'; l.href = 'report/' + f + v; document.head.appendChild(l);
  }));
}
// Правила системы повышения с сервера (как на сайте бланков).
function repPromo(r) {
  const P = window.PROMO; if (!P || !r || !r.custom || !r.config) return;
  const c = r.config;
  if (c.points_per_item) P.pointsPerItem = c.points_per_item;
  if (c.pts) P.acts.forEach(a => { if (Object.prototype.hasOwnProperty.call(c.pts, a.key)) a.pts = c.pts[a.key]; });
  if (Array.isArray(c.ladder)) { Object.keys(P.ladder).forEach(k => delete P.ladder[k]); c.ladder.forEach(s => { P.ladder[s.rank] = { to: s.to, points: s.points, need: s.need || {} }; }); }
}
// Профиль → поля бланка (имя, звание, статик, должность). Поля остаются редактируемыми.
function repAutofill(me) {
  const set = (id, val) => {
    const el = document.getElementById(id); if (!el || !val) return;
    if (el.tagName === 'SELECT') { const o = [...el.options].find(x => x.value && x.value.toLowerCase() === String(val).trim().toLowerCase()); if (!o || el.value === o.value) return; el.value = o.value; }
    else { if (el.value === val) return; el.value = val; }
    el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }));
  };
  set('fromName', me.ic_name); set('fromRank', me.rank); set('fromStatic', me.static_id); if (me.position) set('fromPos', me.position);
}
function repWeekCard(d) {
  const r = d.report, left = d.deadline - d.now;
  const rej = r ? r.items.filter(i => i.review && i.review.status === 'rejected') : [];
  const part = r ? r.items.filter(i => i.review && i.review.status === 'ok' && i.review.n_ok != null) : [];
  return `<div class="card" id="repWeek"><div class="row between"><h2 style="margin:0">Неделя ${weekLabel(d.week)}</h2>${r ? repBadge(r.status) + (r.late ? ' <span class="badge err">после срока</span>' : '') : '<span class="badge warn">не отправлен</span>'}</div>
      <p class="small mut">Срок — <b>${fmtDate(d.deadline)}</b> МСК${left > 0 ? ` (осталось ${Math.floor(left / 86400000) ? Math.floor(left / 86400000) + ' дн. ' : ''}${Math.floor(left % 86400000 / 3600000)} ч)` : ' — прошёл'}. Отчёт после срока сохраняется, но премия по нему не начисляется.</p>
      ${r ? `<div class="kv"><span>Версия</span><b>${r.version} от ${fmtDate(r.submitted_at)}</b></div><div class="kv"><span>Должность</span><b>${esc(r.position_name)}</b></div><div class="kv"><span>Адресат (кому)</span><b class="rep-to">${esc(r.addressee_name || '')}</b></div>
        <div class="kv"><span>Баллы отчёта</span><b>${r.points}</b></div><div class="kv"><span>План недели</span><b>${r.plan ? `<span class="badge ${PLAN_RU[r.plan.level][1]}">${PLAN_RU[r.plan.level][0]}</span>` : '—'}</b></div>
        ${r.comment ? `<div class="alert info" style="margin-top:10px"><b>Комментарий руководства:</b> ${esc(r.comment)}</div>` : ''}
        ${rej.length ? `<div class="alert err small"><b>Не засчитано:</b> ${rej.map(i => esc(i.name) + (i.review.comment ? ' — ' + esc(i.review.comment) : '')).join('; ')}</div>` : ''}
        ${part.length ? `<div class="alert warn small"><b>Засчитано частично:</b> ${part.map(i => `${esc(i.name)}: ${i.review.n_ok} из ${i.n}`).join('; ')}</div>` : ''}` : ''}
      <p class="small mut">Имя, звание и статик подставляются из <a href="#/profile">профиля</a>. По умолчанию командир батальона и комендант гарнизона пишут командиру бригады, старший состав — заместителю командира бригады по РЛС, остальные — ${esc(((d.addressees || [])[0] || {}).name || 'начальнику ГУ ВП')}.${d.addressee_default ? ` Вам по умолчанию — <b>${esc(((d.addressees || []).find(a => a.key === d.addressee_default) || {}).name || '')}</b>.` : ''}
        Тот же бланк есть и <a href="${esc(CFG.REPORTS_URL)}" target="_blank" rel="noopener noreferrer">на сайте бланков ↗</a>. <a href="#/premiums">Премирование</a></p></div>`;
}
function repRecent(d) {
  return `<div class="card flat" id="repRecent"><h3>Мои отчёты</h3>${d.recent.length ? `<div class="tscroll"><table><tr><th>Неделя</th><th>Кому</th><th>Статус</th><th>Отправлен</th><th>Версия</th><th>Комментарий</th></tr>
      ${d.recent.map(x => `<tr><td>${weekLabel(x.week)}</td><td class="small">${esc(x.addressee_name || '')}</td><td>${repBadge(x.status)}${x.late ? ' <span class="badge err">после срока</span>' : ''}</td><td>${fmtDate(x.submitted_at)}</td><td class="num">${x.version}</td><td class="small">${esc(x.comment || '')}</td></tr>`).join('')}</table></div>` : '<p class="mut">Отчётов пока нет.</p>'}</div>`;
}
route('/reports', async () => {
  App.busy = true; onCleanup(() => { App.busy = false; });
  const libs = reportLibs(); libs.catch(() => {});
  const [d, pc] = await Promise.all([api('GET', '/api/reports/my'), api('GET', '/api/promo-config').catch(() => null)]);
  if (d && d.week && !Cache.has('/api/reports/my?week=' + d.week)) cachePut('/api/reports/my?week=' + d.week, d);
  setView(`<h1>Отчёты</h1><div class="rep" id="repBox">${REPORT_FORM_HTML}</div>${repWeekCard(d)}${repRecent(d)}`);
  const box = $('#repBox');
  box.classList.add('rep-wait'); $('#sendInfo').textContent = 'Бланк загружается…'; $('#sendBtn').disabled = true;
  try { await libs; } catch (e) { if (box.isConnected) { $('#sendInfo').innerHTML = `<div class="send-err">${esc(e.message)}</div>`; } return; }
  if (!box.isConnected) return;
  repPromo(pc);
  let go; const eco = { online: true, me: App.me, api, login: () => { location.href = CFG.API_BASE + '/auth/login?return=' + encodeURIComponent(location.origin + location.pathname); },
    onChange: [], authError: null, ready: new Promise(r => { go = r; }),
    onSent: async () => { try { const x = await api('GET', '/api/reports/my'); const w = $('#repWeek'), rc = $('#repRecent'); if (w) w.outerHTML = repWeekCard(x); if (rc) rc.outerHTML = repRecent(x); } catch (_) {} } };
  window.VPReportMount(eco);
  repAutofill(App.me);
  box.classList.remove('rep-wait');
  go(eco);
}, { cap: 'vp' });

// ---------- рапорт на повышение прямо в портале ----------
// Скачать PDF/PNG можно, когда пройдены обязательные курсы учёбы (общие и для текущего звания). Допуск считает сервер
// (GET /api/promo/eligibility); старый сервер без этой проверки — выгрузка открыта, как раньше.
function promoGateHtml(g) {
  if (!g || g.allowed) return '';
  const list = g.missing.map(c => `<a href="#/course/${c.id}">${esc(c.title)}</a>`).join(', ');
  return `<div class="alert warn small promo-gate">Скачать рапорт можно после ${g.missing.length > 1 ? 'курсов' : 'курса'}: ${list}.</div>`;
}
route('/promo/raport', async () => {
  App.busy = true; onCleanup(() => { App.busy = false; });
  const libs = reportLibs(); libs.catch(() => {});
  const elig = (rank) => api('GET', '/api/promo/eligibility' + (rank ? '?rank=' + encodeURIComponent(rank) : '')).catch(() => ({ allowed: true, missing: [] }));
  const [pc, g0] = await Promise.all([api('GET', '/api/promo-config').catch(() => null), elig('')]);
  let gate = g0;
  setView(`<h1>Рапорт на повышение</h1><div class="rep" id="repBox">${PROMO_FORM_HTML}</div>`);
  const box = $('#repBox');
  const paint = () => {
    const el = $('#promoGate'); if (!el) return;
    el.innerHTML = promoGateHtml(gate);
    ['pdf', 'png'].forEach(id => { const b = document.getElementById(id); if (b) { b.classList.toggle('gated', !gate.allowed); b.setAttribute('aria-disabled', gate.allowed ? 'false' : 'true'); } });
  };
  paint();
  box.classList.add('rep-wait');
  try { await libs; } catch (e) { if (box.isConnected) $('#status').innerHTML = `<div class="send-err">${esc(e.message)}</div>`; return; }
  if (!box.isConnected) return;
  repPromo(pc);
  const eco = { me: App.me, api, missingPoints: !(pc && pc.missing_points === false), gate: () => gate };
  window.VPPromoMount(eco);
  repAutofill(App.me);
  box.classList.remove('rep-wait');
  let t = null, asked = (App.me && App.me.rank) || '';
  const rankEl = $('#fromRank');
  if (rankEl && rankEl.value.trim().toLowerCase() !== asked.toLowerCase()) { asked = rankEl.value.trim(); gate = await elig(asked); paint(); }
  if (rankEl) rankEl.addEventListener('input', () => { clearTimeout(t); t = setTimeout(async () => { const r = rankEl.value.trim(); if (r === asked) return; asked = r; const g = await elig(r); if (asked === r && box.isConnected) { gate = g; paint(); } }, 350); });
}, { cap: 'vp' });
