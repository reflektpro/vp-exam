/* Панель управления (администратор / проверяющий). Права проверяются на сервере. */
'use strict';
function adminNav(active) {
  const items = [['/admin', 'Сводка', 'examiner'], ['/admin/attempts', 'Проверка', 'examiner'], ['/admin/users', 'Кандидаты', 'examiner'],
    ['/admin/lectures', 'Лекции', 'admin'], ['/admin/exams', 'Экзамены', 'admin'], ['/admin/settings', 'Настройки', 'admin'], ['/admin/audit', 'Журнал', 'admin']];
  return `<div class="subnav">${items.filter(i => hasRole(i[2])).map(i => `<a href="#${i[0]}" class="${active === i[0] ? 'on' : ''}">${i[1]}</a>`).join('')}</div>`;
}
function formObj(form) {
  const o = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'checkbox') o[el.name] = el.checked;
    else if (el.type === 'number') o[el.name] = el.value === '' ? 0 : Number(el.value);
    else o[el.name] = el.value;
  }
  return o;
}
function bindRows() { $$('tr.click').forEach(tr => tr.onclick = () => { location.hash = tr.dataset.href; }); }
const yes = v => v ? '✔' : '—';
// Блок «Статус публикации» + кнопки сохранения (общий для лекций и экзаменов).
function pubBlock(published, female) {
  const pub = female ? 'Опубликована' : 'Опубликован';
  return `<div class="pubbox">
    <div class="row between"><b>Статус:</b> <span id="pubNow">${published ? `<span class="badge ok">${pub} — видно кандидатам</span>` : '<span class="badge warn">Черновик — кандидаты не видят</span>'}</span></div>
    <label class="f" style="margin:10px 0"><span>Статус после сохранения</span><select name="pubstatus" class="pubsel">
      <option value="0" ${published ? '' : 'selected'}>Черновик (не виден кандидатам)</option>
      <option value="1" ${published ? 'selected' : ''}>${pub} (виден кандидатам)</option></select></label>
    <div class="row"><button type="submit" class="btn gold" id="saveBtn">Сохранить</button>
      <button type="button" class="btn" data-pub="0">Сохранить черновик</button>
      <button type="button" class="btn primary" data-pub="1">${published ? 'Сохранить и оставить опубликованным' : 'Опубликовать'}</button></div>
    <div id="ferr" class="ferr"></div></div>`;
}
// Навешивает обработчики: save(published:boolean) должен вернуть Promise.
function bindPub(form, save) {
  const sel = form.querySelector('.pubsel');
  const run = async (pub) => {
    const btns = $$('.pubbox button', form); btns.forEach(b => b.disabled = true);
    const ferr = form.querySelector('#ferr'); ferr.innerHTML = '';
    try { await save(pub); }
    catch (e) { ferr.innerHTML = `<div class="alert err"><b>Не сохранено:</b> ${esc(e.message)}</div>`; toast('Не сохранено: ' + e.message, true); }
    btns.forEach(b => b.disabled = false);
  };
  form.onsubmit = (ev) => { ev.preventDefault(); run(sel.value === '1'); };
  $$('[data-pub]', form).forEach(b => b.onclick = () => { sel.value = b.dataset.pub; run(b.dataset.pub === '1'); });
  form.addEventListener('input', (ev) => { if (ev.target !== sel) form.querySelector('#ferr').innerHTML = ''; });
}
async function quickPublish(kind, id, pub, errBox) {
  try { await api('PUT', `/api/admin/${kind}/${id}`, { published: pub }); toast(pub ? 'Опубликовано' : 'Снято с публикации'); render(); }
  catch (e) { if (errBox) errBox.innerHTML = `<div class="alert err"><b>Не удалось ${pub ? 'опубликовать' : 'снять с публикации'}:</b> ${esc(e.message)}</div>`; toast(e.message, true); }
}


route('/admin', async () => {
  const s = await api('GET', '/api/admin/stats');
  setView(`<h1>Управление</h1>${adminNav('/admin')}
    <div class="grid">
      <div class="stat"><b>${s.pending_review}</b>попыток ждут проверки</div>
      <div class="stat"><b>${s.users}</b>пользователей</div>
      <div class="stat"><b>${s.passed}</b>сдали экзамен</div>
      <div class="stat"><b>${s.in_progress}</b>экзаменов идёт сейчас</div>
      <div class="stat"><b>${s.lectures_published} / ${s.lectures}</b>лекций опубликовано</div>
      <div class="stat"><b>${s.exams}</b>экзаменов</div>
    </div>
    ${hasRole('admin') ? `<div class="card flat" style="margin-top:18px"><h3>Как наполнить сайт</h3><ol class="small">
      <li>«Лекции» → «Добавить лекцию»: название, ссылка на видео (mp4/webm), длительность (кнопка «Определить по видео»), порядок, «Опубликована».</li>
      <li>«Экзамены» → «Создать экзамен»: параметры, затем вопросы (один ответ / несколько / краткий / развёрнутый). Опубликуйте экзамен.</li>
      <li>В каждом экзамене блок «Обязательные лекции»: все опубликованные лекции (по умолчанию), только выбранные или без лекций. Экзамен открывается кандидату, когда просмотрены его лекции.</li>
      <li>Попытки с текстовыми ответами попадают в «Проверка».</li></ol></div>` : ''}`);
});

