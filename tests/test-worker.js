// ТОЛЬКО ДЛЯ ЛОКАЛЬНЫХ ТЕСТОВ. Не деплоится. Добавляет /__test/login поверх боевого worker.
import real from '../worker/worker.js';
// роли тестового пользователя: ?roles=vp,reatt,leader,examiner,admin (или roles=none). Без параметра — vp,reatt (как у старых тестов).
async function setRoles(env, id, url) {
  const rp = url.searchParams.get('roles');
  if (rp === null) { await env.DB.prepare('UPDATE users SET vp = 1, reatt = 1 WHERE id = ?1').bind(id).run(); return; }
  const r = new Set(rp.split(',').map(x => x.trim()));
  const role = r.has('admin') ? 'admin' : r.has('examiner') ? 'examiner' : 'candidate';
  await env.DB.prepare('UPDATE users SET vp = ?1, reatt = ?2, leader = ?3, role = ?4 WHERE id = ?5').bind(r.has('vp') ? 1 : 0, r.has('reatt') ? 1 : 0, r.has('leader') ? 1 : 0, role, id).run();
}
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
      await setRoles(env, id, url);
      const token = 'test_' + crypto.randomUUID().replace(/-/g, '');
      await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?1, ?2, ?3, ?4)').bind(await sha256(token), id, now, now + 86400000).run();
      return new Response(JSON.stringify({ token }), { headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });
    }
    // имитация входа через Discord: создаёт одноразовый login_code и возвращает на return, как /auth/callback
    if (url.pathname === '/__test/oauth') {
      const local = ['localhost', '127.0.0.1'].includes(url.hostname);
      if (env.TEST_MODE !== '1' || !local) return new Response('forbidden', { status: 403 });
      const id = url.searchParams.get('id'), name = url.searchParams.get('name') || 'tester', ret = url.searchParams.get('return');
      const now = Date.now();
      await env.DB.prepare(`INSERT INTO users (id, username, global_name, role, created_at, last_login_at) VALUES (?1, ?2, ?2, 'candidate', ?3, ?3) ON CONFLICT(id) DO UPDATE SET last_login_at = ?3`).bind(id, name, now).run();
      await setRoles(env, id, url);
      const code = 'lc_' + crypto.randomUUID().replace(/-/g, '');
      await env.DB.prepare('INSERT INTO login_codes (code_hash, user_id, created_at) VALUES (?1, ?2, ?3)').bind(await sha256(code), id, now).run();
      const u = new URL(ret); u.searchParams.set('login_code', code);
      return new Response(null, { status: 302, headers: { Location: u.toString() } });
    }
    // правка данных для сценариев «после срока» (только локально, TEST_MODE)
    if (url.pathname === '/__test/sql' && request.method === 'POST') {
      const local = ['localhost', '127.0.0.1'].includes(url.hostname);
      if (env.TEST_MODE !== '1' || !local) return new Response('forbidden', { status: 403 });
      const b = await request.json();
      const r = await env.DB.prepare(b.sql).bind(...(b.args || [])).all();
      return new Response(JSON.stringify({ results: r.results || [] }), { headers: { 'Content-Type': 'application/json' } });
    }
    return real.fetch(request, env, ctx);
  },
};
