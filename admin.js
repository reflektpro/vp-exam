/* Панель управления (администратор / проверяющий). Права проверяются на сервере. */
'use strict';
function adminNav(active) {
  const items = [['/admin', 'Сводка', 'examiner'], ['/admin/attempts', 'Проверка', 'examiner'], ['/admin/users', 'Кандидаты', 'examiner'],
    ['/admin/lectures', 'Лекции', 'admin'], ['/admin/exams', 'Экзамены', 'admin'], ['/admin/bank', 'Банк вопросов', 'admin'], ['/admin/reatt', 'Переаттестация', 'admin'], ['/admin/settings', 'Настройки', 'admin'], ['/admin/audit', 'Журнал', 'admin']];
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
      <div class="stat"><b>${s.bank_questions} + ${s.bank_cases}</b>вопросов + кейсов в банке</div>
      <div class="stat"><b>${s.reatt_pending} / ${s.reatt_total}</b>переаттестаций ждут проверки / всего</div>
    </div>
    ${hasRole('admin') ? `<div class="card flat" style="margin-top:18px"><h3>Как наполнить сайт</h3><ol class="small">
      <li>«Лекции» → «Добавить лекцию»: название, ссылка на видео (mp4/webm), длительность (кнопка «Определить по видео»), порядок, «Опубликована».</li>
      <li>«Экзамены» → «Создать экзамен»: параметры, затем вопросы (один ответ / несколько / краткий / развёрнутый). Опубликуйте экзамен.</li>
      <li>В каждом экзамене блок «Обязательные лекции»: все опубликованные лекции (по умолчанию), только выбранные или без лекций. Экзамен открывается кандидату, когда просмотрены его лекции.</li>
      <li>Попытки с ответами на ручную проверку (свободная форма, кейсы, файлы, голосовые) попадают в «Проверка».</li>
      <li>«Банк вопросов» — вопросы и кейсы переаттестации по категориям (ПК, УК, ВУ…), импорт JSON. «Переаттестация» — квоты обеих версий.</li></ol></div>` : ''}`);
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
const QTYPE_RU = window.QT.LABELS;
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
      <div class="row"><select id="newType" style="max-width:340px">${Object.entries(QTYPE_RU).map(([k, v]) => `<option value="${k}">${window.QT.ICONS[k]} ${v}</option>`).join('')}</select><button class="btn gold" id="addQ" type="button">+ Добавить вопрос</button>
        <button class="btn" id="impQ" type="button">Импорт JSON</button><button class="btn" id="expQ" type="button">Экспорт JSON</button></div><div id="impBox"></div>`}`);
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
  const qopts = { createPath: `/api/admin/exams/${e.id}/questions`, reorderPath: `/api/admin/exams/${e.id}/questions/reorder`, ids, open: qs.length <= 8 };
  qs.forEach((q, i) => list.appendChild(qCard(q.native, i, qopts)));
  $('#addQ').onclick = () => { const ed = qCard({ id: null, type: $('#newType').value, points: $('#newType').value === 'case' ? 5 : 1 }, qs.length, { ...qopts, open: true }); list.appendChild(ed); ed.querySelector('textarea').focus(); };
  $('#impQ').onclick = () => importBox($('#impBox'), `/api/admin/exams/${e.id}/import`, false);
  $('#expQ').onclick = () => exportJson(`/api/admin/exams/${e.id}/export`, 'exam-' + e.id + '-questions.json');
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

// Карточка вопроса: краткий вид + редактор (общий для экзаменов и банка).
function qSummary(q) {
  const extra = [];
  if (q.category) extra.push(esc(q.category));
  if (q.kind === 'case') extra.push('<span class="badge warn">кейс</span>');
  if (q.easy) extra.push('<span class="badge ok">не душный</span>');
  if (q.active === false) extra.push('<span class="badge err">выключен</span>');
  if (q.ext_id && /^example-/.test(q.ext_id)) extra.push('<span class="badge info">ПРИМЕР</span>');
  return `${window.QT.ICONS[q.type] || ''} <span class="small mut">${esc(QTYPE_RU[q.type] || q.type)} · ${q.points} б.</span> ${extra.join(' ')}<div class="qsum-t">${esc(String(q.text || '').slice(0, 220))}${String(q.text || '').length > 220 ? '…' : ''}</div>`;
}
function qCard(q, i, o) {
  const el = document.createElement('div'); el.className = 'qedit'; if (q.id) el.dataset.qid = q.id;
  el.innerHTML = `<div class="row between"><b>${o.bank ? '#' + (q.id || 'новый') : 'Вопрос ' + (i + 1)}${q.id ? '' : ' (новый)'}</b>
    <span class="row" style="gap:6px">${q.id ? `<button type="button" class="btn sm tgl">${o.open ? 'Свернуть' : 'Изменить'}</button>` : ''}
    ${q.id && o.reorderPath ? `<button type="button" class="btn sm up" ${i ? '' : 'disabled'}>↑</button><button type="button" class="btn sm down" ${i < o.ids.length - 1 ? '' : 'disabled'}>↓</button>` : ''}
    ${q.id ? '<button type="button" class="btn sm try">Проверить как кандидат</button><button type="button" class="btn danger sm del">Удалить</button>' : ''}</span></div>
    <div class="qsum" ${o.open || !q.id ? 'hidden' : ''}>${qSummary(q)}</div><div class="qed" ${o.open || !q.id ? '' : 'hidden'}></div><div class="qtry"></div>`;
  const ed = window.QT.editor(q, { bank: !!o.bank, categories: o.categories });
  el.querySelector('.qed').appendChild(ed.el);
  el.querySelector('.qed').appendChild(h2(`<div class="row" style="margin-top:10px"><button type="button" class="btn gold sm save">Сохранить вопрос</button>${q.id ? '' : '<button type="button" class="btn sm cancel">Отмена</button>'}<span class="qerr small"></span></div>`));
  const tg = el.querySelector('.tgl'); if (tg) tg.onclick = () => { const ed2 = el.querySelector('.qed'); ed2.hidden = !ed2.hidden; el.querySelector('.qsum').hidden = !ed2.hidden; tg.textContent = ed2.hidden ? 'Изменить' : 'Свернуть'; };
  el.querySelector('.save').onclick = async () => {
    const err = el.querySelector('.qerr'); err.innerHTML = '';
    try { const body = ed.get(); const r = await api(q.id ? 'PUT' : 'POST', q.id ? '/api/admin/questions/' + q.id : o.createPath, body); toast('Вопрос сохранён'); if (o.onSaved) o.onSaved(r.question); else render(); }
    catch (e) { err.innerHTML = `<span class="o-wrong">Не сохранено: ${esc(e.message)}</span>`; toast(e.message, true); }
  };
  const c = el.querySelector('.cancel'); if (c) c.onclick = () => el.remove();
  const d = el.querySelector('.del'); if (d) d.onclick = async () => { if (!confirm('Удалить вопрос?')) return; try { await api('DELETE', '/api/admin/questions/' + q.id); if (o.onSaved) o.onSaved(null); else render(); } catch (e) { toast(e.message, true); } };
  const mv = async (dir) => { const a = o.ids.slice(); [a[i], a[i + dir]] = [a[i + dir], a[i]]; try { await api('POST', o.reorderPath, { ids: a }); render(); } catch (e) { toast(e.message, true); } };
  const up = el.querySelector('.up'); if (up) up.onclick = () => mv(-1);
  const dn = el.querySelector('.down'); if (dn) dn.onclick = () => mv(1);
  const tr = el.querySelector('.try'); if (tr) tr.onclick = () => tryQuestion(el.querySelector('.qtry'), q.id);
  return el;
}
function h2(html) { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; }
async function tryQuestion(box, qid) {
  if (box.dataset.open) { box.innerHTML = ''; delete box.dataset.open; return; }
  box.dataset.open = '1';
  try {
    const r = await api('POST', `/api/admin/questions/${qid}/try`, {});
    box.innerHTML = `<div class="trybox"><div class="small mut">Так вопрос увидит кандидат (варианты перемешаны). Ответьте и нажмите «Проверить».</div><div class="q"><div class="qt">${esc(r.question.text)}</div></div><div class="row"><button type="button" class="btn sm gold chk2">Проверить ответ</button><span class="tres small"></span></div></div>`;
    const ctl = window.QT.mount(box.querySelector('.q'), r.question, null, null, { upload: async () => { throw new Error('В режиме проверки файлы не загружаются'); } });
    box.querySelector('.chk2').onclick = async () => {
      try { const g = await api('POST', `/api/admin/questions/${qid}/try`, { state: r.state, answer: ctl.get() ?? null });
        box.querySelector('.tres').innerHTML = g.grade.nr ? '<span class="badge warn">ручная проверка</span>' : `Баллы: <b>${g.grade.ap}</b>` + (g.expected_text ? ` <span class="mut">· правильно: ${esc(g.expected_text)}</span>` : ''); }
      catch (e) { box.querySelector('.tres').innerHTML = `<span class="o-wrong">${esc(e.message)}</span>`; }
    };
  } catch (e) { box.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
}
async function exportJson(path, fname) {
  try { const d = await api('GET', path); const blob = new Blob([JSON.stringify(d, null, 2)], { type: 'application/json' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = fname; document.body.appendChild(a); a.click(); a.remove(); }
  catch (e) { toast(e.message, true); }
}
// Импорт JSON (вставка или файл): сначала проверка (dry run), затем импорт.
function importBox(box, path, bank) {
  box.innerHTML = `<div class="card flat impbox"><h3>Импорт вопросов (JSON)</h3>
    <div class="small mut">Формат — см. IMPORT_FORMAT.md в репозитории: массив вопросов, {"questions":[…], "cases":[…]} или файл закона {law, code, questions, cases}. Повторный импорт с теми же id обновляет вопросы.</div>
    ${bank ? '<label class="f"><span>Категория по умолчанию (если не указана в файле и нет известного code)</span><input class="impcat" maxlength="100" placeholder="например ВУ"></label>' : ''}
    <label class="f"><span>Файл(ы) .json</span><input type="file" class="impfile" accept=".json,application/json" multiple></label>
    <label class="f"><span>или вставьте JSON</span><textarea class="impjson" rows="6" placeholder='{"questions":[...]}'></textarea></label>
    <label class="chk"><input type="checkbox" class="impskip"> Пропускать ошибочные вопросы (иначе при ошибках ничего не импортируется)</label>
    <div class="row"><button type="button" class="btn impdry">Проверить</button><button type="button" class="btn gold impgo">Импортировать</button></div><div class="imprep"></div></div>`;
  const rep = box.querySelector('.imprep');
  const payloads = async () => {
    const files = [...box.querySelector('.impfile').files]; const out = [];
    for (const f of files) out.push({ name: f.name, text: await f.text() });
    const t = box.querySelector('.impjson').value.trim(); if (t) out.push({ name: 'вставка', text: t });
    if (!out.length) throw new Error('Выберите файл или вставьте JSON');
    return out.map(x => { try { return { name: x.name, data: JSON.parse(x.text) }; } catch (e) { throw new Error(`${x.name}: некорректный JSON (${e.message})`); } });
  };
  const run = async (dry) => {
    rep.innerHTML = '<span class="mut">…</span>';
    try {
      const ps = await payloads(); let html = '';
      for (const p of ps) {
        const cat = bank ? box.querySelector('.impcat').value.trim() : '';
        let data = p.data; if (cat && data && !Array.isArray(data) && !data.category) data = { ...data, category: cat }; else if (cat && Array.isArray(data)) data = { questions: data, category: cat };
        let r; try { r = (await api('POST', path, { data, dry_run: dry, skip_invalid: box.querySelector('.impskip').checked })).report; }
        catch (e) { if (e.data && e.data.report) r = e.data.report; else throw e; }
        html += `<div class="alert ${r.error_count ? 'warn' : 'ok'} small"><b>${esc(p.name)}</b>: всего ${r.total}, корректных ${r.valid}, ошибок ${r.error_count}${dry ? ' (проверка, ничего не записано)' : ` · создано ${r.created}, обновлено ${r.updated}`}${r.aborted ? '<br><b>' + esc(r.aborted) + '</b>' : ''}
          <div>${Object.entries(r.by_category || {}).map(([k, v]) => `${esc(k)}: ${v}`).join(' · ')}</div>
          ${r.errors.length ? '<ul>' + r.errors.slice(0, 30).map(x => `<li>#${x.index + 1}${x.id ? ' (' + esc(x.id) + ')' : ''}: ${esc(x.error)}</li>`).join('') + '</ul>' : ''}</div>`;
      }
      rep.innerHTML = html;
      if (!dry) toast('Импорт завершён');
    } catch (e) { rep.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
  };
  box.querySelector('.impdry').onclick = () => run(true);
  box.querySelector('.impgo').onclick = async () => { await run(false); };
}

// ---------- банк вопросов ----------
route('/admin/bank', async () => {
  const qp = new URLSearchParams((location.hash.split('?')[1]) || '');
  const f = { category: qp.get('category') || '', kind: qp.get('kind') || '', type: qp.get('type') || '', easy: qp.get('easy') || '', q: qp.get('q') || '', offset: Number(qp.get('offset')) || 0 };
  const r = await api('GET', '/api/admin/bank?' + new URLSearchParams({ ...f, limit: 50 }).toString());
  const cats = {}; for (const c of r.categories) { cats[c.category] = cats[c.category] || { q: 0, c: 0, e: 0 }; if (c.kind === 'case') cats[c.category].c += c.c; else { cats[c.category].q += c.c; cats[c.category].e += c.easy || 0; } }
  const catNames = Object.keys(cats);
  const link = (o) => '#/admin/bank?' + new URLSearchParams(Object.fromEntries(Object.entries({ ...f, offset: 0, ...o }).filter(([, v]) => v !== '' && v !== 0))).toString();
  setView(`<h1>Банк вопросов</h1>${adminNav('/admin/bank')}
    <p class="small mut">Вопросы и кейсы для переаттестации. Категория — ПК, УК, ТК, ВУ, СУ, ДУ, КПС, «ФЗ об …», «ФКЗ …», КоАП и т.д. (в квотах «ФЗ*» означает все категории, начинающиеся с «ФЗ»).</p>
    <div class="cattable"><table><tr><th>Категория</th><th>Вопросов</th><th>из них «не душных»</th><th>Кейсов</th></tr>
      ${catNames.map(c => `<tr class="click" data-href="${link({ category: c })}"><td>${esc(c || '(без категории)')}</td><td>${cats[c].q}</td><td>${cats[c].e}</td><td>${cats[c].c}</td></tr>`).join('') || '<tr><td colspan="4" class="mut">Банк пуст</td></tr>'}</table></div>
    <div class="row" style="margin:14px 0"><button class="btn gold" id="addB">+ Добавить вопрос</button><select id="newTypeB" style="max-width:300px">${Object.entries(QTYPE_RU).map(([k, v]) => `<option value="${k}">${window.QT.ICONS[k]} ${v}</option>`).join('')}</select>
      <button class="btn" id="impB">Импорт JSON</button><button class="btn" id="expB">Экспорт JSON${f.category ? ' (' + esc(f.category) + ')' : ''}</button><button class="btn danger sm" id="delEx">Удалить ПРИМЕРЫ…</button></div>
    <div id="impBox"></div><div id="newBox"></div>
    <form class="row bankf" id="bf"><input name="q" value="${esc(f.q)}" placeholder="Поиск по тексту / ext_id" style="max-width:260px">
      <select name="category" style="max-width:220px"><option value="">Все категории</option>${catNames.map(c => `<option ${c === f.category ? 'selected' : ''}>${esc(c)}</option>`).join('')}<option value="ФЗ*" ${f.category === 'ФЗ*' ? 'selected' : ''}>ФЗ* (все ФЗ)</option></select>
      <select name="kind" style="max-width:150px"><option value="">Вопросы и кейсы</option><option value="question" ${f.kind === 'question' ? 'selected' : ''}>Только вопросы</option><option value="case" ${f.kind === 'case' ? 'selected' : ''}>Только кейсы</option></select>
      <select name="type" style="max-width:220px"><option value="">Все типы</option>${Object.entries(QTYPE_RU).map(([k, v]) => `<option value="${k}" ${k === f.type ? 'selected' : ''}>${v}</option>`).join('')}</select>
      <label class="chk" style="margin:0"><input type="checkbox" name="easy" value="1" ${f.easy ? 'checked' : ''}> не душные</label><button class="btn">Фильтр</button></form>
    <p class="small mut">Найдено: ${r.total}${r.total > 50 ? ` · показаны ${f.offset + 1}–${Math.min(f.offset + 50, r.total)}` : ''}</p>
    <div id="blist"></div>
    <div class="row">${f.offset ? `<a class="btn sm" href="${link({ offset: Math.max(0, f.offset - 50) })}">← Назад</a>` : ''}${f.offset + 50 < r.total ? `<a class="btn sm" href="${link({ offset: f.offset + 50 })}">Дальше →</a>` : ''}</div>`);
  bindRows();
  const o = { bank: true, categories: [...new Set(catNames.concat(['ПК', 'УК', 'ТК', 'ВУ', 'СУ', 'ДУ', 'КПС', 'КоАП', 'ФЗ об обороне', 'ФЗ о закрытых и охраняемых территориях', 'ФЗ о гос. службе', 'ФЗ о гос. тайне', 'ФЗ об оружии', 'ФЗ о воздушном пространстве', 'ФКЗ об особых правовых режимах']))], createPath: '/api/admin/bank', open: false, ids: [] };
  r.questions.forEach((q, i) => $('#blist').appendChild(qCard(q, i, o)));
  $('#bf').onsubmit = (ev) => { ev.preventDefault(); const fd = new FormData(ev.target); location.hash = link({ q: fd.get('q') || '', category: fd.get('category') || '', kind: fd.get('kind') || '', type: fd.get('type') || '', easy: fd.get('easy') ? '1' : '' }); };
  $('#addB').onclick = () => { const t = $('#newTypeB').value; $('#newBox').innerHTML = ''; const c = qCard({ id: null, type: t, category: f.category && !f.category.endsWith('*') ? f.category : '', kind: t === 'case' ? 'case' : 'question', points: t === 'case' ? 5 : 1 }, 0, { ...o, open: true }); $('#newBox').appendChild(c); c.querySelector('textarea').focus(); };
  $('#impB').onclick = () => importBox($('#impBox'), '/api/admin/bank/import', true);
  $('#expB').onclick = () => exportJson('/api/admin/bank/export' + (f.category && !f.category.endsWith('*') ? '?category=' + encodeURIComponent(f.category) : ''), 'bank' + (f.category ? '-' + f.category : '') + '.json');
  $('#delEx').onclick = async () => {
    const which = prompt('Удалить вопросы-заглушки «ПРИМЕР». Укажите категории через запятую (например: ПК, УК, ФЗ*) или оставьте пустым — удалить ВСЕ примеры:', '');
    if (which === null) return;
    const categories = which.split(',').map(x => x.trim()).filter(Boolean);
    try { const r2 = await api('POST', '/api/admin/bank/delete-examples', { categories }); toast('Удалено примеров: ' + r2.deleted); render(); } catch (e) { toast(e.message, true); }
  };
}, { role: 'admin' });
route('/admin/bank\\?.*', () => App.routes.find(r => r.p === '/admin/bank').fn(), { role: 'admin' });

// ---------- переаттестация: квоты ----------
route('/admin/reatt', async () => {
  const r = await api('GET', '/api/admin/reatt');
  const ver = (k, title) => {
    const v = r.config[k], av = r.availability[k];
    return `<form class="card reattf" data-v="${k}"><h2>${title}</h2>
      <div class="fgrid"><label class="f"><span>Название</span><input name="title" maxlength="200" value="${esc(v.title)}"></label>
        <label class="f"><span>Лимит времени, мин (0 — без лимита)</span><input type="number" name="time_limit_min" min="0" max="1440" value="${v.time_limit_min}"></label>
        <label class="f"><span>Проходной балл, %</span><input type="number" name="pass_pct" min="0" max="100" value="${v.pass_pct}"></label>
        <label class="f"><span>Пауза между попытками, мин</span><input type="number" name="cooldown_min" min="0" value="${v.cooldown_min}"></label>
        <label class="f"><span>Макс. попыток (0 — без лимита)</span><input type="number" name="max_attempts" min="0" value="${v.max_attempts}"></label></div>
      <label class="f"><span>Описание для кандидата</span><textarea name="description" rows="2" maxlength="5000">${esc(v.description)}</textarea></label>
      <label class="chk"><input type="checkbox" name="enabled" ${v.enabled ? 'checked' : ''}> Версия включена (видна и доступна кандидатам)</label>
      <h3>Квоты (на каждую попытку)</h3>
      <div class="tscroll"><table class="gt"><tr><th>Блок</th><th>Категории (через запятую, * — по началу)</th><th>Вопросов</th><th>Кейсов</th><th>Не душные в приоритете</th><th>В банке</th><th></th></tr>
      ${v.groups.map((g, i) => { const a = av[i] || {}; return `<tr class="grow"><td><input class="g-label" value="${esc(g.label)}" maxlength="60"></td><td><input class="g-cats" value="${esc(g.categories.join(', '))}"></td>
        <td><input type="number" class="g-q" min="0" max="200" value="${g.questions}" style="width:70px"></td><td><input type="number" class="g-c" min="0" max="50" value="${g.cases}" style="width:70px"></td>
        <td><input type="checkbox" class="g-e" ${g.prefer_easy ? 'checked' : ''}></td>
        <td class="small ${a.ok ? 'o-correct' : 'o-wrong'}">вопр. ${a.have_q ?? '?'} (не душн. ${a.have_easy_q ?? '?'}) · кейсов ${a.have_c ?? '?'}${a.ok ? '' : ' ⚠ мало'}</td><td><button type="button" class="btn sm danger g-rm">✕</button></td></tr>`; }).join('')}</table></div>
      <div class="row" style="margin-top:8px"><button type="button" class="btn sm g-add">+ блок</button><span class="small mut">Итого: <b class="g-tot"></b></span></div>
      <div class="row" style="margin-top:12px"><button class="btn gold">Сохранить</button><button type="button" class="btn g-prev">Пробная выборка</button><button type="button" class="btn sm g-def">Сбросить к стандартным квотам</button></div>
      <div class="g-out"></div></form>`;
  };
  setView(`<h1>Переаттестация</h1>${adminNav('/admin/reatt')}
    <p class="small mut">Результаты и проверка кейсов — в разделе <a href="#/admin/attempts?status=pending_review&kind=reatt">«Проверка» → Переаттестация</a>. Попыток: ${r.attempt_stats.map(x => `${x.reatt === 'full' ? 'полная' : 'упрощённая'} / ${esc((STATUS_RU[x.status] || [x.status])[0])}: ${x.c}`).join(' · ') || 'пока нет'}.</p>
    ${ver('full', 'Полная (общая)')}${ver('simple', 'Упрощённая (уставы)')}`);
  $$('.reattf').forEach(form => {
    const k = form.dataset.v;
    const tot = () => { let q = 0, c = 0; $$('.grow', form).forEach(rw => { q += Number(rw.querySelector('.g-q').value) || 0; c += Number(rw.querySelector('.g-c').value) || 0; }); form.querySelector('.g-tot').textContent = `${q} вопросов + ${c} кейсов`; };
    const bindRow = (rw) => { rw.querySelector('.g-rm').onclick = () => { rw.remove(); tot(); }; };
    $$('.grow', form).forEach(bindRow); tot(); form.addEventListener('input', tot);
    form.querySelector('.g-add').onclick = () => { const rw = h2(`<table><tr class="grow"><td><input class="g-label" maxlength="60" value="Новый блок"></td><td><input class="g-cats" value=""></td><td><input type="number" class="g-q" min="0" value="1" style="width:70px"></td><td><input type="number" class="g-c" min="0" value="0" style="width:70px"></td><td><input type="checkbox" class="g-e"></td><td></td><td><button type="button" class="btn sm danger g-rm">✕</button></td></tr></table>`).querySelector('tr'); form.querySelector('.gt tbody').appendChild(rw); bindRow(rw); tot(); };
    const collect = () => { const o = formObj(form); delete o['']; o.groups = $$('.grow', form).map(rw => ({ label: rw.querySelector('.g-label').value, categories: rw.querySelector('.g-cats').value.split(',').map(x => x.trim()).filter(Boolean), questions: Number(rw.querySelector('.g-q').value) || 0, cases: Number(rw.querySelector('.g-c').value) || 0, prefer_easy: rw.querySelector('.g-e').checked })); return o; };
    form.onsubmit = async (ev) => { ev.preventDefault(); try { await api('PUT', '/api/admin/reatt', { [k]: collect() }); toast('Квоты сохранены'); render(); } catch (e) { toast(e.message, true); form.querySelector('.g-out').innerHTML = `<div class="alert err">${esc(e.message)}</div>`; } };
    form.querySelector('.g-def').onclick = async () => { if (!confirm('Вернуть стандартные квоты и настройки этой версии?')) return; try { await api('PUT', '/api/admin/reatt', { [k]: r.defaults[k] }); toast('Сброшено'); render(); } catch (e) { toast(e.message, true); } };
    form.querySelector('.g-prev').onclick = async () => {
      const out = form.querySelector('.g-out');
      try { const p = await api('POST', `/api/admin/reatt/${k}/preview`);
        out.innerHTML = `<div class="card flat"><b>Пробная выборка (по сохранённым квотам)</b>: всего ${p.total}, баллов ${p.max_score}
          ${p.groups.map(g => `<div style="margin-top:8px"><b>${esc(g.label)}</b> — вопросов ${g.q.length}/${g.need_q}, кейсов ${g.c.length}/${g.need_c} ${g.short_q || g.short_c ? '<span class="badge err">не хватает</span>' : ''}<ul class="small">${g.q.concat(g.c).map(x => `<li>${window.QT.ICONS[x.type] || ''} [${esc(x.category)}]${x.kind === 'case' ? ' <b>кейс</b>' : ''}${x.easy ? ' <span class="badge ok">не душный</span>' : ''} ${esc(x.text.slice(0, 120))}</li>`).join('')}</ul></div>`).join('')}</div>`;
      } catch (e) { out.innerHTML = `<div class="alert err">${esc(e.message)}</div>`; }
    };
  });
}, { role: 'admin' });

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
  const qp = new URLSearchParams((location.hash.split('?')[1]) || '');
  const st = qp.get('status') ?? 'pending_review', kind = qp.get('kind') || '';
  const { attempts } = await api('GET', '/api/admin/attempts?status=' + encodeURIComponent(st) + '&kind=' + encodeURIComponent(kind));
  const kinds = [['', 'Всё'], ['exam', 'Экзамены'], ['reatt', 'Переаттестация'], ['full', '— полная'], ['simple', '— упрощённая']];
  const tabs = [['pending_review', 'Ждут проверки'], ['passed', 'Сдали'], ['failed', 'Не сдали'], ['in_progress', 'Идут сейчас'], ['', 'Все']];
  setView(`<h1>Проверка попыток</h1>${adminNav('/admin/attempts')}
    <div class="row" style="margin-bottom:8px">${tabs.map(([k, v]) => `<a class="btn sm ${k === st ? 'gold' : ''}" href="#/admin/attempts?status=${k}&kind=${kind}">${v}</a>`).join('')}</div>
    <div class="row" style="margin-bottom:12px">${kinds.map(([k, v]) => `<a class="btn sm ${k === kind ? 'gold' : ''}" href="#/admin/attempts?status=${st}&kind=${k}">${v}</a>`).join('')}</div>
    ${attempts.length ? `<table><tr><th>№</th><th>Кандидат</th><th>Экзамен / переаттестация</th><th>Отправлена</th><th>Статус</th><th>Баллы</th></tr>
    ${attempts.map(a => `<tr class="click" data-href="#/admin/attempt/${a.id}"><td>#${a.id}</td><td>${esc(a.ic_name || a.global_name || a.username)}<div class="small mut">${esc(a.static_id || a.user_id)}</div></td><td>${esc(a.exam_title)}</td><td>${fmtDate(a.submitted_at)}${a.expired ? ' <span class="badge warn">по таймеру</span>' : ''}</td><td>${badge(a.status)}</td><td>${a.score_pct != null ? a.score_pct + '%' : '—'}</td></tr>`).join('')}</table>` : '<div class="alert info">Нет попыток в этом разделе.</div>'}`);
  bindRows();
}, { role: 'examiner' });
route('/admin/attempts\\?.*', () => App.routes.find(r => r.p === '/admin/attempts').fn(), { role: 'examiner' });