// ---------- лекции ----------
route('/admin/lectures', async () => {
  const { lectures } = await api('GET', '/api/admin/lectures');
  setView(`<h1>Лекции</h1>${adminNav('/admin/lectures')}
    <p><a class="btn gold" href="#/admin/lecture/new">+ Добавить лекцию</a></p><div id="lerr"></div>
    ${lectures.length ? `<table><tr><th>Порядок</th><th>Название</th><th>Длительность</th><th>Обязательная</th><th>Статус</th><th>Просмотрели</th><th></th></tr>
    ${lectures.map((l, i) => `<tr><td><button class="btn sm" data-up="${i}" ${i ? '' : 'disabled'}>↑</button> <button class="btn sm" data-down="${i}" ${i < lectures.length - 1 ? '' : 'disabled'}>↓</button></td>
      <td><a href="#/admin/lecture/${l.id}">${esc(l.title)}</a> ${l.type === 'youtube' ? '<span class="badge info">YouTube</span>' : l.type === 'file' ? '<span class="badge">файл</span>' : '<span class="badge warn">нет видео</span>'}</td><td>${fmtTime(l.duration_sec)}</td><td>${yes(l.required)}</td><td>${l.published ? '<span class="badge ok">опубликована</span>' : '<span class="badge warn">черновик</span>'}</td><td>${l.watched_count}</td>
      <td style="white-space:nowrap"><a class="btn sm" href="#/admin/lecture/${l.id}">Изменить</a> ${l.published ? `<button class="btn sm" data-unpub="${l.id}">Снять с публикации</button>` : `<button class="btn sm primary" data-pubnow="${l.id}">Опубликовать</button>`}</td></tr>`).join('')}</table>` : '<div class="alert info">Лекций пока нет.</div>'}`);
  const ids = lectures.map(l => l.id);
  const move = async (i, d) => { const a = ids.slice(); [a[i], a[i + d]] = [a[i + d], a[i]]; await api('POST', '/api/admin/lectures/reorder', { ids: a }); render(); };
  $$('[data-up]').forEach(b => b.onclick = () => move(+b.dataset.up, -1));
  $$('[data-down]').forEach(b => b.onclick = () => move(+b.dataset.down, 1));
  $$('[data-pubnow]').forEach(b => b.onclick = () => quickPublish('lectures', b.dataset.pubnow, true, $('#lerr')));
  $$('[data-unpub]').forEach(b => b.onclick = () => quickPublish('lectures', b.dataset.unpub, false, $('#lerr')));
}, { role: 'admin' });

route('/admin/lecture/:id', async (id) => {
  const isNew = id === 'new';
  let l = { title: '', description: '', video_url: '', duration_sec: 0, required: 1, published: 0 };
  if (!isNew) { const { lectures } = await api('GET', '/api/admin/lectures'); l = lectures.find(x => String(x.id) === id); if (!l) throw new Error('Лекция не найдена'); }
  const saved = sessionStorage.getItem('vp_saved_msg'); sessionStorage.removeItem('vp_saved_msg');
  setView(`<p><a href="#/admin/lectures">← Лекции</a></p><h1>${isNew ? 'Новая лекция' : 'Лекция: ' + esc(l.title)}</h1>
    ${saved ? `<div class="alert ok">${esc(saved)}</div>` : ''}
    <form class="card" id="lf" novalidate>
      <label class="f"><span>Название *</span><input name="title" maxlength="200" value="${esc(l.title)}"></label>
      <label class="f"><span>Описание (показывается под видео)</span><textarea name="description" maxlength="10000">${esc(l.description)}</textarea></label>
      <label class="f"><span>Ссылка на видео: YouTube (можно «По ссылке») или прямая ссылка на файл .mp4/.webm, либо путь на сайте videos/lecture1.mp4</span><input name="video_url" maxlength="1000" value="${esc(l.video_url)}" placeholder="https://www.youtube.com/watch?v=…"></label>
      <div class="small" id="vinfo" style="margin:-6px 0 12px"></div>
      <div class="row"><label class="f" style="width:220px"><span>Длительность (сек, мм:сс или чч:мм:сс)</span><input name="duration_sec" maxlength="10" value="${l.duration_sec ? fmtTime(l.duration_sec) : ''}" placeholder="например 12:34"></label>
        <button type="button" class="btn" id="detect">Определить по видео</button><span class="small" id="dinfo"></span></div>
      <label class="chk"><input type="checkbox" name="required" ${l.required ? 'checked' : ''}> Обязательная (нужна для допуска к экзамену)</label>
      ${pubBlock(l.published, true)}
      ${isNew ? '' : '<p style="margin-top:14px"><button type="button" class="btn danger sm" id="del">Удалить лекцию</button></p>'}
    </form>
    <div class="card flat"><h3>Предпросмотр видео</h3><div id="pv" class="mut small">Вставьте ссылку на видео.</div>
    <p class="small mut">Здесь перемотка разрешена — это только проверка для администратора. Кандидат увидит плеер без перемотки.</p></div>`);
  const f = $('#lf'), pvBox = $('#pv'), dinfo = $('#dinfo'), vinfo = $('#vinfo');
  const setD = (t, cls) => { dinfo.innerHTML = t ? `<span class="${cls === 'err' ? 'o-wrong' : cls === 'ok' ? 'o-correct' : 'mut'}">${esc(t)}</span>` : ''; };
  const kind = (u) => {
    if (!u) return { t: 'none' };
    const yt = window.VPMedia.detectYoutubeId(u);
    if (yt) return { t: 'youtube', id: yt };
    if (/youtu\.?be/i.test(u)) return { t: 'bad', msg: 'Не удалось распознать ссылку YouTube — скопируйте ссылку из адресной строки или кнопки «Поделиться».' };
    if (/drive\.google|docs\.google/i.test(u)) return { t: 'bad', msg: 'Google Диск не подходит. Загрузите видео на YouTube с доступом «По ссылке».' };
    if (/discordapp\.(com|net)/i.test(u)) return { t: 'bad', msg: 'Ссылки Discord CDN перестают работать через сутки. Используйте YouTube («По ссылке»).' };
    return { t: 'file' };
  };
  let lastPv = null;
  const refresh = () => {
    const u = f.video_url.value.trim(), k = kind(u);
    vinfo.innerHTML = k.t === 'youtube' ? `<span class="o-correct">Распознано: YouTube, ролик ${esc(k.id)}</span>` : k.t === 'file' ? '<span class="mut">Распознано: файл видео (нужна прямая ссылка на .mp4/.webm)</span>' : k.t === 'bad' ? `<span class="o-wrong">${esc(k.msg)}</span>` : '';
    const key = k.t + ':' + (k.id || u);
    if (key === lastPv) return k; lastPv = key;
    if (k.t === 'youtube') pvBox.innerHTML = `<div style="position:relative;aspect-ratio:16/9;max-height:360px"><iframe src="https://www.youtube.com/embed/${esc(k.id)}?rel=0" style="position:absolute;inset:0;width:100%;height:100%;border:0" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`;
    else if (k.t === 'file') { pvBox.innerHTML = '<video controls preload="metadata" style="width:100%;max-height:360px;background:#000"></video>'; pvBox.querySelector('video').src = u; }
    else pvBox.innerHTML = '<span class="mut small">Вставьте ссылку на видео.</span>';
    return k;
  };
  const detect = async (auto) => {
    const u = f.video_url.value.trim(), k = kind(u);
    if (k.t === 'none') { if (!auto) setD('Сначала вставьте ссылку на видео', 'err'); return; }
    if (k.t === 'bad') { setD(k.msg, 'err'); return; }
    setD(k.t === 'youtube' ? 'Получаю длительность с YouTube…' : 'Загружаю метаданные видео…');
    $('#detect').disabled = true;
    try {
      const d = k.t === 'youtube' ? await window.VPMedia.youtubeDuration(k.id) : await window.VPMedia.fileDuration(new URL(u, location.href).toString());
      f.duration_sec.value = fmtTime(Math.floor(d));
      setD('Длительность видео: ' + fmtTime(Math.floor(d)) + (auto ? ' (определена автоматически)' : '') + ' — не забудьте сохранить.', 'ok');
    } catch (e) { setD(e.message + ' Можно ввести длительность вручную.', 'err'); }
    $('#detect').disabled = false;
  };
  refresh();
  f.video_url.addEventListener('input', () => refresh());
  f.video_url.addEventListener('change', () => { refresh(); const dv = f.duration_sec.value.trim(); if (!dv || dv === '0' || dv === '0:00') detect(true); });
  $('#detect').onclick = () => detect(false);
  if (l.video_url && !l.duration_sec) detect(true);
  bindPub(f, async (pub) => {
    const body = formObj(f); delete body.pubstatus;
    body.published = pub;
    body.duration_sec = String(body.duration_sec || '').trim();
    if (!body.title.trim()) throw new Error('Укажите название лекции.');
    const r = await api(isNew ? 'POST' : 'PUT', '/api/admin/lectures' + (isNew ? '' : '/' + l.id), body);
    const m = r.lecture.published ? 'Лекция сохранена и опубликована — кандидаты её видят.' : 'Лекция сохранена как черновик (кандидаты её не видят). Нажмите «Опубликовать», когда всё готово.';
    toast(r.lecture.published ? 'Лекция опубликована' : 'Черновик сохранён');
    sessionStorage.setItem('vp_saved_msg', m);
    if (isNew) location.hash = '#/admin/lecture/' + r.lecture.id; else render();
  });
  const del = $('#del');
  if (del) del.onclick = async () => { if (!confirm('Удалить лекцию и весь прогресс кандидатов по ней?')) return; try { await api('DELETE', '/api/admin/lectures/' + l.id); location.hash = '#/admin/lectures'; } catch (e) { toast(e.message, true); } };
}, { role: 'admin' });

