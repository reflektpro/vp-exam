/* Плеер лекций без перемотки вперёд. Серверная проверка — в worker (heartbeat). */
'use strict';
window.VPPlayer = {
  mount(box, lec, msgEl) {
    const prog = lec.progress || { max_pos: 0, last_pos: 0, completed_at: null };
    let maxAllowed = prog.max_pos || 0;      // дальше этой точки перематывать нельзя
    let completed = !!prog.completed_at;
    let lastT = 0, hbTimer = null, hbBusy = false, hbQueued = false, guard = false;
    const dur = lec.duration_sec;
    box.innerHTML = `<div class="player" id="pl">
      <video preload="metadata" playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"></video>
      <div class="ov"><button class="big" type="button" title="Смотреть">▶</button></div>
      <div class="ctrl">
        <button type="button" class="pp" title="Пуск/пауза">▶</button>
        <span class="time">0:00 / ${fmtTime(dur)}</span>
        <div class="track" title="Перемотка вперёд недоступна"><div class="w"></div><div class="c"></div></div>
        <button type="button" class="back" title="Назад на 10 секунд">↺10</button>
        <button type="button" class="mute" title="Звук">🔊</button>
        <input type="range" class="vol" min="0" max="1" step="0.05" value="1" title="Громкость">
        <span class="speed" title="Скорость воспроизведения фиксирована">1×</span>
        <button type="button" class="fs" title="Во весь экран">⛶</button>
      </div></div>`;
    const pl = box.querySelector('#pl'), v = pl.querySelector('video');
    const ov = pl.querySelector('.ov'), pp = pl.querySelector('.pp'), tm = pl.querySelector('.time');
    const tw = pl.querySelector('.track .w'), tc = pl.querySelector('.track .c');
    const msg = (t, cls) => { msgEl.innerHTML = t ? `<span class="${cls === 'err' ? 'o-wrong' : cls === 'ok' ? 'o-correct' : 'mut'}">${t}</span>` : ''; };
    if (!lec.video_url) { box.innerHTML = '<div class="alert warn">Видео для этой лекции ещё не загружено.</div>'; return; }
    v.src = lec.video_url;
    if (completed) msg('✔ Лекция засчитана. Можно пересматривать.', 'ok');

    const draw = () => {
      const d = dur || v.duration || 1;
      tw.style.width = Math.min(100, Math.max(maxAllowed, v.currentTime) / d * 100) + '%';
      tc.style.width = Math.min(100, v.currentTime / d * 100) + '%';
      tm.textContent = fmtTime(v.currentTime) + ' / ' + fmtTime(dur || v.duration);
      pp.textContent = v.paused ? '▶' : '❚❚';
      ov.style.display = v.paused ? 'flex' : 'none';
    };
    const snap = (t) => { guard = true; v.currentTime = t; lastT = t; setTimeout(() => { guard = false; }, 50); };

    v.addEventListener('loadedmetadata', () => {
      const start = Math.min(prog.last_pos || 0, maxAllowed);
      if (start > 1 && start < (v.duration || dur) - 2) snap(start);
      draw();
    });
    v.addEventListener('timeupdate', () => {
      const t = v.currentTime;
      if (!guard && !v.seeking) {
        const step = t - lastT;
        if (step > 0 && step < 2) maxAllowed = Math.max(maxAllowed, t);        // естественное воспроизведение
        else if (t > maxAllowed + 1) { snap(maxAllowed); msg('Перемотка вперёд недоступна.', 'err'); }
      }
      lastT = v.currentTime; draw();
    });
    v.addEventListener('seeking', () => {
      if (guard) return;
      if (v.currentTime > maxAllowed + 0.5) { snap(maxAllowed); msg('Перемотка вперёд недоступна.', 'err'); }
    });
    v.addEventListener('ratechange', () => { if (v.playbackRate !== 1) v.playbackRate = 1; if (v.defaultPlaybackRate !== 1) v.defaultPlaybackRate = 1; });
    v.addEventListener('play', () => { lastT = v.currentTime; send('play'); startHb(); draw(); });
    v.addEventListener('pause', () => { stopHb(); send('pause'); draw(); });
    v.addEventListener('ended', () => { stopHb(); send('ended', Math.max(v.duration || 0, v.currentTime)); draw(); });
    v.addEventListener('error', () => msg('Не удалось загрузить видео. Сообщите администратору.', 'err'));
    v.addEventListener('contextmenu', e => e.preventDefault());
    v.addEventListener('click', () => toggle());
    v.addEventListener('dblclick', () => fs());

    const toggle = () => { if (v.paused) v.play().catch(() => {}); else v.pause(); };
    pp.onclick = toggle; ov.querySelector('.big').onclick = toggle;
    pl.querySelector('.back').onclick = () => { snap(Math.max(0, v.currentTime - 10)); send('seek'); };
    const mute = pl.querySelector('.mute'), vol = pl.querySelector('.vol');
    mute.onclick = () => { v.muted = !v.muted; mute.textContent = v.muted ? '🔇' : '🔊'; };
    vol.oninput = () => { v.volume = Number(vol.value); v.muted = v.volume === 0; mute.textContent = v.muted ? '🔇' : '🔊'; };
    const fs = () => { if (document.fullscreenElement) document.exitFullscreen(); else pl.requestFullscreen && pl.requestFullscreen().catch(() => {}); };
    pl.querySelector('.fs').onclick = fs;
    const keys = (e) => {
      if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
      if (e.code === 'Space' || e.key === 'k') { e.preventDefault(); toggle(); }
      if (['ArrowRight', 'ArrowLeft', 'End', 'Home'].includes(e.key)) e.preventDefault();
    };
    document.addEventListener('keydown', keys);
    const vis = () => { if (CFG.PAUSE_ON_HIDDEN && document.hidden && !v.paused) v.pause(); };
    document.addEventListener('visibilitychange', vis);

    async function send(event, posOverride) {
      if (hbBusy) { hbQueued = true; return; }
      hbBusy = true;
      try {
        const r = await api('POST', `/api/lectures/${lec.id}/heartbeat`, { position: posOverride != null ? posOverride : v.currentTime, event });
        if (!r.accepted) {
          maxAllowed = Math.min(maxAllowed, r.max_pos);
          if (v.currentTime > r.max_pos + 1) snap(r.last_pos);
          msg('Сервер не принял прогресс: ' + esc(r.reason || 'нарушение просмотра') + '. Просмотр продолжится с допустимой точки.', 'err');
        } else maxAllowed = Math.max(maxAllowed, r.max_pos);
        if (r.completed && !completed) { completed = true; msg('✔ Лекция засчитана! Можно переходить к следующей.', 'ok'); toast('Лекция засчитана'); }
        else if (!r.completed && r.accepted && event === 'ended') msg('Видео закончилось, но засчитано только ' + Math.round(r.watched_sec / r.duration_sec * 100) + '% просмотра. Досмотрите пропущенные части.', 'err');
      } catch (e) { if (e.status === 429) msg('Слишком частые запросы.', 'err'); else msg('Нет связи с сервером — прогресс может не сохраниться.', 'err'); }
      hbBusy = false;
      if (hbQueued) { hbQueued = false; send('tick'); }
    }
    function startHb() { stopHb(); hbTimer = setInterval(() => send('tick'), (CFG.HEARTBEAT_SEC || 10) * 1000); }
    function stopHb() { if (hbTimer) clearInterval(hbTimer); hbTimer = null; }
    onCleanup(() => { stopHb(); if (!v.paused) { v.pause(); } document.removeEventListener('keydown', keys); document.removeEventListener('visibilitychange', vis); v.removeAttribute('src'); v.load(); });
    draw();
  },
};
