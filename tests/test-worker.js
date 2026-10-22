// ТОЛЬКО ДЛЯ ЛОКАЛЬНЫХ ТЕСТОВ. Не деплоится. Добавляет /__test/login поверх боевого worker.
import real from '../worker/worker.js';
async function sha256(s) { const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)); return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join(''); }
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/__test/login') {
      const local = ['localhost', '127.0.0.1'].includes(url.hostname);
      if (env.TEST_MODE !== '1' || !local) return new Response('forbidden', { status: 403 });
      const id = url.searchParams.get('id'), name = url.searchParams.get('name') || 'tester';
      const now = Date.now();
      await env.DB.prepare(`INSERT INTO users (id, username, global_name, role, created_at, last_login_at) VALUES (?1, ?2, ?2, 'candidate', ?3, ?3) ON CONFLICT(id) DO UPDATE SET last_login_at = ?3`).bind(id, name, now).run();
      const token = 'test_' + crypto.randomUUID().replace(/-/g, '');
      await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)').bind(await sha256(token), id, now, now + 86400000).run();
      return new Response(JSON.stringify({ token }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    return real.fetch(request, env, ctx);
  },
};
