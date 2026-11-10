/* Админка: опубликованные проверки законодательства. Ответы вопросов здесь не правятся. */
'use strict';
const LAW_ST = {
  unchecked: ['проверка ещё не опубликована', ''],
  unchanged: ['совпадает с копией проверки', 'ok'],
  changed: ['есть расхождения', 'warn'],
  error: ['сбой проверки', 'err'],
  unavailable: ['источник недоступен', 'err'],
  manual: ['только вручную', 'info'],
};
const PROP_ST = { pending: ['ждёт решения', 'warn'], approved: ['редакция принята', 'ok'], rejected: ['отклонено', 'err'], superseded: ['заменено новой проверкой', ''] };
function lawBadge(map, key) { const x = map[key] || [key || '—', '']; return `<span class="badge ${x[1]}">${esc(x[0])}</span>`; }
function lawWhen(ms) { return ms ? fmtDate(ms) : '—'; }
function diffBlock(diff) {
  if (!diff) return '';
  const units = diff.units || [];
  const more = (diff.changed_count || 0) > units.length || (diff.added_count || 0) > (diff.added || []).length || (diff.removed_count || 0) > (diff.removed || []).length;
  const lines = (text) => String(text || '').split('\n').map(line => {
    const kind = line.startsWith('+') ? 'add' : line.startsWith('-') ? 'del' : 'ctx';
    return `<div class="dline ${kind}">${esc(line) || '&nbsp;'}</div>`;
  }).join('');
  return `<div class="diffbox">
    <p class="small mut">Добавлено ${diff.added_count || 0}, удалено ${diff.removed_count || 0}, изменено ${diff.changed_count || 0}. Показаны фрагменты отчёта, не полный кодекс.</p>
    ${(diff.added || []).length ? `<p><b>Новые пункты:</b> ${diff.added.map(esc).join('; ')}</p>` : ''}
    ${(diff.removed || []).length ? `<p><b>Снятые пункты:</b> ${diff.removed.map(esc).join('; ')}</p>` : ''}
    ${more ? '<p class="small mut">В отчёте перечислены не все пункты — смотрите счётчики.</p>' : ''}
    ${units.map(u => `<section class="dunit"><h3>${esc(u.unit)}</h3>
      ${u.old || u.new ? `<div class="split"><div><p class="small mut">Было</p><pre class="legal">${esc(u.old || '—')}</pre></div><div><p class="small mut">Стало</p><pre class="legal">${esc(u.new || '—')}</pre></div></div>` : ''}
      ${u.diff ? `<div class="dlines" aria-label="Построчное сравнение">${lines(u.diff)}</div>` : ''}
    </section>`).join('') || '<p class="mut">Построчного сравнения в этом отчёте нет.</p>'}
  </div>`;
}
function questionRows(list) {
  const rows = list || [];
  if (!rows.length) return '<p class="mut">Затронутых вопросов в отчёте нет.</p>';
  return `<div class="tblwrap"><table><tr><th>Вопрос</th><th>Что не так</th><th>В портале</th><th></th></tr>
    ${rows.map(q => `<tr><td><b>${esc(q.ext_id)}</b><div class="small mut">${esc(q.ref || '')}${q.base ? ' · ' + esc(q.base) : ''}</div>${q.prompt ? `<div class="small">${esc(q.prompt)}</div>` : ''}</td>
      <td>${q.issue === 'missing' ? '<span class="badge err">цитата не найдена</span>' : q.issue === 'moved' ? `<span class="badge warn">пункт ${esc(q.old_ref)} → ${esc(q.new_ref)}</span>` : '<span class="badge ok">на месте</span>'}
        ${q.excerpt ? `<div class="small mut">${esc(q.excerpt)}</div>` : ''}</td>
      <td>${q.in_portal ? (q.active ? 'активный' : 'только выключенная версия') : 'нет такого ext_id'}</td>
      <td>${q.in_portal ? `<a class="btn sm" href="#/admin/bank?q=${encodeURIComponent(q.ext_id)}">Открыть в банке</a>` : ''}${q.question_id && q.issue !== 'ok' ? `<button type="button" class="btn sm" data-ack="${q.question_id}">Оставить как есть</button>` : ''}</td></tr>`).join('')}
  </table></div>`;
}
function pipelineNote(p) {
  if (!p) return '';
  return `<details class="card law-note"><summary>Как устроена проверка</summary>
    <p>${esc(p.routine)}</p><p>${esc(p.publish)}</p><p>${esc(p.approval)}</p>
    <p class="small mut">${esc(p.production_migration)}</p></details>`;
}
function checkBanner(c) {
  if (!c) return '<div class="alert info">Опубликованных проверок пока нет. Портал форум сам не скачивает.</div>';
  const bits = [`Проверка #${c.id}`, lawBadge({ ok: ['без расхождений', 'ok'], changes: ['есть расхождения', 'warn'], errors: ['сбои', 'err'], partial: ['часть со сбоями', 'warn'], failed: ['запись не завершилась', 'err'], recording: ['записывается', 'info'] }, c.status)];
  let extra = '';
  if (c.offline) extra += '<div class="alert warn">Отчёт помечен как офлайн. Это сверка с локальной копией, не живое чтение форума.</div>';
  if (c.applied_locally) extra += '<div class="alert warn">На машине проверки скрипт записал md-файлы. База вопросов портала от этого не обновилась.</div>';
  if (c.partial) extra += '<div class="alert info">Отчёт частичный: документы, которых в нём нет, ниже не перезаписаны.</div>';
  return `${extra}<p class="small mut">${bits.join(' · ')} · ${esc(c.runner || '')} · отчёт от ${lawWhen(c.generated_at)} · опубликован ${lawWhen(c.finished_at)}${c.actor_name ? ' · ' + esc(c.actor_name) : ''}</p>`;
}

