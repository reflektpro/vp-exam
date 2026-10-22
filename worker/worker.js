// ГУ ВП — Учебный центр. API (Cloudflare Worker + D1).
// Без внешних зависимостей, один ES-модуль. См. README.md.

const SESSION_TTL_MS = 7 * 24 * 3600 * 1000;
const STATE_TTL_MS = 10 * 60 * 1000;
const LOGIN_CODE_TTL_MS = 2 * 60 * 1000;
const SUBMIT_GRACE_MS = 30 * 1000;
// Античит лекций
const HB_TOLERANCE_SEC = 2;      // допуск на сетевые задержки
const HB_RATE_FACTOR = 1.1;      // допустимое отношение прироста позиции к реальному времени
const HB_MAX_STEP_SEC = 40;      // максимум прироста за один heartbeat
const COMPLETE_END_SLACK_SEC = 3;  // max_pos >= duration - 3
const COMPLETE_WATCH_RATIO = 0.95; // засчитанное время >= 95% длительности

const ROLES = ['candidate', 'examiner', 'admin'];
const QTYPES = ['single', 'multi', 'text', 'long'];

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    let res;
    try {
      res = await route(request, env, ctx);
    } catch (e) {
      if (e instanceof HttpError) res = json({ error: e.message }, e.status);
      else { console.error(e && e.stack || e); res = json({ error: 'Внутренняя ошибка сервера' }, 500); }
    }
    const h = new Headers(res.headers);
    for (const [k, v] of Object.entries(cors)) h.set(k, v);
    h.set('X-Content-Type-Options', 'nosniff');
    return new Response(res.body, { status: res.status, headers: h });
  },
};