// ---------- экзамены ----------
route('/admin/exams', async () => {
  const { exams } = await api('GET', '/api/admin/exams');
  setView(`<h1>Экзамены</h1>${adminNav('/admin/exams')}
    <p><a class="btn gold" href="#/admin/exam/new">+ Создать экзамен</a></p><div id="lerr"></div>
    ${exams.length ? `<table><tr><th>Название</th><th>Обязательные лекции</th><th>Вопросов</th><th>Время</th><th>Проходной</th><th>Попыток</th><th>На проверке</th><th>Статус</th><th></th></tr>
    ${exams.map(e => `<tr class="click" data-href="#/admin/exam/${e.id}"><td>${esc(e.title)}</td><td class="small" style="max-width:320px">${examLecSummary(e)}</td><td>${e.question_count}</td><td>${e.time_limit_min ? e.time_limit_min + ' мин' : '∞'}</td><td>${e.pass_pct}%</td><td>${e.attempt_count}</td><td>${e.pending_count}</td><td>${e.published ? '<span class="badge ok">опубликован</span>' : '<span class="badge warn">черновик</span>'}</td>
      <td style="white-space:nowrap">${e.published ? `<button class="btn sm" data-unpub="${e.id}">Снять с публикации</button>` : `<button class="btn sm primary" data-pubnow="${e.id}">Опубликовать</button>`}</td></tr>`).join('')}</table>` : '<div class="alert info">Экзаменов пока нет.</div>'}`);
  bindRows();
  $$('[data-pubnow]').forEach(b => b.onclick = (ev) => { ev.stopPropagation(); quickPublish('exams', b.dataset.pubnow, true, $('#lerr')); });
  $$('[data-unpub]').forEach(b => b.onclick = (ev) => { ev.stopPropagation(); quickPublish('exams', b.dataset.unpub, false, $('#lerr')); });
}, { role: 'admin' });