route('/admin/laws', async () => {
  const d = await api('GET', '/api/admin/laws');
  setView(`<h1>Законодательство</h1>${adminNav('/admin/laws')}
    ${pipelineNote(d.pipeline)}
    ${checkBanner(d.latest_check)}
    <div class="row" style="margin:14px 0">
      <label class="btn">Загрузить отчёт JSON<input id="lawFile" type="file" accept="application/json,.json" hidden></label>
      <a class="btn" href="#/admin/laws/history">История</a>
      <span class="small mut">Ждут решения: ${d.pending_count}. Открытых цитат: ${d.open_flags}. Проверок в базе: ${d.checks_total}.</span>
    </div>
    <div id="lawErr"></div>
    <div class="law-grid">${d.documents.map(doc => `<a class="law-card" href="#/admin/laws/doc/${esc(doc.id)}">
      <div class="row between"><b>${esc(doc.short)}</b>${lawBadge(LAW_ST, doc.monitor_status)}</div>
      <span>${esc(doc.title)}</span>
      <small>${doc.mode === 'manual' ? 'Автопроверка недоступна' : 'Успешное чтение: ' + lawWhen(doc.last_ok_at)}</small>
      ${doc.last_error ? `<small class="err-t">${esc(doc.last_error)}</small>` : ''}
      ${doc.pending_proposal_id ? '<small>Есть карточка на решение</small>' : ''}
      ${doc.open_flags ? `<small>Открытых цитат: ${doc.open_flags}</small>` : ''}
    </a>`).join('')}</div>`);
  // карточка документа раскрывается прямо в сетке: решение по правке — без перехода
  $$('.law-card').forEach(card => card.onclick = (ev) => {
    if (ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.button) return;
    ev.preventDefault();
    const code = card.getAttribute('href').split('/').pop();
    inlineOpen(card, 'law' + code, (put) => lawDocView(code, put, { inline: true, onDecided: (r) => {
      const doc = d.documents.find(x => x.id === code);
      if (doc && r && r.doc && r.doc.document) Object.assign(doc, r.doc.document);
      const small = [...card.querySelectorAll('small')].find(x => x.textContent === 'Есть карточка на решение'); if (small) small.remove();
    } }));
  });
  $('#lawFile').onchange = async (ev) => {
    const file = ev.target.files && ev.target.files[0];
    const box = $('#lawErr');
    if (!file) return;
    if (file.size > 1400000) { box.innerHTML = '<div class="alert err">Файл больше 1,4 МБ. В отчёте нужны diff по пунктам, не полный кодекс.</div>'; return; }
    let payload;
    try { payload = JSON.parse(await file.text()); }
    catch (_) { box.innerHTML = '<div class="alert err">Файл не JSON.</div>'; return; }
    payload.source = 'upload';
    try {
      const r = await api('POST', '/api/admin/laws/reports', payload);
      toast(r.duplicate ? 'Такой отчёт уже записан' : 'Отчёт опубликован');
      render({ silent: true });
    } catch (e) { box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; toast(e.message, true); }
  };
}, { role: 'admin' });

