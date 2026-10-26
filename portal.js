/* Разделы портала ГУ ВП: главная, учебный отдел (курсы), отчёты, премирование, система повышения, база данных, личные дела, профиль.
   Доступ по ролям проверяет сервер; здесь — только показ. */
'use strict';
const RANKS = ['Рядовой', 'Ефрейтор', 'Младший сержант', 'Сержант', 'Старший сержант', 'Старшина', 'Прапорщик', 'Старший прапорщик', 'Младший лейтенант', 'Лейтенант', 'Старший лейтенант', 'Капитан', 'Майор', 'Подполковник', 'Полковник', 'Генерал-майор', 'Генерал-лейтенант', 'Генерал-полковник', 'Генерал армии'];
const POSITIONS = ['Комендант Гарнизона', 'Ком. Бат. ВП', 'Зам. Ком. Бат. ВП', 'Инспектор Комендатуры', 'Инструктор ВП', 'Инспектор ВП', 'Стажёр ВП', 'Дознаватель ВП'];
const PLAN_TXT = { normal: 'нормальный план', min: 'минимальный план', none: 'план не выполнен' };
function initials(n) { return String(n || '?').trim().split(/\s+/).slice(0, 2).map(x => x[0] || '').join('').toUpperCase() || '?'; }
function avatar(u, cls) { return u.avatar_url ? `<img class="ava ${cls || ''}" src="${esc(u.avatar_url)}" alt="">` : `<span class="ava ava-t ${cls || ''}">${esc(initials(u.name || userName(u)))}</span>`; }
// plural(n, a, b, c) — из admin.js
function profileMissing(u) { return [!u.ic_name && 'Имя Фамилия', !u.rank && 'звание', !u.static_id && 'статик'].filter(Boolean); }

// ---------- главная ----------
async function homePage() {
  const u = App.me, s = App.config ? App.config.settings : {};
  const tiles = MENU.filter(m => m[0] !== '/' && (!m[3] || can(m[3])));
  const anyRole = can('vp') || can('reatt') || can('examiner') || can('lead');
  const miss = profileMissing(u);
  let rep = null, courses = null;
  try { [rep, courses] = await Promise.all([can('vp') ? api('GET', '/api/reports/my') : null, can('vp') ? api('GET', '/api/courses') : null]); } catch (_) {}
  const TILE_TXT = { '/study': courses ? (() => { const c = courses.courses; const done = c.filter(x => x.complete).length; return c.length ? `Курсов: ${c.length}, пройдено: ${done}` : 'Курсы пока не опубликованы'; })() : 'Курсы, лекции и экзамены',
    '/reports': rep ? (rep.report ? `Отчёт за неделю: ${(REP_ST[rep.report.status] || ['—'])[0].toLowerCase()}` : `Отчёт за неделю не сдан · срок ${fmtDate(rep.deadline)}`) : 'Еженедельный отчёт',
    '/premiums': 'Премии недели: кто, за что, сколько', '/promo': 'Ступени, баллы и требования', '/docs': 'Документация и инструкции', '/people': 'Карточки сотрудников',
    '/reatt': 'Тесты по законам и уставам', '/lead': 'Проверка отчётов, фонд, бюджет', '/admin': 'Лекции, экзамены, проверка, пользователи', '/profile': 'Имя, звание, статик, должность' };
  setView(`<div class="card hero"><div class="row"><div style="flex:1;min-width:240px"><h1>${esc(s.site_title || 'ГУ ВП')}</h1>
      <div class="mut">Здравствуйте, <b>${esc(userName(u))}</b>${u.rank ? ' · ' + esc(u.rank) : ''}</div>
      ${s.welcome_text ? `<div class="welcome small mut" style="margin-top:8px">${esc(s.welcome_text)}</div>` : '<div class="welcome" hidden></div>'}</div></div></div>
    ${!anyRole ? `<div class="alert info"><b>У вас пока нет ролей.</b> Учебный отдел, отчёты и премии открываются с ролью «ВП», переаттестация — с ролью «Переаттестация». Роли назначает администратор — обратитесь к руководству ГУ ВП. Сейчас доступны «База данных» и «Личные дела».</div>` : ''}
    ${miss.length ? `<div class="alert warn">Заполните профиль: ${miss.join(', ')}. Эти данные подставляются в отчёты и документы. <a href="#/profile">Открыть профиль</a></div>` : ''}
    ${rep && !rep.report && rep.deadline > rep.now ? `<div class="alert info">Еженедельный отчёт за эту неделю ещё не отправлен. Срок — <b>${fmtDate(rep.deadline)}</b> МСК. <a href="${esc(CFG.REPORTS_URL)}">Заполнить отчёт</a></div>` : ''}
    <div class="tiles-grid">${tiles.map(m => `<a class="tile-card" href="#${m[0]}"><i>${m[2]}</i><b>${esc(m[1])}</b><span class="small mut">${esc(TILE_TXT[m[0]] || m[4] || '')}</span></a>`).join('')}</div>`);
}