// Кратко: какие лекции нужны для экзамена (для строки списка) + предупреждения о черновиках/удалённых.
function examLecSummary(e) {
  let main;
  if (e.lecture_mode === 'none') main = '<span class="mut">не нужны — открыт сразу</span>';
  else if (e.lecture_mode === 'all') main = `все опубликованные <span class="mut">(${e.effective_lecture_count})</span>`;
  else {
    const ls = e.required_lectures || [];
    const names = ls.slice(0, 3).map(l => l.deleted ? `<s class="mut">#${l.id}</s>` : esc(l.title) + (l.published ? '' : ' <span class="badge warn">черновик</span>'));
    main = names.join(', ') + (ls.length > 3 ? ` <span class="mut">и ещё ${ls.length - 3}</span>` : '');
  }
  return main + (e.lecture_warnings || []).map(w => `<div class="lwarn">⚠ ${esc(w)}</div>`).join('');
}
const QTYPE_RU = { single: 'Один правильный ответ', multi: 'Несколько правильных ответов', text: 'Краткий текстовый ответ (ручная проверка)', long: 'Развёрнутый ответ (ручная проверка)' };
route('/admin/exam/:id', async (id) => {
  const isNew = id === 'new';
  let e = { title: '', description: '', time_limit_min: 30, max_attempts: 3, cooldown_min: 60, pass_pct: 70, shuffle_questions: 1, shuffle_options: 1, requires_lectures: 1, lecture_mode: 'all', required_lecture_ids: [], published: 0 }, qs = [];
  const [er, lr] = await Promise.all([isNew ? null : api('GET', '/api/admin/exams/' + encodeURIComponent(id)), api('GET', '/api/admin/lectures')]);
  if (er) { e = er.exam; qs = er.questions; }
  const allLec = lr.lectures;
  setView(`<p><a href="#/admin/exams">← Экзамены</a></p><h1>${isNew ? 'Новый экзамен' : 'Экзамен: ' + esc(e.title)}</h1>
    <form class="card" id="ef">
      <label class="f"><span>Название *</span><input name="title" maxlength="200" required value="${esc(e.title)}"></label>
      <label class="f"><span>Описание / инструкция для кандидата</span><textarea name="description" maxlength="10000">${esc(e.description)}</textarea></label>
      <div class="fgrid">
        <label class="f"><span>Лимит времени, мин (0 — без лимита)</span><input type="number" name="time_limit_min" min="0" max="1440" value="${e.time_limit_min}"></label>
        <label class="f"><span>Макс. попыток (0 — без лимита)</span><input type="number" name="max_attempts" min="0" max="1000" value="${e.max_attempts}"></label>
        <label class="f"><span>Пауза между попытками, мин</span><input type="number" name="cooldown_min" min="0" value="${e.cooldown_min}"></label>
        <label class="f"><span>Проходной балл, %</span><input type="number" name="pass_pct" min="0" max="100" value="${e.pass_pct}"></label>
      </div>
      <label class="chk"><input type="checkbox" name="shuffle_questions" ${e.shuffle_questions ? 'checked' : ''}> Перемешивать вопросы</label>
      <label class="chk"><input type="checkbox" name="shuffle_options" ${e.shuffle_options ? 'checked' : ''}> Перемешивать варианты ответов</label>
      ${reqLecturesBlock(e, allLec)}
      ${pubBlock(e.published, false)}
      ${isNew ? '' : '<p style="margin-top:14px"><button type="button" class="btn danger sm" id="del">Удалить экзамен</button></p>'}
    </form>
    ${isNew ? '<div class="alert info">Сохраните экзамен, чтобы добавить вопросы.</div>' : `<h2>Вопросы (${qs.length}, всего баллов: ${qs.reduce((s, q) => s + q.points, 0)})</h2><div id="qlist"></div>
      <div class="row"><select id="newType">${Object.entries(QTYPE_RU).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select><button class="btn gold" id="addQ" type="button">+ Добавить вопрос</button></div>`}`);
  const reqState = bindReqLectures($('#ef'), allLec);
  bindPub($('#ef'), async (pub) => {
    const body = formObj($('#ef')); delete body.pubstatus; body.published = pub;
    body.required_lectures = reqState();
    if (!String(body.title || '').trim()) throw new Error('Укажите название экзамена.');
    const r = await api(isNew ? 'POST' : 'PUT', '/api/admin/exams' + (isNew ? '' : '/' + e.id), body);
    toast(r.exam.published ? 'Экзамен опубликован' : 'Черновик экзамена сохранён');
    if (isNew) location.hash = '#/admin/exam/' + r.exam.id; else render();
  });
  if (isNew) return;
  $('#del').onclick = async () => { if (!confirm('Удалить экзамен со всеми вопросами и попытками?')) return; try { await api('DELETE', '/api/admin/exams/' + e.id); location.hash = '#/admin/exams'; } catch (err) { toast(err.message, true); } };
  const list = $('#qlist');
  const ids = qs.map(q => q.id);
  qs.forEach((q, i) => list.appendChild(qEditor(q, i, e.id, ids)));
  $('#addQ').onclick = () => {
    const t = $('#newType').value;
    const q = { id: null, type: t, text: '', points: 1, reference: '', options: t === 'single' || t === 'multi' ? [{ text: '' }, { text: '' }] : [], correct: [] };
    const ed = qEditor(q, qs.length, e.id, ids); list.appendChild(ed); ed.querySelector('textarea').focus();
  };
}, { role: 'admin' });

// Блок «Обязательные лекции» в форме экзамена.
function reqLecturesBlock(e, lectures) {
  const all = e.lecture_mode !== 'selected' && e.lecture_mode !== 'none' && !!e.requires_lectures;
  const sel = new Set(e.required_lecture_ids || []);
  const missing = (e.required_lectures || []).filter(l => l.deleted);
  return `<fieldset class="reqbox" id="reqbox"><legend>Обязательные лекции</legend>
    <div class="small mut" style="margin-bottom:6px">Какие лекции кандидат должен досмотреть, чтобы открыть <b>этот</b> экзамен.</div>
    <label class="chk" style="margin-bottom:4px"><input type="checkbox" id="reqAll" ${all ? 'checked' : ''}> <span><b>Все опубликованные лекции</b> <span class="small mut">— по умолчанию, как раньше: все опубликованные лекции с отметкой «Обязательная», включая будущие</span></span></label>
    <div class="small mut" style="margin:8px 0 0">или отметьте только нужные:</div>
    ${lectures.length ? `<div class="reqlist ${all ? 'off' : ''}" id="reqList">${lectures.map((l, i) => `<label class="chk"><input type="checkbox" class="reql" value="${l.id}" ${sel.has(l.id) ? 'checked' : ''} ${all ? 'disabled' : ''}>
      <span>${i + 1}. ${esc(l.title)} ${l.published ? '' : '<span class="badge warn">черновик</span>'}${l.required ? '' : ' <span class="badge">необязательная</span>'}</span></label>`).join('')}</div>` : '<div class="small mut">Лекций пока нет.</div>'}
    ${missing.length ? `<div class="lwarn">⚠ Ранее выбранные лекции удалены: ${missing.map(l => '#' + l.id).join(', ')} — они не учитываются и уберутся при сохранении.</div>` : ''}
    <div id="reqHint" class="alert info small" style="margin:10px 0 0"></div></fieldset>`;
}
function bindReqLectures(form, lectures) {
  const allBox = form.querySelector('#reqAll'), list = form.querySelector('#reqList'), hint = form.querySelector('#reqHint');
  const boxes = () => $$('.reql', form);
  const seq = !!(App.config && App.config.settings && App.config.settings.sequential_lectures);
  const update = () => {
    const all = allBox.checked;
    boxes().forEach(b => b.disabled = all);
    if (list) list.classList.toggle('off', all);
    let html, cls = 'info';
    if (all) {
      const n = lectures.filter(l => l.published && l.required).length;
      html = `Экзамен откроется после просмотра <b>всех опубликованных обязательных лекций</b> (сейчас: ${n}). Новые лекции будут добавляться к условию автоматически.`;
    } else {
      const ids = new Set(boxes().filter(b => b.checked).map(b => Number(b.value)));
      const chosen = lectures.filter(l => ids.has(l.id));
      if (!chosen.length) { cls = 'warn'; html = '<b>Лекции не выбраны — экзамен будет открыт сразу</b>, без просмотра лекций. Если нужны все лекции, отметьте «Все опубликованные лекции».'; }
      else {
        const drafts = chosen.filter(l => !l.published);
        const live = chosen.length - drafts.length;
        html = `Экзамен откроется после просмотра выбранных лекций: <b>${chosen.length}</b>.`;
        if (drafts.length) { cls = 'warn'; html += `<br>⚠ Черновики не учитываются, пока не опубликованы: ${drafts.map(l => '«' + esc(l.title) + '»').join(', ')}.${live ? '' : ' Сейчас экзамен фактически открыт без лекций.'}`; }
        if (seq) {
          // при «строго по порядку» кандидату придётся пройти и предыдущие обязательные лекции, чтобы открыть выбранную
          const pub = lectures.filter(l => l.published);
          const lastIdx = Math.max(...chosen.filter(l => l.published).map(l => pub.indexOf(l)));
          const before = lastIdx > 0 ? pub.slice(0, lastIdx).filter(l => l.required && !ids.has(l.id)) : [];
          if (before.length) html += `<br>ℹ Включено «Открывать лекции строго по порядку»: чтобы открыть выбранные лекции, кандидату сначала придётся посмотреть предыдущие: ${before.map(l => '«' + esc(l.title) + '»').join(', ')}. На сам допуск к экзамену порядок не влияет — проверяются только выбранные лекции.`;
        }
      }
    }
    hint.className = 'alert small ' + cls; hint.innerHTML = html;
  };
  allBox.onchange = update; boxes().forEach(b => b.onchange = update);
  update();
  return () => allBox.checked ? 'all' : boxes().filter(b => b.checked).map(b => Number(b.value));
}

function qEditor(q, i, examId, ids) {
  const el = document.createElement('div'); el.className = 'qedit';
  const choice = q.type === 'single' || q.type === 'multi';
  el.innerHTML = `<div class="row between"><b>Вопрос ${i + 1}${q.id ? '' : ' (новый)'}</b><span class="small mut">${QTYPE_RU[q.type]}</span></div>
    <label class="f"><span>Текст вопроса</span><textarea class="qt" maxlength="5000" rows="2">${esc(q.text)}</textarea></label>
    <div class="fgrid"><label class="f"><span>Тип</span><select class="qtype">${Object.entries(QTYPE_RU).map(([k, v]) => `<option value="${k}" ${k === q.type ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label class="f"><span>Баллы</span><input type="number" class="qp" min="0" max="1000" value="${q.points}"></label></div>
    <div class="opts" ${choice ? '' : 'hidden'}><div class="small mut" style="margin-bottom:6px">Варианты ответа — отметьте правильные:</div><div class="olist"></div><button type="button" class="btn sm addO">+ вариант</button></div>
    <label class="f ref" ${choice ? 'hidden' : ''} style="border:0;padding:0"><span>Эталонный ответ / критерии (видит только проверяющий)</span><textarea class="qr" maxlength="5000" rows="2">${esc(q.reference || '')}</textarea></label>
    <div class="row" style="margin-top:10px"><button type="button" class="btn gold sm save">Сохранить вопрос</button>
      ${q.id ? `<button type="button" class="btn sm up" ${i ? '' : 'disabled'}>↑</button><button type="button" class="btn sm down" ${i < ids.length - 1 ? '' : 'disabled'}>↓</button><button type="button" class="btn danger sm del">Удалить</button>` : '<button type="button" class="btn sm cancel">Отмена</button>'}</div>`;
  const olist = el.querySelector('.olist');
  const addOpt = (o) => {
    const r = document.createElement('div'); r.className = 'optrow';
    const t = el.querySelector('.qtype').value === 'single' ? 'radio' : 'checkbox';
    r.innerHTML = `<input type="${t}" name="c${q.id || 'n' + i}" class="oc" ${o.id && q.correct.includes(o.id) ? 'checked' : ''}><input type="text" class="ot" maxlength="1000" value="${esc(o.text)}" placeholder="Текст варианта"><button type="button" class="btn sm danger rm">✕</button>`;
    r.dataset.oid = o.id || '';
    r.querySelector('.rm').onclick = () => r.remove();
    olist.appendChild(r);
  };
  (q.options || []).forEach(addOpt);
  el.querySelector('.addO').onclick = () => addOpt({ text: '' });
  el.querySelector('.qtype').onchange = (ev) => {
    const t = ev.target.value, ch = t === 'single' || t === 'multi';
    el.querySelector('.opts').hidden = !ch; el.querySelector('.ref').hidden = ch;
    $$('.oc', el).forEach(x => { x.type = t === 'single' ? 'radio' : 'checkbox'; });
    if (ch && !olist.children.length) { addOpt({ text: '' }); addOpt({ text: '' }); }
  };
  el.querySelector('.save').onclick = async () => {
    const type = el.querySelector('.qtype').value;
    const body = { type, text: el.querySelector('.qt').value, points: Number(el.querySelector('.qp').value || 0), reference: el.querySelector('.qr').value };
    if (type === 'single' || type === 'multi') body.options = $$('.optrow', olist).map(r => ({ id: r.dataset.oid || undefined, text: r.querySelector('.ot').value, correct: r.querySelector('.oc').checked }));
    try { await api(q.id ? 'PUT' : 'POST', q.id ? '/api/admin/questions/' + q.id : `/api/admin/exams/${examId}/questions`, body); toast('Вопрос сохранён'); render(); }
    catch (e) { toast(e.message, true); }
  };
  const c = el.querySelector('.cancel'); if (c) c.onclick = () => el.remove();
  const d = el.querySelector('.del'); if (d) d.onclick = async () => { if (!confirm('Удалить вопрос?')) return; try { await api('DELETE', '/api/admin/questions/' + q.id); render(); } catch (e) { toast(e.message, true); } };
  const mv = async (dir) => { const a = ids.slice(); [a[i], a[i + dir]] = [a[i + dir], a[i]]; try { await api('POST', `/api/admin/exams/${examId}/questions/reorder`, { ids: a }); render(); } catch (e) { toast(e.message, true); } };
  const up = el.querySelector('.up'); if (up) up.onclick = () => mv(-1);
  const dn = el.querySelector('.down'); if (dn) dn.onclick = () => mv(1);
  return el;
}

// ---------- кандидаты ----------
route('/admin/users', async () => {
  const q = new URLSearchParams((location.hash.split('?')[1]) || '').get('q') || '';
  const r = await api('GET', '/api/admin/users?q=' + encodeURIComponent(q));
  setView(`<h1>Кандидаты и сотрудники</h1>${adminNav('/admin/users')}
    <form class="row" id="sf" style="margin-bottom:14px"><input name="q" value="${esc(q)}" placeholder="Поиск: Discord ID, ник, игровое имя, статик" style="max-width:420px"><button class="btn">Найти</button></form>
    <table><tr><th>Пользователь</th><th>Игровое имя / статик</th><th>Роль</th><th>Лекции</th><th>Попытки</th><th>Последний вход</th></tr>
    ${r.users.map(u => `<tr class="click" data-href="#/admin/user/${u.id}"><td>${esc(u.global_name || u.username)}<div class="small mut">${esc(u.id)}</div></td><td>${esc(u.ic_name || '—')}<div class="small mut">${esc(u.static_id)}</div></td>
      <td>${esc(ROLE_RU[u.role])}${u.super ? ' ★' : ''}${u.blocked ? ' <span class="badge err">заблокирован</span>' : ''}</td><td>${u.lectures_watched} / ${r.lectures_total}</td><td>${u.attempt_count} ${u.last_status ? badge(u.last_status) : ''}</td><td>${fmtDate(u.last_login_at)}</td></tr>`).join('')}</table>`);
  $('#sf').onsubmit = (ev) => { ev.preventDefault(); location.hash = '#/admin/users?q=' + encodeURIComponent(ev.target.q.value); };
  bindRows();
}, { role: 'examiner' });
route('/admin/users\\?.*', () => App.routes.find(r => r.p === '/admin/users').fn(), { role: 'examiner' });

route('/admin/user/:id', async (id) => {
  const r = await api('GET', '/api/admin/users/' + encodeURIComponent(id));
  const u = r.user, adm = hasRole('admin');
  setView(`<p><a href="#/admin/users">← Кандидаты</a></p>
    <div class="card"><div class="row">${u.avatar_url ? `<img src="${esc(u.avatar_url)}" style="width:56px;height:56px;border-radius:50%">` : ''}<div><h2 style="margin:0">${esc(u.global_name || u.username)}</h2>
      <div class="small mut">@${esc(u.username)} · Discord ID ${esc(u.id)} · создан ${fmtDate(u.created_at)} · вход ${fmtDate(u.last_login_at)}</div>
      <div>Игровое имя: <b>${esc(u.ic_name || '—')}</b> · Статик: <b>${esc(u.static_id || '—')}</b> · Звание: <b>${esc(u.rank || '—')}</b></div></div></div>
      ${adm ? `<div class="row" style="margin-top:14px"><label>Роль: <select id="role" ${u.super ? 'disabled' : ''} style="width:auto">${['candidate', 'examiner', 'admin'].map(x => `<option value="${x}" ${u.role === x ? 'selected' : ''}>${ROLE_RU[x]}</option>`).join('')}</select></label>
        ${u.super ? '<span class="small mut">главный администратор (ADMIN_IDS)</span>' : ''}
        <button class="btn sm" id="blk" ${u.super ? 'disabled' : ''}>${u.blocked ? 'Разблокировать' : 'Заблокировать'}</button></div>` : ''}</div>
    <div class="card flat"><div class="row between"><h3>Прогресс лекций</h3>${adm ? '<button class="btn sm danger" id="rstAll">Сбросить весь прогресс</button>' : ''}</div>
      <table><tr><th>Лекция</th><th>Досмотрено до</th><th>Засчитано времени</th><th>Отклонено heartbeat</th><th>Статус</th>${adm ? '<th></th>' : ''}</tr>
      ${r.lectures.map(l => `<tr><td>${esc(l.title)}${l.published ? '' : ' <span class="badge">черновик</span>'}</td><td>${l.max_pos != null ? fmtTime(l.max_pos) + ' / ' + fmtTime(l.duration_sec) : '—'}</td><td>${l.watched_sec != null ? fmtTime(l.watched_sec) : '—'}</td><td>${l.rejected || 0}</td>
        <td>${l.completed_at ? '<span class="badge ok">' + fmtDate(l.completed_at) + '</span>' : l.started_at ? '<span class="badge info">смотрит</span>' : '—'}</td>${adm ? `<td>${l.started_at ? `<button class="btn sm" data-rl="${l.id}">Сбросить</button>` : ''}</td>` : ''}</tr>`).join('')}</table></div>
    <div class="card flat"><div class="row between"><h3>Попытки экзаменов</h3>${adm ? '<button class="btn sm danger" id="rstAtt">Удалить все попытки</button>' : ''}</div>
      ${r.attempts.length ? `<table><tr><th>№</th><th>Экзамен</th><th>Начата</th><th>Статус</th><th>Результат</th></tr>${r.attempts.map(a => `<tr class="click" data-href="#/admin/attempt/${a.id}"><td>#${a.id}</td><td>${esc(a.exam_title)}</td><td>${fmtDate(a.started_at)}</td><td>${badge(a.status)}</td><td>${a.score_pct != null ? a.score_pct + '%' : '—'}</td></tr>`).join('')}</table>` : '<p class="mut">Нет попыток.</p>'}</div>`);
  bindRows();
  if (!adm) return;
  const act = async (method, path, body, ok) => { try { await api(method, path, body); toast(ok); render(); } catch (e) { toast(e.message, true); } };
  const role = $('#role'); if (role && !u.super) role.onchange = () => act('PUT', '/api/admin/users/' + u.id, { role: role.value }, 'Роль изменена');
  const blk = $('#blk'); if (blk && !u.super) blk.onclick = () => { if (confirm(u.blocked ? 'Разблокировать?' : 'Заблокировать пользователя? Его сессии будут завершены.')) act('PUT', '/api/admin/users/' + u.id, { blocked: !u.blocked }, 'Готово'); };
  $('#rstAll').onclick = () => { if (confirm('Сбросить прогресс всех лекций этого пользователя?')) act('POST', `/api/admin/users/${u.id}/reset-progress`, {}, 'Прогресс сброшен'); };
  $$('[data-rl]').forEach(b => b.onclick = () => { if (confirm('Сбросить прогресс этой лекции?')) act('POST', `/api/admin/users/${u.id}/reset-progress`, { lecture_id: Number(b.dataset.rl) }, 'Прогресс сброшен'); });
  $('#rstAtt').onclick = () => { if (confirm('Удалить все попытки экзаменов этого пользователя? Он сможет сдавать заново.')) act('POST', `/api/admin/users/${u.id}/reset-attempts`, {}, 'Попытки удалены'); };
}, { role: 'examiner' });

// ---------- проверка попыток ----------
route('/admin/attempts', async () => {
  const st = new URLSearchParams((location.hash.split('?')[1]) || '').get('status') ?? 'pending_review';
  const { attempts } = await api('GET', '/api/admin/attempts?status=' + encodeURIComponent(st));
  const tabs = [['pending_review', 'Ждут проверки'], ['passed', 'Сдали'], ['failed', 'Не сдали'], ['in_progress', 'Идут сейчас'], ['', 'Все']];
  setView(`<h1>Проверка попыток</h1>${adminNav('/admin/attempts')}
    <div class="row" style="margin-bottom:12px">${tabs.map(([k, v]) => `<a class="btn sm ${k === st ? 'gold' : ''}" href="#/admin/attempts?status=${k}">${v}</a>`).join('')}</div>
    ${attempts.length ? `<table><tr><th>№</th><th>Кандидат</th><th>Экзамен</th><th>Отправлена</th><th>Статус</th><th>Баллы</th></tr>
    ${attempts.map(a => `<tr class="click" data-href="#/admin/attempt/${a.id}"><td>#${a.id}</td><td>${esc(a.ic_name || a.global_name || a.username)}<div class="small mut">${esc(a.static_id || a.user_id)}</div></td><td>${esc(a.exam_title)}</td><td>${fmtDate(a.submitted_at)}${a.expired ? ' <span class="badge warn">по таймеру</span>' : ''}</td><td>${badge(a.status)}</td><td>${a.score_pct != null ? a.score_pct + '%' : '—'}</td></tr>`).join('')}</table>` : '<div class="alert info">Нет попыток в этом разделе.</div>'}`);
  bindRows();
}, { role: 'examiner' });
route('/admin/attempts\\?.*', () => App.routes.find(r => r.p === '/admin/attempts').fn(), { role: 'examiner' });

route('/admin/attempt/:id', async (id) => {
  const r = await api('GET', '/api/admin/attempts/' + encodeURIComponent(id));
  const a = r.attempt, u = r.user;
  const items = r.items.map((it, i) => {
    const q = it.question; let body = '';
    if (q.type === 'single' || q.type === 'multi') {
      const chosen = Array.isArray(it.answer) ? it.answer : it.answer ? [it.answer] : [];
      body = '<ul>' + q.options.map(o => { const c = chosen.includes(o.id), ok = q.correct.includes(o.id);
        return `<li class="${c ? 'o-chosen' : ''} ${ok ? 'o-correct' : c ? 'o-wrong' : ''}">${c ? '☑' : '☐'} ${esc(o.text)}${ok ? ' — правильный' : ''}</li>`; }).join('') + '</ul>';
      body += `<div class="small">Автопроверка: <b>${it.auto_points ?? 0} / ${q.points}</b></div>`;
      body += `<div class="row small" style="margin-top:6px">Изменить баллы вручную: <input type="number" class="pts" data-q="${q.id}" min="0" max="${q.points}" step="0.5" value="${it.manual_points ?? ''}" placeholder="авто" style="width:90px"></div>`;
    } else {
      body = `<div class="ans">${it.answer ? esc(it.answer) : '<span class="mut">(нет ответа)</span>'}</div>${q.reference ? `<div class="ref"><b>Эталон:</b> ${esc(q.reference)}</div>` : ''}
        <div class="row">Баллы: <input type="number" class="pts" data-q="${q.id}" min="0" max="${q.points}" step="0.5" value="${it.manual_points ?? ''}" style="width:90px"> / ${q.points} ${it.needs_review && it.manual_points == null ? '<span class="badge warn">требует оценки</span>' : ''}</div>`;
    }
    return `<div class="q"><div class="row between"><span class="small mut">Вопрос ${i + 1} · ${esc(QTYPE_RU[q.type] || q.type)}</span><span class="small mut">${q.points} балл(ов)</span></div><div class="qt">${esc(q.text)}</div>${body}</div>`;
  }).join('');
  setView(`<p><a href="#/admin/attempts">← Проверка</a></p>
    <div class="card"><div class="row between"><h2 style="margin:0">Попытка #${a.id} — ${esc(r.exam ? r.exam.title : '')}</h2>${badge(a.status)}</div>
      <p>Кандидат: <a href="#/admin/user/${esc(a.user_id)}">${esc(userName(u))}</a> <span class="mut small">(${esc(u ? u.username : '')}, ${esc(a.user_id)}${u && u.static_id ? ', статик ' + esc(u.static_id) : ''})</span></p>
      <p class="small mut">Начата ${fmtDate(a.started_at)} · отправлена ${fmtDate(a.submitted_at)}${a.expired ? ' (автоматически по таймеру)' : ''} · автобаллы ${a.auto_score} · ручные ${a.manual_score} · максимум ${a.max_score} · итог ${a.score_pct != null ? a.score_pct + '%' : '—'} (проходной ${r.exam ? r.exam.pass_pct : '?'}%)</p>
      ${a.reviewed_at ? `<p class="small mut">Проверил: ${esc(r.reviewer ? (r.reviewer.global_name || r.reviewer.username) : a.reviewer_id)} · ${fmtDate(a.reviewed_at)}</p>` : ''}</div>
    ${items}
    ${a.status === 'in_progress' ? '<div class="alert info">Кандидат ещё проходит экзамен.</div>' : `<form class="card" id="rf"><h3>Итог проверки</h3>
      <label class="f"><span>Решение</span><select name="verdict"><option value="auto">По баллам (≥ ${r.exam ? r.exam.pass_pct : '?'}% — сдан)</option><option value="passed" ${a.status === 'passed' ? '' : ''}>Сдан (вручную)</option><option value="failed">Не сдан (вручную)</option></select></label>
      <label class="f"><span>Комментарий для кандидата</span><textarea name="comment" maxlength="5000">${esc(a.reviewer_comment || '')}</textarea></label>
      <button class="btn gold">Сохранить проверку</button> ${hasRole('admin') ? '<button type="button" class="btn danger" id="delA">Удалить попытку</button>' : ''}</form>`}`);
  const rf = $('#rf');
  if (rf) rf.onsubmit = async (ev) => {
    ev.preventDefault();
    const points = {}; $$('.pts').forEach(x => { if (x.value !== '') points[x.dataset.q] = Number(x.value); });
    try { await api('POST', `/api/admin/attempts/${a.id}/review`, { points, verdict: rf.verdict.value, comment: rf.comment.value }); toast('Проверка сохранена'); render(); }
    catch (e) { toast(e.message, true); }
  };
  const dA = $('#delA'); if (dA) dA.onclick = async () => { if (!confirm('Удалить попытку? Кандидат сможет пройти экзамен заново.')) return; try { await api('DELETE', '/api/admin/attempts/' + a.id); location.hash = '#/admin/attempts'; } catch (e) { toast(e.message, true); } };
}, { role: 'examiner' });

// ---------- настройки и журнал ----------
route('/admin/settings', async () => {
  const { settings: s } = await api('GET', '/api/admin/settings');
  setView(`<h1>Настройки сайта</h1>${adminNav('/admin/settings')}
    <form class="card" id="sf">
      <label class="f"><span>Название сайта</span><input name="site_title" maxlength="120" value="${esc(s.site_title)}"></label>
      <label class="f"><span>Приветственный текст (главная и страница входа)</span><textarea name="welcome_text" maxlength="5000" rows="5">${esc(s.welcome_text)}</textarea></label>
      <label class="chk" style="margin-bottom:2px"><input type="checkbox" name="sequential_lectures" ${s.sequential_lectures ? 'checked' : ''}> Открывать лекции строго по порядку</label>
      <div class="small mut" style="margin:0 0 14px 26px">Влияет только на очерёдность просмотра: следующая лекция открывается после предыдущих обязательных. На допуск к экзаменам порядок не влияет — каждый экзамен проверяет только свои обязательные лекции (они выбираются в настройках экзамена). Если нужная экзамену лекция стоит, например, третьей, кандидат всё равно сначала посмотрит первые две, чтобы её открыть; чтобы этого не было — выключите настройку или поставьте эту лекцию выше в списке.</div>
      <button class="btn gold">Сохранить</button></form>
    <div class="card flat"><h3>Вход через Discord</h3><p class="small">OAuth: ${App.config && App.config.oauth_configured ? '<span class="badge ok">настроен</span>' : '<span class="badge err">не настроен</span>'}</p>
      <p class="small mut">Redirect URI для Discord-приложения:</p><pre class="code">${esc(App.config ? App.config.redirect_uri : '')}</pre>
      <p class="small mut">Главные администраторы задаются переменной ADMIN_IDS в Worker. Другим пользователям роль назначается на странице пользователя.</p></div>`);
  $('#sf').onsubmit = async (ev) => {
    ev.preventDefault();
    try { const r = await api('PUT', '/api/admin/settings', formObj(ev.target)); App.config.settings = r.settings; renderHeader(); toast('Настройки сохранены'); }
    catch (e) { toast(e.message, true); }
  };
}, { role: 'admin' });

const ACTION_RU = { 'lecture.create': 'Создана лекция', 'lecture.update': 'Изменена лекция', 'lecture.delete': 'Удалена лекция', 'lectures.reorder': 'Порядок лекций',
  'exam.create': 'Создан экзамен', 'exam.update': 'Изменён экзамен', 'exam.delete': 'Удалён экзамен', 'question.create': 'Добавлен вопрос', 'question.update': 'Изменён вопрос',
  'question.delete': 'Удалён вопрос', 'questions.reorder': 'Порядок вопросов', 'user.update': 'Изменён пользователь', 'user.reset_progress': 'Сброс прогресса лекций',
  'user.reset_attempts': 'Сброс попыток', 'attempt.review': 'Проверка попытки', 'attempt.delete': 'Удалена попытка', 'settings.update': 'Настройки сайта' };
route('/admin/audit', async () => {
  const { log } = await api('GET', '/api/admin/audit');
  setView(`<h1>Журнал действий</h1>${adminNav('/admin/audit')}
    ${log.length ? `<table><tr><th>Время</th><th>Кто</th><th>Действие</th><th>Объект</th><th>Детали</th></tr>${log.map(l => `<tr><td>${fmtDate(l.at)}</td><td>${esc(l.global_name || l.username || l.actor_id)}</td><td>${esc(ACTION_RU[l.action] || l.action)}</td><td>${esc(l.target || '')}</td><td class="small mut" style="max-width:380px;word-break:break-word">${esc((l.details || '').slice(0, 300))}</td></tr>`).join('')}</table>` : '<div class="alert info">Журнал пуст.</div>'}`);
}, { role: 'admin' });
