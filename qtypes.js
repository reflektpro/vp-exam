/* Типы вопросов: отображение для кандидата, редактор для админа, разбор ответа для проверяющего. */
'use strict';
(function () {
  const LABELS = {
    single: 'Одиночный выбор', multi: 'Множественный выбор', number: 'Ввод числа', text: 'Ввод текста', param: 'Параметризованная задача',
    long: 'Ответ в свободной форме', order: 'Установление последовательности', match: 'Установление соответствий',
    blanks_input: 'Заполнение пропусков (ввод)', blanks_select: 'Заполнение пропусков (из списка)', dictation: 'Интерактивный диктант',
    eliminate: 'Последовательное исключение', slider: 'Слайдер (ползунок)', file: 'Загрузка файла', voice: 'Голосовой ответ',
    info: 'Информационный текст', letters: 'Слова из букв', words: 'Фразы из слов', find: 'Поиск в тексте', case: 'Кейс (ситуационная задача)',
  };
  const ICONS = { single: '◉', multi: '☑', number: '🔢', text: '⌨', param: '⇄', long: '📝', order: '⇅', match: '🔗', blanks_input: '▭', blanks_select: '▾',
    dictation: '✎', eliminate: '✕', slider: '⟷', file: '📎', voice: '🎙', info: 'ℹ', letters: '🔤', words: '💬', find: '🔍', case: '⚖' };
  const PARTIAL = new Set(['multi', 'order', 'match', 'blanks_input', 'blanks_select', 'dictation', 'find', 'eliminate', 'words']);
  const HINTS = {
    multi: 'Можно выбрать несколько вариантов', order: 'Расставьте элементы в правильном порядке: перетащите или используйте стрелки ↑↓',
    match: 'Для каждого элемента слева выберите соответствие', blanks_input: 'Впишите пропущенные слова', blanks_select: 'Выберите слова в пропусках',
    dictation: 'Нажмите на правильный вариант в каждом месте', eliminate: 'Исключайте неверные варианты по одному, пока не останется один — он и будет ответом',
    slider: 'Передвиньте ползунок', letters: 'Нажимайте на буквы, чтобы собрать слово', words: 'Нажимайте на слова, чтобы собрать фразу',
    find: 'Нажмите на нужные слова в тексте (повторное нажатие снимает выделение)', file: 'Загрузите файл (до 1 МБ)', voice: 'Запишите голосовой ответ',
  };
  const e = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const h = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
  const fmtKB = (n) => n >= 1024 * 1024 ? (n / 1048576).toFixed(1) + ' МБ' : Math.ceil(n / 1024) + ' КБ';
  const fileToB64 = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => rej(new Error('Не удалось прочитать файл')); r.readAsDataURL(blob); });

  // ---------- кандидат ----------
  // mount(box, q, val, onChange, ctx) → { get() }; ctx.upload(qid, {name, mime, data}) → Promise<{upload_id,name,size,mime}>
  function mount(box, q, val, onChange, ctx) {
    const ch = () => onChange && onChange();
    const body = document.createElement('div'); body.className = 'qbody qt-' + q.type;
    box.appendChild(body);
    if (HINTS[q.type]) body.appendChild(h(`<div class="small mut qhint">${e(HINTS[q.type])}</div>`));
    const T = q.type;
    if (T === 'single' || T === 'multi') {
      q.options.forEach(o => body.appendChild(h(`<label class="opt"><input type="${T === 'single' ? 'radio' : 'checkbox'}" name="q${q.id}" value="${e(o.id)}" ${(T === 'single' ? val === o.id : Array.isArray(val) && val.includes(o.id)) ? 'checked' : ''}><span>${e(o.text)}</span></label>`)));
      body.addEventListener('change', ch);
      return { get: () => T === 'single' ? ((body.querySelector('input:checked') || {}).value || null) : [...body.querySelectorAll('input:checked')].map(x => x.value) };
    }
    if (T === 'text' || T === 'number' || T === 'param') {
      const num = T !== 'text';
      body.appendChild(h(`<div class="row"><input type="text" name="q${q.id}" ${num ? 'inputmode="decimal" placeholder="Число" style="max-width:220px"' : 'maxlength="1000" placeholder="Краткий ответ"'} value="${e(val == null ? '' : (num ? String(val).replace('.', ',') : val))}">${q.unit ? `<span>${e(q.unit)}</span>` : ''}</div>`));
      const inp = body.querySelector('input'); inp.addEventListener('input', ch);
      return { get: () => inp.value.trim() === '' ? null : inp.value };
    }
    if (T === 'long' || T === 'case') {
      body.appendChild(h(`<textarea name="q${q.id}" maxlength="8000" rows="${T === 'case' ? 8 : 6}" placeholder="${T === 'case' ? 'Ваше решение кейса: квалификация, нормы (статьи), порядок действий' : 'Развёрнутый ответ'}">${e(val || '')}</textarea>`));
      const ta = body.querySelector('textarea'); ta.addEventListener('input', ch);
      return { get: () => ta.value };
    }
    if (T === 'info') return { get: () => undefined };
    if (T === 'slider') {
      const touched = val != null; const v0 = touched ? val : (q.min + q.max) / 2;
      body.appendChild(h(`<div class="slider"><input type="range" name="q${q.id}" min="${q.min}" max="${q.max}" step="${q.step}" value="${v0}"><div class="row between small mut"><span>${e(q.min)}</span><b class="sval">${touched ? e(String(val).replace('.', ',')) + ' ' + e(q.unit || '') : 'не выбрано'}</b><span>${e(q.max)}</span></div></div>`));
      const r = body.querySelector('input'); let t = touched;
      r.addEventListener('input', () => { t = true; body.querySelector('.sval').textContent = String(r.value).replace('.', ',') + ' ' + (q.unit || ''); ch(); });
      return { get: () => t ? Number(r.value) : null };
    }
    if (T === 'order') {
      const m = new Map(q.items.map(x => [x.id, x]));
      let ids = Array.isArray(val) && val.length === q.items.length && val.every(x => m.has(x)) ? val.slice() : q.items.map(x => x.id);
      let touched = Array.isArray(val);
      const list = h('<ol class="ord-list"></ol>'); body.appendChild(list);
      let drag = null;
      const draw = () => {
        list.innerHTML = '';
        ids.forEach((id, i) => {
          const li = h(`<li class="ord-item" draggable="true" data-id="${e(id)}"><span class="grip">⠿</span><span class="otext">${e(m.get(id).text)}</span><span class="obtn"><button type="button" class="btn sm up" ${i ? '' : 'disabled'} aria-label="Выше">↑</button><button type="button" class="btn sm dn" ${i < ids.length - 1 ? '' : 'disabled'} aria-label="Ниже">↓</button></span></li>`);
          const mv = (d) => { [ids[i], ids[i + d]] = [ids[i + d], ids[i]]; touched = true; draw(); ch(); };
          li.querySelector('.up').onclick = () => mv(-1); li.querySelector('.dn').onclick = () => mv(1);
          li.addEventListener('dragstart', (ev) => { drag = id; li.classList.add('drag'); ev.dataTransfer.effectAllowed = 'move'; try { ev.dataTransfer.setData('text/plain', id); } catch (_) {} });
          li.addEventListener('dragend', () => li.classList.remove('drag'));
          li.addEventListener('dragover', (ev) => { ev.preventDefault(); });
          li.addEventListener('drop', (ev) => { ev.preventDefault(); if (!drag || drag === id) return; const from = ids.indexOf(drag); ids.splice(from, 1); ids.splice(ids.indexOf(id) + (from <= i ? 1 : 0), 0, drag); drag = null; touched = true; draw(); ch(); });
          list.appendChild(li);
        });
      };
      draw();
      return { get: () => touched ? ids.slice() : null };
    }
    if (T === 'match') {
      const v = val && typeof val === 'object' ? val : {};
      q.left.forEach(l => body.appendChild(h(`<div class="mrow"><div class="ml">${e(l.text)}</div><div class="mr"><select data-l="${e(l.id)}"><option value="">— выберите —</option>${q.right.map(r => `<option value="${e(r.id)}" ${v[l.id] === r.id ? 'selected' : ''}>${e(r.text)}</option>`).join('')}</select></div></div>`)));
      body.addEventListener('change', ch);
      return { get: () => { const o = {}; body.querySelectorAll('select').forEach(s => { if (s.value) o[s.dataset.l] = s.value; }); return Object.keys(o).length ? o : null; } };
    }
    if (T === 'blanks_input' || T === 'blanks_select' || T === 'dictation') {
      const v = Array.isArray(val) ? val : [];
      const txt = document.createElement('div'); txt.className = 'btext';
      for (const p of q.parts) {
        if (typeof p === 'string') { txt.appendChild(document.createTextNode(p)); continue; }
        const k = p.i;
        if (T === 'blanks_input') txt.appendChild(h(`<input type="text" class="blank" data-k="${k}" maxlength="500" value="${e(v[k] || '')}" aria-label="Пропуск ${k + 1}">`));
        else if (T === 'blanks_select') txt.appendChild(h(`<select class="blank" data-k="${k}" aria-label="Пропуск ${k + 1}"><option value="">…</option>${q.blanks[k].map(o => `<option value="${e(o.id)}" ${v[k] === o.id ? 'selected' : ''}>${e(o.text)}</option>`).join('')}</select>`));
        else {
          const g = h(`<span class="dict" data-k="${k}"></span>`);
          q.blanks[k].forEach((o, j) => { if (j) g.appendChild(h('<span class="dsep">/</span>')); const b = h(`<button type="button" class="dopt ${v[k] === o.id ? 'on' : ''}" data-id="${e(o.id)}">${e(o.text)}</button>`);
            b.onclick = () => { const was = b.classList.contains('on'); g.querySelectorAll('.dopt').forEach(x => x.classList.remove('on')); if (!was) b.classList.add('on'); ch(); }; g.appendChild(b); });
          txt.appendChild(g);
        }
      }
      body.appendChild(txt);
      body.addEventListener('input', ch); body.addEventListener('change', ch);
      const n = T === 'blanks_input' ? q.blank_count : q.blanks.length;
      return { get: () => { const out = []; for (let k = 0; k < n; k++) {
        if (T === 'dictation') { const on = txt.querySelector(`.dict[data-k="${k}"] .dopt.on`); out.push(on ? on.dataset.id : null); }
        else { const el = txt.querySelector(`.blank[data-k="${k}"]`); out.push(el && el.value ? el.value : (T === 'blanks_input' ? '' : null)); } }
        return out.some(x => x) ? out : null; } };
    }
    if (T === 'eliminate') {
      let el = Array.isArray(val) ? val.slice() : [];
      const list = h('<div class="elim"></div>'); body.appendChild(list);
      const res = h('<div class="elim-res small"></div>'); body.appendChild(res);
      const reset = h('<button type="button" class="btn sm">Начать заново</button>'); body.appendChild(reset);
      const draw = () => {
        list.innerHTML = '';
        const left = q.options.filter(o => !el.includes(o.id));
        q.options.forEach(o => {
          const out = el.includes(o.id); const last = !out && left.length === 1;
          const r = h(`<div class="eopt ${out ? 'out' : ''} ${last ? 'last' : ''}"><span>${out ? '<s>' + e(o.text) + '</s> <span class="small mut">(исключён ' + (el.indexOf(o.id) + 1) + '-м)</span>' : e(o.text)}</span>${!out && left.length > 1 ? '<button type="button" class="btn sm danger">✕ Исключить</button>' : ''}</div>`);
          const b = r.querySelector('button'); if (b) b.onclick = () => { el.push(o.id); draw(); ch(); };
          list.appendChild(r);
        });
        res.innerHTML = left.length === 1 ? `Ваш ответ: <b>${e(left[0].text)}</b>` : `Осталось вариантов: ${left.length}`;
      };
      reset.onclick = () => { el = []; draw(); ch(); };
      draw();
      return { get: () => el.length ? el.slice() : null };
    }
    if (T === 'letters' || T === 'words') {
      const pool = T === 'letters' ? q.letters : q.words;
      let sel = Array.isArray(val) ? val.filter(i => i >= 0 && i < pool.length) : [];
      const ans = h(`<div class="tiles ans-tiles ${T}"></div>`), src = h(`<div class="tiles src-tiles ${T}"></div>`);
      const reset = h('<button type="button" class="btn sm">Очистить</button>');
      body.appendChild(h(`<div class="small mut">Ваш ${T === 'letters' ? 'ответ' : 'ответ'}:</div>`)); body.appendChild(ans); body.appendChild(src); body.appendChild(reset);
      const draw = () => {
        ans.innerHTML = sel.length ? '' : '<span class="small mut">…</span>'; src.innerHTML = '';
        sel.forEach((i, k) => { const b = h(`<button type="button" class="tile on">${e(pool[i])}</button>`); b.onclick = () => { sel.splice(k, 1); draw(); ch(); }; ans.appendChild(b); });
        pool.forEach((t, i) => { const used = sel.includes(i); const b = h(`<button type="button" class="tile" data-i="${i}" ${used ? 'disabled' : ''}>${e(t)}</button>`); b.onclick = () => { if (!sel.includes(i)) { sel.push(i); draw(); ch(); } }; src.appendChild(b); });
      };
      reset.onclick = () => { sel = []; draw(); ch(); };
      draw();
      return { get: () => sel.length ? sel.slice() : null };
    }
    if (T === 'find') {
      const sel = new Set(Array.isArray(val) ? val : []);
      const txt = h('<div class="ftext"></div>');
      q.tokens.forEach((t, i) => {
        if (t === '\n') { txt.appendChild(document.createElement('br')); return; }
        const s = h(`<span class="tok ${sel.has(i) ? 'on' : ''}" data-i="${i}" role="button" tabindex="0">${e(t)}</span>`);
        const tg = () => { if (sel.has(i)) sel.delete(i); else sel.add(i); s.classList.toggle('on'); ch(); };
        s.onclick = tg; s.onkeydown = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); tg(); } };
        txt.appendChild(s); txt.appendChild(document.createTextNode(' '));
      });
      body.appendChild(txt);
      return { get: () => sel.size ? [...sel].sort((a, b) => a - b) : null };
    }
    if (T === 'file' || T === 'voice') {
      let cur = val && typeof val === 'object' ? val : null;
      const st = h('<div class="upstate small"></div>');
      const show = () => { st.innerHTML = cur && cur.upload_id ? `✔ Загружено: <b>${e(cur.name || (T === 'voice' ? 'голосовой ответ' : 'файл'))}</b>${cur.size ? ' (' + fmtKB(cur.size) + ')' : ''}` : cur && cur.url ? `✔ Ссылка: ${e(cur.url)}` : '<span class="mut">Ответ не приложен</span>'; };
      const upload = async (blob, name) => {
        const limit = Math.min(1024, q.max_kb || 1024) * 1024;
        if (blob.size > limit) throw new Error(`Файл слишком большой: ${fmtKB(blob.size)} (макс. ${fmtKB(limit)})`);
        st.innerHTML = '<span class="mut">Загрузка…</span>';
        cur = await ctx.upload(q.id, { name, mime: blob.type || 'application/octet-stream', data: await fileToB64(blob) });
        show(); ch(); if (ctx.onUploaded) ctx.onUploaded();
      };
      if (T === 'file') {
        const f = h(`<div class="upl"><input type="file" accept="${e(q.accept || '')}">${q.allow_url ? `<div class="small mut" style="margin:8px 0 4px">или ссылка на изображение/документ:</div><div class="row"><input type="url" class="uurl" placeholder="https://…" value="${e(cur && cur.url || '')}"><button type="button" class="btn sm useurl">Сохранить ссылку</button></div>` : ''}</div>`);
        body.appendChild(f);
        f.querySelector('input[type=file]').onchange = async (ev) => { const fl = ev.target.files[0]; if (!fl) return; try { await upload(fl, fl.name); } catch (err) { st.innerHTML = `<span class="o-wrong">${e(err.message)}</span>`; } };
        const uu = f.querySelector('.useurl'); if (uu) uu.onclick = () => { const u = f.querySelector('.uurl').value.trim(); if (!/^https?:\/\//i.test(u)) { st.innerHTML = '<span class="o-wrong">Ссылка должна начинаться с https://</span>'; return; } cur = { url: u }; show(); ch(); };
      } else {
        const ok = !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
        const v = h(`<div class="voice"><div class="row"><button type="button" class="btn primary rec">● Записать</button><button type="button" class="btn stop" disabled>■ Стоп</button><span class="vtime small mut">0:00 / ${Math.floor(q.max_sec / 60)}:${String(q.max_sec % 60).padStart(2, '0')}</span></div><audio controls hidden></audio>
          ${ok ? '' : '<div class="small o-wrong">Браузер не поддерживает запись. Загрузите аудиофайл:</div>'}<div class="small mut" style="margin-top:6px">или загрузите аудиофайл: <input type="file" accept="audio/*" class="afile" style="width:auto"></div></div>`);
        body.appendChild(v);
        let rec = null, chunks = [], timer = null, t0 = 0, stream = null;
        const rb = v.querySelector('.rec'), sb = v.querySelector('.stop'), tm = v.querySelector('.vtime'), au = v.querySelector('audio');
        if (!ok) rb.disabled = true;
        const stop = () => { if (rec && rec.state !== 'inactive') rec.stop(); clearInterval(timer); sb.disabled = true; rb.disabled = false; };
        rb.onclick = async () => {
          try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); } catch (err) { st.innerHTML = '<span class="o-wrong">Нет доступа к микрофону: разрешите его в браузере.</span>'; return; }
          const mt = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find(t => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
          rec = new MediaRecorder(stream, mt ? { mimeType: mt, audioBitsPerSecond: 24000 } : { audioBitsPerSecond: 24000 }); chunks = [];
          rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
          rec.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            const blob = new Blob(chunks, { type: (rec.mimeType || 'audio/webm').split(';')[0] });
            au.src = URL.createObjectURL(blob); au.hidden = false;
            try { await upload(blob, 'voice.' + (/ogg/.test(blob.type) ? 'ogg' : /mp4/.test(blob.type) ? 'm4a' : 'webm')); } catch (err) { st.innerHTML = `<span class="o-wrong">${e(err.message)}</span>`; }
          };
          rec.start(1000); t0 = Date.now(); rb.disabled = true; sb.disabled = false;
          timer = setInterval(() => { const s = Math.floor((Date.now() - t0) / 1000); tm.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')} / ${Math.floor(q.max_sec / 60)}:${String(q.max_sec % 60).padStart(2, '0')}`; if (s >= q.max_sec) stop(); }, 250);
        };
        sb.onclick = stop;
        v.querySelector('.afile').onchange = async (ev) => { const fl = ev.target.files[0]; if (!fl) return; try { await upload(fl, fl.name); } catch (err) { st.innerHTML = `<span class="o-wrong">${e(err.message)}</span>`; } };
      }
      body.appendChild(st); show();
      return { get: () => cur ? (cur.upload_id ? { upload_id: cur.upload_id } : { url: cur.url }) : null };
    }
    body.appendChild(h(`<div class="alert warn">Неизвестный тип вопроса: ${e(T)}</div>`));
    return { get: () => null };
  }

  // ---------- редактор (админ) ----------
  const varsToText = (vars) => Object.entries(vars || {}).map(([k, s]) => s.values ? `${k} = ${s.values.join('; ')}` : `${k} = ${s.min}..${s.max}${s.step && s.step !== 1 ? ' шаг ' + s.step : ''}`).join('\n');
  function textToVars(t) {
    const vars = {};
    for (const line of String(t).split(/\r?\n/).map(x => x.trim()).filter(Boolean)) {
      let m = /^([A-Za-zА-Яа-яЁё_]\w*)\s*=\s*(-?[\d.,]+)\s*\.\.\s*(-?[\d.,]+)(?:\s*(?:шаг|step)\s*([\d.,]+))?$/i.exec(line);
      if (m) { vars[m[1]] = { min: Number(m[2].replace(',', '.')), max: Number(m[3].replace(',', '.')), step: m[4] ? Number(m[4].replace(',', '.')) : 1 }; continue; }
      m = /^([A-Za-zА-Яа-яЁё_]\w*)\s*=\s*(.+)$/.exec(line);
      if (m && /^[-\d.,;\s]+$/.test(m[2])) { vars[m[1]] = { values: m[2].split(';').map(x => Number(x.trim().replace(',', '.'))).filter(x => !Number.isNaN(x)) }; continue; }
      throw new Error('Переменные: не понял строку «' + line + '». Пример: a = 2..9 шаг 1  или  b = 10; 20; 50');
    }
    return vars;
  }
  const splitLines = (t) => String(t || '').split(/\r?\n/).map(x => x.trim()).filter(Boolean);
  const CONTENT_HELP = {
    blanks_input: 'Пропуски — в двойных квадратных скобках: «Срок — [[48]] часов». Несколько допустимых ответов через |: [[сорок восемь|48]]. Регистр и ё не важны.',
    blanks_select: 'Пропуск с выбором: [[*правильный|неверный|неверный]] (правильный — со звёздочкой, иначе первый). Варианты перемешиваются.',
    dictation: 'Места выбора: «пр[[*и|е]]каз», «[[*не был|небыл]]» (правильный — со звёздочкой, иначе первый). Варианты перемешиваются.',
    find: 'Выделите правильные слова/фрагменты двойными скобками: «… задержанный [[обязан]] …». Кандидат видит текст без скобок и отмечает слова.',
  };
  // editor(q, {bank, categories}) → { el, get() }  (get возвращает тело для API или бросает Error)
  function editor(q, opts = {}) {
    q = Object.assign({ type: 'single', text: '', points: 1, reference: '', options: [{ text: '', correct: true }, { text: '' }] }, q || {});
    const el = h(`<div class="qform">
      <div class="fgrid">
        <label class="f"><span>Тип вопроса</span><select class="e-type">${Object.entries(LABELS).map(([k, v]) => `<option value="${k}" ${k === q.type ? 'selected' : ''}>${ICONS[k]} ${v}</option>`).join('')}</select></label>
        <label class="f e-pts-w"><span>Баллы</span><input type="number" class="e-pts" min="0" max="1000" value="${q.points}"></label>
        ${opts.bank ? `<label class="f"><span>Категория *</span><input class="e-cat" list="catlist" maxlength="100" value="${e(q.category || '')}" placeholder="ПК, УК, ВУ, ФЗ об обороне…"><datalist id="catlist">${(opts.categories || []).map(c => `<option value="${e(c)}">`).join('')}</datalist></label>
        <label class="f"><span>Вид</span><select class="e-kind"><option value="question" ${q.kind !== 'case' ? 'selected' : ''}>Вопрос</option><option value="case" ${q.kind === 'case' ? 'selected' : ''}>Кейс</option></select></label>` : ''}
      </div>
      ${opts.bank ? `<div class="row"><label class="chk"><input type="checkbox" class="e-easy" ${q.easy ? 'checked' : ''}> «Не душный» (простой) — в приоритете в упрощённой версии</label><label class="chk"><input type="checkbox" class="e-active" ${q.active === false ? '' : 'checked'}> Активен (попадает в выборку)</label>${q.ext_id ? `<span class="small mut">ext_id: ${e(q.ext_id)}</span>` : ''}</div>` : ''}
      <label class="f"><span class="e-tlabel">Текст вопроса</span><textarea class="e-text" maxlength="10000" rows="3">${e(q.text)}</textarea></label>
      <div class="e-spec"></div>
      <label class="chk e-part-w"><input type="checkbox" class="e-partial" ${q.partial ? 'checked' : ''}> Частичные баллы (пропорционально числу верных элементов)</label>
      <details class="e-meta"><summary class="small">Доп. сведения (статья, пояснение — видит только админ)</summary>
        <label class="f"><span>Статья / источник</span><input class="e-article" maxlength="3000" value="${e(q.article || '')}"></label>
        <label class="f"><span>Пояснение</span><textarea class="e-expl" maxlength="3000" rows="2">${e(q.explanation || '')}</textarea></label></details>
    </div>`);
    const spec = el.querySelector('.e-spec');
    let curType = q.type; let getSpec = () => ({});
    const num = (cls, label, v, extra = '') => `<label class="f"><span>${label}</span><input class="${cls}" inputmode="decimal" value="${e(v == null ? '' : v)}" ${extra}></label>`;
    const ref = (label) => `<label class="f"><span>${label || 'Эталонный ответ / критерии (видит только проверяющий)'}</span><textarea class="e-ref" maxlength="10000" rows="3">${e(q.reference || '')}</textarea></label>`;
    const n = (sel) => { const v = spec.querySelector(sel).value.trim().replace(',', '.'); return v === '' ? undefined : Number(v); };
    const build = (t) => {
      curType = t;
      el.querySelector('.e-part-w').hidden = !PARTIAL.has(t);
      el.querySelector('.e-pts-w').hidden = t === 'info';
      el.querySelector('.e-tlabel').textContent = t === 'param' ? 'Шаблон задачи: переменные в фигурных скобках, например «Колонна из {n} машин…»' : t === 'case' ? 'Ситуация и вопрос кейса' : t === 'info' ? 'Информационный текст (не оценивается)' : 'Текст вопроса / задание';
      const kind = el.querySelector('.e-kind'); if (kind && t === 'case') kind.value = 'case';
      if (t === 'single' || t === 'multi' || t === 'eliminate') {
        spec.innerHTML = `<div class="small mut" style="margin-bottom:6px">${t === 'eliminate' ? 'Варианты — отметьте тот, который должен остаться последним (правильный):' : 'Варианты ответа — отметьте правильные:'}</div><div class="olist"></div><button type="button" class="btn sm addO">+ вариант</button>`;
        const olist = spec.querySelector('.olist');
        const add = (o) => { const r = h(`<div class="optrow"><input type="${t === 'multi' ? 'checkbox' : 'radio'}" name="c${Math.random().toString(36).slice(2, 6)}x" class="oc" ${o.correct ? 'checked' : ''}><input type="text" class="ot" maxlength="1000" value="${e(o.text)}" placeholder="Текст варианта"><button type="button" class="btn sm danger rm">✕</button></div>`);
          r.dataset.oid = o.id || ''; r.querySelector('.rm').onclick = () => r.remove(); olist.appendChild(r); };
        const name = 'c' + Math.random().toString(36).slice(2, 8);
        (q.options && q.options.length ? q.options : [{ text: '', correct: true }, { text: '' }]).forEach(add);
        spec.querySelectorAll('.oc').forEach(x => { if (t !== 'multi') x.name = name; });
        spec.querySelector('.addO').onclick = () => { add({ text: '' }); spec.querySelectorAll('.oc').forEach(x => { if (t !== 'multi') x.name = name; }); };
        getSpec = () => ({ options: [...olist.querySelectorAll('.optrow')].map(r => ({ id: r.dataset.oid || undefined, text: r.querySelector('.ot').value, correct: r.querySelector('.oc').checked })) });
      } else if (t === 'number') {
        spec.innerHTML = `<div class="fgrid">${num('e-ans', 'Правильный ответ *', q.answer)}${num('e-tol', 'Допуск ± (0 — точно)', q.tolerance || 0)}<label class="f"><span>Единица</span><input class="e-unit" maxlength="40" value="${e(q.unit || '')}"></label></div>`;
        getSpec = () => ({ answer: n('.e-ans'), tolerance: n('.e-tol') || 0, unit: spec.querySelector('.e-unit').value });
      } else if (t === 'slider') {
        spec.innerHTML = `<div class="fgrid">${num('e-min', 'Минимум', q.min ?? 0)}${num('e-max', 'Максимум', q.max ?? 100)}${num('e-step', 'Шаг', q.step ?? 1)}${num('e-ans', 'Правильное значение *', q.answer)}${num('e-tol', 'Допуск ±', q.tolerance || 0)}<label class="f"><span>Единица</span><input class="e-unit" maxlength="40" value="${e(q.unit || '')}"></label></div>`;
        getSpec = () => ({ min: n('.e-min'), max: n('.e-max'), step: n('.e-step'), answer: n('.e-ans'), tolerance: n('.e-tol') || 0, unit: spec.querySelector('.e-unit').value });
      } else if (t === 'text') {
        spec.innerHTML = `<label class="f"><span>Допустимые ответы — по одному в строке (регистр, ё и знаки по краям не важны). Пусто — ответ проверяется вручную.</span><textarea class="e-acc" rows="3">${e((q.accepted || []).join('\n'))}</textarea></label>${ref()}`;
        getSpec = () => ({ accepted: splitLines(spec.querySelector('.e-acc').value), reference: spec.querySelector('.e-ref').value });
      } else if (t === 'param') {
        spec.innerHTML = `<label class="f"><span>Переменные — по одной в строке: «a = 2..9 шаг 1» (диапазон) или «b = 10; 20; 50» (список)</span><textarea class="e-vars" rows="3">${e(varsToText(q.vars))}</textarea></label>
          <div class="fgrid"><label class="f"><span>Формула ответа * (+ − * / ^, round(x, 2), sqrt, min, max)</span><input class="e-formula" maxlength="500" value="${e(q.formula || '')}" placeholder="a * b"></label>${num('e-tol', 'Допуск ±', q.tolerance || 0)}<label class="f"><span>Единица</span><input class="e-unit" maxlength="40" value="${e(q.unit || '')}"></label></div>`;
        getSpec = () => ({ vars: textToVars(spec.querySelector('.e-vars').value), formula: spec.querySelector('.e-formula').value, tolerance: n('.e-tol') || 0, unit: spec.querySelector('.e-unit').value });
      } else if (t === 'long') { spec.innerHTML = ref(); getSpec = () => ({ reference: spec.querySelector('.e-ref').value }); }
      else if (t === 'case') {
        spec.innerHTML = ref('Эталонное решение (видит только проверяющий)') + `<label class="f"><span>Критерии оценки — по одному в строке: «текст | баллы» (сумма станет баллами кейса, если баллы не заданы)</span><textarea class="e-crit" rows="4">${e((q.criteria || []).map(c => c.text + (c.points ? ' | ' + c.points : '')).join('\n'))}</textarea></label>`;
        getSpec = () => ({ reference: spec.querySelector('.e-ref').value, criteria: splitLines(spec.querySelector('.e-crit').value) });
      } else if (t === 'order') {
        spec.innerHTML = `<label class="f"><span>Элементы в ПРАВИЛЬНОМ порядке — по одному в строке (кандидат увидит их перемешанными)</span><textarea class="e-items" rows="5">${e((q.items || []).map(x => x.text || x).join('\n'))}</textarea></label>`;
        getSpec = () => ({ items: splitLines(spec.querySelector('.e-items').value) });
      } else if (t === 'match') {
        spec.innerHTML = `<label class="f"><span>Пары — по одной в строке: «левая часть => правая часть»</span><textarea class="e-pairs" rows="5">${e((q.pairs || []).map(p => p.left + ' => ' + p.right).join('\n'))}</textarea></label>
          <label class="f"><span>Лишние варианты справа (необязательно) — по одному в строке</span><textarea class="e-distr" rows="2">${e((q.distractors || []).join('\n'))}</textarea></label>`;
        getSpec = () => ({ pairs: splitLines(spec.querySelector('.e-pairs').value).map((l, i) => { const m = l.split(/\s*=>\s*/); if (m.length !== 2) throw new Error(`Пара ${i + 1}: используйте «левая => правая»`); return { left: m[0], right: m[1] }; }), distractors: splitLines(spec.querySelector('.e-distr').value) });
      } else if (CONTENT_HELP[t]) {
        spec.innerHTML = `<label class="f"><span>${CONTENT_HELP[t]}</span><textarea class="e-content" rows="5">${e(q.content || '')}</textarea></label>`;
        getSpec = () => ({ content: spec.querySelector('.e-content').value });
      } else if (t === 'file') {
        const acc = q.accept || 'image/*,application/pdf';
        spec.innerHTML = `<div class="fgrid"><label class="f"><span>Типы файлов</span><select class="e-accept">${[['image/*,application/pdf', 'Изображения и PDF'], ['image/*', 'Только изображения'], ['*/*', 'Любые файлы']].map(([v, l]) => `<option value="${v}" ${v === acc ? 'selected' : ''}>${l}</option>`).join('')}</select></label>${num('e-maxkb', 'Макс. размер, КБ (до 1024)', q.max_kb || 1024)}</div>
          <label class="chk"><input type="checkbox" class="e-allowurl" ${q.allow_url === false ? '' : 'checked'}> Разрешить вместо файла ссылку</label>${ref()}`;
        getSpec = () => ({ accept: spec.querySelector('.e-accept').value, max_kb: n('.e-maxkb'), allow_url: spec.querySelector('.e-allowurl').checked, reference: spec.querySelector('.e-ref').value });
      } else if (t === 'voice') {
        spec.innerHTML = `<div class="fgrid">${num('e-maxsec', 'Макс. длительность, сек (5–300)', q.max_sec || 120)}</div>${ref()}`;
        getSpec = () => ({ max_sec: n('.e-maxsec'), reference: spec.querySelector('.e-ref').value });
      } else if (t === 'letters') {
        spec.innerHTML = `<div class="fgrid"><label class="f"><span>Слово-ответ *</span><input class="e-word" maxlength="60" value="${e(q.word || '')}"></label><label class="f"><span>Лишние буквы (необязательно)</span><input class="e-extra" maxlength="30" value="${e(q.extra_letters || '')}"></label></div>`;
        getSpec = () => ({ word: spec.querySelector('.e-word').value, extra_letters: spec.querySelector('.e-extra').value });
      } else if (t === 'words') {
        spec.innerHTML = `<label class="f"><span>Фраза-ответ * (слова через пробел)</span><input class="e-phrase" maxlength="1000" value="${e(q.phrase || '')}"></label><label class="f"><span>Лишние слова (через пробел, необязательно)</span><input class="e-extra" maxlength="1000" value="${e((q.extra_words || []).join(' '))}"></label>`;
        getSpec = () => ({ phrase: spec.querySelector('.e-phrase').value, extra_words: spec.querySelector('.e-extra').value.split(/\s+/).filter(Boolean) });
      } else { spec.innerHTML = ''; getSpec = () => ({}); }
    };
    build(q.type);
    el.querySelector('.e-type').onchange = (ev) => { const t = ev.target.value; if (t === 'case' && !Number(el.querySelector('.e-pts').value)) el.querySelector('.e-pts').value = 5; build(t); };
    const get = () => {
      const body = Object.assign({ type: curType, text: el.querySelector('.e-text').value, points: Number(el.querySelector('.e-pts').value || 0) }, getSpec());
      if (PARTIAL.has(curType)) body.partial = el.querySelector('.e-partial').checked;
      body.article = el.querySelector('.e-article').value; body.explanation = el.querySelector('.e-expl').value;
      if (opts.bank) { body.category = el.querySelector('.e-cat').value; body.kind = el.querySelector('.e-kind').value; body.easy = el.querySelector('.e-easy').checked; body.active = el.querySelector('.e-active').checked; }
      return body;
    };
    return { el, get };
  }

  // ---------- проверка (админ) ----------
  function review(it, i, ctx) {
    const q = it.question; const N = q.native || {};
    const pts = it.manual_points ?? '';
    const head = `<div class="row between"><span class="small mut">${it.group ? e(it.group) + ' · ' : ''}${q.kind === 'case' ? '<b>Кейс</b> · ' : ''}Вопрос ${i + 1} · ${ICONS[q.type] || ''} ${e(LABELS[q.type] || q.type)}${q.category ? ' · ' + e(q.category) : ''}</span><span class="small mut">${q.points} балл(ов)</span></div>`;
    let body = '';
    const text = it.public && it.public.text ? it.public.text : q.text;
    if (q.type === 'info') return `<div class="q info-q">${head}<div class="qt">${e(text)}</div><div class="small mut">Информационный блок — не оценивается.</div></div>`;
    if (q.type === 'single' || q.type === 'multi') {
      const chosen = Array.isArray(it.answer) ? it.answer : it.answer ? [it.answer] : [];
      body = '<ul>' + q.options.map(o => { const c = chosen.includes(o.id), ok = q.correct.includes(o.id);
        return `<li class="${c ? 'o-chosen' : ''} ${ok ? 'o-correct' : c ? 'o-wrong' : ''}">${c ? '☑' : '☐'} ${e(o.text)}${ok ? ' — правильный' : ''}</li>`; }).join('') + '</ul>';
    } else {
      body = `<div class="small mut">Ответ кандидата:</div><div class="ans">${it.answer_text ? e(it.answer_text) : '<span class="mut">(нет ответа)</span>'}</div>`;
      if (it.upload) body += `<div class="row small"><button type="button" class="btn sm" data-up="${it.upload.id}">${it.upload.kind === 'voice' ? '▶ Прослушать' : '📎 Открыть файл'}</button><span class="mut">${e(it.upload.name)} · ${e(it.upload.mime)} · ${fmtKB(it.upload.size)}</span></div><div class="upview" id="upv${it.upload.id}"></div>`;
      else if (it.answer && it.answer.url) body += `<div class="small">Ссылка: <a href="${e(it.answer.url)}" target="_blank" rel="noopener noreferrer nofollow">${e(it.answer.url)}</a></div>`;
      if (it.expected_text) body += `<div class="ref"><b>Правильно:</b>\n${e(it.expected_text)}</div>`;
    }
    if (q.reference) body += `<div class="ref"><b>Эталон:</b> ${e(q.reference)}</div>`;
    const crit = (N.criteria || []).filter(c => c.text);
    if (crit.length) body += `<div class="crit" data-q="${q.id}"><div class="small"><b>Критерии</b> (отметьте выполненные — баллы посчитаются сами):</div>${crit.map((c, k) => `<label class="chk small"><input type="checkbox" class="critc" data-q="${q.id}" data-p="${c.points}"> ${e(c.text)} <span class="mut">(${c.points})</span></label>`).join('')}</div>`;
    if (N.article || N.explanation) body += `<div class="small mut">${N.article ? 'Статья: ' + e(N.article) : ''}${N.explanation ? '<br>' + e(N.explanation) : ''}</div>`;
    const manualNeeded = it.needs_review && it.manual_points == null;
    body += `<div class="row small" style="margin-top:6px">${it.auto_points != null ? `Автопроверка: <b>${it.auto_points} / ${q.points}</b> · ` : ''}${it.needs_review ? 'Баллы' : 'Изменить баллы вручную'}: <input type="number" class="pts" data-q="${q.id}" min="0" max="${q.points}" step="0.5" value="${pts}" placeholder="${it.needs_review ? '' : 'авто'}" style="width:90px"> / ${q.points} ${manualNeeded ? '<span class="badge warn">требует оценки</span>' : ''}</div>`;
    return `<div class="q">${head}<div class="qt">${e(text)}</div>${body}</div>`;
  }
  function bindReview(root, api) {
    root.querySelectorAll('[data-up]').forEach(b => b.onclick = async () => {
      const box = root.querySelector('#upv' + b.dataset.up);
      try {
        const f = await api('GET', '/api/uploads/' + b.dataset.up);
        const url = `data:${f.mime};base64,${f.data}`;
        if (/^audio\//.test(f.mime)) box.innerHTML = `<audio controls src="${e(url)}"></audio>`;
        else if (/^image\//.test(f.mime)) box.innerHTML = `<img src="${e(url)}" alt="" style="max-width:100%;max-height:480px;border:1px solid #333">`;
        else { const a = document.createElement('a'); a.href = url; a.download = f.name || 'file'; a.textContent = '⬇ Скачать ' + (f.name || 'файл'); a.className = 'btn sm'; box.innerHTML = ''; box.appendChild(a); }
      } catch (err) { box.textContent = err.message; }
    });
    root.querySelectorAll('.crit').forEach(c => {
      const qid = c.dataset.q; const inp = root.querySelector(`.pts[data-q="${qid}"]`);
      c.addEventListener('change', () => { let s = 0; c.querySelectorAll('.critc:checked').forEach(x => { s += Number(x.dataset.p) || 0; }); inp.value = Math.min(s, Number(inp.max)); });
    });
  }
  window.QT = { LABELS, ICONS, PARTIAL, mount, editor, review, bindReview, esc: e };
})();