// ---------- учебный отдел: курсы ----------
route('/study', async () => {
  const { courses } = await api('GET', '/api/courses');
  const card = (c) => {
    const pct = c.required_total ? Math.round(c.required_done / c.required_total * 100) : (c.lectures_total ? Math.round(c.watched / c.lectures_total * 100) : 100);
    const ex = c.exams;
    const exState = !ex.length ? '<span class="badge">без экзамена</span>' : c.exam_passed ? '<span class="badge ok">экзамен сдан</span>'
      : ex.some(e => e.can_start || e.active_attempt_id) ? '<span class="badge info">экзамен открыт</span>' : ex.some(e => e.attempts.some(a => a.status === 'pending_review')) ? '<span class="badge warn">экзамен на проверке</span>' : '<span class="badge lock">🔒 экзамен после лекций</span>';
    return `<a class="course-card ${c.complete ? 'done' : ''}" href="#/course/${c.id}">
      <div class="row between"><h2>${esc(c.title)}</h2>${c.complete ? '<span class="badge ok">✔ пройден</span>' : ''}</div>
      ${c.description ? `<p class="small mut cdesc">${esc(c.description.slice(0, 220))}</p>` : ''}
      <div class="small">Лекций: <b>${c.lectures_total}</b>${c.required_total ? ` · обязательных просмотрено <b>${c.required_done} из ${c.required_total}</b>` : ''} · экзаменов: <b>${ex.length}</b></div>
      <div class="bar"><i style="width:${pct}%"></i></div><div class="row between small" style="margin-top:8px"><span class="mut">${pct}%</span>${exState}</div></a>`;
  };
  setView(`<h1>Учебный отдел</h1>
    <p class="mut small">Каждый курс — это лекции по порядку и экзамен в конце. Экзамен открывается, когда просмотрены обязательные лекции курса. Перематывать лекции вперёд нельзя.</p>
    ${courses.length ? `<div class="course-grid">${courses.map(card).join('')}</div>` : '<div class="alert info">Курсы пока не опубликованы.</div>'}`);
}, { cap: 'vp' });

route('/course/:id', async (id) => {
  const { courses } = await api('GET', '/api/courses');
  const c = courses.find(x => String(x.id) === String(id));
  if (!c) throw new Error('Курс не найден или ещё не опубликован');
  const lecDone = c.required_done >= c.required_total;
  const step = (l, i) => {
    const pct = l.duration_sec ? Math.min(100, Math.round((l.progress ? l.progress.max_pos : 0) / l.duration_sec * 100)) : 0;
    const st = l.status === 'in_progress' ? `<span class="badge info">${pct}%</span>` : badge(l.status);
    return `<li class="step ${l.status} ${l.locked ? 'locked' : ''}"><span class="dot">${l.status === 'watched' ? '✔' : l.locked ? '🔒' : i + 1}</span>
      <a class="step-body" href="#/lecture/${l.id}" ${l.locked ? 'tabindex="-1" aria-disabled="true"' : ''}><div class="row between"><b>${esc(l.title)}</b>${st}</div>
        <div class="small mut">Лекция · ${fmtTime(l.duration_sec)}${l.required ? '' : ' · необязательная'}${l.description ? ' · ' + esc(l.description.slice(0, 120)) : ''}</div>
        ${l.status === 'in_progress' ? `<div class="bar"><i style="width:${pct}%"></i></div>` : ''}</a></li>`;
  };
  const exStep = (e) => {
    const last = e.attempts[0];
    const st = last ? badge(last.status) : e.can_start ? '<span class="badge ok">открыт</span>' : '<span class="badge lock">закрыт</span>';
    return `<li class="step exam ${e.attempts.some(a => a.status === 'passed') ? 'watched' : ''} ${!e.can_start && !e.active_attempt_id && !last ? 'locked' : ''}"><span class="dot">🎯</span>
      <div class="step-body"><div class="row between"><b>Экзамен: ${esc(e.title)}</b>${st}</div>
        <div class="small mut">${examMeta(e)}</div>
        ${e.lectures_left ? `<div class="small warn-t">Осталось посмотреть лекций: ${e.lectures_left}</div>` : ''}
        ${!e.can_start && e.reason && !e.active_attempt_id ? `<div class="small mut">${esc(e.reason)}${e.next_at ? ' — ' + fmtDate(e.next_at) : ''}</div>` : ''}
        <div class="row" style="margin-top:8px">${e.active_attempt_id ? `<a class="btn primary sm" href="#/attempt/${e.active_attempt_id}">Продолжить попытку</a>` : e.can_start ? `<a class="btn primary sm" href="#/exam/${e.id}">Перейти к экзамену</a>` : `<a class="btn sm" href="#/exam/${e.id}">Подробнее</a>`}</div></div></li>`;
  };
  setView(`<p><a href="#/study">← Учебный отдел</a></p>
    <div class="card"><div class="row between"><h1 style="margin:0">${esc(c.title)}</h1>${c.complete ? '<span class="badge ok">✔ курс пройден</span>' : ''}</div>
      ${c.description ? `<div class="welcome" style="margin-top:8px">${esc(c.description)}</div>` : ''}
      <div class="small mut" style="margin-top:8px">Лекций: ${c.lectures_total}${c.required_total ? ` · обязательных просмотрено ${c.required_done} из ${c.required_total}` : ''} · экзаменов: ${c.exams.length}</div>
      <div class="bar"><i style="width:${c.required_total ? Math.round(c.required_done / c.required_total * 100) : 100}%"></i></div></div>
    <ol class="steps">${c.lectures.map(step).join('')}${c.exams.map(exStep).join('')}</ol>
    ${!c.lectures.length && !c.exams.length ? '<div class="alert info">В курсе пока нет лекций и экзаменов.</div>' : ''}
    ${c.lectures.length && !lecDone ? `<p class="small mut">${'Лекции идут по порядку: следующая открывается после полного просмотра предыдущей обязательной.'}</p>` : ''}`);
}, { cap: 'vp' });

