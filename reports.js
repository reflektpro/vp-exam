/* «Руководство: отчёты и премии» — роль «Руководство ГУ ВП» и администраторы. Расчёт — на сервере (worker: computePremiums). */
'use strict';
function isLead() { return can('lead'); }
const RUB = n => (Number(n) || 0).toLocaleString('ru-RU') + ' ₽';
const GROUP_RU = { main: 'Основная отчётность', extra: 'Дополнительная отчётность', gu: 'Работа ГУ ВП' };
const REP_ST = { submitted: ['Отправлен', 'info'], review: ['На проверке', 'warn'], approved: ['Принят', 'ok'], rejected: ['Отклонён', 'err'], missing: ['Нет отчёта', 'err'] };
const repBadge = (st) => { const x = REP_ST[st] || [st, '']; return `<span class="badge ${x[1]}">${esc(x[0])}</span>`; };
const PLAN_RU = { normal: ['Нормальный', 'ok'], min: ['Минимальный', 'warn'], none: ['Не выполнен', 'err'] };
const TIER_RU = { avg: 'средний', min: 'минимальный', zero: 'нулевой' };
const KIND_RU = { contribution: 'Взнос СС', leftover: 'Остаток фонда', income: 'Поступление', withdrawal: 'Снятие' };
function mondayOf(d) { const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())); const dow = (x.getUTCDay() + 6) % 7; x.setUTCDate(x.getUTCDate() - dow); return x.toISOString().slice(0, 10); }
function addD(w, n) { const d = new Date(w + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function weekLabel(w) { const f = (s) => s.slice(8, 10) + '.' + s.slice(5, 7) + '.' + s.slice(0, 4); return f(w) + ' — ' + f(addD(w, 6)); }
function hashQ() { return new URLSearchParams((location.hash.split('?')[1]) || ''); }
function leadNav(active) {
  const items = [['/lead', 'Неделя и премии'], ['/lead/violations', 'Нарушения'], ['/lead/budget', 'Бюджет ГУ ВП'], ['/lead/staff', 'Состав'], ['/lead/config', 'Таблицы выплат']];
  return `<div class="subnav">${items.map(i => `<a href="#${i[0]}" class="${active === i[0] ? 'on' : ''}">${i[1]}</a>`).join('')}</div>`;
}
function weekPicker(week, base) {
  return `<div class="row weekpick"><a class="btn sm" href="#${base}?week=${addD(week, -7)}">← Пред.</a><b>${weekLabel(week)}</b><a class="btn sm" href="#${base}?week=${addD(week, 7)}">След. →</a>
    <input type="date" id="wkDate" value="${week}" style="width:auto"><a class="btn sm" href="#${base}">Текущая</a></div>`;
}
function bindWeekPicker(base) { const d = $('#wkDate'); if (d) d.onchange = () => { if (d.value) location.hash = `#${base}?week=${mondayOf(new Date(d.value + 'T12:00:00'))}`; }; }
const leadRoute = (p, fn) => { route(p, async (...a) => { if (!isLead()) { setView(noAccess('lead')); return; } return fn(...a); }); route(p + '\\?.*', () => App.routes.find(r => r.p === p).fn()); };

// ---------- неделя: сводная таблица и премии ----------
leadRoute('/lead', async () => {
  const q = hashQ();
  const d = await api('GET', '/api/lead/week' + (q.get('week') ? '?week=' + encodeURIComponent(q.get('week')) : ''));
  const showAll = q.get('all') === '1';
  const used = new Set(); d.rows.forEach(r => Object.keys(r.counts || {}).forEach(k => used.add(k)));
  const cols = d.config.items.filter(i => showAll || used.has(i.key));
  const groups = ['main', 'extra', 'gu'].map(g => ({ g, items: cols.filter(i => i.group === g) })).filter(x => x.items.length);
  const posName = (k) => (d.config.positions.find(p => p.key === k) || {}).name || (k ? k : '—');
  const T = d.totals;
  const missingTxt = (r) => r.plan ? (r.plan.level === 'normal' ? '' : (r.plan.level === 'min' ? r.plan.missing_normal : r.plan.missing_min).map(x => `${x.name}: ещё ${x.need}`).join('\n')) : '';
  const rowCls = (r) => r.status === 'missing' ? 'r-missing' : r.late ? 'r-late' : r.status === 'rejected' ? 'r-late' : '';
  setView(`<h1>Руководство: отчёты и премии</h1>${leadNav('/lead')}
    ${weekPicker(d.week, '/lead')}
    <p class="small mut">Срок подачи: ${fmtDate(d.deadline)} (МСК)${d.deadline_passed ? ' — <b>прошёл</b>' : ''}. Премия — только при отчёте в срок. Отклонённые пункты не считаются, расчёт обновляется сразу.</p>
    <div class="grid fundgrid">
      <form class="card flat" id="fundF"><h3>Премиальный фонд недели</h3>
        <div class="row"><input name="fund" type="number" min="0" step="1" value="${d.fund || ''}" placeholder="${d.config.rules.fund_min} … ${d.config.rules.fund_max}" style="max-width:200px"><button class="btn sm gold">Сохранить</button></div>
        <input name="note" value="${esc(d.fund_note)}" placeholder="примечание (например, сумма от руководства ВС РФ)" style="margin-top:8px">
        <div class="small mut" style="margin-top:6px">От ${RUB(d.config.rules.fund_min)} до ${RUB(d.config.rules.fund_max)}.</div></form>
      <div class="card flat"><h3>Расчёт</h3>
        <div class="kv"><span>Фонд</span><b>${RUB(d.fund)}</b></div>
        <div class="kv"><span>Базовая премия (оклад + действия)</span><b>${RUB(T.base)}</b></div>
        <div class="kv total"><span>Итого из фонда</span><b id="paidFund">${RUB(T.paid)}</b></div>
        <div class="kv"><span>Остаток фонда</span><b class="${T.remaining < 0 ? 'neg' : 'pos'}" id="remaining">${RUB(T.remaining)}</b></div>
        <div class="budget-box"><div class="small mut">Наградные из бюджета ГУ ВП — отдельно, другой источник (в «Итого из фонда» не входят)</div><b id="budgetTotal">${RUB(T.award_budget)}</b></div>
        ${d.deleted_count ? `<details class="small" id="delBox"><summary>Удалённых отчётов за неделю: ${d.deleted_count}</summary><div id="delList" class="mut">загрузка…</div></details>` : ''}
        ${!d.fund_set ? '<div class="alert warn small">Фонд недели не указан — надбавки не рассчитываются.</div>' : ''}
        ${T.fund_short ? '<div class="alert err small">Фонда не хватает даже на базовую премию — база выплачивается, надбавки не начисляются.</div>' : ''}
        ${!T.fund_short && (T.add_short || T.award_short || T.ss_short) ? `<div class="alert warn small">Фонда не хватает на все надбавки: урезаны ${[T.add_short && 'дополнительная', T.award_short && 'наградная', T.ss_short && 'премия СС'].filter(Boolean).join(', ')}.</div>` : ''}
        ${d.deadline_passed ? `<button class="btn sm" id="leftBtn" ${T.remaining > 0 ? '' : 'disabled'}>Перенести остаток в бюджет ГУ ВП</button>${d.leftover_posted != null ? ` <span class="small mut">перенесено: ${RUB(d.leftover_posted)}</span>` : ''}${d.leftover_stale ? '<div class="alert warn small">Расчёт изменился после переноса остатка (например, удалён или перепроверен отчёт). Перенесите остаток заново.</div>' : ''}` : ''}
      </div></div>
    <div class="row between" style="margin:6px 0 8px"><div class="row">
      <a class="btn sm ${showAll ? 'gold' : ''}" href="#/lead?week=${d.week}${showAll ? '' : '&all=1'}">${showAll ? 'Только отмеченные пункты' : 'Все пункты'}</a>
      <span class="small mut">${d.rows.length} сотрудн. · красным — нет отчёта, жёлтым — после срока / отклонён</span></div>
      <div class="row"><button class="btn sm" id="csvBtn">Экспорт CSV</button><button class="btn sm" id="xlsxBtn">Экспорт XLSX</button></div></div>
    ${d.rows.length ? `<div class="tblwrap"><table class="prem"><thead>
      <tr><th rowspan="2">Сотрудник</th><th rowspan="2">Должность</th>${groups.map(g => `<th colspan="${g.items.length}" class="grp">${GROUP_RU[g.g]}</th>`).join('')}
        <th rowspan="2">Баллы</th><th rowspan="2">План</th><th rowspan="2">Оклад</th><th rowspan="2">Действия</th><th rowspan="2">Вычет</th><th rowspan="2">База</th><th rowspan="2">Доп.</th>
        <th rowspan="2">Наградная<div class="small mut">из фонда</div></th><th rowspan="2">Премия СС</th><th rowspan="2">Итого<div class="small mut">из фонда</div></th><th rowspan="2" class="bcol">Наградная<div class="small">бюджет ГУ ВП, отдельно</div></th><th rowspan="2">Отчёт</th></tr>
      <tr>${groups.map(g => g.items.map(i => `<th class="ic" title="${esc(i.name)} — ${RUB(i.pay)}"><span>${esc(i.name)}</span></th>`).join('')).join('')}</tr></thead>
      <tbody>${d.rows.map(r => `<tr class="${rowCls(r)}" data-uid="${esc(r.user_id)}">
        <td><b>${esc(r.name)}</b>${r.senior ? ' <span class="badge info">СС</span>' : ''}<div class="small mut">${esc(r.static_id || r.user_id)}</div>${r.strikes ? `<div class="small neg">нарушений: ${r.strikes}</div>` : ''}</td>
        <td>${esc(posName(r.position))}</td>
        ${groups.map(g => g.items.map(i => `<td class="num">${r.counts[i.key] || ''}</td>`).join('')).join('')}
        <td class="num">${r.points || 0}</td>
        <td>${r.plan ? `<span class="badge ${PLAN_RU[r.plan.level][1]}" title="${esc(missingTxt(r))}">${PLAN_RU[r.plan.level][0]}</span>${r.plan.level !== 'normal' ? `<div class="small mut miss">${esc(missingTxt(r)).replace(/\n/g, '<br>')}</div>` : ''}` : '—'}</td>
        <td class="num">${r.eligible ? `${RUB(r.oklad)}<div class="small mut">${TIER_RU[r.oklad_tier]}</div>` : `<span class="small neg">${esc(r.reason)}</span>`}</td>
        <td class="num">${RUB(r.actions)}</td><td class="num">${r.deduction ? '−' + RUB(r.deduction) + `<div class="small mut">${r.deduct_pct}%</div>` : '—'}</td>
        <td class="num"><b>${RUB(r.base)}</b>${r.excess ? `<div class="small mut">сверх макс. ${RUB(r.excess)}</div>` : ''}</td>
        <td class="num">${r.add ? RUB(r.add) : '—'}${r.add_want > r.add ? `<div class="small neg">урезано с ${RUB(r.add_want)}</div>` : ''}</td>
        <td><input class="m-award" type="number" min="0" step="1" value="${esc(rowManual(r, 'award'))}" ${r.eligible ? '' : 'disabled'} title="${RUB(d.config.rules.award_min)} – ${RUB(d.config.rules.award_max)}">${r.award_want > r.award ? `<div class="small neg">выплачено ${RUB(r.award)}</div>` : ''}</td>
        <td>${r.senior ? `<input class="m-ss" type="number" min="0" max="${d.config.rules.ss_max}" step="1" value="${esc(rowManual(r, 'ss'))}">${r.ss_want > r.ss ? `<div class="small neg">выплачено ${RUB(r.ss)}</div>` : ''}` : '<span class="small mut">не СС</span>'}</td>
        <td class="num"><b>${RUB(r.total_fund)}</b></td>
        <td class="bcol"><input class="m-ab" type="number" min="0" step="1" value="${esc(r.award_budget || '')}"></td>
        <td>${r.report_id ? `<a href="#/lead/report/${r.report_id}">${repBadge(r.status)}</a>${r.late ? ' <span class="badge err">после срока</span>' : ''}${r.edited_after_deadline ? ' <span class="badge warn" title="Отчёт изменён после срока">изм.</span>' : ''}<div class="small mut">${fmtDate(r.submitted_at)}</div>` : repBadge('missing')}</td>
      </tr>`).join('')}</tbody>
      <tfoot><tr><td colspan="${2 + cols.length + 5}"><b>Итого</b></td><td class="num"><b>${RUB(T.base)}</b></td><td class="num">${RUB(d.rows.reduce((s, r) => s + r.add, 0))}</td><td class="num">${RUB(d.rows.reduce((s, r) => s + r.award, 0))}</td><td class="num">${RUB(d.rows.reduce((s, r) => s + r.ss, 0))}</td><td class="num"><b>${RUB(d.rows.reduce((s, r) => s + r.total_fund, 0))}</b></td><td class="num bcol"><b>${RUB(T.award_budget)}</b></td><td></td></tr></tfoot>
    </table></div>
    <p class="small mut">Наградная из фонда: ${RUB(d.config.rules.award_min)}–${RUB(d.config.rules.award_max)}; премия СС — до ${RUB(d.config.rules.ss_max)} (только старшему составу); лимит на человека ${RUB(d.config.rules.person_cap)} (оклад + премия + доп. + наградная из фонда). Наградная из бюджета ГУ ВП — сверх лимита и списывается с бюджета ГУ ВП. Значения сохраняются при выходе из поля.</p>`
    : '<div class="alert info">За эту неделю нет отчётов, а состав ГУ ВП ещё не отмечен (раздел «Состав»).</div>'}`);
  bindWeekPicker('/lead');
  $('#fundF').onsubmit = async (ev) => { ev.preventDefault(); try { await api('PUT', `/api/lead/week/${d.week}/fund`, { fund: ev.target.fund.value, note: ev.target.note.value }); toast('Фонд сохранён'); render(); } catch (e) { toast(e.message, true); } };
  const lb = $('#leftBtn'); if (lb) lb.onclick = async () => { if (!confirm(`Перенести остаток ${RUB(T.remaining)} в бюджет ГУ ВП?`)) return; try { await api('POST', `/api/lead/week/${d.week}/leftover`); toast('Остаток перенесён'); render(); } catch (e) { toast(e.message, true); } };
  $$('tr[data-uid]').forEach(tr => {
    const r = d.rows.find(x => x.user_id === tr.dataset.uid);
    const save = async () => {
      const v = (c) => { const el = tr.querySelector(c); return el ? el.value : 0; };
      try { await api('PUT', `/api/lead/week/${d.week}/manual/${r.user_id}`, { award: v('.m-award'), ss: v('.m-ss'), award_budget: v('.m-ab') }); toast('Сохранено'); render(); }
      catch (e) { toast(e.message, true); }
    };
    tr.querySelectorAll('input').forEach(i => i.onchange = save);
  });
  const exportRows = () => {
    const head = ['Сотрудник', 'Discord ID', 'Статик', 'Должность', ...d.config.items.map(i => i.name), 'Баллы', 'План', 'Не хватает', 'Оклад (уровень)', 'Оклад', 'Действия', 'Вычет %', 'Вычет', 'База', 'Доп. премия', 'Наградная (фонд)', 'Премия СС', 'Итого из фонда', 'Наградная из бюджета ГУ ВП (отдельно)', 'Статус отчёта', 'После срока', 'Причина', 'Нарушений'];
    const body = d.rows.map(r => [r.name, r.user_id, r.static_id, posName(r.position), ...d.config.items.map(i => r.counts[i.key] || 0), r.points || 0, r.plan ? PLAN_RU[r.plan.level][0] : '', missingTxt(r).replace(/\n/g, '; '),
      r.eligible ? TIER_RU[r.oklad_tier] : '', r.oklad, r.actions, r.deduct_pct, r.deduction, r.base, r.add, r.award, r.ss, r.total_fund, r.award_budget, (REP_ST[r.status] || [r.status])[0], r.late ? 'да' : '', r.reason || '', r.strikes || 0]);
    body.push(['Итого', '', '', '', ...d.config.items.map(() => ''), '', '', '', '', '', '', '', '', T.base, d.rows.reduce((s, r) => s + r.add, 0), d.rows.reduce((s, r) => s + r.award, 0), d.rows.reduce((s, r) => s + r.ss, 0), d.rows.reduce((s, r) => s + r.total_fund, 0), T.award_budget, '', '', '', '']);
    body.push(['Фонд', d.fund], ['Итого из фонда', T.paid], ['Остаток фонда', T.remaining], ['Наградные из бюджета ГУ ВП (отдельно)', T.award_budget]);
    return [head, ...body];
  };
  const db = $('#delBox'); if (db) db.addEventListener('toggle', async () => { if (!db.open || db.dataset.done) return; db.dataset.done = 1;
    try { const r = await api('GET', '/api/lead/deleted?week=' + d.week); $('#delList').innerHTML = r.deleted.map(x => `<div>${esc(x.name)} — удалил ${esc(x.deleted_by)}, ${fmtDate(x.deleted_at)}${x.reason ? ': «' + esc(x.reason) + '»' : ''}</div>`).join('') || 'нет'; } catch (e) { $('#delList').textContent = e.message; } });
  $('#csvBtn').onclick = () => { const csv = exportRows().map(r => r.map(c => { const s = String(c == null ? '' : c); return /[";\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; }).join(';')).join('\r\n'); downloadBlob(new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' }), `premii_${d.week}.csv`); };
  $('#xlsxBtn').onclick = () => downloadBlob(xlsxBlob(exportRows(), 'Премии ' + d.week), `premii_${d.week}.xlsx`);
});
function rowManual(r, k) { return r['m_' + k] || ''; }
function downloadBlob(blob, name) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
// Минимальный XLSX (zip без сжатия, inline-строки) — без внешних библиотек.
function xlsxBlob(rows, sheetName) {
  const x = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const col = n => { let s = ''; n++; while (n) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((c, j) => {
    const ref = col(j) + (i + 1); return typeof c === 'number' ? `<c r="${ref}"><v>${c}</v></c>` : `<c r="${ref}" t="inlineStr"${i === 0 ? ' s="1"' : ''}><is><t>${x(c == null ? '' : c)}</t></is></c>`; }).join('')}</row>`).join('')}</sheetData></worksheet>`;
  const files = {
    '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
    '_rels/.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${x(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>',
    'xl/styles.xml': '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>',
    'xl/worksheets/sheet1.xml': sheet,
  };
  return new Blob([zipStore(files)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function zipStore(files) {
  const enc = new TextEncoder(); const crcT = zipStore.t || (zipStore.t = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
  const crc = (b) => { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i++) c = crcT[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const parts = [], central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const nb = enc.encode(name), data = enc.encode(text), c = crc(data);
    const h = new DataView(new ArrayBuffer(30)); h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true); h.setUint32(14, c, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true); h.setUint16(26, nb.length, true);
    parts.push(new Uint8Array(h.buffer), nb, data);
    const cd = new DataView(new ArrayBuffer(46)); cd.setUint32(0, 0x02014b50, true); cd.setUint16(4, 20, true); cd.setUint16(6, 20, true); cd.setUint16(8, 0x0800, true); cd.setUint32(16, c, true); cd.setUint32(20, data.length, true); cd.setUint32(24, data.length, true); cd.setUint16(28, nb.length, true); cd.setUint32(42, off, true);
    central.push(new Uint8Array(cd.buffer), nb); off += 30 + nb.length + data.length;
  }
  const csize = central.reduce((s, b) => s + b.length, 0);
  const e = new DataView(new ArrayBuffer(22)); e.setUint32(0, 0x06054b50, true); e.setUint16(8, Object.keys(files).length, true); e.setUint16(10, Object.keys(files).length, true); e.setUint32(12, csize, true); e.setUint32(16, off, true);
  return new Blob([...parts, ...central, new Uint8Array(e.buffer)]);
}

// ---------- один отчёт ----------
route('/lead/report/:id', async (id) => {
  if (!isLead()) { setView(noAccess('lead')); return; }
  const d = await api('GET', '/api/lead/reports/' + encodeURIComponent(id));
  const r = d.report, c = d.calc, cfgItems = new Map(d.config.items.map(i => [i.key, i]));
  const h = r.header || {};
  const itemRow = (it) => { const rv = it.review || {}; const pay = (cfgItems.get(it.key) || {}).pay || 0;
    return `<div class="ritem ${rv.status === 'rejected' ? 'rej' : rv.status === 'ok' ? 'acc' : ''}" data-key="${esc(it.key)}">
      <div class="row between"><div><b>${esc(it.name)}</b> — штук: <b>${it.n}</b>${it.vp != null ? ` · баллы: ${it.vp}` : ''}${it.points != null ? ` · баллы благодарностей: ${it.points}` : ''}${it.custom ? ' <span class="badge">свой пункт, без выплаты</span>' : ` <span class="small mut">${RUB(pay)} за 1</span>`}</div>
        <div class="row">${rv.status ? `<span class="badge ${rv.status === 'ok' ? 'ok' : 'err'}">${rv.status === 'ok' ? 'принят' + (rv.n_ok != null ? ` (${rv.n_ok} из ${it.n})` : '') : 'отклонён'}</span>` : '<span class="badge">не проверен</span>'}
          <input type="number" class="nok" min="0" max="${it.n}" value="${rv.n_ok != null ? rv.n_ok : it.n}" title="Принято штук" style="width:70px">
          <button class="btn sm i-ok">Принять</button><button class="btn sm danger i-rej">Отклонить</button>${rv.status ? '<button class="btn sm i-clr" title="Снять отметку">↺</button>' : ''}</div></div>
      ${it.links && it.links.length ? `<ol class="links">${it.links.map(u => `<li><a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a></li>`).join('')}</ol>` : '<div class="small neg">ссылок нет</div>'}
      <input class="icom" placeholder="комментарий к пункту" value="${esc(rv.comment || '')}"></div>`; };
  setView(`<p><a href="#/lead?week=${r.week}">← Неделя ${weekLabel(r.week)}</a></p>
    <div class="card"><div class="row between"><h2 style="margin:0">Отчёт: ${esc(h.rank || '')} ${esc(h.name || '')}</h2><div class="row">${repBadge(r.status)}${r.late ? '<span class="badge err">после срока — без премии</span>' : ''}${r.edited_after_deadline ? '<span class="badge warn">изменён после срока</span>' : ''}</div></div>
      <p class="small mut">Discord: ${esc(d.user ? (d.user.global_name || d.user.username) : r.user_id)} (${esc(r.user_id)}) · удостоверение ${esc(h.static_id || '—')} · ${esc(h.unit || '')} · период ${esc(weekLabel(r.week))}
        · первая отправка ${fmtDate(r.first_submitted_at)} · версия ${r.version} от ${fmtDate(r.submitted_at)} · срок ${fmtDate(r.deadline)}</p>
      <div class="row"><label>Должность (из отчёта, можно исправить): <select id="pos" style="width:auto">${d.config.positions.map(p => `<option value="${p.key}" ${p.key === r.position ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
        <span>Баллы отчёта: <b>${r.points}</b></span></div>
      ${h.result ? `<p><b>Общий результат:</b> ${esc(h.result)}</p>` : ''}${h.extra ? `<p><b>Дополнительные сведения:</b> ${esc(h.extra)}</p>` : ''}</div>
    <div class="grid two">
      <div class="card flat"><h3>План недели: ${r.plan ? `<span class="badge ${PLAN_RU[r.plan.level][1]}">${PLAN_RU[r.plan.level][0]}</span>` : ''}</h3>
        <table><tr><th>Строка плана</th><th>Засчитано</th><th>Мин.</th><th>Норм.</th></tr>${r.plan.lines.map(l => `<tr><td>${esc(l.name)}</td><td class="num">${l.got}</td><td class="num ${l.ok_min ? 'pos' : 'neg'}">${l.min}</td><td class="num ${l.ok_normal ? 'pos' : 'neg'}">${l.normal}</td></tr>`).join('')}</table></div>
      <div class="card flat"><h3>Премия</h3>${c ? (c.eligible ? `
        <div class="kv"><span>Оклад (${TIER_RU[c.oklad_tier]})</span><b>${RUB(c.oklad)}</b></div>
        <div class="kv"><span>Выплаты за действия</span><b>${RUB(c.actions)}</b></div>
        <div class="kv"><span>Вычет ${c.deduct_pct}%</span><b>${c.deduction ? '−' + RUB(c.deduction) : '—'}</b></div>
        <div class="kv"><span>База (не больше ${RUB(c.max)})</span><b>${RUB(c.base)}</b></div>
        <div class="kv"><span>Дополнительная</span><b>${RUB(c.add)}</b></div><div class="kv"><span>Наградная (фонд)</span><b>${RUB(c.award)}</b></div>
        <div class="kv"><span>Премия СС</span><b>${RUB(c.ss)}</b></div>
        <div class="kv total"><span>Итого из фонда</span><b>${RUB(c.total_fund)}</b></div>
        <div class="budget-box"><div class="small mut">Наградная из бюджета ГУ ВП — отдельно</div><b>${RUB(c.award_budget)}</b></div>` : `<div class="alert err">Без премии: ${esc(c.reason)}</div>`) : ''}</div></div>
    <div class="card"><div class="row between"><h3 style="margin:0">Пункты и доказательства</h3><button class="btn sm" id="allOk">Принять все непроверенные</button></div>
      ${['main', 'extra', 'gu'].map(g => { const list = r.items.filter(i => i.group === g); return list.length ? `<h4>${GROUP_RU[g]}</h4>${list.map(itemRow).join('')}` : ''; }).join('')}</div>
    <form class="card" id="rf"><h3>Решение по отчёту</h3>
      <label class="f"><span>Комментарий для сотрудника</span><textarea name="comment" maxlength="2000">${esc(r.comment)}</textarea></label>
      <div class="row"><button type="button" class="btn gold" data-st="approved">Принять отчёт</button><button type="button" class="btn danger" data-st="rejected">Отклонить отчёт</button><button type="button" class="btn" data-st="review">На проверке</button><button type="button" class="btn" data-st="">Сохранить комментарий</button></div>
      ${d.reviewer ? `<p class="small mut">Проверял: ${esc(d.reviewer)} · ${fmtDate(r.reviewed_at)}</p>` : ''}</form>
    <div class="card flat danger-zone"><h3>Удалить отчёт</h3><p class="small mut">Если отчёт явно недостоверный или отправлен по ошибке. Копия отчёта и история правок сохранятся в журнале, премии недели пересчитаются, сотрудник сможет сдать неделю заново (если срок прошёл — уже после срока). Неделя без отчёта считается нарушением.</p>
      <div class="row"><input id="delReason" placeholder="причина удаления (видна в журнале)" style="flex:1;min-width:220px"><button type="button" class="btn danger" id="delRep">Удалить отчёт</button></div></div>
    ${d.history.length ? `<div class="card flat"><h3>История правок</h3><table><tr><th>Версия</th><th>Отправлена</th><th>Пункты</th></tr>${d.history.map(v => `<tr><td>${v.version}</td><td>${fmtDate(v.submitted_at)}${v.after_deadline ? ' <span class="badge warn">после срока</span>' : ''}</td><td class="small">${v.items.map(i => `${esc(i.name)}: ${i.n}`).join('; ')}</td></tr>`).join('')}</table></div>` : ''}`);
  const send = async (body, msg) => { try { await api('POST', `/api/lead/reports/${r.id}/review`, body); toast(msg); render(); } catch (e) { toast(e.message, true); } };
  $$('.ritem').forEach(el => {
    const k = el.dataset.key, com = () => el.querySelector('.icom').value;
    el.querySelector('.i-ok').onclick = () => send({ items: { [k]: { status: 'ok', n_ok: el.querySelector('.nok').value, comment: com() } } }, 'Пункт принят');
    el.querySelector('.i-rej').onclick = () => send({ items: { [k]: { status: 'rejected', comment: com() } } }, 'Пункт отклонён');
    const clr = el.querySelector('.i-clr'); if (clr) clr.onclick = () => send({ items: { [k]: null } }, 'Отметка снята');
  });
  $('#allOk').onclick = () => { const items = {}; r.items.filter(i => !i.review).forEach(i => { items[i.key] = { status: 'ok' }; }); if (!Object.keys(items).length) return toast('Все пункты уже проверены'); send({ items }, 'Пункты приняты'); };
  $('#pos').onchange = () => send({ position: $('#pos').value }, 'Должность исправлена');
  $('#delRep').onclick = async () => {
    if (!confirm(`Удалить отчёт ${h.rank || ''} ${h.name || ''} за неделю ${weekLabel(r.week)}? Это нельзя отменить — копия останется только в журнале.`)) return;
    try { await api('DELETE', '/api/lead/reports/' + r.id, { reason: $('#delReason').value }); toast('Отчёт удалён'); location.hash = '#/lead?week=' + r.week; } catch (e) { toast(e.message, true); }
  };
  $$('#rf [data-st]').forEach(b => b.onclick = () => send(b.dataset.st ? { status: b.dataset.st, comment: $('#rf').comment.value } : { comment: $('#rf').comment.value }, 'Сохранено'));
});

// ---------- нарушения ----------
leadRoute('/lead/violations', async () => {
  const d = await api('GET', '/api/lead/violations');
  setView(`<h1>Нарушения: отчёт не сдан в срок</h1>${leadNav('/lead/violations')}
    <p class="small mut">Считаются недели с начала учёта сотрудника (раздел «Состав»), срок которых прошёл (последняя закрытая неделя — ${weekLabel(d.last_closed_week)}). 1 — предупреждение, 2 — выговор, 3 — увольнение. Сообщения в Discord автоматически не отправляются. Нарушение можно снять (уважительная причина).</p>
    ${d.users.length ? `<table><tr><th>Сотрудник</th><th>Нарушений</th><th>Мера</th><th>Недели</th></tr>${d.users.map(u => `<tr><td><b>${esc(u.name)}</b><div class="small mut">${esc(u.static_id || u.user_id)} · учёт с ${u.staff_since ? weekLabel(u.staff_since).slice(0, 10) : '—'}</div></td>
      <td class="num">${u.strikes}</td><td>${u.label ? `<span class="badge ${u.strikes >= 3 ? 'err' : 'warn'}">${esc(u.label)}</span>` : '<span class="badge ok">нет</span>'}</td>
      <td>${u.list.map(x => `<div class="row small"><span class="${x.excused ? 'mut strike' : ''}">${weekLabel(x.week)} — ${x.kind === 'late' ? 'после срока' : 'не сдан'}</span>${x.excused ? `<span class="mut">снято${x.note ? ': ' + esc(x.note) : ''}</span>` : ''}
        <button class="btn sm" data-u="${esc(u.user_id)}" data-w="${x.week}" data-e="${x.excused ? 0 : 1}">${x.excused ? 'Вернуть' : 'Снять'}</button></div>`).join('') || '<span class="small mut">—</span>'}</td></tr>`).join('')}</table>` : '<div class="alert info">Состав ГУ ВП не отмечен — отметьте сотрудников в разделе «Состав».</div>'}`);
  $$('[data-u]').forEach(b => b.onclick = async () => {
    const excused = b.dataset.e === '1'; const note = excused ? prompt('Причина снятия нарушения:', '') : '';
    if (excused && note === null) return;
    try { await api('POST', '/api/lead/violations/excuse', { user_id: b.dataset.u, week: b.dataset.w, excused, note }); render(); } catch (e) { toast(e.message, true); }
  });
});

// ---------- бюджет ГУ ВП ----------
leadRoute('/lead/budget', async () => {
  const q = hashQ();
  const d = await api('GET', '/api/lead/budget' + (q.get('week') ? '?week=' + encodeURIComponent(q.get('week')) : ''));
  const st = await api('GET', '/api/lead/staff');
  const people = st.users.filter(u => u.staff || u.senior);
  setView(`<h1>Бюджет ГУ ВП</h1>${leadNav('/lead/budget')}
    <div class="grid two"><div class="card flat"><h3>Баланс</h3><div class="big ${d.balance < 0 ? 'neg' : 'pos'}" id="balance">${RUB(d.balance)}</div>
      <p class="small mut">Взносы СС + остатки премиального фонда + поступления − снятия − наградные из бюджета (вписываются в таблице недели).</p></div>
      <div class="card flat"><h3>Взносы СС за неделю</h3>${weekPicker(d.week, '/lead/budget')}
        <p class="small mut">Минимум ${RUB(d.min_contribution)} в неделю с каждого сотрудника старшего состава.</p>
        ${d.contributions.length ? `<table>${d.contributions.map(c => `<tr><td>${esc(c.name)}</td><td class="num">${RUB(c.paid)}</td><td>${c.ok ? '<span class="badge ok">внесено</span>' : '<span class="badge err">не внесено</span>'}</td></tr>`).join('')}</table>` : '<p class="small mut">Старший состав не отмечен (раздел «Состав»).</p>'}</div></div>
    <form class="card" id="bf"><h3>Новая операция</h3><div class="row">
      <select name="kind" style="width:auto">${Object.entries(KIND_RU).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select>
      <input name="amount" type="number" min="1" step="1" placeholder="сумма, ₽" style="max-width:160px" required>
      <select name="user_id" style="width:auto"><option value="">— кто внёс (для взноса) —</option>${people.map(u => `<option value="${esc(u.id)}">${esc(u.ic_name || u.global_name || u.username)}${u.senior ? ' (СС)' : ''}</option>`).join('')}</select>
      <input name="week" type="date" value="${d.week}" style="width:auto" title="неделя (понедельник)">
      <input name="note" placeholder="примечание (для снятия — обязательно: на что)" style="flex:1;min-width:200px">
      <button class="btn gold">Добавить</button></div></form>
    <div class="card flat"><h3>Журнал операций</h3>${d.entries.length ? `<table><tr><th>Когда</th><th>Операция</th><th>Сумма</th><th>Сотрудник</th><th>Неделя</th><th>Примечание</th><th>Кто записал</th><th></th></tr>
      ${d.entries.map(e => `<tr class="${e.deleted_at ? 'deleted' : ''}"><td>${fmtDate(e.created_at)}</td><td>${KIND_RU[e.kind] || e.kind}</td><td class="num ${e.sign < 0 ? 'neg' : 'pos'}">${e.sign < 0 ? '−' : '+'}${RUB(e.amount)}</td><td>${esc(e.user_name)}</td><td>${e.week ? weekLabel(e.week).slice(0, 10) : ''}</td><td>${esc(e.note)}</td><td>${esc(e.created_by)}</td>
        <td>${e.deleted_at ? `<span class="small mut">удалена ${fmtDate(e.deleted_at)}</span>` : `<button class="btn sm danger" data-del="${e.id}">Удалить</button>`}</td></tr>`).join('')}</table>` : '<p class="mut">Операций пока нет.</p>'}
      ${d.awards.length ? `<h4>Наградные из бюджета ГУ ВП</h4><table>${d.awards.map(a => `<tr><td>${weekLabel(a.week)}</td><td>${esc(a.name)}</td><td class="num neg">−${RUB(a.amount)}</td></tr>`).join('')}</table>` : ''}</div>`);
  bindWeekPicker('/lead/budget');
  $('#bf').onsubmit = async (ev) => { ev.preventDefault(); const f = ev.target;
    const wk = f.week.value ? mondayOf(new Date(f.week.value + 'T12:00:00')) : d.week;
    try { await api('POST', '/api/lead/budget', { kind: f.kind.value, amount: f.amount.value, user_id: f.user_id.value || undefined, week: wk, note: f.note.value }); toast('Операция записана'); render(); } catch (e) { toast(e.message, true); } };
  $$('[data-del]').forEach(b => b.onclick = async () => { if (!confirm('Удалить операцию? Она останется в журнале как удалённая.')) return; try { await api('DELETE', '/api/lead/budget/' + b.dataset.del); render(); } catch (e) { toast(e.message, true); } });
});

// ---------- состав ----------
leadRoute('/lead/staff', async () => {
  const [d, cfg] = await Promise.all([api('GET', '/api/lead/staff'), api('GET', '/api/report-config')]);
  const f = (hashQ().get('q') || '').toLowerCase();
  const list = d.users.filter(u => !f || [u.id, u.username, u.global_name, u.ic_name, u.static_id].some(x => String(x || '').toLowerCase().includes(f)));
  setView(`<h1>Состав ГУ ВП</h1>${leadNav('/lead/staff')}
    <p class="small mut">«В составе» — обязан сдавать еженедельный отчёт: попадает в сводную таблицу (даже без отчёта) и в учёт нарушений с недели «учёт с». «СС» — старший состав: премия СС и еженедельный взнос в бюджет. Должность в премии берётся из отчёта; здесь — для сотрудников без отчёта. Роль «Руководство ГУ ВП» назначают администраторы на странице пользователя.</p>
    <form class="row" id="sf" style="margin-bottom:12px"><input name="q" value="${esc(f)}" placeholder="Поиск" style="max-width:320px"><button class="btn sm">Найти</button></form>
    <table><tr><th>Пользователь</th><th>В составе</th><th>СС</th><th>Должность</th><th>Учёт с недели</th><th>Отчётов</th></tr>
    ${list.map(u => `<tr data-uid="${esc(u.id)}"><td><b>${esc(u.ic_name || u.global_name || u.username)}</b>${u.leader ? ' <span class="badge gold">Руководство</span>' : ''}<div class="small mut">${esc(u.username)} · ${esc(u.id)}${u.static_id ? ' · ' + esc(u.static_id) : ''}</div></td>
      <td><input type="checkbox" class="s-staff" ${u.staff ? 'checked' : ''}></td><td><input type="checkbox" class="s-senior" ${u.senior ? 'checked' : ''}></td>
      <td><select class="s-pos" style="width:auto"><option value="">—</option>${cfg.positions.map(p => `<option value="${p.key}" ${p.key === u.staff_position ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></td>
      <td><input type="date" class="s-since" value="${esc(u.staff_since || '')}" style="width:auto"></td><td class="num">${u.reports}</td></tr>`).join('')}</table>`);
  $('#sf').onsubmit = (ev) => { ev.preventDefault(); location.hash = '#/lead/staff?q=' + encodeURIComponent(ev.target.q.value); };
  $$('tr[data-uid]').forEach(tr => {
    const put = async (body) => { try { await api('PUT', '/api/lead/staff/' + tr.dataset.uid, body); toast('Сохранено'); render(); } catch (e) { toast(e.message, true); } };
    tr.querySelector('.s-staff').onchange = (e) => put({ staff: e.target.checked });
    tr.querySelector('.s-senior').onchange = (e) => put({ senior: e.target.checked });
    tr.querySelector('.s-pos').onchange = (e) => put({ staff_position: e.target.value });
    tr.querySelector('.s-since').onchange = (e) => put({ staff_since: e.target.value ? mondayOf(new Date(e.target.value + 'T12:00:00')) : '' });
  });
});

// ---------- таблицы выплат (редактирует главный администратор) ----------
leadRoute('/lead/config', async () => {
  const d = await api('GET', '/api/lead/config');
  const C = d.config, ed = d.can_edit, dis = ed ? '' : 'disabled';
  const names = new Map(C.items.map(i => [i.key, i.name]));
  const R = C.rules;
  const unpaid = C.items.filter(i => !i.pay);
  setView(`<h1>Таблицы выплат и план</h1>${leadNav('/lead/config')}
    ${ed ? '' : '<div class="alert info">Изменять таблицы может только главный администратор. Здесь — просмотр.</div>'}
    <div class="card"><h3>Оклады по должностям (Таблица «Все выплаты»)</h3>
      <table id="tPos"><tr><th>Ключ</th><th>Должность</th><th>Нулевой</th><th>Минимальный</th><th>Средний</th><th>Максимальная выплата</th></tr>
      ${C.positions.map(p => `<tr><td class="small mut">${esc(p.key)}</td><td><input data-f="name" value="${esc(p.name)}" ${dis}></td>${['zero', 'min', 'avg', 'max'].map(f => `<td><input type="number" data-f="${f}" value="${p[f]}" ${dis}></td>`).join('')}</tr>`).join('')}</table>
      ${ed ? '<div class="row"><button class="btn gold sm" data-save="positions">Сохранить оклады</button><button class="btn sm" data-reset="positions">Вернуть значения приказа</button></div>' : ''}</div>
    <div class="card"><h3>Минимальный и нормальный план</h3>
      <p class="small mut">Каждая строка плана — сумма пунктов отчёта; один пункт может засчитываться в несколько строк. Уровень плана: все строки ≥ норм. — нормальный; все ≥ мин. — минимальный.</p>
      <table id="tPlan"><tr><th>Строка плана</th><th>Мин.</th><th>Норм.</th><th>Засчитываются пункты</th></tr>
      ${C.plan.map(l => `<tr data-key="${esc(l.key)}"><td><input data-f="name" value="${esc(l.name)}" ${dis}></td><td><input type="number" data-f="min" value="${l.min}" style="width:70px" ${dis}></td><td><input type="number" data-f="normal" value="${l.normal}" style="width:70px" ${dis}></td>
        <td>${ed ? `<details><summary class="small">${l.items.map(k => esc(names.get(k) || k)).join(', ')}</summary><div class="plan-items">${C.items.map(i => `<label class="chk small"><input type="checkbox" value="${esc(i.key)}" ${l.items.includes(i.key) ? 'checked' : ''}> ${esc(i.name)}</label>`).join('')}</div></details>` : `<span class="small">${l.items.map(k => esc(names.get(k) || k)).join(', ')}</span>`}</td></tr>`).join('')}</table>
      ${ed ? '<div class="row"><button class="btn gold sm" data-save="plan">Сохранить план</button><button class="btn sm" data-reset="plan">Вернуть значения приказа</button></div>' : ''}</div>
    <div class="card"><h3>Выплата за одно действие (Таблицы 1–2) и пункты отчёта</h3>
      <table id="tItems"><tr><th>Пункт отчёта</th><th>Раздел</th><th>Строка таблицы выплат</th><th>Выплата, ₽</th><th>Баллы отчёта</th></tr>
      ${C.items.map(i => `<tr data-key="${esc(i.key)}"><td>${esc(i.name)}<div class="small mut">${esc(i.key)}${i.legacy ? ' · нет в перечне приказа' : ''}</div></td><td class="small">${GROUP_RU[i.group]}</td>
        <td><input data-f="pay_name" value="${esc(i.pay_name || '')}" ${dis}></td><td><input type="number" data-f="pay" value="${i.pay}" style="width:110px" ${dis}></td><td>${i.group === 'main' ? `<input data-f="wk" value="${esc(i.wk)}" style="width:60px" ${dis}>` : '<span class="small mut">—</span>'}</td></tr>`).join('')}</table>
      ${unpaid.length ? `<p class="small mut">Без выплаты (нет строки в таблицах приказа): ${unpaid.map(i => esc(i.name)).join('; ')}. Свои пункты сотрудников тоже без выплаты.</p>` : ''}
      ${ed ? '<div class="row"><button class="btn gold sm" data-save="items">Сохранить выплаты</button><button class="btn sm" data-reset="items">Вернуть значения приказа</button></div>' : ''}</div>
    <div class="card"><h3>Правила и лимиты</h3><div class="grid rules" id="tRules">
      ${[['ded_none', 'Вычет без минимального плана, %'], ['ded_min', 'Вычет при минимальном плане, %'], ['add_cap', 'Доп. премия — максимум на человека'], ['award_min', 'Наградная — минимум'], ['award_max', 'Наградная — максимум'], ['ss_max', 'Премия СС — максимум'], ['person_cap', 'Лимит на человека (оклад+премия+доп.+наградная)'], ['thanks_points', 'Баллов за 1 благодарность'], ['fund_min', 'Фонд — минимум'], ['fund_max', 'Фонд — максимум'], ['ss_contrib_min', 'Взнос СС в бюджет, минимум/нед.'], ['deadline_dow', 'День срока (0 — воскресенье)'], ['deadline_hour', 'Час срока (МСК)']]
        .map(([k, t]) => `<label class="f"><span>${t}</span><input type="number" data-f="${k}" value="${R[k]}" ${dis}></label>`).join('')}</div>
      ${ed ? '<div class="row"><button class="btn gold sm" data-save="rules">Сохранить правила</button><button class="btn sm" data-reset="rules">Вернуть значения приказа</button></div>' : ''}</div>`);
  if (!ed) return;
  const collect = {
    positions: () => $$('#tPos tr').slice(1).map((tr, i) => { const o = { key: C.positions[i].key }; tr.querySelectorAll('[data-f]').forEach(x => { o[x.dataset.f] = x.type === 'number' ? Number(x.value) : x.value; }); return o; }),
    plan: () => $$('#tPlan tr[data-key]').map(tr => ({ key: tr.dataset.key, name: tr.querySelector('[data-f=name]').value, min: Number(tr.querySelector('[data-f=min]').value), normal: Number(tr.querySelector('[data-f=normal]').value), items: [...tr.querySelectorAll('.plan-items input:checked')].map(x => x.value) })),
    items: () => $$('#tItems tr[data-key]').map(tr => { const it = C.items.find(i => i.key === tr.dataset.key); const o = { ...it }; tr.querySelectorAll('[data-f]').forEach(x => { o[x.dataset.f] = x.dataset.f === 'pay' ? Number(x.value) : x.dataset.f === 'wk' ? (x.value.trim() === 'n' ? 'n' : Number(x.value)) : x.value; }); return o; }),
    rules: () => { const o = {}; $$('#tRules [data-f]').forEach(x => { o[x.dataset.f] = Number(x.value); }); return o; },
  };
  $$('[data-save]').forEach(b => b.onclick = async () => { try { await api('PUT', '/api/lead/config', { [b.dataset.save]: collect[b.dataset.save]() }); toast('Сохранено'); render(); } catch (e) { toast(e.message, true); } });
  $$('[data-reset]').forEach(b => b.onclick = async () => { if (!confirm('Вернуть значения из приказа № 01_10?')) return; try { await api('POST', `/api/lead/config/${b.dataset.reset}/reset`); toast('Значения приказа восстановлены'); render(); } catch (e) { toast(e.message, true); } });
});