route('/admin/attempt/:id', async (id) => {
  const r = await api('GET', '/api/admin/attempts/' + encodeURIComponent(id));
  const a = r.attempt, u = r.user;
  const items = r.items.map((it, i) => window.QT.review(it, i)).join('');
  const groups = r.groups ? `<div class="card flat"><h3>По блокам</h3><table><tr><th>Блок</th><th>Вопросов</th><th>Кейсов</th><th>Баллы</th><th></th></tr>${r.groups.map(g => `<tr><td>${esc(g.label)}</td><td>${g.questions}${g.short_q ? ` <span class="badge err">не хватило ${g.short_q}</span>` : ''}</td><td>${g.cases}${g.short_c ? ` <span class="badge err">не хватило ${g.short_c}</span>` : ''}</td><td>${g.points} / ${g.max}</td><td>${g.pending ? `<span class="badge warn">на проверке: ${g.pending}</span>` : ''}</td></tr>`).join('')}</table></div>` : '';
  setView(`<p><a href="#/admin/attempts">← Проверка</a></p>
    <div class="card"><div class="row between"><h2 style="margin:0">Попытка #${a.id} — ${esc(r.exam ? r.exam.title : '')}</h2>${badge(a.status)}</div>
      <p>Кандидат: <a href="#/admin/user/${esc(a.user_id)}">${esc(userName(u))}</a> <span class="mut small">(${esc(u ? u.username : '')}, ${esc(a.user_id)}${u && u.static_id ? ', статик ' + esc(u.static_id) : ''})</span></p>
      <p class="small mut">Начата ${fmtDate(a.started_at)} · отправлена ${fmtDate(a.submitted_at)}${a.expired ? ' (автоматически по таймеру)' : ''} · автобаллы ${a.auto_score} · ручные ${a.manual_score} · максимум ${a.max_score} · итог ${a.score_pct != null ? a.score_pct + '%' : '—'} (проходной ${r.exam ? r.exam.pass_pct : '?'}%)</p>
      ${a.reviewed_at ? `<p class="small mut">Проверил: ${esc(r.reviewer ? (r.reviewer.global_name || r.reviewer.username) : a.reviewer_id)} · ${fmtDate(a.reviewed_at)}</p>` : ''}</div>
    ${groups}
    <div id="ritems">${items}</div>
    ${a.status === 'in_progress' ? '<div class="alert info">Кандидат ещё проходит экзамен.</div>' : `<form class="card" id="rf"><h3>Итог проверки</h3>
      <label class="f"><span>Решение</span><select name="verdict"><option value="auto">По баллам (≥ ${r.exam ? r.exam.pass_pct : '?'}% — сдан)</option><option value="passed" ${a.status === 'passed' ? '' : ''}>Сдан (вручную)</option><option value="failed">Не сдан (вручную)</option></select></label>
      <label class="f"><span>Комментарий для кандидата</span><textarea name="comment" maxlength="5000">${esc(a.reviewer_comment || '')}</textarea></label>
      <button class="btn gold">Сохранить проверку</button> ${hasRole('admin') ? '<button type="button" class="btn danger" id="delA">Удалить попытку</button>' : ''}</form>`}`);
  window.QT.bindReview($('#ritems'), api);
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
  'user.reset_attempts': 'Сброс попыток', 'attempt.review': 'Проверка попытки', 'attempt.delete': 'Удалена попытка', 'settings.update': 'Настройки сайта', 'reatt.config': 'Квоты переаттестации', 'question.import': 'Импорт вопросов', 'question.delete_examples': 'Удалены ПРИМЕРЫ' };
route('/admin/audit', async () => {
  const { log } = await api('GET', '/api/admin/audit');
  setView(`<h1>Журнал действий</h1>${adminNav('/admin/audit')}
    ${log.length ? `<table><tr><th>Время</th><th>Кто</th><th>Действие</th><th>Объект</th><th>Детали</th></tr>${log.map(l => `<tr><td>${fmtDate(l.at)}</td><td>${esc(l.global_name || l.username || l.actor_id)}</td><td>${esc(ACTION_RU[l.action] || l.action)}</td><td>${esc(l.target || '')}</td><td class="small mut" style="max-width:380px;word-break:break-word">${esc((l.details || '').slice(0, 300))}</td></tr>`).join('')}</table>` : '<div class="alert info">Журнал пуст.</div>'}`);
}, { role: 'admin' });