// ---------- отчёты (сотрудник) ----------
route('/reports', async () => {
  const d = await api('GET', '/api/reports/my');
  const r = d.report;
  const left = d.deadline - d.now;
  const rej = r ? r.items.filter(i => i.review && i.review.status === 'rejected') : [];
  const part = r ? r.items.filter(i => i.review && i.review.status === 'ok' && i.review.n_ok != null) : [];
  setView(`<h1>Отчёты</h1>
    <div class="card"><div class="row between"><h2 style="margin:0">Неделя ${weekLabel(d.week)}</h2>${r ? repBadge(r.status) + (r.late ? ' <span class="badge err">после срока</span>' : '') : '<span class="badge warn">не отправлен</span>'}</div>
      <p class="small mut">Срок — <b>${fmtDate(d.deadline)}</b> МСК${left > 0 ? ` (осталось ${Math.floor(left / 86400000) ? Math.floor(left / 86400000) + ' дн. ' : ''}${Math.floor(left % 86400000 / 3600000)} ч)` : ' — прошёл'}. Отчёт после срока сохраняется, но премия по нему не начисляется.</p>
      ${r ? `<div class="kv"><span>Версия</span><b>${r.version} от ${fmtDate(r.submitted_at)}</b></div><div class="kv"><span>Должность</span><b>${esc(r.position_name)}</b></div>
        <div class="kv"><span>Баллы отчёта</span><b>${r.points}</b></div><div class="kv"><span>План недели</span><b>${r.plan ? `<span class="badge ${PLAN_RU[r.plan.level][1]}">${PLAN_RU[r.plan.level][0]}</span>` : '—'}</b></div>
        ${r.comment ? `<div class="alert info" style="margin-top:10px"><b>Комментарий руководства:</b> ${esc(r.comment)}</div>` : ''}
        ${rej.length ? `<div class="alert err small"><b>Не засчитано:</b> ${rej.map(i => esc(i.name) + (i.review.comment ? ' — ' + esc(i.review.comment) : '')).join('; ')}</div>` : ''}
        ${part.length ? `<div class="alert warn small"><b>Засчитано частично:</b> ${part.map(i => `${esc(i.name)}: ${i.review.n_ok} из ${i.n}`).join('; ')}</div>` : ''}` : ''}
      <div class="row" style="margin-top:12px"><a class="btn gold" href="${esc(CFG.REPORTS_URL)}">${r ? 'Изменить отчёт' : 'Заполнить отчёт'}</a><a class="btn" href="#/premiums">Премирование</a></div>
      <p class="small mut">Отчёт заполняется на сайте бланков (тот же вход). Имя, звание и статик подставляются из <a href="#/profile">профиля</a>.</p></div>
    <div class="card flat"><h3>Мои отчёты</h3>${d.recent.length ? `<table><tr><th>Неделя</th><th>Статус</th><th>Отправлен</th><th>Версия</th><th>Комментарий</th></tr>
      ${d.recent.map(x => `<tr><td>${weekLabel(x.week)}</td><td>${repBadge(x.status)}${x.late ? ' <span class="badge err">после срока</span>' : ''}</td><td>${fmtDate(x.submitted_at)}</td><td class="num">${x.version}</td><td class="small">${esc(x.comment || '')}</td></tr>`).join('')}</table>` : '<p class="mut">Отчётов пока нет.</p>'}</div>`);
}, { cap: 'vp' });

