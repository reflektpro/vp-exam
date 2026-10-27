/* Личные дела (досье сотрудников ГУ ВП). Только старший состав (cap «ss»); проверка — на сервере (worker: requireSS, personFile / dz*). */
'use strict';
const DZ_TABS = [['main', 'Общее'], ['timeline', 'Хронология'], ['cars', 'Транспорт'], ['reports', 'Отчёты'], ['discipline', 'Взыскания и поощрения'], ['service', 'Служба'], ['study', 'Обучение'], ['log', 'Журнал']];
const DZ_EV = { penalty: ['Взыскание', 'err', '⚠'], reward: ['Поощрение', 'ok', '★'], promotion: ['Повышение', 'ok', '▲'], demotion: ['Понижение', 'err', '▼'], transfer: ['Перевод', 'info', '⇄'], note: ['Заметка', '', '✎'],
  archive: ['Архив', 'err', '🗄'], restore: ['Из архива', 'ok', '↩'] };
const DZ_TL = { report: ['📄', 'Отчёт'], violation: ['⚠', 'Нарушение'], exam: ['🎯', 'Экзамен'], reatt: ['📝', 'Переаттестация'], lecture: ['📖', 'Лекция'], dossier: ['🗂', 'Дело'] };
const LAW_RU = { 1: 'очень слабо', 2: 'слабо', 3: 'удовлетворительно', 4: 'хорошо', 5: 'отлично' };
const dDay = (s) => s ? s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4) : '—';
const msDay = (ms) => ms ? new Date(ms).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '—';
const todayMsk = () => new Date(Date.now() + 3 * 3600000).toISOString().slice(0, 10);
const extLink = (u, t) => u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(t || 'доказательство')}</a>` : '';
const dzBadge = (k) => { const x = DZ_EV[k] || [k, '']; return `<span class="badge ${x[1]}">${esc(x[0])}</span>`; };
const stars = (n) => n ? '★'.repeat(n) + '☆'.repeat(5 - n) : '—';

// ---------- список ----------
route('/people', () => peoplePage(), { cap: 'ss' });
route('/people\\?.*', () => peoplePage(), { cap: 'ss' });
async function peoplePage() {
  const Q = hashQ(); const q = (Q.get('q') || '').toLowerCase(), pos = Q.get('pos') || '', pen = Q.get('pen') === '1', st = Q.get('st') || 'active';
  const d = await api('GET', '/api/people');
  const list = d.people.filter(p => (st === 'all' || (st === 'archived') === p.archived) && (!pos || p.position === pos) && (!pen || p.pen_active || p.strikes)
    && (!q || [p.name, p.rank, p.static_id, p.position, p.discord, p.car].some(x => String(x || '').toLowerCase().includes(q))));
  const nArch = d.people.filter(p => p.archived).length;
  setView(`<div class="row" style="justify-content:space-between;align-items:center"><h1 style="margin:0">Личные дела</h1>
      ${d.can_edit ? '<button class="btn gold" id="newdz">+ Завести дело</button>' : ''}</div>
    <p class="small mut">Досье сотрудников ГУ ВП. Раздел виден только старшему составу.</p>
    <div id="cands" hidden></div>
    <form class="card flat dzfilter" id="pf">
      <input name="q" value="${esc(q)}" placeholder="Поиск: имя, статик, звание, номер авто">
      <select name="pos"><option value="">Все должности</option>${d.positions.map(p => `<option ${p === pos ? 'selected' : ''}>${esc(p)}</option>`).join('')}</select>
      <select name="st"><option value="active" ${st === 'active' ? 'selected' : ''}>Действующие</option><option value="archived" ${st === 'archived' ? 'selected' : ''}>Архив (${nArch})</option><option value="all" ${st === 'all' ? 'selected' : ''}>Все</option></select>
      <label class="chk"><input type="checkbox" name="pen" value="1" ${pen ? 'checked' : ''}> есть активные взыскания</label>
      <button class="btn">Показать</button></form>
    <p class="small mut">${list.length} ${plural(list.length, 'дело', 'дела', 'дел')}</p>
    <div class="people">${list.map(p => `<a class="pcard${p.archived ? ' arch' : ''}" href="#/person/${p.id}">${avatar(p)}<div>
      <b>${esc(p.name)}</b>${p.archived ? ' <span class="badge err">архив</span>' : ''}
      <div class="small">${esc(p.rank || '—')}${p.static_id ? ' · статик ' + esc(p.static_id) : ''}</div><div class="small mut">${esc(p.position || 'должность не указана')}</div>
      <div class="chips">${p.pen_active ? `<span class="chip neg">⚠ ${p.pen_active} ${plural(p.pen_active, 'взыскание', 'взыскания', 'взысканий')}</span>` : ''}${p.strikes ? `<span class="chip neg">отчёты: ${p.strikes} ${plural(p.strikes, 'нарушение', 'нарушения', 'нарушений')}</span>` : ''}
        ${p.rewards ? `<span class="chip">★ ${p.rewards}</span>` : ''}${p.car ? `<span class="chip">🚓 ${esc(p.car)}</span>` : ''}</div></div></a>`).join('') || '<div class="alert info">Никого не найдено.</div>'}</div>`);
  $('#pf').onsubmit = (ev) => { ev.preventDefault(); const f = new FormData(ev.target); const u = new URLSearchParams();
    for (const k of ['q', 'pos', 'st', 'pen']) { const v = String(f.get(k) || '').trim(); if (v && !(k === 'st' && v === 'active')) u.set(k, v); }
    location.hash = '#/people' + (u.toString() ? '?' + u : ''); };
  if (d.can_edit) $('#newdz').onclick = () => {
    const box = $('#cands'); box.hidden = !box.hidden; if (box.hidden) return;
    box.innerHTML = `<div class="card"><h3>Завести личное дело</h3><p class="small mut">Дело заводится на сотрудника ГУ ВП — пользователя с ролью «ВП» или в составе ГУ ВП. Роль выдаёт администратор.</p>
      <input id="cq" placeholder="Поиск по имени / Discord" style="margin-bottom:8px"><div class="clist2">${d.candidates.map(c => `<div class="crow" data-s="${esc((c.name + ' ' + c.discord + ' ' + c.static_id).toLowerCase())}">${avatar(c)}<div style="flex:1;min-width:0"><b>${esc(c.name)}</b> <span class="small mut">@${esc(c.discord)}</span>
        <div class="small mut">${esc(c.roles.join(', ') || 'без ролей')}</div></div>${c.eligible ? `<button class="btn sm gold" data-id="${c.id}">Завести</button>` : '<span class="small mut">нет роли «ВП»</span>'}</div>`).join('') || '<p class="mut">Все сотрудники уже с делами.</p>'}</div></div>`;
    $('#cq').oninput = (e) => { const v = e.target.value.toLowerCase(); $$('.crow', box).forEach(r => { r.hidden = v && !r.dataset.s.includes(v); }); };
    $$('button[data-id]', box).forEach(b => b.onclick = async () => { try { await api('POST', '/api/people/' + b.dataset.id, {}); toast('Личное дело заведено'); location.hash = '#/person/' + b.dataset.id + '/edit'; } catch (e) { toast(e.message, true); } });
  };
}

// ---------- карточка ----------
route('/person/:id', (id) => personPage(id), { cap: 'ss' });
route('/person/:id\\?.*', (id) => personPage(id), { cap: 'ss' });
async function personPage(id) {
  const tab = hashQ().get('tab') || 'main';
  const d = await api('GET', '/api/people/' + encodeURIComponent(id));
  const p = d.person, z = d.dossier;
  const la = d.law_auto.all;
  const tabs = DZ_TABS.filter(t => t[0] !== 'log' || d.show_private);
  const body = { main: dzMain, timeline: dzTimeline, cars: dzCars, reports: dzReports, discipline: dzDiscipline, service: dzService, study: dzStudy, log: dzLog }[tab] || dzMain;
  setView(`<p><a href="#/people">← Личные дела</a></p>
    <div class="card pfile dzhead"><div class="row">${avatar(p, 'big')}<div style="flex:1;min-width:0"><h1 style="margin:0">${esc(p.name)}</h1>
      <div>${esc(p.rank || 'звание не указано')}${p.static_id ? ' · статик <b>' + esc(p.static_id) + '</b>' : ''}</div><div class="mut">${esc(p.position || 'должность не указана')}</div>
      <div class="chips">${z && z.status === 'archived' ? '<span class="chip neg">🗄 В архиве</span>' : ''}${d.blocked ? '<span class="chip neg">заблокирован</span>' : ''}${p.roles.map(r => `<span class="chip">${esc(r)}</span>`).join('')}</div></div></div>
      ${d.can_edit && z ? `<div class="row dzact"><a class="btn sm gold" href="#/person/${p.id}/edit">✎ Редактировать</a><a class="btn sm" href="#/person/${p.id}/event">+ Запись в историю</a>
        ${z.status === 'archived' ? '<button class="btn sm" id="unarch">Вернуть из архива</button>' : '<button class="btn sm danger" id="arch">В архив (увольнение)</button>'}</div>` : ''}
      ${d.can_ss && d.self && !d.can_edit ? '<p class="small mut">Своё дело правит другой сотрудник старшего состава.</p>' : ''}
      ${!z ? `<div class="alert info" style="margin-top:10px">Личное дело не заведено — ниже только данные с сайта.${d.can_edit && d.eligible ? ' <button class="btn sm gold" id="mkdz">Завести дело</button>' : ''}</div>` : ''}
      ${z && z.status === 'archived' ? `<div class="alert err" style="margin-top:10px">Дело в архиве с ${msDay(z.archived_at)}${z.archive_reason ? ': ' + esc(z.archive_reason) : ''}.</div>` : ''}
      <div class="grid stats4">
        <div class="stat"><b class="${d.penalties_active ? 'neg' : ''}">${d.penalties_active}</b>${plural(d.penalties_active, 'активное взыскание', 'активных взыскания', 'активных взысканий')}<div class="small mut">+ по отчётам: ${d.strikes ? d.strikes + ' (' + esc(d.strike_label) + ')' : 'нет'}</div></div>
        <div class="stat"><b>${d.rewards_total}</b>${plural(d.rewards_total, 'поощрение', 'поощрения', 'поощрений')}<div class="small mut">благодарностей в отчётах: ${d.thanks_total}</div></div>
        <div class="stat"><b>${d.reports.length}</b>${plural(d.reports.length, 'отчёт', 'отчёта', 'отчётов')}<div class="small mut">в срок: ${d.reports.filter(r => !r.late).length}</div></div>
        <div class="stat"><b>${la ? la.avg + '%' : '—'}</b>знание законов (тесты)<div class="small mut">${la ? 'лучший ' + la.best + '% · попыток ' + la.n : 'попыток нет'}${z && z.law_score ? ' · оценка СС ' + z.law_score + '/5' : ''}</div></div></div></div>
    <nav class="subnav dztabs">${tabs.map(t => `<a href="#/person/${p.id}?tab=${t[0]}" class="${t[0] === tab ? 'on' : ''}">${t[1]}</a>`).join('')}</nav>
    <div id="dzbody">${body(d)}</div>`);
  const arch = $('#arch'); if (arch) arch.onclick = async () => { const r = prompt('Перевести дело в архив (увольнение). Причина / основание:', ''); if (!r) return; try { await api('POST', `/api/people/${p.id}/archive`, { reason: r }); toast('Дело переведено в архив'); render(); } catch (e) { toast(e.message, true); } };
  const un = $('#unarch'); if (un) un.onclick = async () => { const r = prompt('Вернуть дело из архива. Основание (необязательно):', ''); if (r === null) return; try { await api('POST', `/api/people/${p.id}/restore`, { reason: r }); toast('Дело возвращено из архива'); render(); } catch (e) { toast(e.message, true); } };
  const mk = $('#mkdz'); if (mk) mk.onclick = async () => { try { await api('POST', '/api/people/' + p.id, {}); location.hash = '#/person/' + p.id + '/edit'; } catch (e) { toast(e.message, true); } };
  $$('[data-lift]').forEach(b => b.onclick = async () => { const r = prompt('Основание снятия взыскания:', ''); if (!r) return; try { await api('POST', `/api/people/${p.id}/events/${b.dataset.lift}/lift`, { reason: r }); toast('Взыскание снято'); render(); } catch (e) { toast(e.message, true); } });
  $$('[data-unlift]').forEach(b => b.onclick = async () => { if (!confirm('Вернуть взыскание в действующие?')) return; try { await api('POST', `/api/people/${p.id}/events/${b.dataset.unlift}/unlift`); render(); } catch (e) { toast(e.message, true); } });
  $$('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Удалить ошибочную запись? Удаление попадёт в журнал.')) return; try { await api('DELETE', `/api/people/${p.id}/events/${b.dataset.del}`); toast('Запись удалена'); render(); } catch (e) { toast(e.message, true); } });
}
function kv(rows) { return `<dl class="dzkv">${rows.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`; }
function lockNote() { return ''; }
function dzMain(d) {
  const z = d.dossier || {}; const p = d.person; const priv = d.show_private;
  const main = (z.service_cars || []).find(c => c.main) || (z.service_cars || [])[0];
  return `<div class="grid two">
    <div class="card flat"><h3>Основное</h3>${kv([['Имя Фамилия', esc(p.name)], ['Статик', esc(p.static_id || '—')], ['Звание', esc(p.rank || '—')], ['Должность', esc(p.position || '—')],
      ['В ГУ ВП с', z.joined_on ? dDay(z.joined_on) : '—'], ['Discord', esc(z.discord || p.discord || '—')],
      priv && ['Возраст (ИРЛ)', z.age ? z.age + ' ' + plural(z.age, 'год', 'года', 'лет') : '—'], priv && ['Часовой пояс', esc(z.timezone || '—')],
      ['Средний онлайн', z.online_hours != null ? String(z.online_hours).replace('.', ',') + ' ч/день' : '—'], ['Обычно в игре', esc(z.online_time || '—')],
      ['Основной служебный автомобиль', main ? esc(main.model) + ' · <b class="plate">' + esc(main.plate) + '</b>' : '—']])}${lockNote(d)}</div>
    <div class="card flat"><h3>Знание законодательства</h3>
      ${kv([['По тестам (все)', d.law_auto.all ? `средний <b>${d.law_auto.all.avg}%</b>, лучший ${d.law_auto.all.best}%` : 'попыток нет'],
        ['Экзамены', d.law_auto.exams ? `${d.law_auto.exams.avg}% / лучший ${d.law_auto.exams.best}% · сдано ${d.law_auto.exams.passed} из ${d.law_auto.exams.n}` : '—'],
        ['Переаттестации', d.law_auto.reatt ? `${d.law_auto.reatt.avg}% / лучший ${d.law_auto.reatt.best}% · сдано ${d.law_auto.reatt.passed} из ${d.law_auto.reatt.n}` : '—'],
        priv && ['Оценка старшего состава', z.law_score ? `<span class="stars">${stars(z.law_score)}</span> ${z.law_score}/5 — ${LAW_RU[z.law_score]}` : 'не выставлена'],
        priv && z.law_comment && ['Комментарий', esc(z.law_comment)]])}</div></div>
    ${priv ? `<div class="card flat"><h3>Характеристика / заметки старшего состава</h3>${z.notes ? `<div class="md">${md(z.notes)}</div>` : '<p class="mut">Пока нет.</p>'}</div>` : ''}
    <div class="card flat"><h3>Последние события</h3>${tlList(d.timeline.slice(0, 8))}<a class="btn sm" href="#/person/${p.id}?tab=timeline">Вся хронология →</a></div>
    ${d.dossier ? `<p class="small mut">Дело заведено ${msDay(z.created_at)}${z.created_by ? ' (' + esc(z.created_by) + ')' : ''} · изменено ${fmtDate(z.updated_at)}${z.updated_by ? ' — ' + esc(z.updated_by) : ''}</p>` : ''}`;
}
function tlList(items) {
  if (!items.length) return '<p class="mut">Событий пока нет.</p>';
  return `<ol class="tl">${items.map(t => { const ic = DZ_EV[t.type] ? DZ_EV[t.type][2] : (DZ_TL[t.type] || ['•'])[0]; const cls = DZ_EV[t.type] ? DZ_EV[t.type][1] : t.type === 'violation' ? 'err' : '';
    return `<li class="tl-${esc(t.type)} ${cls}"><span class="tl-ic">${ic}</span><div><div class="small mut">${t.date ? dDay(t.date) : fmtDate(t.at)} · ${esc(DZ_EV[t.type] ? DZ_EV[t.type][0] : (DZ_TL[t.type] || ['', t.type])[1])}</div>
      <b>${esc(t.title)}</b>${t.status ? ' ' + repBadge(t.status) : ''}${t.text ? `<div class="small">${esc(t.text)}</div>` : ''}${t.by ? `<div class="small mut">${esc(t.by)}</div>` : ''}${t.link ? '<div class="small">' + extLink(t.link) + '</div>' : ''}</div></li>`; }).join('')}</ol>`;
}
function dzTimeline(d) {
  const kinds = [['', 'Все'], ['dz', 'Записи СС'], ['report', 'Отчёты'], ['violation', 'Нарушения'], ['exam', 'Экзамены'], ['lecture', 'Лекции']];
  const f = hashQ().get('f') || '';
  const items = d.timeline.filter(t => !f || (f === 'dz' ? !!DZ_EV[t.type] : f === 'exam' ? (t.type === 'exam' || t.type === 'reatt') : t.type === f));
  return `<div class="card flat"><div class="chips">${kinds.map(k => `<a class="chip${k[0] === f ? ' on' : ''}" href="#/person/${d.person.id}?tab=timeline${k[0] ? '&f=' + k[0] : ''}">${k[1]}</a>`).join('')}</div>${tlList(items)}</div>`;
}
function dzCars(d) {
  const z = d.dossier || {};
  const tbl = (l, car) => l.length ? `<div class="dzrows">${l.map(c => `<div class="dzrow"><span>${car ? '🚓' : '🚗'}</span><div style="flex:1"><b>${esc(c.model || '—')}</b></div><b class="plate">${esc(c.plate)}</b>${car ? (c.main ? '<span class="badge ok">основной</span>' : '<span class="badge">доп.</span>') : ''}</div>`).join('')}</div>` : '<p class="mut">Не указаны.</p>';
  return `<div class="grid two"><div class="card flat"><h3>Служебные автомобили ВП</h3>${tbl(z.service_cars || [], true)}</div><div class="card flat"><h3>Личные транспортные средства</h3>${tbl(z.vehicles || [], false)}</div></div>`;
}
function dzReports(d) {
  const r = d.reports;
  const head = `<p class="small mut">Еженедельные отчёты с сайта (неделя пн–вс). План и премия — по проверенным отчётам; премия видна, когда руководство проверит все отчёты недели.</p>`;
  return `<div class="card flat"><h3>Еженедельные отчёты</h3>${head}${r.length ? `<div class="tscroll"><table class="dzt"><tr><th>Неделя</th><th>Отправлен</th><th>Срок</th><th>План</th><th>Баллы</th>${d.show_money ? '<th>Премия</th>' : ''}<th>Статус</th></tr>
    ${r.map(x => `<tr><td data-l="Неделя">${weekLabel(x.week)}</td><td data-l="Отправлен">${fmtDate(x.submitted_at)}</td><td data-l="Срок">${x.late ? '<span class="badge err">поздно</span>' : '<span class="badge ok">в срок</span>'}</td>
      <td data-l="План">${x.plan ? `<span class="badge ${PLAN_RU[x.plan][1]}">${PLAN_RU[x.plan][0]}</span>${x.plan_final ? '' : ' <span class="small mut">до проверки</span>'}` : '—'}</td><td data-l="Баллы" class="num">${x.points}${x.thanks ? ` <span class="small mut">(благ. ${x.thanks})</span>` : ''}</td>
      ${d.show_money ? `<td data-l="Премия" class="num">${x.premium ? x.premium.pending ? '<span class="small mut">ждёт проверки недели</span>' : RUB(x.premium.total) + (x.premium.award_budget ? `<div class="small mut">+ ${RUB(x.premium.award_budget)} из бюджета</div>` : '') + (x.premium.reason ? `<div class="small mut">${esc(x.premium.reason)}</div>` : '') : '—'}</td>` : ''}
      <td data-l="Статус">${repBadge(x.status)}</td></tr>`).join('')}</table></div>` : '<p class="mut">Отчётов нет.</p>'}</div>
    <div class="card flat"><h3>Нарушения по отчётам (автоматически)</h3>${dzViol(d)}</div>`;
}
function dzViol(d) {
  if (!d.staff) return '<p class="mut">Учёт нарушений по отчётам ведётся для сотрудников состава ГУ ВП (раздел «Отчёты и премии» → «Состав»).</p>';
  return d.violations.length ? `<div class="dzrows">${d.violations.map(v => `<div class="dzrow"><div style="flex:1">${weekLabel(v.week)} — ${v.kind === 'late' ? 'отчёт после срока' : 'отчёт не сдан'}${v.excused && v.note ? `<div class="small mut">снято: ${esc(v.note)}</div>` : ''}</div>
    <span class="badge ${v.excused ? '' : v.measure === 'увольнение' ? 'err' : 'warn'}">${esc(v.measure)}</span></div>`).join('')}</div>` : '<p class="mut">Нарушений нет.</p>';
}
function evRow(d, e) {
  const ed = d.can_edit && d.dossier && !['archive', 'restore'].includes(e.kind);
  return `<div class="ev ev-${e.kind}${e.kind === 'penalty' && !e.active ? ' lifted' : ''}"><div class="ev-h">${dzBadge(e.kind)} <b>${esc(e.subtype || '')}</b> <span class="mut small">${dDay(e.on_date)}</span>
      ${e.kind === 'penalty' ? (e.active ? '<span class="badge err">действует</span>' : '<span class="badge">снято</span>') : ''}</div>
    ${e.from_rank || e.to_rank ? `<div class="small">Звание: ${esc(e.from_rank || '—')} → <b>${esc(e.to_rank || e.from_rank || '—')}</b></div>` : ''}
    ${e.from_position || e.to_position ? `<div class="small">Должность: ${esc(e.from_position || '—')} → <b>${esc(e.to_position || e.from_position || '—')}</b></div>` : ''}
    ${e.reason ? `<div>${esc(e.reason)}</div>` : ''}<div class="small mut">${e.issued_by ? 'Кем: ' + esc(e.issued_by) : ''}${e.evidence ? ' · ' + extLink(e.evidence) : ''}</div>
    ${e.lifted_at ? `<div class="small ok-t">Снято ${msDay(e.lifted_at)}${e.lifted_by ? ' — ' + esc(e.lifted_by) : ''}${e.lift_reason ? ': ' + esc(e.lift_reason) : ''}</div>` : ''}
    ${ed ? `<div class="row ev-act"><a class="btn sm" href="#/person/${d.person.id}/event/${e.id}">Изменить</a>${e.kind === 'penalty' ? (e.active ? `<button class="btn sm" data-lift="${e.id}">Снять</button>` : `<button class="btn sm" data-unlift="${e.id}">Вернуть</button>`) : ''}<button class="btn sm danger" data-del="${e.id}">Удалить</button></div>` : ''}</div>`;
}
function dzDiscipline(d) {
  const pen = d.events.filter(e => e.kind === 'penalty'), rew = d.events.filter(e => e.kind === 'reward');
  const add = (k, t) => d.can_edit && d.dossier ? `<a class="btn sm gold" href="#/person/${d.person.id}/event?kind=${k}">+ ${t}</a>` : '';
  return `<div class="grid two"><div><div class="card flat"><div class="row" style="justify-content:space-between"><h3>Взыскания</h3>${add('penalty', 'Взыскание')}</div>
      <p class="small mut">Активных: <b>${d.penalties_active}</b>. Нарушения по отчётам считаются отдельно (1 — предупреждение, 2 — выговор, 3 — увольнение) и показаны ниже.</p>
      ${pen.map(e => evRow(d, e)).join('') || '<p class="mut">Взысканий нет.</p>'}</div>
      <div class="card flat"><h3>Нарушения по отчётам (авто)</h3>${dzViol(d)}</div></div>
    <div class="card flat"><div class="row" style="justify-content:space-between"><h3>Поощрения</h3>${add('reward', 'Поощрение')}</div>${rew.map(e => evRow(d, e)).join('') || '<p class="mut">Поощрений нет.</p>'}
      <p class="small mut">Благодарностей в принятых отчётах: ${d.thanks_total}.</p></div></div>`;
}
function dzService(d) {
  const z = d.dossier || {};
  const sv = d.events.filter(e => ['promotion', 'demotion', 'transfer', 'archive', 'restore'].includes(e.kind)), notes = d.events.filter(e => e.kind === 'note');
  return `<div class="grid two"><div class="card flat"><div class="row" style="justify-content:space-between"><h3>Повышения, понижения, переводы</h3>${d.can_edit && d.dossier ? `<a class="btn sm gold" href="#/person/${d.person.id}/event?kind=promotion">+ Запись</a>` : ''}</div>
      ${kv([['В ГУ ВП с', z.joined_on ? dDay(z.joined_on) : '—'], ['На сайте с', msDay(d.since)], d.staff && ['В составе (учёт отчётов) с', d.staff_since ? weekLabel(d.staff_since) : '—']])}
      ${sv.map(e => evRow(d, e)).join('') || '<p class="mut">Записей нет.</p>'}</div>
    <div class="card flat"><div class="row" style="justify-content:space-between"><h3>Заметки</h3>${d.can_edit && d.dossier ? `<a class="btn sm gold" href="#/person/${d.person.id}/event?kind=note">+ Заметка</a>` : ''}</div>${notes.map(e => evRow(d, e)).join('') || '<p class="mut">Заметок нет.</p>'}</div></div>`;
}
function dzStudy(d) {
  return `<div class="grid two"><div class="card flat"><h3>Курсы</h3>${d.courses.length ? `<div class="dzrows">${d.courses.map(c => `<div class="dzrow"><div style="flex:1"><b>${esc(c.title)}</b><div class="small mut">лекций ${c.done}/${c.lectures} · экзаменов сдано ${c.exams_passed}/${c.exams}</div>
      <div class="bar"><i style="width:${c.lectures + c.exams ? Math.round((c.done + c.exams_passed) / (c.lectures + c.exams) * 100) : 0}%"></i></div></div>${c.complete ? '<span class="badge ok">пройден</span>' : ''}</div>`).join('')}</div>` : '<p class="mut">Курсов нет.</p>'}
      <p class="small mut">Пройдено лекций всего: ${d.lectures_done}.</p></div>
    <div class="card flat"><h3>Экзамены и переаттестации</h3>${d.attempts.length ? `<div class="tscroll"><table class="dzt"><tr><th>Дата</th><th>Тест</th><th>Результат</th><th></th></tr>${d.attempts.map(a => `<tr><td data-l="Дата">${fmtDate(a.at)}</td><td data-l="Тест">${esc(a.title)}${a.reatt ? ' <span class="small mut">(переаттестация)</span>' : ''}</td>
      <td data-l="Балл" class="num">${a.score_pct != null ? a.score_pct + '%' : '—'}</td><td>${badge(a.status)}</td></tr>`).join('')}</table></div>` : '<p class="mut">Попыток нет.</p>'}</div></div>`;
}
const LOG_RU = { 'profile.update': 'Профиль изменён', 'profile.self': 'Профиль изменён сотрудником', 'staff.update': 'Состав ГУ ВП', 'user.update': 'Роли / доступ', 'dossier.create': 'Дело заведено', 'dossier.update': 'Дело изменено',
  'dossier.archive': 'Дело в архив', 'dossier.restore': 'Дело из архива', 'dossier.event.add': 'Добавлена запись', 'dossier.event.update': 'Запись изменена', 'dossier.event.lift': 'Взыскание снято', 'dossier.event.unlift': 'Взыскание возвращено', 'dossier.event.delete': 'Запись удалена' };
const FIELD_RU = { ic_name: 'имя', rank: 'звание', static_id: 'статик', position: 'должность', joined_on: 'дата вступления', age: 'возраст', timezone: 'часовой пояс', online_hours: 'онлайн ч/день', online_time: 'время онлайна',
  discord: 'Discord', vehicles: 'личные ТС', service_cars: 'служебные авто', law_score: 'оценка знаний', law_comment: 'комментарий к оценке', notes: 'характеристика', staff: 'в составе', senior: 'старший состав', staff_position: 'должность (оклад)', staff_since: 'учёт с' };
function logDetails(x) {
  const dd = x.details || {};
  if (x.action.startsWith('dossier.event')) return esc([dd.kind && (DZ_EV[dd.kind] || [dd.kind])[0], dd.subtype, dd.on_date && dDay(dd.on_date), dd.reason].filter(Boolean).join(' · ') || ('запись #' + (dd.event || '')));
  if (x.action === 'dossier.create') return '';
  if (x.action === 'dossier.archive' || x.action === 'dossier.restore') return esc(dd.reason || '');
  return Object.entries(dd).filter(([k]) => k !== 'via').map(([k, v]) => `${esc(FIELD_RU[k] || k)}${Array.isArray(v) ? ': ' + esc(v[0] === '' || v[0] == null ? '—' : v[0]) + ' → ' + esc(v[1] === '' || v[1] == null ? '—' : v[1]) : v === true ? ' (изменено)' : ': ' + esc(typeof v === 'object' ? JSON.stringify(v) : v)}`).join('; ') + (dd.via ? ` <span class="mut">(${esc(dd.via)})</span>` : '');
}
function dzLog(d) {
  return `<div class="card flat"><h3>Журнал изменений</h3><p class="small mut">Все правки профиля и личного дела с автором. Виден только старшему составу.</p>
    ${d.log.length ? `<div class="dzrows">${d.log.map(x => `<div class="dzrow"><div style="flex:1"><b>${esc(LOG_RU[x.action] || x.action)}</b> <span class="small mut">${fmtDate(x.at)} · ${esc(x.self ? 'сам сотрудник' : x.by)}</span><div class="small">${logDetails(x)}</div></div></div>`).join('')}</div>` : '<p class="mut">Изменений нет.</p>'}</div>`;
}

// ---------- редактирование (старший состав) ----------
route('/person/:id/edit', async (id) => {
  const d = await api('GET', '/api/people/' + encodeURIComponent(id));
  if (!d.can_edit) { setView(`<div class="alert err">Личное дело заполняет только старший состав ГУ ВП${d.self ? ' (своё дело — другой сотрудник СС)' : ''}.</div><a class="btn" href="#/person/${esc(id)}">Назад</a>`); return; }
  if (!d.dossier) { location.hash = '#/person/' + id; return; }
  const p = d.person, z = d.dossier;
  const vrow = (c, car) => `<div class="vrow"><input name="model" placeholder="${car ? 'Модель (напр. УАЗ Патриот)' : 'Модель'}" maxlength="60" value="${esc(c.model || '')}"><input name="plate" placeholder="Номер" maxlength="20" value="${esc(c.plate || '')}" class="plate-in">
    ${car ? `<label class="chk"><input type="checkbox" name="main" ${c.main ? 'checked' : ''}> основной</label>` : ''}<button type="button" class="btn sm danger vdel" title="Убрать">✕</button></div>`;
  setView(`<p><a href="#/person/${p.id}">← ${esc(p.name)}</a></p><h1>Личное дело: редактирование</h1>
    <form id="dzf" class="dzform">
      <fieldset class="card"><legend>Основное</legend><div class="fgrid">
        <label class="f"><span>Имя Фамилия</span><input name="ic_name" maxlength="100" value="${esc(p.has_ic ? p.name : '')}"></label>
        <label class="f"><span>Статик</span><input name="static_id" maxlength="30" value="${esc(p.static_id)}"></label>
        <label class="f"><span>Звание</span><input name="rank" maxlength="60" list="rankList" value="${esc(p.rank)}"></label>
        <label class="f"><span>Должность</span><input name="position" maxlength="80" list="posList" value="${esc(p.position)}"></label>
        <label class="f"><span>Дата вступления в ГУ ВП</span><input type="date" name="joined_on" value="${esc(z.joined_on || '')}"></label>
        <label class="f"><span>Discord</span><input name="discord" maxlength="60" value="${esc(z.discord || '')}"></label></div>
        <p class="small mut">Имя, статик, звание и должность — это поля профиля: они обновятся в профиле и в отчётах (с записью в журнал).</p></fieldset>
      <fieldset class="card"><legend>Онлайн и личное</legend><div class="fgrid">
        <label class="f"><span>Возраст (ИРЛ)</span><input type="number" name="age" min="14" max="99" value="${z.age ?? ''}"></label>
        <label class="f"><span>Часовой пояс</span><input name="timezone" maxlength="40" list="tzList" value="${esc(z.timezone || '')}" placeholder="МСК, МСК+2, UTC+5…"></label>
        <label class="f"><span>Средний онлайн, часов в день</span><input type="number" name="online_hours" min="0" max="24" step="0.5" value="${z.online_hours ?? ''}"></label>
        <label class="f"><span>Обычное время в игре</span><input name="online_time" maxlength="80" value="${esc(z.online_time || '')}" placeholder="18:00–23:00 МСК, выходные днём"></label></div>
        <datalist id="tzList">${['МСК−1 (Калининград)', 'МСК', 'МСК+1 (Самара)', 'МСК+2 (Екатеринбург)', 'МСК+3 (Омск)', 'МСК+4 (Новосибирск)', 'МСК+5 (Иркутск)', 'МСК+6 (Якутск)', 'МСК+7 (Владивосток)', 'МСК+9 (Камчатка)'].map(x => `<option>${x}</option>`).join('')}</datalist></fieldset>
      <fieldset class="card"><legend>Служебные автомобили ВП, закреплённые за сотрудником</legend><div id="scars">${(z.service_cars.length ? z.service_cars : []).map(c => vrow(c, true)).join('')}</div><button type="button" class="btn sm" id="addcar">+ Автомобиль</button></fieldset>
      <fieldset class="card"><legend>Личные транспортные средства</legend><div id="pcars">${z.vehicles.map(c => vrow(c, false)).join('')}</div><button type="button" class="btn sm" id="addveh">+ ТС</button></fieldset>
      <fieldset class="card"><legend>Оценка знания законодательства</legend>
        <div class="lawpick">${[1, 2, 3, 4, 5].map(n => `<label class="lp"><input type="radio" name="law_score" value="${n}" ${z.law_score === n ? 'checked' : ''}><span>${n}</span><small>${LAW_RU[n]}</small></label>`).join('')}<label class="lp"><input type="radio" name="law_score" value="" ${!z.law_score ? 'checked' : ''}><span>—</span><small>нет</small></label></div>
        <p class="small mut">По тестам: ${d.law_auto.all ? `средний ${d.law_auto.all.avg}%, лучший ${d.law_auto.all.best}% (${d.law_auto.all.n} попыток)` : 'попыток нет'}.</p>
        <label class="f"><span>Комментарий к оценке</span><input name="law_comment" maxlength="1000" value="${esc(z.law_comment || '')}"></label></fieldset>
      <fieldset class="card"><legend>Характеристика / заметки старшего состава</legend>
        <textarea name="notes" rows="6" maxlength="5000" placeholder="Можно Markdown: **жирный**, списки">${esc(z.notes || '')}</textarea></fieldset>
      <datalist id="rankList">${RANKS.map(r => `<option>${r}</option>`).join('')}</datalist><datalist id="posList">${POSITIONS.map(r => `<option>${r}</option>`).join('')}</datalist>
      <div class="row stickybar"><button class="btn gold">Сохранить</button><a class="btn" href="#/person/${p.id}">Отмена</a></div></form>`);
  const bindDel = () => $$('.vdel').forEach(b => b.onclick = () => b.closest('.vrow').remove());
  $('#addcar').onclick = () => { $('#scars').insertAdjacentHTML('beforeend', vrow({ main: !$$('#scars .vrow').length }, true)); bindDel(); };
  $('#addveh').onclick = () => { $('#pcars').insertAdjacentHTML('beforeend', vrow({}, false)); bindDel(); };
  bindDel();
  const rows = (sel, car) => $$(sel + ' .vrow').map(r => ({ model: r.querySelector('[name=model]').value, plate: r.querySelector('[name=plate]').value, ...(car ? { main: r.querySelector('[name=main]').checked } : {}) })).filter(x => x.model.trim() || x.plate.trim());
  $('#dzf').onsubmit = async (ev) => {
    ev.preventDefault(); const f = ev.target;
    const b = {}; for (const k of ['ic_name', 'static_id', 'rank', 'position', 'joined_on', 'discord', 'age', 'timezone', 'online_hours', 'online_time', 'law_comment', 'notes']) b[k] = f[k].value;
    b.law_score = (f.querySelector('[name=law_score]:checked') || {}).value || ''; b.service_cars = rows('#scars', true); b.vehicles = rows('#pcars', false);
    try { await api('PUT', '/api/people/' + p.id, b); toast('Личное дело сохранено'); location.hash = '#/person/' + p.id; } catch (e) { toast(e.message, true); }
  };
}, { cap: 'ss' });

// ---------- запись в историю ----------
route('/person/:id/event', (id) => eventForm(id, null), { cap: 'ss' });
route('/person/:id/event\\?.*', (id) => eventForm(id, null), { cap: 'ss' });
route('/person/:id/event/:eid', (id, eid) => eventForm(id, eid), { cap: 'ss' });
async function eventForm(id, eid) {
  const d = await api('GET', '/api/people/' + encodeURIComponent(id));
  if (!d.can_edit || !d.dossier) { setView(`<div class="alert err">Записи в личное дело добавляет только старший состав ГУ ВП.</div><a class="btn" href="#/person/${esc(id)}">Назад</a>`); return; }
  const e = eid ? d.events.find(x => String(x.id) === String(eid)) : null;
  if (eid && !e) throw new Error('Запись не найдена');
  const p = d.person; let kind = e ? e.kind : (hashQ().get('kind') || 'penalty'); if (!d.lists.kinds[kind]) kind = 'penalty';
  const me = App.me ? userName(App.me) : '';
  setView(`<p><a href="#/person/${p.id}">← ${esc(p.name)}</a></p><h1>${e ? 'Изменить запись' : 'Новая запись в личное дело'}</h1>
    <form id="evf" class="card dzform">
      ${e ? `<p>${dzBadge(kind)}</p>` : `<div class="seg" id="kinds">${Object.entries(d.lists.kinds).map(([k, t]) => `<label><input type="radio" name="kind" value="${k}" ${k === kind ? 'checked' : ''}><span>${t}</span></label>`).join('')}</div>`}
      <div class="fgrid">
        <label class="f k-pen k-rew k-svc"><span>Вид</span><input name="subtype" maxlength="60" list="subList" value="${esc(e ? e.subtype : '')}"></label>
        <label class="f"><span>Дата</span><input type="date" name="on_date" required value="${esc(e ? e.on_date : todayMsk())}"></label>
        <label class="f k-pen k-rew k-svc"><span>Кем выдано</span><input name="issued_by" maxlength="100" value="${esc(e ? e.issued_by : me)}"></label>
        <label class="f"><span>Ссылка на доказательство</span><input type="url" name="evidence" maxlength="500" placeholder="https://…" value="${esc(e ? e.evidence : '')}"></label></div>
      <div class="fgrid k-svc">
        <label class="f"><span>Звание: с</span><input name="from_rank" list="rankList" maxlength="60" value="${esc(e ? e.from_rank || '' : p.rank)}"></label>
        <label class="f"><span>Звание: на</span><input name="to_rank" list="rankList" maxlength="60" value="${esc(e ? e.to_rank || '' : '')}"></label>
        <label class="f"><span>Должность: с</span><input name="from_position" list="posList" maxlength="80" value="${esc(e ? e.from_position || '' : p.position)}"></label>
        <label class="f"><span>Должность: на</span><input name="to_position" list="posList" maxlength="80" value="${esc(e ? e.to_position || '' : '')}"></label></div>
      ${e ? '' : '<p class="small k-svc"><label class="chk"><input type="checkbox" name="apply_profile" checked> обновить звание и должность в профиле сотрудника</label></p>'}
      <label class="f"><span id="rlbl">Причина / основание</span><textarea name="reason" rows="4" maxlength="2000">${esc(e ? e.reason : '')}</textarea></label>
      <datalist id="subList"></datalist><datalist id="rankList">${RANKS.map(r => `<option>${r}</option>`).join('')}</datalist><datalist id="posList">${POSITIONS.map(r => `<option>${r}</option>`).join('')}</datalist>
      <div class="row"><button class="btn gold">${e ? 'Сохранить' : 'Добавить'}</button><a class="btn" href="#/person/${p.id}?tab=${kind === 'penalty' || kind === 'reward' ? 'discipline' : 'service'}">Отмена</a></div></form>`);
  const f = $('#evf');
  const sync = () => {
    const k = e ? kind : f.querySelector('[name=kind]:checked').value; const svc = ['promotion', 'demotion', 'transfer'].includes(k);
    $$('.k-svc', f).forEach(x => { x.hidden = !svc && !x.classList.contains('k-pen'); });
    $$('.k-pen', f).forEach(x => { x.hidden = k === 'note'; });
    $('#subList').innerHTML = (k === 'penalty' ? d.lists.penalties : k === 'reward' ? d.lists.rewards : []).map(x => `<option>${esc(x)}</option>`).join('');
    if (!e && f.subtype.dataset.auto !== '0') f.subtype.value = k === 'penalty' ? 'Выговор' : k === 'reward' ? 'Благодарность' : svc ? d.lists.kinds[k] : '';
    $('#rlbl').textContent = k === 'note' ? 'Текст заметки' : svc ? 'Основание (приказ, рапорт)' : 'Причина / основание';
  };
  f.subtype.oninput = () => { f.subtype.dataset.auto = '0'; };
  if (!e) $$('[name=kind]', f).forEach(r => r.onchange = sync);
  sync();
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const k = e ? kind : f.querySelector('[name=kind]:checked').value; const svc = ['promotion', 'demotion', 'transfer'].includes(k);
    const b = { subtype: f.subtype.value, on_date: f.on_date.value, issued_by: f.issued_by.value, evidence: f.evidence.value, reason: f.reason.value };
    if (svc) Object.assign(b, { from_rank: f.from_rank.value, to_rank: f.to_rank.value, from_position: f.from_position.value, to_position: f.to_position.value });
    if (!e) { b.kind = k; if (svc) b.apply_profile = f.apply_profile.checked; }
    try { await api(e ? 'PUT' : 'POST', `/api/people/${p.id}/events${e ? '/' + e.id : ''}`, b); toast(e ? 'Запись сохранена' : 'Запись добавлена'); location.hash = `#/person/${p.id}?tab=${k === 'penalty' || k === 'reward' ? 'discipline' : 'service'}`; }
    catch (err) { toast(err.message, true); }
  };
}