// ---------- helpers ----------
function json(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra } });
}
function allowedOrigins(env) {
  return String(env.ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
}
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const h = { 'Vary': 'Origin' };
  if (origin && allowedOrigins(env).includes(origin)) {
    h['Access-Control-Allow-Origin'] = origin;
    h['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS';
    h['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
    h['Access-Control-Max-Age'] = '600';
  }
  return h;
}
function adminIds(env) {
  return String(env.ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
}
function isSuper(env, id) { return adminIds(env).includes(String(id)); }
function oauthConfigured(env) { return !!(env.DISCORD_CLIENT_ID && env.DISCORD_CLIENT_SECRET); }
function redirectUri(env, request) {
  return env.DISCORD_REDIRECT_URI || (new URL(request.url).origin + '/auth/callback');
}
function randToken(bytes = 32) {
  const a = new Uint8Array(bytes); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(b => b.toString(16).padStart(2, '0')).join('');
}
function clientIp(request) { return request.headers.get('CF-Connecting-IP') || 'local'; }
async function readJson(request, maxBytes = 200000) {
  const t = await request.text();
  if (t.length > maxBytes) throw new HttpError(413, 'Слишком большой запрос');
  if (!t) return {};
  try { const v = JSON.parse(t); if (v && typeof v === 'object') return v; } catch (_) {}
  throw new HttpError(400, 'Некорректный JSON');
}
function str(v, max, { required = false, name = 'поле' } = {}) {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string' && typeof v !== 'number') throw new HttpError(400, `Некорректное значение: ${name}`);
  v = String(v).trim();
  if (required && !v) throw new HttpError(400, `Не заполнено: ${name}`);
  if (v.length > max) throw new HttpError(400, `Слишком длинное значение: ${name} (макс. ${max})`);
  return v;
}
function int(v, min, max, name, def) {
  if ((v === undefined || v === null || v === '') && def !== undefined) return def;
  const n = Number(v);
  if (!Number.isFinite(n) || Math.floor(n) !== n || n < min || n > max) throw new HttpError(400, `Некорректное число: ${name} (${min}…${max})`);
  return n;
}
function bool(v, def) { if (v === undefined || v === null) return def ? 1 : 0; return v === true || v === 1 || v === '1' || v === 'true' ? 1 : 0; }
function idParam(v) { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Некорректный id'); return n; }
// Распознаёт ссылку на YouTube и возвращает id ролика (11 символов) или null.
function youtubeId(u) {
  let url; try { url = new URL(u); } catch (_) { return null; }
  const host = url.hostname.toLowerCase().replace(/^(www\.|m\.|music\.)/, '');
  let id = null;
  if (host === 'youtu.be') id = url.pathname.split('/')[1];
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    if (url.pathname === '/watch') id = url.searchParams.get('v');
    else { const m = /^\/(?:embed|shorts|live|v)\/([^/?#]+)/.exec(url.pathname); if (m) id = m[1]; }
  } else return null;
  return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : 'bad';
}
function videoInfo(u) {
  if (!u) return { type: 'none' };
  const yt = /^https?:\/\//i.test(u) ? youtubeId(u) : null;
  if (yt && yt !== 'bad') return { type: 'youtube', youtube_id: yt };
  return { type: 'file' };
}
function validVideoUrl(u) {
  if (!u) return '';
  if (u.length > 1000) throw new HttpError(400, 'Слишком длинная ссылка на видео');
  if (/^https?:\/\//i.test(u)) {
    let url; try { url = new URL(u); } catch (_) { throw new HttpError(400, 'Некорректная ссылка на видео'); }
    const host = url.hostname.toLowerCase();
    const yt = youtubeId(u);
    if (yt === 'bad') throw new HttpError(400, 'Не удалось распознать ссылку YouTube. Подходят ссылки вида https://www.youtube.com/watch?v=XXXXXXXXXXX, https://youtu.be/XXXXXXXXXXX, /shorts/… или /embed/…');
    if (yt) return 'https://www.youtube.com/watch?v=' + yt;   // храним в едином виде
    if (/(^|\.)(drive|docs)\.google\.com$/.test(host)) throw new HttpError(400, 'Ссылки Google Диска не подходят: Google не отдаёт видео для встроенного плеера без перемотки. Загрузите видео на YouTube с доступом «По ссылке» и вставьте ссылку YouTube.');
    if (/(^|\.)(cdn\.discordapp\.com|media\.discordapp\.net|discordapp\.net)$/.test(host) || host === 'cdn.discordapp.com') throw new HttpError(400, 'Ссылки Discord CDN не подходят: они перестают работать через сутки. Используйте YouTube («По ссылке») или прямую ссылку на .mp4.');
    if (/(^|\.)(vk\.com|vkvideo\.ru|rutube\.ru|twitch\.tv|disk\.yandex\.ru|yadi\.sk)$/.test(host)) throw new HttpError(400, 'Этот видеохостинг не поддерживается. Используйте YouTube («По ссылке») или прямую ссылку на файл .mp4/.webm.');
    return url.toString();
  }
  if (/^[a-zA-Z0-9_\-./%]+$/.test(u) && !u.includes('..') && !u.startsWith('//') && !u.startsWith('/')) return u; // относительный путь на сайте
  throw new HttpError(400, 'Ссылка на видео должна начинаться с https:// (YouTube или прямой файл .mp4/.webm) или быть путём на сайте, например videos/lecture1.mp4');
}
// Длительность: число секунд или строка «сс», «мм:сс», «чч:мм:сс».
function parseDuration(v) {
  if (v === undefined || v === null || v === '') return 0;
  if (typeof v === 'number') return int(Math.round(v), 0, 6 * 3600, 'длительность');
  const t = String(v).trim();
  const m = /^(?:(\d{1,2}):)?(?:(\d{1,3}):)?(\d{1,5})$/.exec(t);
  if (!m) throw new HttpError(400, 'Длительность: укажите секунды или формат мм:сс / чч:мм:сс');
  const parts = t.split(':').map(Number);
  if (parts.slice(1).some(x => x >= 60)) throw new HttpError(400, 'Длительность: минуты и секунды должны быть меньше 60');
  const sec = parts.reduce((a, x) => a * 60 + x, 0);
  return int(sec, 0, 6 * 3600, 'длительность (макс. 6 часов)');
}
function parseJ(s, def) { try { return JSON.parse(s); } catch (_) { return def; } }
function shuffle(a) {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const x = new Uint32Array(1); crypto.getRandomValues(x);
    const j = x[0] % (i + 1); [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

async function rateLimit(env, key, limit, windowSec) {
  const now = Math.floor(Date.now() / 1000);
  const ws = now - (now % windowSec);
  const row = await env.DB.prepare(
    `INSERT INTO rate_limits (k, window_start, cnt) VALUES (?1, ?2, 1)
     ON CONFLICT(k) DO UPDATE SET cnt = CASE WHEN rate_limits.window_start = excluded.window_start THEN rate_limits.cnt + 1 ELSE 1 END,
       window_start = excluded.window_start
     RETURNING cnt`).bind(key, ws).first();
  if (row && row.cnt > limit) throw new HttpError(429, 'Слишком много запросов, попробуйте позже');
}

async function audit(env, actor, action, target, details) {
  await env.DB.prepare('INSERT INTO audit_log (actor_id, action, target, details, at) VALUES (?1, ?2, ?3, ?4, ?5)')
    .bind(String(actor.id), action, target == null ? null : String(target), details == null ? null : JSON.stringify(details).slice(0, 4000), Date.now()).run();
}

async function getSettings(env) {
  const { results } = await env.DB.prepare('SELECT k, v FROM settings').all();
  const s = { site_title: 'ГУ ВП — Учебный центр', welcome_text: '', sequential_lectures: '1' };
  for (const r of results) s[r.k] = r.v;
  return { site_title: s.site_title, welcome_text: s.welcome_text, sequential_lectures: s.sequential_lectures === '1' };
}

// ---------- auth ----------
async function authUser(request, env, { optional = false } = {}) {
  const h = request.headers.get('Authorization') || '';
  const m = /^Bearer\s+([A-Za-z0-9_\-]{20,200})$/.exec(h);
  if (!m) { if (optional) return null; throw new HttpError(401, 'Требуется вход'); }
  const th = await sha256(m[1]);
  const row = await env.DB.prepare(
    'SELECT u.*, s.expires_at AS s_exp FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?1').bind(th).first();
  if (!row || row.s_exp < Date.now()) { if (optional) return null; throw new HttpError(401, 'Сессия истекла, войдите заново'); }
  if (row.blocked) throw new HttpError(403, 'Доступ заблокирован администратором');
  const user = row; delete user.s_exp;
  user.super = isSuper(env, user.id);
  if (user.super) user.role = 'admin';
  user._token_hash = th;
  return user;
}
function requireRole(user, role) {
  const lvl = { candidate: 0, examiner: 1, admin: 2 };
  if ((lvl[user.role] ?? 0) < lvl[role]) throw new HttpError(403, 'Недостаточно прав');
}
function publicUser(u) {
  return {
    id: u.id, username: u.username, global_name: u.global_name, avatar: u.avatar,
    avatar_url: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null,
    ic_name: u.ic_name || '', static_id: u.static_id || '', rank: u.rank || '',
    role: u.role, super: !!u.super, blocked: !!u.blocked,
    created_at: u.created_at, last_login_at: u.last_login_at,
  };
}
async function createSession(env, request, userId) {
  const token = randToken(32);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at, ip, ua) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(await sha256(token), userId, now, now + SESSION_TTL_MS, clientIp(request), (request.headers.get('User-Agent') || '').slice(0, 200)).run();
  return token;
}
function safeReturn(env, ret) {
  const origins = allowedOrigins(env);
  const def = env.FRONTEND_URL || origins[0] || '';
  if (!ret) return def;
  try { const u = new URL(ret); if (origins.includes(u.origin)) return u.toString(); } catch (_) {}
  return def;
}
function withParam(url, k, v) {
  try { const u = new URL(url); u.searchParams.set(k, v); return u.toString(); } catch (_) { return url; }
}
function redirect(url) { return new Response(null, { status: 302, headers: { Location: url, 'Cache-Control': 'no-store' } }); }

async function authLogin(request, env, url) {
  await rateLimit(env, 'login:' + clientIp(request), 30, 600);
  const retParam = url.searchParams.get('return');
  const ret = safeReturn(env, retParam);
  if (!oauthConfigured(env)) {
    if (retParam && ret) return redirect(withParam(ret, 'auth_error', 'OAuth не настроен'));
    return json({ error: 'OAuth не настроен', detail: 'Администратору нужно задать DISCORD_CLIENT_ID и DISCORD_CLIENT_SECRET в настройках Worker (см. README).' }, 503);
  }
  const state = randToken(24);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('DELETE FROM oauth_states WHERE created_at < ?1').bind(now - STATE_TTL_MS),
    env.DB.prepare('INSERT INTO oauth_states (state, return_to, created_at) VALUES (?1, ?2, ?3)').bind(state, ret, now),
  ]);
  const q = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, response_type: 'code', redirect_uri: redirectUri(env, request), scope: 'identify', state, prompt: 'none' });
  return redirect('https://discord.com/oauth2/authorize?' + q.toString());
}

async function authCallback(request, env, url) {
  await rateLimit(env, 'login:' + clientIp(request), 30, 600);
  const state = url.searchParams.get('state') || '';
  const code = url.searchParams.get('code') || '';
  const now = Date.now();
  const st = state ? await env.DB.prepare('SELECT * FROM oauth_states WHERE state = ?1').bind(state).first() : null;
  if (st) await env.DB.prepare('DELETE FROM oauth_states WHERE state = ?1').bind(state).run();
  const ret = st ? st.return_to : safeReturn(env, null);
  const fail = (msg) => ret ? redirect(withParam(ret, 'auth_error', msg)) : json({ error: msg }, 400);
  if (!st || st.created_at < now - STATE_TTL_MS) return fail('Ссылка входа устарела, попробуйте ещё раз');
  if (url.searchParams.get('error')) return fail('Вход отменён');
  if (!code) return fail('Discord не вернул код авторизации');
  if (!oauthConfigured(env)) return fail('OAuth не настроен');
  const tr = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirectUri(env, request) }),
  });
  if (!tr.ok) return fail('Discord отклонил авторизацию (проверьте Client Secret и Redirect URI)');
  const tok = await tr.json();
  const ur = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${tok.access_token}` } });
  if (!ur.ok) return fail('Не удалось получить профиль Discord');
  const du = await ur.json();
  if (!du || !/^\d{5,25}$/.test(String(du.id))) return fail('Некорректный ответ Discord');
  await env.DB.prepare(
    `INSERT INTO users (id, username, global_name, avatar, role, created_at, last_login_at) VALUES (?1, ?2, ?3, ?4, 'candidate', ?5, ?5)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, global_name = excluded.global_name, avatar = excluded.avatar, last_login_at = excluded.last_login_at`)
    .bind(String(du.id), String(du.username || '').slice(0, 100), du.global_name ? String(du.global_name).slice(0, 100) : null, du.avatar ? String(du.avatar).slice(0, 100) : null, now).run();
  const u = await env.DB.prepare('SELECT blocked FROM users WHERE id = ?1').bind(String(du.id)).first();
  if (u && u.blocked) return fail('Доступ заблокирован администратором');
  const lc = randToken(24);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_codes WHERE created_at < ?1').bind(now - LOGIN_CODE_TTL_MS),
    env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?1').bind(now),
    env.DB.prepare('INSERT INTO login_codes (code_hash, user_id, created_at) VALUES (?1, ?2, ?3)').bind(await sha256(lc), String(du.id), now),
  ]);
  return redirect(withParam(ret, 'login_code', lc));
}

async function authExchange(request, env) {
  await rateLimit(env, 'exchange:' + clientIp(request), 30, 600);
  const b = await readJson(request);
  const code = str(b.code, 100, { required: true, name: 'code' });
  const ch = await sha256(code);
  const row = await env.DB.prepare('SELECT * FROM login_codes WHERE code_hash = ?1').bind(ch).first();
  if (!row) throw new HttpError(400, 'Код входа недействителен');
  await env.DB.prepare('DELETE FROM login_codes WHERE code_hash = ?1').bind(ch).run();
  if (row.created_at < Date.now() - LOGIN_CODE_TTL_MS) throw new HttpError(400, 'Код входа устарел');
  const token = await createSession(env, request, row.user_id);
  return json({ token, expires_in: SESSION_TTL_MS / 1000 });
}

// ---------- lectures ----------
async function lectureStates(env, userId) {
  const settings = await getSettings(env);
  const { results: lectures } = await env.DB.prepare('SELECT * FROM lectures WHERE published = 1 ORDER BY position, id').all();
  const { results: prog } = await env.DB.prepare('SELECT * FROM lecture_progress WHERE user_id = ?1').bind(userId).all();
  const pm = new Map(prog.map(p => [p.lecture_id, p]));
  let blocked = false;
  const out = [];
  for (const l of lectures) {
    const p = pm.get(l.id);
    let status = 'not_started';
    if (p && p.completed_at) status = 'watched';
    else if (p && (p.max_pos > 0 || p.watched_sec > 0)) status = 'in_progress';
    const locked = settings.sequential_lectures && blocked && status !== 'watched';
    if (locked) status = 'locked';
    out.push({ lecture: l, progress: p || null, status, locked });
    if (l.required && !(p && p.completed_at)) blocked = true;
  }
  const allRequiredDone = lectures.filter(l => l.required).every(l => { const p = pm.get(l.id); return p && p.completed_at; });
  return { items: out, allRequiredDone };
}
function lectureOut(it, withVideo) {
  const l = it.lecture, p = it.progress;
  const o = {
    id: l.id, title: l.title, description: l.description, duration_sec: l.duration_sec, required: !!l.required,
    position: l.position, status: it.status, locked: it.locked,
    progress: p ? { max_pos: p.max_pos, last_pos: p.last_pos, watched_sec: Math.round(p.watched_sec), completed_at: p.completed_at } : null,
  };
  if (withVideo) { o.video_url = l.video_url; Object.assign(o, videoInfo(l.video_url)); }
  return o;
}
async function listLectures(env, user) {
  const st = await lectureStates(env, user.id);
  return json({ lectures: st.items.map(i => lectureOut(i, false)), all_required_done: st.allRequiredDone });
}
async function getLecture(env, user, id) {
  const st = await lectureStates(env, user.id);
  const it = st.items.find(i => i.lecture.id === id);
  if (!it) throw new HttpError(404, 'Лекция не найдена');
  if (it.locked) throw new HttpError(403, 'Лекция пока недоступна: сначала просмотрите предыдущие');
  return json({ lecture: lectureOut(it, true) });
}
async function heartbeat(request, env, user, id) {
  await rateLimit(env, 'hb:' + user.id, 40, 60);
  const b = await readJson(request, 2000);
  const position = Number(b.position);
  if (!Number.isFinite(position) || position < 0) throw new HttpError(400, 'Некорректная позиция');
  const st = await lectureStates(env, user.id);
  const it = st.items.find(i => i.lecture.id === id);
  if (!it) throw new HttpError(404, 'Лекция не найдена');
  if (it.locked) throw new HttpError(403, 'Лекция недоступна');
  const dur = it.lecture.duration_sec;
  if (!dur || dur <= 0) throw new HttpError(409, 'Для лекции не задана длительность');
  const now = Date.now();
  const pos = Math.min(position, dur);
  let p = it.progress;
  if (!p) {
    await env.DB.prepare('INSERT OR IGNORE INTO lecture_progress (user_id, lecture_id, max_pos, last_pos, watched_sec, last_hb_at, started_at) VALUES (?1, ?2, 0, 0, 0, NULL, ?3)')
      .bind(user.id, id, now).run();
    p = { max_pos: 0, last_pos: 0, watched_sec: 0, last_hb_at: null, rejected: 0, completed_at: null };
  }
  const elapsed = p.last_hb_at ? Math.max(0, (now - p.last_hb_at) / 1000) : 0;
  const allowed = Math.min(elapsed * HB_RATE_FACTOR + HB_TOLERANCE_SEC, HB_MAX_STEP_SEC);
  const delta = pos - p.last_pos;
  let accepted = true, credit = 0, reason = null;
  if (delta <= allowed) { credit = Math.max(0, delta); }
  else if (pos <= p.max_pos + 1) { credit = 0; } // перемотка внутри уже просмотренного
  else { accepted = false; reason = 'Перемотка вперёд запрещена'; }
  let maxPos = p.max_pos, lastPos = p.last_pos, watched = p.watched_sec, completedAt = p.completed_at;
  if (accepted) {
    lastPos = pos; maxPos = Math.max(maxPos, pos); watched = Math.min(watched + credit, dur * 3);
    if (!completedAt && maxPos >= dur - COMPLETE_END_SLACK_SEC && watched >= dur * COMPLETE_WATCH_RATIO) completedAt = now;
  }
  await env.DB.prepare('UPDATE lecture_progress SET max_pos = ?1, last_pos = ?2, watched_sec = ?3, last_hb_at = ?4, completed_at = ?5, rejected = rejected + ?6 WHERE user_id = ?7 AND lecture_id = ?8')
    .bind(maxPos, lastPos, watched, now, completedAt, accepted ? 0 : 1, user.id, id).run();
  return json({ accepted, reason, max_pos: maxPos, last_pos: lastPos, watched_sec: Math.round(watched), completed: !!completedAt, duration_sec: dur });
}

// ---------- exams ----------
async function examAvailability(env, user, exam, lecturesDone) {
  const { results: atts } = await env.DB.prepare('SELECT id, status, started_at, submitted_at, score_pct FROM attempts WHERE user_id = ?1 AND exam_id = ?2 ORDER BY id DESC').bind(user.id, exam.id).all();
  const now = Date.now();
  let can = true, reason = null, nextAt = null;
  const active = atts.find(a => a.status === 'in_progress');
  if (exam.requires_lectures && !lecturesDone) { can = false; reason = 'Сначала просмотрите все обязательные лекции'; }
  else if (active) { can = true; reason = null; }
  else if (atts.some(a => a.status === 'passed')) { can = false; reason = 'Экзамен уже сдан'; }
  else if (atts.some(a => a.status === 'pending_review')) { can = false; reason = 'Предыдущая попытка ожидает проверки'; }
  else if (exam.max_attempts && atts.length >= exam.max_attempts) { can = false; reason = 'Попытки закончились'; }
  else if (exam.cooldown_min && atts.length) {
    const last = atts[0].submitted_at || atts[0].started_at;
    const t = last + exam.cooldown_min * 60000;
    if (t > now) { can = false; reason = 'Следующая попытка будет доступна позже'; nextAt = t; }
  }
  return { can_start: can, reason, next_at: nextAt, active_attempt_id: active ? active.id : null,
    attempts: atts.map(a => ({ id: a.id, status: a.status, started_at: a.started_at, submitted_at: a.submitted_at, score_pct: a.status === 'pending_review' ? null : a.score_pct })) };
}
function examPublic(e) {
  return { id: e.id, title: e.title, description: e.description, time_limit_min: e.time_limit_min, max_attempts: e.max_attempts,
    cooldown_min: e.cooldown_min, pass_pct: e.pass_pct, requires_lectures: !!e.requires_lectures };
}
async function listExams(env, user) {
  const st = await lectureStates(env, user.id);
  const { results } = await env.DB.prepare('SELECT * FROM exams WHERE published = 1 ORDER BY position, id').all();
  const out = [];
  for (const e of results) {
    const qc = await env.DB.prepare('SELECT COUNT(*) AS c FROM questions WHERE exam_id = ?1').bind(e.id).first();
    out.push({ ...examPublic(e), question_count: qc.c, ...(await examAvailability(env, user, e, st.allRequiredDone)) });
  }
  return json({ exams: out, all_required_done: st.allRequiredDone });
}
async function getExam(env, user, id) {
  const e = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1 AND published = 1').bind(id).first();
  if (!e) throw new HttpError(404, 'Экзамен не найден');
  const st = await lectureStates(env, user.id);
  const qc = await env.DB.prepare('SELECT COUNT(*) AS c FROM questions WHERE exam_id = ?1').bind(id).first();
  return json({ exam: { ...examPublic(e), question_count: qc.c, ...(await examAvailability(env, user, e, st.allRequiredDone)) } });
}
async function startExam(env, user, id) {
  await rateLimit(env, 'start:' + user.id, 10, 60);
  const e = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1 AND published = 1').bind(id).first();
  if (!e) throw new HttpError(404, 'Экзамен не найден');
  const st = await lectureStates(env, user.id);
  const av = await examAvailability(env, user, e, st.allRequiredDone);
  if (av.active_attempt_id) {
    const a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(av.active_attempt_id).first();
    if (!(await finalizeIfExpired(env, a))) return json({ attempt_id: a.id });
    throw new HttpError(409, 'Время предыдущей попытки истекло — она завершена автоматически. Обновите страницу.');
  }
  if (!av.can_start) throw new HttpError(403, av.reason || 'Экзамен недоступен');
  const { results: qs } = await env.DB.prepare('SELECT * FROM questions WHERE exam_id = ?1 ORDER BY position, id').bind(id).all();
  if (!qs.length) throw new HttpError(409, 'В экзамене пока нет вопросов');
  const order = e.shuffle_questions ? shuffle(qs.map(q => q.id)) : qs.map(q => q.id);
  const optOrder = {};
  for (const q of qs) {
    if (q.type === 'single' || q.type === 'multi') {
      const ids = parseJ(q.options, []).map(o => o.id);
      optOrder[q.id] = e.shuffle_options ? shuffle(ids) : ids;
    }
  }
  const max = qs.reduce((s, q) => s + q.points, 0);
  const now = Date.now();
  const deadline = e.time_limit_min ? now + e.time_limit_min * 60000 : null;
  const r = await env.DB.prepare(`INSERT INTO attempts (exam_id, user_id, status, started_at, deadline_at, q_order, opt_order, max_score) VALUES (?1, ?2, 'in_progress', ?3, ?4, ?5, ?6, ?7) RETURNING id`)
    .bind(id, user.id, now, deadline, JSON.stringify(order), JSON.stringify(optOrder), max).first();
  return json({ attempt_id: r.id });
}

function validateAnswer(q, v) {
  if (v === null || v === undefined) return null;
  const opts = parseJ(q.options, []).map(o => o.id);
  if (q.type === 'single') { if (typeof v !== 'string' || !opts.includes(v)) throw new HttpError(400, 'Некорректный ответ'); return v; }
  if (q.type === 'multi') {
    if (!Array.isArray(v) || v.length > opts.length || v.some(x => typeof x !== 'string' || !opts.includes(x))) throw new HttpError(400, 'Некорректный ответ');
    return [...new Set(v)];
  }
  if (typeof v !== 'string') throw new HttpError(400, 'Некорректный ответ');
  const max = q.type === 'text' ? 1000 : 8000;
  if (v.length > max) throw new HttpError(400, `Ответ слишком длинный (макс. ${max} символов)`);
  return v;
}
async function saveAnswers(env, attempt, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new HttpError(400, 'Некорректные ответы');
  const order = parseJ(attempt.q_order, []);
  const { results: qs } = await env.DB.prepare('SELECT * FROM questions WHERE exam_id = ?1').bind(attempt.exam_id).all();
  const qm = new Map(qs.map(q => [q.id, q]));
  const stmts = [];
  for (const [k, v] of Object.entries(answers)) {
    const qid = Number(k);
    if (!order.includes(qid) || !qm.has(qid)) continue;
    const val = validateAnswer(qm.get(qid), v);
    stmts.push(env.DB.prepare('INSERT INTO answers (attempt_id, question_id, answer) VALUES (?1, ?2, ?3) ON CONFLICT(attempt_id, question_id) DO UPDATE SET answer = excluded.answer')
      .bind(attempt.id, qid, JSON.stringify(val)));
  }
  if (stmts.length) await env.DB.batch(stmts);
}
async function finalizeAttempt(env, attempt, expired) {
  const exam = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1').bind(attempt.exam_id).first();
  const order = parseJ(attempt.q_order, []);
  const { results: qs } = await env.DB.prepare('SELECT * FROM questions WHERE exam_id = ?1').bind(attempt.exam_id).all();
  const qm = new Map(qs.map(q => [q.id, q]));
  const { results: ans } = await env.DB.prepare('SELECT * FROM answers WHERE attempt_id = ?1').bind(attempt.id).all();
  const am = new Map(ans.map(a => [a.question_id, parseJ(a.answer, null)]));
  let auto = 0, max = 0, needReview = false;
  const stmts = [];
  for (const qid of order) {
    const q = qm.get(qid); if (!q) continue;
    max += q.points;
    const v = am.has(qid) ? am.get(qid) : null;
    let ap = null, nr = 0;
    if (q.type === 'single') { const c = parseJ(q.correct, []); ap = (v !== null && c.length === 1 && v === c[0]) ? q.points : 0; }
    else if (q.type === 'multi') { const c = new Set(parseJ(q.correct, [])); const s = new Set(Array.isArray(v) ? v : []); ap = (c.size === s.size && [...c].every(x => s.has(x))) ? q.points : 0; }
    else if (typeof v === 'string' && v.trim()) { nr = 1; needReview = true; }
    else { ap = 0; }
    if (ap) auto += ap;
    stmts.push(env.DB.prepare('INSERT INTO answers (attempt_id, question_id, answer, auto_points, needs_review) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(attempt_id, question_id) DO UPDATE SET auto_points = excluded.auto_points, needs_review = excluded.needs_review')
      .bind(attempt.id, qid, JSON.stringify(v), ap, nr));
  }
  const pct = max ? Math.round(auto / max * 1000) / 10 : 0;
  const status = needReview ? 'pending_review' : (pct >= exam.pass_pct ? 'passed' : 'failed');
  stmts.push(env.DB.prepare(`UPDATE attempts SET status = ?1, submitted_at = ?2, expired = ?3, auto_score = ?4, max_score = ?5, score_pct = ?6 WHERE id = ?7 AND status = 'in_progress'`)
    .bind(status, Date.now(), expired ? 1 : 0, auto, max, pct, attempt.id));
  await env.DB.batch(stmts);
  return status;
}
async function finalizeIfExpired(env, a) {
  if (a.status === 'in_progress' && a.deadline_at && Date.now() > a.deadline_at + SUBMIT_GRACE_MS) {
    await finalizeAttempt(env, a, true); return true;
  }
  return false;
}
async function loadOwnAttempt(env, user, id) {
  let a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(id).first();
  if (!a || a.user_id !== user.id) throw new HttpError(404, 'Попытка не найдена');
  if (await finalizeIfExpired(env, a)) a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(id).first();
  return a;
}
async function getAttempt(env, user, id) {
  const a = await loadOwnAttempt(env, user, id);
  const exam = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1').bind(a.exam_id).first();
  const base = { id: a.id, exam: exam ? examPublic(exam) : null, status: a.status, started_at: a.started_at, deadline_at: a.deadline_at,
    submitted_at: a.submitted_at, expired: !!a.expired, server_now: Date.now() };
  if (a.status === 'in_progress') {
    const order = parseJ(a.q_order, []), optOrder = parseJ(a.opt_order, {});
    const { results: qs } = await env.DB.prepare('SELECT id, type, text, options, points FROM questions WHERE exam_id = ?1').bind(a.exam_id).all();
    const qm = new Map(qs.map(q => [q.id, q]));
    const { results: ans } = await env.DB.prepare('SELECT question_id, answer FROM answers WHERE attempt_id = ?1').bind(a.id).all();
    const saved = {}; for (const r of ans) saved[r.question_id] = parseJ(r.answer, null);
    base.questions = order.filter(id => qm.has(id)).map(id => {
      const q = qm.get(id);
      const o = { id: q.id, type: q.type, text: q.text, points: q.points };
      if (q.type === 'single' || q.type === 'multi') {
        const om = new Map(parseJ(q.options, []).map(x => [x.id, x]));
        const ord = (optOrder[q.id] || []).filter(x => om.has(x));
        for (const x of om.keys()) if (!ord.includes(x)) ord.push(x);
        o.options = ord.map(x => ({ id: x, text: om.get(x).text }));
      }
      return o;
    });
    base.saved_answers = saved;
  } else {
    base.score_pct = a.status === 'pending_review' ? null : a.score_pct;
    base.reviewer_comment = a.reviewer_comment || null;
    base.reviewed_at = a.reviewed_at;
  }
  return json({ attempt: base });
}
async function putAnswers(request, env, user, id) {
  await rateLimit(env, 'ans:' + user.id, 60, 60);
  const a = await loadOwnAttempt(env, user, id);
  if (a.status !== 'in_progress') throw new HttpError(409, 'Попытка уже завершена');
  const b = await readJson(request);
  await saveAnswers(env, a, b.answers);
  return json({ ok: true });
}
async function submitAttempt(request, env, user, id) {
  const a = await loadOwnAttempt(env, user, id);
  if (a.status !== 'in_progress') return json({ ok: true, status: a.status, note: a.expired ? 'Время вышло, попытка завершена автоматически' : 'Попытка уже завершена' });
  const b = await readJson(request);
  if (b.answers) await saveAnswers(env, a, b.answers);
  const status = await finalizeAttempt(env, a, false);
  return json({ ok: true, status });
}
async function myAttempts(env, user) {
  const { results } = await env.DB.prepare('SELECT a.id, a.exam_id, e.title, a.status, a.started_at, a.submitted_at, a.score_pct, a.reviewer_comment FROM attempts a LEFT JOIN exams e ON e.id = a.exam_id WHERE a.user_id = ?1 ORDER BY a.id DESC').bind(user.id).all();
  return json({ attempts: results.map(r => ({ ...r, score_pct: r.status === 'pending_review' ? null : r.score_pct })) });
}

// ---------- admin ----------
function lectureInput(b, partial) {
  const o = {};
  if (!partial || b.title !== undefined) o.title = str(b.title, 200, { required: true, name: 'название' });
  if (!partial || b.description !== undefined) o.description = str(b.description, 10000, { name: 'описание' });
  if (!partial || b.video_url !== undefined) o.video_url = validVideoUrl(str(b.video_url, 1000, { name: 'ссылка на видео' }));
  if (!partial || b.duration_sec !== undefined) o.duration_sec = parseDuration(b.duration_sec);
  if (!partial || b.position !== undefined) o.position = int(b.position, 0, 100000, 'порядок', 0);
  if (!partial || b.required !== undefined) o.required = bool(b.required, true);
  if (!partial || b.published !== undefined) o.published = bool(b.published, false);
  if (o.published && ('video_url' in o || 'duration_sec' in o)) {
    // проверка ниже, при публикации
  }
  return o;
}
async function adminLectures(env) {
  const { results } = await env.DB.prepare(`SELECT l.*, (SELECT COUNT(*) FROM lecture_progress p WHERE p.lecture_id = l.id AND p.completed_at IS NOT NULL) AS watched_count FROM lectures l ORDER BY position, id`).all();
  return json({ lectures: results.map(l => ({ ...l, ...videoInfo(l.video_url) })) });
}
async function saveLecture(request, env, user, id) {
  const b = await readJson(request);
  const o = lectureInput(b, !!id);
  const now = Date.now();
  if (id) {
    const cur = await env.DB.prepare('SELECT * FROM lectures WHERE id = ?1').bind(id).first();
    if (!cur) throw new HttpError(404, 'Лекция не найдена');
    const m = { ...cur, ...o };
    if (m.published && (!m.video_url || !m.duration_sec)) throw new HttpError(400, 'Чтобы опубликовать лекцию, укажите ссылку на видео и длительность (больше 0). Черновик можно сохранить и без них.');
    const keys = Object.keys(o);
    if (keys.length) {
      await env.DB.prepare(`UPDATE lectures SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${keys.length + 1} WHERE id = ?${keys.length + 2}`)
        .bind(...keys.map(k => o[k]), now, id).run();
    }
    await audit(env, user, 'lecture.update', id, o);
    const lr = await env.DB.prepare('SELECT * FROM lectures WHERE id = ?1').bind(id).first();
    return json({ lecture: { ...lr, ...videoInfo(lr.video_url) } });
  }
  if (o.published && (!o.video_url || !o.duration_sec)) throw new HttpError(400, 'Чтобы опубликовать лекцию, укажите ссылку на видео и длительность (больше 0). Черновик можно сохранить и без них.');
  if (b.position === undefined) { const mx = await env.DB.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM lectures').first(); o.position = mx.m + 10; }
  const r = await env.DB.prepare('INSERT INTO lectures (title, description, video_url, duration_sec, position, required, published, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?8) RETURNING *')
    .bind(o.title, o.description, o.video_url, o.duration_sec, o.position, o.required, o.published, now).first();
  await audit(env, user, 'lecture.create', r.id, { title: o.title });
  return json({ lecture: { ...r, ...videoInfo(r.video_url) } });
}
async function deleteLecture(env, user, id) {
  const cur = await env.DB.prepare('SELECT id, title FROM lectures WHERE id = ?1').bind(id).first();
  if (!cur) throw new HttpError(404, 'Лекция не найдена');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM lecture_progress WHERE lecture_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM lectures WHERE id = ?1').bind(id),
  ]);
  await audit(env, user, 'lecture.delete', id, { title: cur.title });
  return json({ ok: true });
}
async function reorder(request, env, user, table, extraWhere) {
  const b = await readJson(request);
  if (!Array.isArray(b.ids) || b.ids.length > 1000) throw new HttpError(400, 'Нужен массив ids');
  const ids = b.ids.map(idParam);
  const stmts = ids.map((id, i) => env.DB.prepare(`UPDATE ${table} SET position = ?1 WHERE id = ?2${extraWhere ? ' AND ' + extraWhere.sql : ''}`).bind((i + 1) * 10, id, ...(extraWhere ? [extraWhere.val] : [])));
  if (stmts.length) await env.DB.batch(stmts);
  await audit(env, user, table + '.reorder', extraWhere ? extraWhere.val : null, { ids });
  return json({ ok: true });
}

function examInput(b, partial) {
  const o = {};
  const f = (k, fn) => { if (!partial || b[k] !== undefined) o[k] = fn(b[k]); };
  f('title', v => str(v, 200, { required: true, name: 'название' }));
  f('description', v => str(v, 10000, { name: 'описание' }));
  f('time_limit_min', v => int(v, 0, 24 * 60, 'лимит времени', 0));
  f('max_attempts', v => int(v, 0, 1000, 'лимит попыток', 0));
  f('cooldown_min', v => int(v, 0, 60 * 24 * 60, 'пауза между попытками', 0));
  f('pass_pct', v => int(v, 0, 100, 'проходной балл', 70));
  f('shuffle_questions', v => bool(v, false));
  f('shuffle_options', v => bool(v, false));
  f('requires_lectures', v => bool(v, true));
  f('position', v => int(v, 0, 100000, 'порядок', 0));
  f('published', v => bool(v, false));
  return o;
}
async function adminExams(env) {
  const { results } = await env.DB.prepare(`SELECT e.*, (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS question_count,
    (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = e.id) AS attempt_count,
    (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = e.id AND a.status = 'pending_review') AS pending_count FROM exams e ORDER BY position, id`).all();
  return json({ exams: results });
}
async function adminExam(env, id) {
  const e = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1').bind(id).first();
  if (!e) throw new HttpError(404, 'Экзамен не найден');
  const { results } = await env.DB.prepare('SELECT * FROM questions WHERE exam_id = ?1 ORDER BY position, id').bind(id).all();
  return json({ exam: e, questions: results.map(qOut) });
}
function qOut(q) { return { ...q, options: parseJ(q.options, []), correct: parseJ(q.correct, []) }; }
async function saveExam(request, env, user, id) {
  const b = await readJson(request);
  const o = examInput(b, !!id);
  const now = Date.now();
  if (id) {
    const cur = await env.DB.prepare('SELECT id FROM exams WHERE id = ?1').bind(id).first();
    if (!cur) throw new HttpError(404, 'Экзамен не найден');
    const keys = Object.keys(o);
    if (keys.length) await env.DB.prepare(`UPDATE exams SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${keys.length + 1} WHERE id = ?${keys.length + 2}`).bind(...keys.map(k => o[k]), now, id).run();
    await audit(env, user, 'exam.update', id, o);
    return adminExam(env, id);
  }
  const keys = Object.keys(o);
  const r = await env.DB.prepare(`INSERT INTO exams (${keys.join(', ')}, created_at, updated_at) VALUES (${keys.map((_, i) => '?' + (i + 1)).join(', ')}, ?${keys.length + 1}, ?${keys.length + 1}) RETURNING id`)
    .bind(...keys.map(k => o[k]), now).first();
  await audit(env, user, 'exam.create', r.id, { title: o.title });
  return adminExam(env, r.id);
}
async function deleteExam(env, user, id) {
  const cur = await env.DB.prepare('SELECT id, title FROM exams WHERE id = ?1').bind(id).first();
  if (!cur) throw new HttpError(404, 'Экзамен не найден');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM answers WHERE attempt_id IN (SELECT id FROM attempts WHERE exam_id = ?1)').bind(id),
    env.DB.prepare('DELETE FROM attempts WHERE exam_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM questions WHERE exam_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM exams WHERE id = ?1').bind(id),
  ]);
  await audit(env, user, 'exam.delete', id, { title: cur.title });
  return json({ ok: true });
}
function questionInput(b) {
  const type = str(b.type, 10, { required: true, name: 'тип' });
  if (!QTYPES.includes(type)) throw new HttpError(400, 'Тип вопроса: single, multi, text или long');
  const o = { type, text: str(b.text, 5000, { required: true, name: 'текст вопроса' }), points: int(b.points, 0, 1000, 'баллы', 1),
    reference: str(b.reference, 5000, { name: 'эталонный ответ' }), options: [], correct: [] };
  if (b.position !== undefined) o.position = int(b.position, 0, 100000, 'порядок', 0);
  if (type === 'single' || type === 'multi') {
    if (!Array.isArray(b.options) || b.options.length < 2 || b.options.length > 20) throw new HttpError(400, 'Нужно от 2 до 20 вариантов ответа');
    const seen = new Set();
    o.options = b.options.map((x, i) => {
      let oid = x && typeof x.id === 'string' && /^[a-z0-9]{1,16}$/i.test(x.id) ? x.id : null;
      if (!oid || seen.has(oid)) { do { oid = randToken(6).replace(/[^a-z0-9]/gi, '').slice(0, 8) || ('o' + i); } while (seen.has(oid)); }
      seen.add(oid);
      return { id: oid, text: str(x && x.text, 1000, { required: true, name: `вариант ${i + 1}` }), _c: !!(x && x.correct) };
    });
    o.correct = o.options.filter(x => x._c).map(x => x.id);
    o.options = o.options.map(({ id, text }) => ({ id, text }));
    if (type === 'single' && o.correct.length !== 1) throw new HttpError(400, 'В вопросе с одним ответом должен быть ровно один правильный вариант');
    if (type === 'multi' && o.correct.length < 1) throw new HttpError(400, 'Отметьте хотя бы один правильный вариант');
  }
  return o;
}
async function saveQuestion(request, env, user, examId, qid) {
  const b = await readJson(request);
  const o = questionInput(b);
  if (qid) {
    const cur = await env.DB.prepare('SELECT * FROM questions WHERE id = ?1').bind(qid).first();
    if (!cur) throw new HttpError(404, 'Вопрос не найден');
    await env.DB.prepare('UPDATE questions SET type = ?1, text = ?2, options = ?3, correct = ?4, reference = ?5, points = ?6, position = COALESCE(?7, position) WHERE id = ?8')
      .bind(o.type, o.text, JSON.stringify(o.options), JSON.stringify(o.correct), o.reference, o.points, o.position ?? null, qid).run();
    await audit(env, user, 'question.update', qid, { exam_id: cur.exam_id });
    return json({ question: qOut(await env.DB.prepare('SELECT * FROM questions WHERE id = ?1').bind(qid).first()) });
  }
  const e = await env.DB.prepare('SELECT id FROM exams WHERE id = ?1').bind(examId).first();
  if (!e) throw new HttpError(404, 'Экзамен не найден');
  if (o.position === undefined) { const mx = await env.DB.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM questions WHERE exam_id = ?1').bind(examId).first(); o.position = mx.m + 10; }
  const r = await env.DB.prepare('INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING *')
    .bind(examId, o.type, o.text, JSON.stringify(o.options), JSON.stringify(o.correct), o.reference, o.points, o.position).first();
  await audit(env, user, 'question.create', r.id, { exam_id: examId });
  return json({ question: qOut(r) });
}
async function deleteQuestion(env, user, qid) {
  const cur = await env.DB.prepare('SELECT id, exam_id FROM questions WHERE id = ?1').bind(qid).first();
  if (!cur) throw new HttpError(404, 'Вопрос не найден');
  await env.DB.prepare('DELETE FROM questions WHERE id = ?1').bind(qid).run();
  await audit(env, user, 'question.delete', qid, { exam_id: cur.exam_id });
  return json({ ok: true });
}

async function adminUsers(env, url) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100);
  const like = '%' + q.replace(/[%_\\]/g, m => '\\' + m) + '%';
  const { results } = await env.DB.prepare(`SELECT u.*,
      (SELECT COUNT(*) FROM lecture_progress p JOIN lectures l ON l.id = p.lecture_id WHERE p.user_id = u.id AND p.completed_at IS NOT NULL AND l.published = 1) AS lectures_watched,
      (SELECT COUNT(*) FROM attempts a WHERE a.user_id = u.id) AS attempt_count,
      (SELECT a.status FROM attempts a WHERE a.user_id = u.id ORDER BY a.id DESC LIMIT 1) AS last_status
    FROM users u WHERE (?1 = '' OR u.id LIKE ?2 ESCAPE '\\' OR u.username LIKE ?2 ESCAPE '\\' OR u.global_name LIKE ?2 ESCAPE '\\' OR u.ic_name LIKE ?2 ESCAPE '\\' OR u.static_id LIKE ?2 ESCAPE '\\')
    ORDER BY COALESCE(u.last_login_at, u.created_at) DESC LIMIT 500`).bind(q, like).all();
  const total = await env.DB.prepare('SELECT COUNT(*) AS c FROM lectures WHERE published = 1').first();
  return json({ users: results.map(u => ({ ...publicUser({ ...u, super: isSuper(env, u.id), role: isSuper(env, u.id) ? 'admin' : u.role }), lectures_watched: u.lectures_watched, attempt_count: u.attempt_count, last_status: u.last_status })), lectures_total: total.c });
}
async function adminUser(env, id) {
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first();
  if (!u) throw new HttpError(404, 'Пользователь не найден');
  const { results: lec } = await env.DB.prepare(`SELECT l.id, l.title, l.duration_sec, l.published, l.required, p.max_pos, p.last_pos, p.watched_sec, p.rejected, p.started_at, p.completed_at
    FROM lectures l LEFT JOIN lecture_progress p ON p.lecture_id = l.id AND p.user_id = ?1 ORDER BY l.position, l.id`).bind(id).all();
  const { results: atts } = await env.DB.prepare('SELECT a.*, e.title AS exam_title FROM attempts a LEFT JOIN exams e ON e.id = a.exam_id WHERE a.user_id = ?1 ORDER BY a.id DESC').bind(id).all();
  return json({ user: publicUser({ ...u, super: isSuper(env, u.id), role: isSuper(env, u.id) ? 'admin' : u.role }), lectures: lec,
    attempts: atts.map(a => ({ id: a.id, exam_id: a.exam_id, exam_title: a.exam_title, status: a.status, started_at: a.started_at, submitted_at: a.submitted_at, score_pct: a.score_pct, expired: !!a.expired })) });
}
async function updateUser(request, env, actor, id) {
  const b = await readJson(request);
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first();
  if (!u) throw new HttpError(404, 'Пользователь не найден');
  const ch = {};
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) throw new HttpError(400, 'Роль: candidate, examiner или admin');
    if (isSuper(env, id)) throw new HttpError(400, 'Роль главного администратора задаётся в настройках Worker (ADMIN_IDS)');
    if ((b.role === 'admin' || u.role === 'admin') && !actor.super) throw new HttpError(403, 'Назначать и снимать администраторов может только главный администратор');
    ch.role = b.role;
  }
  if (b.blocked !== undefined) {
    if (isSuper(env, id) || id === actor.id) throw new HttpError(400, 'Нельзя заблокировать этого пользователя');
    if (u.role === 'admin' && !actor.super) throw new HttpError(403, 'Недостаточно прав');
    ch.blocked = bool(b.blocked, false);
  }
  for (const k of ['ic_name', 'static_id', 'rank']) if (b[k] !== undefined) ch[k] = str(b[k], 100, { name: k });
  const keys = Object.keys(ch);
  if (!keys.length) throw new HttpError(400, 'Нечего изменять');
  const stmts = [env.DB.prepare(`UPDATE users SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')} WHERE id = ?${keys.length + 1}`).bind(...keys.map(k => ch[k]), id)];
  if (ch.blocked) stmts.push(env.DB.prepare('DELETE FROM sessions WHERE user_id = ?1').bind(id));
  await env.DB.batch(stmts);
  await audit(env, actor, 'user.update', id, ch);
  return adminUser(env, id);
}
async function resetProgress(request, env, actor, id) {
  const b = await readJson(request);
  const lid = b.lecture_id ? idParam(b.lecture_id) : null;
  if (lid) await env.DB.prepare('DELETE FROM lecture_progress WHERE user_id = ?1 AND lecture_id = ?2').bind(id, lid).run();
  else await env.DB.prepare('DELETE FROM lecture_progress WHERE user_id = ?1').bind(id).run();
  await audit(env, actor, 'user.reset_progress', id, { lecture_id: lid });
  return adminUser(env, id);
}
async function resetAttempts(request, env, actor, id) {
  const b = await readJson(request);
  const eid = b.exam_id ? idParam(b.exam_id) : null;
  const w = eid ? ' AND exam_id = ?2' : '';
  const binds = eid ? [id, eid] : [id];
  await env.DB.batch([
    env.DB.prepare(`DELETE FROM answers WHERE attempt_id IN (SELECT id FROM attempts WHERE user_id = ?1${w})`).bind(...binds),
    env.DB.prepare(`DELETE FROM attempts WHERE user_id = ?1${w}`).bind(...binds),
  ]);
  await audit(env, actor, 'user.reset_attempts', id, { exam_id: eid });
  return adminUser(env, id);
}
async function adminAttempts(env, url) {
  const status = url.searchParams.get('status') || '';
  if (status && !['in_progress', 'pending_review', 'passed', 'failed'].includes(status)) throw new HttpError(400, 'Некорректный статус');
  const { results } = await env.DB.prepare(`SELECT a.id, a.exam_id, e.title AS exam_title, a.user_id, u.username, u.global_name, u.ic_name, u.static_id, a.status, a.started_at, a.submitted_at, a.score_pct, a.expired, a.reviewer_id, a.reviewed_at
    FROM attempts a LEFT JOIN exams e ON e.id = a.exam_id LEFT JOIN users u ON u.id = a.user_id WHERE (?1 = '' OR a.status = ?1) ORDER BY a.id DESC LIMIT 500`).bind(status).all();
  return json({ attempts: results });
}
async function adminAttempt(env, id) {
  let a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(id).first();
  if (!a) throw new HttpError(404, 'Попытка не найдена');
  if (await finalizeIfExpired(env, a)) a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(id).first();
  const exam = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1').bind(a.exam_id).first();
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(a.user_id).first();
  const rv = a.reviewer_id ? await env.DB.prepare('SELECT id, username, global_name FROM users WHERE id = ?1').bind(a.reviewer_id).first() : null;
  const { results: qs } = await env.DB.prepare('SELECT * FROM questions WHERE exam_id = ?1').bind(a.exam_id).all();
  const qm = new Map(qs.map(q => [q.id, q]));
  const { results: ans } = await env.DB.prepare('SELECT * FROM answers WHERE attempt_id = ?1').bind(id).all();
  const am = new Map(ans.map(x => [x.question_id, x]));
  const items = parseJ(a.q_order, []).map(qid => {
    const q = qm.get(qid); const x = am.get(qid);
    return { question: q ? qOut(q) : { id: qid, text: '(вопрос удалён)', type: 'text', points: 0, options: [], correct: [] },
      answer: x ? parseJ(x.answer, null) : null, auto_points: x ? x.auto_points : null, manual_points: x ? x.manual_points : null, needs_review: !!(x && x.needs_review) };
  });
  return json({ attempt: { ...a, q_order: undefined, opt_order: undefined }, exam, user: u ? publicUser({ ...u, super: isSuper(env, u.id) }) : null, reviewer: rv, items });
}
async function reviewAttempt(request, env, actor, id) {
  const b = await readJson(request);
  const a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(id).first();
  if (!a) throw new HttpError(404, 'Попытка не найдена');
  if (a.status === 'in_progress') throw new HttpError(409, 'Попытка ещё не завершена кандидатом');
  const exam = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1').bind(a.exam_id).first();
  const { results: qs } = await env.DB.prepare('SELECT * FROM questions WHERE exam_id = ?1').bind(a.exam_id).all();
  const qm = new Map(qs.map(q => [q.id, q]));
  const { results: ans } = await env.DB.prepare('SELECT * FROM answers WHERE attempt_id = ?1').bind(id).all();
  const points = b.points && typeof b.points === 'object' ? b.points : {};
  const stmts = [];
  let manual = 0, auto = 0, missing = 0;
  for (const x of ans) {
    const q = qm.get(x.question_id);
    const maxp = q ? q.points : 0;
    let mp = x.manual_points;
    if (points[x.question_id] !== undefined && points[x.question_id] !== null && points[x.question_id] !== '') {
      const n = Number(points[x.question_id]);
      if (!Number.isFinite(n) || n < 0 || n > maxp) throw new HttpError(400, `Баллы за вопрос ${x.question_id}: от 0 до ${maxp}`);
      mp = n;
      stmts.push(env.DB.prepare('UPDATE answers SET manual_points = ?1 WHERE attempt_id = ?2 AND question_id = ?3').bind(n, id, x.question_id));
    }
    if (mp !== null && mp !== undefined) manual += mp; else if (x.auto_points !== null) auto += x.auto_points; else if (x.needs_review) missing++;
  }
  const verdict = b.verdict || 'auto';
  if (!['auto', 'passed', 'failed'].includes(verdict)) throw new HttpError(400, 'Решение: auto, passed или failed');
  if (verdict === 'auto' && missing) throw new HttpError(400, 'Оцените все текстовые ответы или выберите итог вручную');
  const comment = str(b.comment, 5000, { name: 'комментарий' });
  const total = auto + manual;
  const pct = a.max_score ? Math.round(total / a.max_score * 1000) / 10 : 0;
  const status = verdict === 'auto' ? (pct >= exam.pass_pct ? 'passed' : 'failed') : verdict;
  stmts.push(env.DB.prepare('UPDATE attempts SET status = ?1, manual_score = ?2, score_pct = ?3, reviewer_id = ?4, reviewer_comment = ?5, reviewed_at = ?6 WHERE id = ?7')
    .bind(status, manual, pct, actor.id, comment || null, Date.now(), id));
  await env.DB.batch(stmts);
  await audit(env, actor, 'attempt.review', id, { status, pct, user_id: a.user_id });
  return adminAttempt(env, id);
}
async function deleteAttempt(env, actor, id) {
  const a = await env.DB.prepare('SELECT id, user_id FROM attempts WHERE id = ?1').bind(id).first();
  if (!a) throw new HttpError(404, 'Попытка не найдена');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM answers WHERE attempt_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM attempts WHERE id = ?1').bind(id),
  ]);
  await audit(env, actor, 'attempt.delete', id, { user_id: a.user_id });
  return json({ ok: true });
}
async function putSettings(request, env, actor) {
  const b = await readJson(request);
  const ch = {};
  if (b.site_title !== undefined) ch.site_title = str(b.site_title, 120, { required: true, name: 'название сайта' });
  if (b.welcome_text !== undefined) ch.welcome_text = str(b.welcome_text, 5000, { name: 'приветствие' });
  if (b.sequential_lectures !== undefined) ch.sequential_lectures = bool(b.sequential_lectures, true) ? '1' : '0';
  const stmts = Object.entries(ch).map(([k, v]) => env.DB.prepare('INSERT INTO settings (k, v) VALUES (?1, ?2) ON CONFLICT(k) DO UPDATE SET v = excluded.v').bind(k, v));
  if (stmts.length) await env.DB.batch(stmts);
  await audit(env, actor, 'settings.update', null, ch);
  return json({ settings: await getSettings(env) });
}
async function adminAudit(env, url) {
  const before = Number(url.searchParams.get('before')) || Number.MAX_SAFE_INTEGER;
  const { results } = await env.DB.prepare('SELECT l.*, u.username, u.global_name FROM audit_log l LEFT JOIN users u ON u.id = l.actor_id WHERE l.id < ?1 ORDER BY l.id DESC LIMIT 200').bind(before).all();
  return json({ log: results });
}
async function adminStats(env) {
  const one = async (sql) => (await env.DB.prepare(sql).first()).c;
  return json({
    users: await one('SELECT COUNT(*) AS c FROM users'),
    lectures: await one('SELECT COUNT(*) AS c FROM lectures'),
    lectures_published: await one('SELECT COUNT(*) AS c FROM lectures WHERE published = 1'),
    exams: await one('SELECT COUNT(*) AS c FROM exams'),
    pending_review: await one(`SELECT COUNT(*) AS c FROM attempts WHERE status = 'pending_review'`),
    passed: await one(`SELECT COUNT(DISTINCT user_id) AS c FROM attempts WHERE status = 'passed'`),
    in_progress: await one(`SELECT COUNT(*) AS c FROM attempts WHERE status = 'in_progress'`),
  });
}