// ---------- премирование (все ВП) ----------
route('/premiums', () => premiumsPage(), { cap: 'vp' });
route('/premiums\\?.*', () => premiumsPage(), { cap: 'vp' });
async function premiumsPage() {
  const q = hashQ();
  const d = await api('GET', '/api/premiums' + (q.get('week') ? '?week=' + encodeURIComponent(q.get('week')) : ''));
  const my = d.my;
  const money = d.final;
  const detail = (x) => `<div class="pdet">
      ${x.plan ? `<div class="small"><b>План:</b> ${PLAN_TXT[x.plan.level]}${x.deduct_pct ? ` (вычет ${x.deduct_pct}% из выплат за действия)` : ''} — ${x.plan.lines.map(l => `${esc(l.name)}: ${l.got} (мин. ${l.min}, норм. ${l.normal})`).join('; ')}.</div>` : ''}
      <table class="small"><tr><th>За что</th><th>Кол-во</th>${money ? '<th>За 1</th><th>Сумма</th>' : ''}</tr>${x.items.map(i => `<tr><td>${esc(i.name)}</td><td class="num">${i.n}</td>${money ? `<td class="num">${i.pay ? RUB(i.pay) : '—'}</td><td class="num">${i.sum ? RUB(i.sum) : '—'}</td>` : ''}</tr>`).join('')}</table></div>`;
  const myCard = !my ? `<div class="card flat"><h3>Моя премия</h3><p class="mut">За эту неделю у вас нет отчёта.</p></div>`
    : `<div class="card my-prem"><h3>Моя премия — ${weekLabel(d.week)}</h3>
      ${!my.reason && !my.late && my.status !== 'rejected' ? (money ? `<div class="grid two"><div><div class="kv"><span>Оклад (${TIER_RU[my.oklad_tier]})</span><b>${RUB(my.oklad)}</b></div><div class="kv"><span>Выплаты за действия</span><b>${RUB(my.actions)}</b></div>
          <div class="kv"><span>Вычет ${my.deduct_pct}%</span><b>${my.deduction ? '−' + RUB(my.deduction) : '—'}</b></div><div class="kv"><span>Базовая премия (не больше ${RUB(my.max)})</span><b>${RUB(my.base)}</b></div>
          <div class="kv"><span>Дополнительная</span><b>${RUB(my.add)}</b></div><div class="kv"><span>Наградная</span><b>${RUB(my.award)}</b></div><div class="kv"><span>Премия СС</span><b>${RUB(my.ss)}</b></div>
          <div class="kv total"><span>Итого из премиального фонда</span><b>${RUB(my.total_fund)}</b></div></div>
          <div><div class="budget-box"><div class="small mut">Наградная из бюджета ГУ ВП — отдельно, другой источник</div><div class="big">${RUB(my.award_budget)}</div></div>${detail(my)}</div></div>`
        : `<p>Отчёт: ${repBadge(my.status)}. ${d.open ? `Итоговая сумма появится, когда руководство проверит все отчёты недели (проверено ${d.stats.reviewed} из ${d.stats.on_time}).` : `Сумма появится после срока (${fmtDate(d.deadline)} МСК) и проверки всех отчётов.`}</p>${my.items ? detail(my) : ''}`)
      : `<div class="alert err">Без премии: ${esc(my.late ? 'отчёт после срока' : my.status === 'rejected' ? 'отчёт отклонён' : my.reason)}.</div>`}</div>`;
  const weeks = [...new Set([d.week, d.last_closed_week, ...d.weeks])].sort().reverse();
  setView(`<h1>Премирование</h1>
    <div class="row weekpick"><a class="btn sm" href="#/premiums?week=${addD(d.week, -7)}">← Пред.</a><select id="wkSel" style="width:auto">${weeks.map(w => `<option value="${w}" ${w === d.week ? 'selected' : ''}>${weekLabel(w)}</option>`).join('')}</select>
      <a class="btn sm" href="#/premiums?week=${addD(d.week, 7)}">След. →</a></div>
    ${!d.open ? `<div class="alert info">Список премий за эту неделю откроется после срока подачи отчётов — <b>${fmtDate(d.deadline)}</b> МСК.</div>`
      : !d.final ? `<div class="alert warn">Руководство проверяет отчёты: проверено <b>${d.stats.reviewed} из ${d.stats.on_time}</b>. Ниже — принятые отчёты; суммы появятся после проверки всех отчётов недели.</div>`
      : `<div class="alert ok">Все отчёты недели проверены — суммы итоговые.</div>`}
    ${myCard}
    ${d.open ? `<div class="card flat"><h3>Премии недели ${d.list.length ? `<span class="small mut">(${d.list.length} ${plural(d.list.length, 'сотрудник', 'сотрудника', 'сотрудников')})</span>` : ''}</h3>
      ${d.list.length ? `<div class="tblwrap"><table class="plist"><thead><tr><th>Сотрудник</th><th>Должность</th><th>План</th><th>Благ.</th>${money ? '<th>Оклад</th><th>Действия</th><th>Вычет</th><th>Доп.</th><th>Наградная</th><th>СС</th><th>Итого (фонд)</th><th class="bcol">Наградная<div class="small">бюджет ГУ ВП</div></th>' : ''}<th></th></tr></thead>
        <tbody>${d.list.map((x, i) => `<tr class="${x.user_id === App.me.id ? 'me' : ''}"><td><b>${esc(x.name)}</b><div class="small mut">${esc(x.rank)}${x.static_id ? ' · ' + esc(x.static_id) : ''}</div></td><td class="small">${esc(x.position_name)}</td>
          <td>${x.plan ? `<span class="badge ${PLAN_RU[x.plan.level][1]}">${PLAN_RU[x.plan.level][0]}</span>` : '—'}</td><td class="num">${x.thanks || ''}</td>
          ${money ? `<td class="num">${RUB(x.oklad)}<div class="small mut">${TIER_RU[x.oklad_tier]}</div></td><td class="num">${RUB(x.actions)}</td><td class="num">${x.deduction ? '−' + RUB(x.deduction) : '—'}</td><td class="num">${x.add ? RUB(x.add) : '—'}</td><td class="num">${x.award ? RUB(x.award) : '—'}</td><td class="num">${x.ss ? RUB(x.ss) : '—'}</td>
            <td class="num"><b>${RUB(x.total_fund)}</b></td><td class="num bcol">${x.award_budget ? RUB(x.award_budget) : '—'}</td>` : ''}
          <td><button class="btn sm" data-det="${i}">За что</button></td></tr><tr class="detrow" id="det${i}" hidden><td colspan="${money ? 13 : 5}">${detail(x)}</td></tr>`).join('')}</tbody>
          ${money && d.totals ? `<tfoot><tr><td colspan="10"><b>Итого из премиального фонда</b></td><td class="num"><b>${RUB(d.totals.fund)}</b></td><td class="num bcol"><b>${RUB(d.totals.award_budget)}</b></td><td></td></tr></tfoot>` : ''}</table></div>
        <p class="small mut">Наградная из бюджета ГУ ВП идёт из другого источника и в «Итого (фонд)» не входит. Оклад зависит от плана: нормальный — средний оклад, минимальный — минимальный оклад и вычет 20%, не выполнен — нулевой оклад и вычет 50% из выплат за действия.</p>`
        : '<p class="mut">Принятых отчётов за эту неделю пока нет.</p>'}</div>` : ''}`);
  $('#wkSel').onchange = (e) => { location.hash = '#/premiums?week=' + e.target.value; };
  $$('[data-det]').forEach(b => b.onclick = () => { const r = $('#det' + b.dataset.det); r.hidden = !r.hidden; b.textContent = r.hidden ? 'За что' : 'Скрыть'; });
}

