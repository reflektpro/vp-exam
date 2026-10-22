/* Плеер лекций без перемотки вперёд: файл (mp4/webm) или YouTube.
   Серверная проверка — в worker (heartbeat). */
'use strict';
(function () {
  // ---------- YouTube IFrame API ----------
  let ytPromise = null;
  function loadYT() {
    if (window.YT && window.YT.Player) return Promise.resolve(window.YT);
    if (ytPromise) return ytPromise;
    ytPromise = new Promise((resolve, reject) => {
      const prev = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => { if (prev) try { prev(); } catch (_) {} resolve(window.YT); };
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api'; s.async = true;
      s.onerror = () => { ytPromise = null; reject(new Error('Не удалось загрузить YouTube (проверьте интернет или блокировщик рекламы)')); };
      document.head.appendChild(s);
      setTimeout(() => { if (!(window.YT && window.YT.Player)) { ytPromise = null; reject(new Error('YouTube не отвечает')); } }, 20000);
    });
    return ytPromise;
  }
  const YT_ERR = { 2: 'некорректный id ролика', 5: 'ошибка HTML5-плеера', 100: 'видео не найдено или приватное', 101: 'владелец запретил встраивание на сайты', 150: 'владелец запретил встраивание на сайты' };
  function ytErrorText(code) { return 'YouTube: ' + (YT_ERR[code] || 'ошибка ' + code) + (code === 101 || code === 150 ? ' (в YouTube Studio включите «Разрешить встраивание»)' : '') + '.'; }

  // Длительность ролика YouTube через скрытый плеер (для админки).
  function youtubeDuration(id, timeoutMs = 20000) {
    return loadYT().then(YT => new Promise((resolve, reject) => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:-10000px;top:0;width:320px;height:180px;';
      const el = document.createElement('div'); host.appendChild(el); document.body.appendChild(host);
      let done = false, poll = null, p = null;
      const finish = (err, val) => { if (done) return; done = true; clearInterval(poll); clearTimeout(to); try { p && p.destroy(); } catch (_) {} host.remove(); err ? reject(err) : resolve(val); };
      const to = setTimeout(() => finish(new Error('YouTube не вернул длительность (таймаут)')), timeoutMs);
      p = new YT.Player(el, { videoId: id, width: 320, height: 180, playerVars: { controls: 0, autoplay: 0, mute: 1, playsinline: 1 },
        events: {
          onReady: () => { poll = setInterval(() => { const d = p.getDuration && p.getDuration(); if (d > 0) finish(null, d); }, 300); },
          onError: (e) => finish(new Error(ytErrorText(e.data))),
        } });
    }));
  }
  // Длительность файла: скрытый <video> без crossOrigin (для метаданных CORS не нужен).
  function fileDuration(url, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.preload = 'metadata'; v.muted = true;
      v.style.cssText = 'position:fixed;left:-10000px;width:1px;height:1px';
      let done = false;
      const finish = (err, val) => { if (done) return; done = true; clearTimeout(to); v.removeAttribute('src'); try { v.load(); } catch (_) {} v.remove(); err ? reject(err) : resolve(val); };
      const to = setTimeout(() => finish(new Error('Видео не ответило за 20 секунд — проверьте, что ссылка прямая и открывается в браузере')), timeoutMs);
      v.addEventListener('loadedmetadata', () => { if (isFinite(v.duration) && v.duration > 0) finish(null, v.duration); else finish(new Error('Файл открылся, но длительность неизвестна (возможно, это поток)')); });
      v.addEventListener('error', () => finish(new Error('Браузер не смог открыть видео по ссылке. Нужна прямая ссылка на файл .mp4 (H.264) или .webm, либо ссылка YouTube.')));
      document.body.appendChild(v);
      v.src = url;
    });
  }
  function detectYoutubeId(u) {
    try {
      const url = new URL(u, location.href);
      const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
      let id = null;
      if (host === 'youtu.be') id = url.pathname.split('/')[1];
      else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
        if (url.pathname === '/watch') id = url.searchParams.get('v');
        else { const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname); if (m) id = m[1]; }
      }
      return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
    } catch (_) { return null; }
  }
  window.VPMedia = { loadYT, youtubeDuration, fileDuration, detectYoutubeId, ytErrorText };

  // ---------- адаптеры ----------
  function fileAdapter(container, url, startAt, cb) {
    container.innerHTML = '<video preload="metadata" playsinline disablepictureinpicture controlslist="nodownload noplaybackrate noremoteplayback"></video>';
    const v = container.querySelector('video');
    const A = {
      el: v, time: () => v.currentTime || 0, duration: () => v.duration || 0, paused: () => v.paused,
      play: () => v.play().catch(() => {}), pause: () => v.pause(), seek: (t) => { v.currentTime = t; },
      volume: (x) => { v.volume = x; }, mute: (m) => { v.muted = m; },
      destroy: () => { try { v.pause(); } catch (_) {} v.removeAttribute('src'); try { v.load(); } catch (_) {} },
    };
    v.addEventListener('loadedmetadata', () => { if (startAt > 1 && startAt < (v.duration || 1e9) - 2) v.currentTime = startAt; cb.ready(); });
    v.addEventListener('seeking', () => cb.seeking());
    v.addEventListener('ratechange', () => { if (v.playbackRate !== 1) v.playbackRate = 1; if (v.defaultPlaybackRate !== 1) v.defaultPlaybackRate = 1; });
    v.addEventListener('play', () => cb.play());
    v.addEventListener('pause', () => cb.pause());
    v.addEventListener('ended', () => cb.ended());
    v.addEventListener('error', () => cb.error('Не удалось загрузить видео. Сообщите администратору.'));
    v.addEventListener('contextmenu', e => e.preventDefault());
    v.src = url;
    return A;
  }
  function youtubeAdapter(container, id, startAt, cb) {
    container.innerHTML = '<div class="ytwrap"><div class="ytp"></div><div class="shield" title=""></div></div>';
    const target = container.querySelector('.ytp');
    let p = null, state = -1, readyFlag = false;
    const A = {
      el: container.querySelector('.shield'),
      time: () => (p && readyFlag && p.getCurrentTime) ? (p.getCurrentTime() || 0) : 0,
      duration: () => (p && readyFlag && p.getDuration) ? (p.getDuration() || 0) : 0,
      paused: () => !(state === 1 || state === 3),
      play: () => { p && readyFlag && p.playVideo(); }, pause: () => { p && readyFlag && p.pauseVideo(); },
      seek: (t) => { p && readyFlag && p.seekTo(t, true); },
      volume: (x) => { p && readyFlag && p.setVolume(Math.round(x * 100)); }, mute: (m) => { if (p && readyFlag) m ? p.mute() : p.unMute(); },
      destroy: () => { try { p && p.destroy(); } catch (_) {} },
    };
    loadYT().then(YT => {
      p = new YT.Player(target, {
        videoId: id, width: '100%', height: '100%',
        playerVars: { controls: 0, disablekb: 1, modestbranding: 1, rel: 0, fs: 0, iv_load_policy: 3, playsinline: 1, cc_load_policy: 0,
          start: startAt > 1 ? Math.floor(startAt) : 0, origin: location.origin },
        events: {
          onReady: () => { readyFlag = true; try { p.setPlaybackRate(1); } catch (_) {} cb.ready(); },
          onStateChange: (e) => {
            const prev = state; state = e.data;
            if (state === 1 && prev !== 1) cb.play();
            else if (state === 2) cb.pause();
            else if (state === 0) cb.ended();
          },
          onPlaybackRateChange: () => { try { if (p.getPlaybackRate() !== 1) p.setPlaybackRate(1); } catch (_) {} },
          onError: (e) => cb.error(ytErrorText(e.data)),
        },
      });
    }).catch(e => cb.error(e.message));
    return A;
  }

  // ---------- плеер ----------
  window.VPPlayer = {
    mount(box, lec, msgEl) {
      const prog = lec.progress || { max_pos: 0, last_pos: 0, completed_at: null };
      let maxAllowed = prog.max_pos || 0;
      let completed = !!prog.completed_at;
      let lastT = 0, hbTimer = null, poll = null, hbBusy = false, hbQueued = false, guardUntil = 0, playing = false;
      const dur = lec.duration_sec;
      const msg = (t, cls) => { msgEl.innerHTML = t ? `<span class="${cls === 'err' ? 'o-wrong' : cls === 'ok' ? 'o-correct' : 'mut'}">${t}</span>` : ''; };
      if (!lec.video_url) { box.innerHTML = '<div class="alert warn">Видео для этой лекции ещё не загружено.</div>'; return; }
      const isYT = lec.type === 'youtube' || !!window.VPMedia.detectYoutubeId(lec.video_url);
      box.innerHTML = `<div class="player" id="pl">
        <div class="media"></div>
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
      const pl = box.querySelector('#pl');
      const ov = pl.querySelector('.ov'), pp = pl.querySelector('.pp'), tm = pl.querySelector('.time');
      const tw = pl.querySelector('.track .w'), tc = pl.querySelector('.track .c');
      if (completed) msg('✔ Лекция засчитана. Можно пересматривать.', 'ok');
      const startAt = Math.min(prog.last_pos || 0, maxAllowed);

      const cb = {
        ready: () => { lastT = A.time(); draw(); },
        seeking: () => { if (Date.now() < guardUntil) return; if (A.time() > maxAllowed + 0.5) { snap(maxAllowed); msg('Перемотка вперёд недоступна.', 'err'); } },
        play: () => { playing = true; lastT = A.time(); send('play'); startHb(); draw(); },
        pause: () => { playing = false; stopHb(); send('pause'); draw(); },
        ended: () => { playing = false; stopHb(); send('ended', Math.max(A.duration() || 0, A.time())); draw(); },
        error: (t) => msg(esc(t), 'err'),
      };
      const media = pl.querySelector('.media');
      const A = isYT ? youtubeAdapter(media, lec.youtube_id || window.VPMedia.detectYoutubeId(lec.video_url), startAt, cb) : fileAdapter(media, lec.video_url, startAt, cb);
      const snap = (t) => { guardUntil = Date.now() + 400; A.seek(t); lastT = t; };

      function draw() {
        const d = dur || A.duration() || 1, t = A.time();
        tw.style.width = Math.min(100, Math.max(maxAllowed, t) / d * 100) + '%';
        tc.style.width = Math.min(100, t / d * 100) + '%';
        tm.textContent = fmtTime(t) + ' / ' + fmtTime(dur || A.duration());
        const paused = A.paused();
        pp.textContent = paused ? '▶' : '❚❚';
        ov.style.display = paused ? 'flex' : 'none';
      }
      // Опрос позиции: ловит перемотку в обход интерфейса и двигает «досмотрено до».
      function tick() {
        const t = A.time();
        if (Date.now() >= guardUntil) {
          const step = t - lastT;
          if (step >= 0 && step < 2) { if (!A.paused()) maxAllowed = Math.max(maxAllowed, t); }
          else if (t > maxAllowed + 1) { snap(maxAllowed); msg('Перемотка вперёд недоступна.', 'err'); }
        }
        lastT = A.time(); draw();
      }
      poll = setInterval(tick, 250);

      const toggle = () => { if (A.paused()) A.play(); else A.pause(); };
      pp.onclick = toggle; ov.querySelector('.big').onclick = toggle;
      A.el.addEventListener('click', toggle);
      A.el.addEventListener('dblclick', () => fs());
      A.el.addEventListener('contextmenu', e => e.preventDefault());
      pl.querySelector('.back').onclick = () => { snap(Math.max(0, A.time() - 10)); send('seek'); };
      const mute = pl.querySelector('.mute'), vol = pl.querySelector('.vol');
      let muted = false;
      mute.onclick = () => { muted = !muted; A.mute(muted); mute.textContent = muted ? '🔇' : '🔊'; };
      vol.oninput = () => { const x = Number(vol.value); A.volume(x); muted = x === 0; A.mute(muted); mute.textContent = muted ? '🔇' : '🔊'; };
      const fs = () => { if (document.fullscreenElement) document.exitFullscreen(); else pl.requestFullscreen && pl.requestFullscreen().catch(() => {}); };
      pl.querySelector('.fs').onclick = fs;
      const keys = (e) => {
        if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
        if (e.code === 'Space' || e.key === 'k') { e.preventDefault(); toggle(); }
        if (['ArrowRight', 'ArrowLeft', 'End', 'Home'].includes(e.key)) e.preventDefault();
      };
      document.addEventListener('keydown', keys);
      const vis = () => { if (CFG.PAUSE_ON_HIDDEN && document.hidden && !A.paused()) A.pause(); };
      document.addEventListener('visibilitychange', vis);

      async function send(event, posOverride) {
        if (hbBusy) { hbQueued = true; return; }
        hbBusy = true;
        try {
          const r = await api('POST', `/api/lectures/${lec.id}/heartbeat`, { position: posOverride != null ? posOverride : A.time(), event });
          if (!r.accepted) {
            maxAllowed = Math.min(maxAllowed, r.max_pos);
            if (A.time() > r.max_pos + 1) snap(r.last_pos);
            msg('Сервер не принял прогресс: ' + esc(r.reason || 'нарушение просмотра') + '. Просмотр продолжится с допустимой точки.', 'err');
          } else maxAllowed = Math.max(maxAllowed, r.max_pos);
          if (r.completed && !completed) { completed = true; msg('✔ Лекция засчитана! Можно переходить к следующей.', 'ok'); toast('Лекция засчитана'); }
          else if (!r.completed && r.accepted && event === 'ended') msg('Видео закончилось, но засчитано только ' + Math.round(r.watched_sec / r.duration_sec * 100) + '% просмотра. Досмотрите пропущенные части.', 'err');
        } catch (e) { if (e.status === 429) msg('Слишком частые запросы.', 'err'); else msg(esc(e.message || 'Нет связи с сервером — прогресс может не сохраниться.'), 'err'); }
        hbBusy = false;
        if (hbQueued) { hbQueued = false; send('tick'); }
      }
      function startHb() { stopHb(); hbTimer = setInterval(() => send('tick'), (CFG.HEARTBEAT_SEC || 10) * 1000); }
      function stopHb() { if (hbTimer) clearInterval(hbTimer); hbTimer = null; }
      onCleanup(() => { stopHb(); clearInterval(poll); if (playing) { try { send('pause'); } catch (_) {} } document.removeEventListener('keydown', keys); document.removeEventListener('visibilitychange', vis); A.destroy(); });
      window.__vpPlayer = { A, get maxAllowed() { return maxAllowed; } }; // для отладки/тестов
      draw();
    },
  };
})();