// ---------- router ----------
async function route(request, env, ctx) {
  const url = new URL(request.url);
  const p = url.pathname.replace(/\/+$/, '') || '/';
  const M = request.method;
  if (!env.DB) throw new HttpError(500, 'База данных не подключена');

  if (p === '/' || p === '/health') return json({ ok: true, service: 'vp-exam-api', oauth_configured: oauthConfigured(env), time: Date.now() });
  if (p === '/auth/login' && M === 'GET') return authLogin(request, env, url);
  if (p === '/auth/callback' && M === 'GET') return authCallback(request, env, url);
  if (p === '/auth/exchange' && M === 'POST') return authExchange(request, env);
  if (p === '/api/config' && M === 'GET') return json({ oauth_configured: oauthConfigured(env), settings: await getSettings(env), redirect_uri: redirectUri(env, request) });

  let m;
  if (!p.startsWith('/api/')) throw new HttpError(404, 'Не найдено');
  const user = await authUser(request, env);

  if (p === '/api/logout' && M === 'POST') { await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(user._token_hash).run(); return json({ ok: true }); }
  if (p === '/api/me' && M === 'GET') return json({ user: publicUser(user) });
  if (p === '/api/me' && M === 'PUT') {
    const b = await readJson(request);
    const ic = str(b.ic_name, 100, { name: 'игровое имя' }), sid = str(b.static_id, 30, { name: 'статик' }), rk = str(b.rank, 60, { name: 'звание' });
    await env.DB.prepare('UPDATE users SET ic_name = ?1, static_id = ?2, rank = ?3 WHERE id = ?4').bind(ic, sid, rk, user.id).run();
    return json({ user: publicUser({ ...user, ic_name: ic, static_id: sid, rank: rk }) });
  }
  if (p === '/api/lectures' && M === 'GET') return listLectures(env, user);
  if ((m = /^\/api\/lectures\/(\d+)$/.exec(p)) && M === 'GET') return getLecture(env, user, idParam(m[1]));
  if ((m = /^\/api\/lectures\/(\d+)\/heartbeat$/.exec(p)) && M === 'POST') return heartbeat(request, env, user, idParam(m[1]));
  if (p === '/api/exams' && M === 'GET') return listExams(env, user);
  if ((m = /^\/api\/exams\/(\d+)$/.exec(p)) && M === 'GET') return getExam(env, user, idParam(m[1]));
  if ((m = /^\/api\/exams\/(\d+)\/start$/.exec(p)) && M === 'POST') return startExam(env, user, idParam(m[1]));
  if (p === '/api/my/attempts' && M === 'GET') return myAttempts(env, user);
  if ((m = /^\/api\/attempts\/(\d+)$/.exec(p)) && M === 'GET') return getAttempt(env, user, idParam(m[1]));
  if ((m = /^\/api\/attempts\/(\d+)\/answers$/.exec(p)) && M === 'PUT') return putAnswers(request, env, user, idParam(m[1]));
  if ((m = /^\/api\/attempts\/(\d+)\/submit$/.exec(p)) && M === 'POST') return submitAttempt(request, env, user, idParam(m[1]));

  if (p.startsWith('/api/admin/')) {
    requireRole(user, 'examiner'); // минимум — проверяющий; ниже уточняется
    const A = () => requireRole(user, 'admin');
    if (p === '/api/admin/stats' && M === 'GET') return adminStats(env);
    // лекции
    if (p === '/api/admin/lectures' && M === 'GET') { A(); return adminLectures(env); }
    if (p === '/api/admin/lectures' && M === 'POST') { A(); return saveLecture(request, env, user, null); }
    if (p === '/api/admin/lectures/reorder' && M === 'POST') { A(); return reorder(request, env, user, 'lectures'); }
    if ((m = /^\/api\/admin\/lectures\/(\d+)$/.exec(p))) {
      A(); const id = idParam(m[1]);
      if (M === 'PUT') return saveLecture(request, env, user, id);
      if (M === 'DELETE') return deleteLecture(env, user, id);
    }
    // экзамены
    if (p === '/api/admin/exams' && M === 'GET') { A(); return adminExams(env); }
    if (p === '/api/admin/exams' && M === 'POST') { A(); return saveExam(request, env, user, null); }
    if ((m = /^\/api\/admin\/exams\/(\d+)$/.exec(p))) {
      A(); const id = idParam(m[1]);
      if (M === 'GET') return adminExam(env, id);
      if (M === 'PUT') return saveExam(request, env, user, id);
      if (M === 'DELETE') return deleteExam(env, user, id);
    }
    if ((m = /^\/api\/admin\/exams\/(\d+)\/questions$/.exec(p)) && M === 'POST') { A(); return saveQuestion(request, env, user, idParam(m[1]), null); }
    if ((m = /^\/api\/admin\/exams\/(\d+)\/questions\/reorder$/.exec(p)) && M === 'POST') { A(); const eid = idParam(m[1]); return reorder(request, env, user, 'questions', { sql: 'exam_id = ?3', val: eid }); }
    if ((m = /^\/api\/admin\/questions\/(\d+)$/.exec(p))) {
      A(); const id = idParam(m[1]);
      if (M === 'PUT') return saveQuestion(request, env, user, null, id);
      if (M === 'DELETE') return deleteQuestion(env, user, id);
    }
    // пользователи
    if (p === '/api/admin/users' && M === 'GET') return adminUsers(env, url);
    if ((m = /^\/api\/admin\/users\/(\d{5,25})$/.exec(p))) {
      if (M === 'GET') return adminUser(env, m[1]);
      if (M === 'PUT') { A(); return updateUser(request, env, user, m[1]); }
    }
    if ((m = /^\/api\/admin\/users\/(\d{5,25})\/reset-progress$/.exec(p)) && M === 'POST') { A(); return resetProgress(request, env, user, m[1]); }
    if ((m = /^\/api\/admin\/users\/(\d{5,25})\/reset-attempts$/.exec(p)) && M === 'POST') { A(); return resetAttempts(request, env, user, m[1]); }
    // попытки
    if (p === '/api/admin/attempts' && M === 'GET') return adminAttempts(env, url);
    if ((m = /^\/api\/admin\/attempts\/(\d+)$/.exec(p))) {
      const id = idParam(m[1]);
      if (M === 'GET') return adminAttempt(env, id);
      if (M === 'DELETE') { A(); return deleteAttempt(env, user, id); }
    }
    if ((m = /^\/api\/admin\/attempts\/(\d+)\/review$/.exec(p)) && M === 'POST') return reviewAttempt(request, env, user, idParam(m[1]));
    // настройки и журнал
    if (p === '/api/admin/settings' && M === 'GET') { A(); return json({ settings: await getSettings(env) }); }
    if (p === '/api/admin/settings' && M === 'PUT') { A(); return putSettings(request, env, user); }
    if (p === '/api/admin/audit' && M === 'GET') { A(); return adminAudit(env, url); }
  }
  throw new HttpError(404, 'Не найдено');
}