// ---------- система повышения ----------
route('/promo', async () => {
  const d = await api('GET', '/api/promo');
  const C = d.config, names = new Map(d.items.map(i => [i.key, i.name]));
  const edit = hashQ().get('edit') === '1' && d.can_edit;
  const need = (n) => Object.entries(n).map(([k, v]) => `<span class="chip">${esc(names.get(k) || k)} × ${v}</span>`).join('') || '<span class="small mut">—</span>';
  const ptsItems = d.items.filter(i => (C.pts[i.key] || 0) > 0);
  if (!edit) {
    setView(`<h1>Система повышения</h1>
      ${d.can_edit ? `<p><a class="btn gold" href="#/promo?edit=1">Изменить правила</a>${d.custom ? ' <span class="small mut">изменено ' + fmtDate(d.updated_at) + '</span>' : ''}</p>` : ''}
      <p class="mut small">Для повышения нужно набрать баллы за период и выполнить обязательные пункты ступени. Каждый недостающий пункт можно заменить <b>${C.points_per_item}</b> баллами сверх нормы (кроме лекций, экзаменов и стажировок). Рапорт на повышение — на <a href="${esc(CFG.REPORTS_URL.replace(/otchet\.html$/, 'povyshenie.html'))}" target="_blank" rel="noopener">сайте бланков</a>: он считает всё сам.</p>
      <div class="ladder">${C.ladder.map((st, i) => `<div class="lstep"><div class="lnum">${i + 1}</div><div style="flex:1"><div class="row between"><b>${esc(st.rank)} → ${esc(st.to)}</b><span class="badge gold">${st.points} баллов</span></div>
        <div class="chips">${need(st.need)}</div></div></div>`).join('')}</div>
      <div class="card flat"><h3>Баллы за действия</h3><table><tr><th>Действие</th><th>Раздел</th><th>Баллы</th></tr>${ptsItems.map(i => `<tr><td>${esc(i.name)}</td><td class="small mut">${GROUP_RU[i.group] || ''}</td><td class="num">${C.pts[i.key]}</td></tr>`).join('')}</table>
        <p class="small mut">Остальные пункты отчёта баллов для повышения не дают.</p></div>`);
    return;
  }
  const opts = (sel) => d.items.map(i => `<option value="${esc(i.key)}" ${i.key === sel ? 'selected' : ''}>${esc(i.name)}</option>`).join('');
  const needRow = (k, v) => `<div class="needrow"><select class="nk">${opts(k)}</select><input type="number" class="nv" min="1" value="${v}" style="width:70px"><button type="button" class="btn sm danger nx">✕</button></div>`;
  const stepRow = (st) => `<tr class="lrow"><td><input class="lr" value="${esc(st.rank)}" list="rankList"></td><td><input class="lt" value="${esc(st.to)}" list="rankList"></td><td><input class="lp" type="number" min="0" value="${st.points}" style="width:90px"></td>
    <td class="needs">${Object.entries(st.need).map(([k, v]) => needRow(k, v)).join('')}<button type="button" class="btn sm na">+ пункт</button></td><td><button type="button" class="btn sm danger lx">Удалить</button></td></tr>`;
  setView(`<p><a href="#/promo">← Система повышения</a></p><h1>Правила повышения</h1>
    <datalist id="rankList">${RANKS.map(r => `<option>${r}</option>`).join('')}</datalist>
    <div class="card"><label class="f" style="max-width:320px"><span>Баллов за один недостающий пункт</span><input id="ppi" type="number" min="1" value="${C.points_per_item}"></label>
      <h3>Ступени</h3><div class="tscroll"><table id="ladT"><tr><th>Звание</th><th>Следующее</th><th>Баллы</th><th>Обязательные пункты</th><th></th></tr>${C.ladder.map(stepRow).join('')}</table></div>
      <button type="button" class="btn sm" id="addStep">+ ступень</button></div>
    <div class="card"><h3>Баллы за действия</h3><div class="tscroll"><table id="ptsT"><tr><th>Действие</th><th>Баллы</th></tr>${d.items.map(i => `<tr><td>${esc(i.name)}<div class="small mut">${GROUP_RU[i.group] || ''}</div></td><td><input type="number" min="0" data-k="${esc(i.key)}" value="${C.pts[i.key] || 0}" style="width:90px"></td></tr>`).join('')}</table></div></div>
    <div class="row"><button class="btn gold" id="saveP">Сохранить</button><button class="btn" id="resetP">Вернуть исходные правила</button><a class="btn" href="#/promo">Отмена</a></div><div id="perr" class="ferr"></div>`);
  const bindRow = (tr) => {
    tr.querySelector('.lx').onclick = () => tr.remove();
    tr.querySelector('.na').onclick = (e) => { e.target.insertAdjacentHTML('beforebegin', needRow(d.items[0].key, 1)); bindNeeds(tr); };
    bindNeeds(tr);
  };
  const bindNeeds = (tr) => tr.querySelectorAll('.nx').forEach(b => b.onclick = () => b.closest('.needrow').remove());
  $$('#ladT .lrow').forEach(bindRow);
  $('#addStep').onclick = () => { $('#ladT tbody').insertAdjacentHTML('beforeend', stepRow({ rank: '', to: '', points: 0, need: {} })); bindRow($$('#ladT .lrow').pop()); };
  $('#saveP').onclick = async () => {
    const body = { points_per_item: $('#ppi').value, pts: {}, ladder: $$('#ladT .lrow').map(tr => { const need = {}; tr.querySelectorAll('.needrow').forEach(n => { need[n.querySelector('.nk').value] = (need[n.querySelector('.nk').value] || 0) + Number(n.querySelector('.nv').value || 0); });
      return { rank: tr.querySelector('.lr').value, to: tr.querySelector('.lt').value, points: tr.querySelector('.lp').value, need }; }) };
    $$('#ptsT [data-k]').forEach(i => { body.pts[i.dataset.k] = i.value; });
    try { await api('PUT', '/api/promo', body); toast('Правила повышения сохранены'); location.hash = '#/promo'; } catch (e) { $('#perr').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; toast(e.message, true); }
  };
  $('#resetP').onclick = async () => { if (!confirm('Вернуть исходные правила (как в promo-rules.js сайта бланков)?')) return; try { await api('POST', '/api/promo/reset'); toast('Исходные правила восстановлены'); location.hash = '#/promo'; } catch (e) { toast(e.message, true); } };
}, { cap: 'vp' });
route('/promo\\?.*', () => App.routes.find(r => r.p === '/promo').fn(), { cap: 'vp' });