route('/admin/laws/history', async () => {
  const d = await api('GET', '/api/admin/laws/history');
  const act = { 'report.ingest': 'опубликован отчёт', 'proposal.open': 'открыта карточка', 'proposal.approve': 'редакция принята', 'proposal.reject': 'отклонено', 'flag.ack': 'цитата просмотрена', 'flag.cleared_by_check': 'проверка сняла пометку' };
  setView(`<p><a href="#/admin/laws">← Законодательство</a></p><h1>История решений</h1>${adminNav('/admin/laws')}
    ${d.events.length ? `<ol class="tl">${d.events.map(e => `<li><div><b>${esc(act[e.action] || e.action)}</b> ${e.doc_id ? '· ' + esc(e.doc_id) : ''}<div class="small mut">${lawWhen(e.at)}${e.actor_name ? ' · ' + esc(e.actor_name) : ''}</div>${e.details && e.details.note ? `<div>${esc(e.details.note)}</div>` : ''}${e.details && e.details.summary ? `<div class="small">${esc(e.details.summary)}</div>` : ''}</div></li>`).join('')}</ol>` : '<div class="alert info">Событий ещё нет.</div>'}`);
}, { role: 'admin' });

route('/admin/laws/doc/:id', async (id) => lawDocView(id, setView, {}), { role: 'admin' });
// Документ и решение по правке — отдельной страницей или раскрытием в сетке документов (o.inline).
async function lawDocView(id, put, o) {
  const d = o.data || await api('GET', '/api/admin/laws/docs/' + encodeURIComponent(id));
  const doc = d.document;
  const pending = d.pending;
  put(`${o.inline ? `<div class="row between"><h3>${esc(doc.short)}</h3>${lawBadge(LAW_ST, doc.monitor_status)}</div>` : `<p><a href="#/admin/laws">← Все документы</a></p>
    <div class="row between"><h1>${esc(doc.short)}</h1>${lawBadge(LAW_ST, doc.monitor_status)}</div>`}
    <p class="lead">${esc(doc.title)}</p>
    <p><a href="${esc(doc.url)}" target="_blank" rel="noopener">Тема на форуме</a></p>
    ${doc.mode === 'manual' ? `<div class="alert warn"><b>Автопроверка недоступна.</b> ${esc(doc.manual_reason)}</div>` : ''}
    <div class="grid stats3">
      <div class="stat"><b>${lawWhen(doc.last_ok_at)}</b>последнее успешное чтение</div>
      <div class="stat"><b>${lawWhen(doc.last_error_at)}</b>последний сбой</div>
      <div class="stat"><b>${doc.open_flags}</b>открытых цитат</div>
    </div>
    ${doc.last_error ? `<div class="alert err">${esc(doc.last_error)}</div>` : ''}
    ${doc.edition_old || doc.edition_new ? `<p class="small mut">Редакция в отчёте: ${esc(doc.edition_old || '—')} → ${esc(doc.edition_new || '—')}${doc.accepted_edition ? '. Принятая подпись редакции: ' + esc(doc.accepted_edition) : ''}</p>` : ''}
    ${(d.latest) ? `<div class="card"><h2>${pending ? 'Карточка на решение' : 'Последняя карточка'}</h2><p>${lawBadge(PROP_ST, d.latest.proposal.status)} ${esc(d.latest.proposal.summary)}</p>
      ${d.latest.proposal.check && d.latest.proposal.check.offline ? '<div class="alert warn">Карточка из офлайн-отчёта.</div>' : ''}
      ${diffBlock(d.latest.diff)}
      <h3>Вопросы и цитаты</h3>
      <p class="small mut">Кнопка «Оставить как есть» только закрывает пометку. Формулировка и правильный ответ остаются прежними. Новый ответ здесь задать нельзя.</p>
      ${questionRows(d.latest.questions)}
      ${pending ? `<form id="lawDecide" class="law-decide">
        <label class="f"><span>Комментарий к решению</span><textarea name="note" required minlength="8" maxlength="1000" placeholder="Что проверили и почему принимаете или отклоняете"></textarea></label>
        <div class="row">
          <button class="btn gold" type="submit" value="approve">Принять редакцию</button>
          <button class="btn" type="submit" value="reject">Отклонить</button>
        </div>
        <p class="small mut">Принятие не переписывает вопросы и не обновляет файлы в репозитории.</p>
        <div id="lawDecErr"></div>
      </form>` : '<p class="small mut">Решение уже записано. Формулировки и правильные ответы вопросов не менялись.</p>'}
      </div>` : '<div class="alert info">Проверок по этому документу ещё не публиковали.</div>'}
    <h2>Прошлые карточки</h2>
    ${d.proposals.length ? `<ul class="law-past">${d.proposals.map(p => `<li>${lawBadge(PROP_ST, p.status)} ${esc(p.summary)} <span class="small mut">${lawWhen(p.created_at)}</span></li>`).join('')}</ul>` : '<p class="mut">Пока нет.</p>'}
    <h2>События</h2>
    ${d.events.length ? `<ul class="law-past">${d.events.map(e => `<li><span class="small mut">${lawWhen(e.at)} ${esc(e.actor_name || '')}</span> ${esc(e.action)}</li>`).join('')}</ul>` : ''}`);
  const form = $('#lawDecide');
  if (form && pending) {
    form.querySelectorAll('button[type=submit]').forEach(btn => btn.addEventListener('click', () => { form.dataset.action = btn.value; }));
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const box = $('#lawDecErr'); box.innerHTML = '';
      const action = ev.submitter ? ev.submitter.value : form.dataset.action;
      if (action === 'reject' && !confirm('Отклонить правку? Решение попадёт в историю.')) return;
      form.querySelectorAll('button').forEach(b => { b.disabled = true; });
      try {
        const r = await api('POST', `/api/admin/laws/proposals/${pending.proposal.id}/decision`, { action, generation: pending.proposal.generation, note: form.note.value });
        toast(r.message || 'Решение записано');
        if (o.onDecided) o.onDecided(r);
        quiet(() => lawDocView(id, put, { ...o, data: r && r.doc && r.doc.document ? r.doc : undefined }));
      } catch (e) { form.querySelectorAll('button').forEach(b => { b.disabled = false; }); box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; toast(e.message, true); }
    };
  }
  $$('[data-ack]').forEach(btn => btn.onclick = async () => {
    const note = prompt('Почему текущий вопрос остаётся без правки ответа?');
    if (note === null) return;
    try { const r = await api('POST', '/api/admin/laws/flags/' + btn.dataset.ack + '/ack', { note }); toast(r.message || 'Отмечено'); quiet(() => lawDocView(id, put, { ...o, data: undefined })); }
    catch (e) { toast(e.message, true); }
  });
}
