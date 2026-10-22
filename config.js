// Адрес API (Cloudflare Worker). При локальном тестировании используется localhost.
window.VP_CONFIG = {
  API_BASE: (location.hostname === 'localhost' || location.hostname === '127.0.0.1')
    ? 'http://localhost:8787'
    : 'https://vp-exam-api.reflektpro8.workers.dev',
  HEARTBEAT_SEC: 10,          // как часто плеер отправляет прогресс
  PAUSE_ON_HIDDEN: true,      // ставить видео на паузу, если вкладка скрыта
};