// ---------- база данных (документация) ----------
// Разметка статей: # заголовок, ## подзаголовок, - список, 1. нумерованный, **жирный**, `код`, [текст](https://ссылка), пустая строка — новый абзац.
function mdInline(t) {
  return esc(t).replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|#\/[^\s)]*)\)/g, (m, a, h) => `<a href="${h}"${h[0] === '#' ? '' : ' target="_blank" rel="noopener noreferrer"'}>${a}</a>`);
}
function md(src) {
  const out = []; let list = null, para = [];
  const flushP = () => { if (para.length) { out.push(`<p>${para.map(mdInline).join('<br>')}</p>`); para = []; } };
  const flushL = () => { if (list) { out.push(`<${list.t}>${list.items.map(i => `<li>${mdInline(i)}</li>`).join('')}</${list.t}>`); list = null; } };
  for (const raw of String(src || '').split(/\r?\n/)) {
    const line = raw.trimEnd(); let m;
    if (!line.trim()) { flushP(); flushL(); continue; }
    if ((m = /^(#{1,3})\s+(.*)$/.exec(line))) { flushP(); flushL(); const h = m[1].length + 1; out.push(`<h${h}>${mdInline(m[2])}</h${h}>`); continue; }
    if ((m = /^\s*[-*•]\s+(.*)$/.exec(line))) { flushP(); if (!list || list.t !== 'ul') { flushL(); list = { t: 'ul', items: [] }; } list.items.push(m[1]); continue; }
    if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) { flushP(); if (!list || list.t !== 'ol') { flushL(); list = { t: 'ol', items: [] }; } list.items.push(m[1]); continue; }
    flushL(); para.push(line);
  }
  flushP(); flushL();
  return out.join('');
}
route('/docs', () => docsPage());
route('/docs\\?.*', () => docsPage());
async function docsPage() {
  const q = hashQ().get('q') || '';
  const d = await api('GET', '/api/docs' + (q ? '?q=' + encodeURIComponent(q) : ''));
  const cats = [...new Set(d.docs.map(x => x.category))];
  setView(`<div class="row between"><h1 style="margin:0">База данных</h1>${can('admin') ? '<a class="btn gold" href="#/doc-edit/new">+ Статья</a>' : ''}</div>
    <p class="mut small">Документация ГУ ВП: инструкции, порядок работы, правила. ${can('admin') ? 'Вы можете добавлять и править статьи.' : 'Статьи добавляют администраторы.'}</p>
    <form class="row" id="dq" style="margin-bottom:14px"><input name="q" value="${esc(q)}" placeholder="Поиск по статьям" style="max-width:420px"><button class="btn">Найти</button>${q ? '<a class="btn" href="#/docs">Сбросить</a>' : ''}</form>
    ${cats.length ? cats.map(c => `<div class="doccat"><h2>${esc(c)}</h2><div class="docgrid">${d.docs.filter(x => x.category === c).map(x => `<a class="doccard" href="#/doc/${x.id}"><b>${esc(x.title)}</b>
      <span class="small mut">${esc(x.snippet.replace(/[#*`>\[\]]/g, '').replace(/\s+/g, ' ').slice(0, 160))}${x.len > 160 ? '…' : ''}</span><span class="small mut">обновлено ${fmtDate(x.updated_at)}</span></a>`).join('')}</div></div>`).join('')
      : `<div class="alert info">${q ? 'Ничего не найдено.' : 'Статей пока нет.'}</div>`}`);
  $('#dq').onsubmit = (ev) => { ev.preventDefault(); const v = ev.target.q.value.trim(); location.hash = v ? '#/docs?q=' + encodeURIComponent(v) : '#/docs'; };
}
route('/doc/:id', async (id) => {
  const { doc } = await api('GET', '/api/docs/' + encodeURIComponent(id));
  setView(`<p><a href="#/docs">← База данных</a></p>
    <article class="card doc"><div class="small mut">${esc(doc.category)}</div><h1>${esc(doc.title)}</h1><div class="md">${md(doc.body)}</div>
      <p class="small mut" style="margin-top:18px">Обновлено ${fmtDate(doc.updated_at)}${doc.author ? ' · ' + esc(doc.author) : ''}</p>
      ${can('admin') ? `<div class="row"><a class="btn" href="#/doc-edit/${doc.id}">Изменить</a><button class="btn danger sm" id="delDoc">Удалить</button></div>` : ''}</article>`);
  const del = $('#delDoc'); if (del) del.onclick = async () => { if (!confirm(`Удалить статью «${doc.title}»?`)) return; try { await api('DELETE', '/api/docs/' + doc.id); toast('Статья удалена'); location.hash = '#/docs'; } catch (e) { toast(e.message, true); } };
});
route('/doc-edit/:id', async (id) => {
  const isNew = id === 'new';
  const [cur, list] = await Promise.all([isNew ? null : api('GET', '/api/docs/' + encodeURIComponent(id)), api('GET', '/api/docs')]);
  const doc = cur ? cur.doc : { category: hashQ().get('cat') || (list.categories[0] || 'Общее'), title: '', body: '', position: 0 };
  setView(`<p><a href="${isNew ? '#/docs' : '#/doc/' + doc.id}">← Назад</a></p><h1>${isNew ? 'Новая статья' : 'Изменить статью'}</h1>
    <form class="card" id="df"><div class="fgrid"><label class="f"><span>Раздел</span><input name="category" list="catList" maxlength="80" value="${esc(doc.category)}"></label>
      <label class="f"><span>Порядок в разделе</span><input name="position" type="number" min="0" value="${doc.position}"></label></div>
      <datalist id="catList">${list.categories.map(c => `<option>${esc(c)}</option>`).join('')}</datalist>
      <label class="f"><span>Заголовок *</span><input name="title" maxlength="200" value="${esc(doc.title)}"></label>
      <div class="grid two"><label class="f"><span>Текст. Разметка: # заголовок, ## подзаголовок, - список, 1. список, **жирный**, \`код\`, [текст](https://…)</span><textarea name="body" id="dbody" style="min-height:360px">${esc(doc.body)}</textarea></label>
        <div><div class="small mut" style="margin-bottom:4px">Предпросмотр</div><div class="md mdprev" id="dprev"></div></div></div>
      <button class="btn gold">Сохранить</button></form>`);
  const upd = () => { $('#dprev').innerHTML = md($('#dbody').value) || '<span class="mut small">Пусто</span>'; };
  upd(); $('#dbody').addEventListener('input', upd);
  $('#df').onsubmit = async (ev) => { ev.preventDefault(); const f = ev.target;
    try { const r = await api(isNew ? 'POST' : 'PUT', '/api/docs' + (isNew ? '' : '/' + doc.id), { category: f.category.value, title: f.title.value, body: f.body.value, position: f.position.value }); toast('Статья сохранена'); location.hash = '#/doc/' + r.doc.id; }
    catch (e) { toast(e.message, true); } };
}, { cap: 'admin' });

// ---------- личные дела ----------
route('/people', () => peoplePage());
route('/people\\?.*', () => peoplePage());
async function peoplePage() {
  const q = (hashQ().get('q') || '').toLowerCase();
  const { people } = await api('GET', '/api/people');
  const list = people.filter(p => !q || [p.name, p.rank, p.static_id, p.position, p.discord].some(x => String(x || '').toLowerCase().includes(q)));
  setView(`<h1>Личные дела</h1>
    <form class="row" id="pq" style="margin-bottom:14px"><input name="q" value="${esc(q)}" placeholder="Поиск: имя, звание, статик, должность" style="max-width:420px"><button class="btn">Найти</button></form>
    <p class="small mut">${list.length} ${plural(list.length, 'сотрудник', 'сотрудника', 'сотрудников')}. Данные — из профилей сотрудников.</p>
    <div class="people">${list.map(p => `<a class="pcard" href="#/person/${p.id}">${avatar(p)}<div><b>${esc(p.name)}</b>${p.has_ic ? '' : ' <span class="small mut">(профиль не заполнен)</span>'}
      <div class="small">${esc(p.rank || '—')}${p.static_id ? ' · статик ' + esc(p.static_id) : ''}</div><div class="small mut">${esc(p.position || '')}</div>
      <div class="chips">${p.roles.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</div></div></a>`).join('') || '<div class="alert info">Никого не найдено.</div>'}</div>`);
  $('#pq').onsubmit = (ev) => { ev.preventDefault(); const v = ev.target.q.value.trim(); location.hash = v ? '#/people?q=' + encodeURIComponent(v) : '#/people'; };
}
route('/person/:id', async (id) => {
  const d = await api('GET', '/api/people/' + encodeURIComponent(id));
  const p = d.person;
  setView(`<p><a href="#/people">← Личные дела</a></p>
    <div class="card pfile"><div class="row">${avatar(p, 'big')}<div style="flex:1"><h1 style="margin:0">${esc(p.name)}</h1>
      <div>${esc(p.rank || 'звание не указано')}${p.static_id ? ' · статик <b>' + esc(p.static_id) + '</b>' : ''}</div><div class="mut">${esc(p.position || 'должность не указана')}</div>
      <div class="chips">${p.roles.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</div></div>
      ${can('admin') ? `<a class="btn sm" href="#/admin/user/${p.id}">Изменить профиль</a>` : ''}</div>
      <div class="grid stats3"><div class="stat"><b>${d.reports.length}</b>${plural(d.reports.length, 'отчёт', 'отчёта', 'отчётов')}</div><div class="stat"><b>${d.thanks_total}</b>${plural(d.thanks_total, 'благодарность', 'благодарности', 'благодарностей')}</div>
        <div class="stat"><b class="${d.strikes ? 'neg' : ''}">${d.strikes}</b>${d.strikes ? 'нарушений · ' + esc(d.strike_label) : 'нарушений нет'}</div><div class="stat"><b>${d.exams.length}</b>сдано экзаменов</div></div></div>
    <div class="grid two">
      <div class="card flat"><h3>Отчёты</h3>${d.reports.length ? `<table><tr><th>Неделя</th><th>Статус</th><th>План</th><th>Баллы</th><th>Благ.</th></tr>${d.reports.map(r => `<tr><td>${weekLabel(r.week)}</td><td>${repBadge(r.status)}${r.late ? ' <span class="badge err">после срока</span>' : ''}</td>
        <td>${r.plan ? `<span class="badge ${PLAN_RU[r.plan][1]}">${PLAN_RU[r.plan][0]}</span>` : '—'}</td><td class="num">${r.points}</td><td class="num">${r.thanks || ''}</td></tr>`).join('')}</table>` : '<p class="mut">Отчётов нет.</p>'}</div>
      <div><div class="card flat"><h3>Взыскания</h3>${d.violations.length ? `<table>${d.violations.map(v => `<tr><td>${weekLabel(v.week)}</td><td>${v.kind === 'late' ? 'отчёт после срока' : 'отчёт не сдан'}</td><td><span class="badge ${v.measure === 'увольнение' ? 'err' : 'warn'}">${esc(v.measure)}</span></td></tr>`).join('')}</table>` : '<p class="mut">Взысканий нет.</p>'}</div>
        <div class="card flat"><h3>Экзамены и аттестации</h3>${d.exams.length ? `<table>${d.exams.map(x => `<tr><td>${esc(x.title)}</td><td>${fmtDate(x.at)}</td><td class="num">${x.score_pct != null ? x.score_pct + '%' : ''}</td></tr>`).join('')}</table>` : '<p class="mut">Пока нет.</p>'}</div></div></div>`);
});

// ---------- профиль ----------
route('/profile', async () => {
  const u = App.me;
  const { attempts } = await api('GET', '/api/my/attempts');
  setView(`<h1>Профиль</h1>
    <div class="card"><div class="row">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" style="width:64px;height:64px;border-radius:50%;border:2px solid var(--gold)">` : ''}
      <div><div><b>${esc(u.global_name || u.username)}</b> <span class="mut">@${esc(u.username)}</span></div><div class="small mut">Discord ID: ${esc(u.id)} · ${esc(rolesText(u))}${u.super ? ' (главный администратор)' : ''}</div></div></div>
      <p class="small mut" style="margin-top:12px">Эти данные подставляются в еженедельный отчёт и документы на сайте бланков и видны в «Личных делах». Администраторы могут их исправить — изменения записываются в журнал.</p>
      <form id="pf"><div class="fgrid">
        <label class="f"><span>Имя Фамилия (игровые)</span><input name="ic_name" maxlength="100" value="${esc(u.ic_name)}" placeholder="Шерман Ассман"></label>
        <label class="f"><span>Звание</span><input name="rank" maxlength="60" list="rankList" value="${esc(u.rank)}" placeholder="Лейтенант"></label>
        <label class="f"><span>Статик (номер удостоверения)</span><input name="static_id" maxlength="30" value="${esc(u.static_id)}" placeholder="123-456"></label>
        <label class="f"><span>Должность (по желанию)</span><input name="position" maxlength="80" list="posList" value="${esc(u.position)}" placeholder="Инспектор ВП"></label></div>
        <datalist id="rankList">${RANKS.map(r => `<option>${r}</option>`).join('')}</datalist><datalist id="posList">${POSITIONS.map(r => `<option>${r}</option>`).join('')}</datalist>
        <button class="btn gold">Сохранить</button></form></div>
    ${can('vp') || can('reatt') ? `<div class="card flat"><h3>Мои попытки</h3>${attempts.length ? `<table><tr><th>№</th><th>Экзамен</th><th>Дата</th><th>Статус</th><th>Результат</th></tr>${attempts.map(a => `<tr class="click" data-href="#/attempt/${a.id}"><td>#${a.id}</td><td>${esc(a.title)}</td><td>${fmtDate(a.submitted_at || a.started_at)}</td><td>${badge(a.status)}</td><td>${a.score_pct != null ? a.score_pct + '%' : '—'}</td></tr>`).join('')}</table>` : '<p class="mut">Попыток пока нет.</p>'}</div>` : ''}`);
  $$('tr.click').forEach(tr => tr.onclick = () => { location.hash = tr.dataset.href; });
  $('#pf').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    try { App.me = (await api('PUT', '/api/me', Object.fromEntries(f))).user; renderHeader(); toast('Профиль сохранён'); }
    catch (e) { toast(e.message, true); }
  };
});
