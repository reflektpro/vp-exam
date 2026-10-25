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
  return { items: out, allRequiredDone, sequential: settings.sequential_lectures };
}
// Какие лекции нужны для допуска к конкретному экзамену.
//   mode: 'none' — лекции не нужны; 'all' — все опубликованные обязательные (как раньше); 'selected' — выбранные админом.
// Неопубликованные и удалённые лекции из выбранных не учитываются.
// Порядок «строго по порядку» на допуск к экзамену не влияет — он ограничивает только очерёдность просмотра лекций.
function examMode(e) { return !e.requires_lectures ? 'none' : (e.lecture_mode === 'selected' ? 'selected' : 'all'); }
async function examLinks(env, examId) {
  const { results } = examId
    ? await env.DB.prepare('SELECT exam_id, lecture_id FROM exam_lectures WHERE exam_id = ?1').bind(examId).all()
    : await env.DB.prepare('SELECT exam_id, lecture_id FROM exam_lectures').all();
  const m = new Map();
  for (const r of results) { if (!m.has(r.exam_id)) m.set(r.exam_id, []); m.get(r.exam_id).push(r.lecture_id); }
  return m;
}
function examRequirement(exam, st, links) {
  const mode = examMode(exam);
  let items = [];
  if (mode === 'all') items = st.items.filter(i => i.lecture.required);
  else if (mode === 'selected') { const ids = new Set(links.get(exam.id) || []); items = st.items.filter(i => ids.has(i.lecture.id)); }
  const lectures = items.map(i => ({ id: i.lecture.id, title: i.lecture.title, watched: !!(i.progress && i.progress.completed_at), locked: !!i.locked }));
  const left = lectures.filter(l => !l.watched);
  return { mode, lectures, left, done: left.length === 0 };
}
function lecturesReason(req) {
  const names = req.left.slice(0, 5).map(l => '«' + l.title + '»').join(', ') + (req.left.length > 5 ? ` и ещё ${req.left.length - 5}` : '');
  return 'Сначала просмотрите лекции: ' + names;
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
async function examAvailability(env, user, exam, req) {
  const { results: atts } = await env.DB.prepare('SELECT id, status, started_at, submitted_at, score_pct FROM attempts WHERE user_id = ?1 AND exam_id = ?2 ORDER BY id DESC').bind(user.id, exam.id).all();
  const now = Date.now();
  let can = true, reason = null, nextAt = null;
  const active = atts.find(a => a.status === 'in_progress');
  if (!req.done) { can = false; reason = lecturesReason(req); }
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
    lecture_mode: req.mode, lectures: req.lectures, lectures_left: req.left.length, lectures_done: req.done,
    attempts: atts.map(a => ({ id: a.id, status: a.status, started_at: a.started_at, submitted_at: a.submitted_at, score_pct: a.status === 'pending_review' ? null : a.score_pct })) };
}
function examPublic(e) {
  return { id: e.id, title: e.title, description: e.description, time_limit_min: e.time_limit_min, max_attempts: e.max_attempts,
    cooldown_min: e.cooldown_min, pass_pct: e.pass_pct, requires_lectures: !!e.requires_lectures };
}
async function listExams(env, user) {
  const st = await lectureStates(env, user.id);
  const links = await examLinks(env);
  const { results } = await env.DB.prepare('SELECT * FROM exams WHERE published = 1 ORDER BY position, id').all();
  const out = [];
  for (const e of results) {
    const qc = await env.DB.prepare('SELECT COUNT(*) AS c FROM questions WHERE exam_id = ?1').bind(e.id).first();
    out.push({ ...examPublic(e), question_count: qc.c, ...(await examAvailability(env, user, e, examRequirement(e, st, links))) });
  }
  return json({ exams: out, all_required_done: st.allRequiredDone, sequential_lectures: st.sequential });
}
// Проверка лекций для конкретного экзамена (используется при открытии, старте и отправке).
async function examReqFor(env, user, exam) {
  const st = await lectureStates(env, user.id);
  return examRequirement(exam, st, await examLinks(env, exam.id));
}
async function getExam(env, user, id) {
  const e = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1 AND published = 1').bind(id).first();
  if (!e) throw new HttpError(404, 'Экзамен не найден');
  const req = await examReqFor(env, user, e);
  const qc = await env.DB.prepare('SELECT COUNT(*) AS c FROM questions WHERE exam_id = ?1').bind(id).first();
  return json({ exam: { ...examPublic(e), question_count: qc.c, ...(await examAvailability(env, user, e, req)) } });
}
// ---------- движок вопросов (все типы) ----------
// Хранение: questions.options/correct — варианты для single/multi/eliminate (как раньше);
// questions.data (JSON) — всё остальное по типу (в т.ч. правильные ответы). Кандидату уходит только publicQuestion().
// Состояние вопроса в конкретной попытке (перемешивание, параметры) — attempts.opt_order[qid].
const QTYPE_LIST = ['single', 'multi', 'number', 'text', 'param', 'long', 'order', 'match', 'blanks_input', 'blanks_select', 'dictation',
  'eliminate', 'slider', 'file', 'voice', 'info', 'letters', 'words', 'find', 'case'];
const CHOICE_TYPES = new Set(['single', 'multi', 'eliminate']);
const PARTIAL_TYPES = new Set(['multi', 'order', 'match', 'blanks_input', 'blanks_select', 'dictation', 'find', 'eliminate', 'words']);
const UPLOAD_HARD_MAX = 1024 * 1024;   // 1 МБ на файл (D1, base64)
const IMPORT_TYPE_ALIASES = { multiple: 'multi', choice: 'single', radio: 'single', checkbox: 'multi', numeric: 'number', input: 'text', short: 'text',
  free: 'long', essay: 'long', sequence: 'order', matching: 'match', fill: 'blanks_input', blanks: 'blanks_input', fill_input: 'blanks_input', fill_select: 'blanks_select',
  select: 'blanks_select', exclude: 'eliminate', elimination: 'eliminate', range: 'slider', upload: 'file', audio: 'voice', information: 'info',
  anagram: 'letters', phrase: 'words', search: 'find', situation: 'case' };
const RU_DIGITS = /^[-+]?(\d+[.,]?\d*|[.,]\d+)(e[-+]?\d+)?$/i;

function randInt(n) { const x = new Uint32Array(1); crypto.getRandomValues(x); return x[0] % n; }
function newId(seen) { let id; do { id = randToken(6).replace(/[^a-z0-9]/gi, '').slice(0, 8); } while (!id || seen.has(id)); seen.add(id); return id; }
function normText(s) {
  return String(s == null ? '' : s).toLowerCase().replace(/ё/g, 'е').replace(/[\s\u00a0]+/g, ' ')
    .replace(/^[\s.,;:!?"'«»()\-–—]+|[\s.,;:!?"'«»()\-–—]+$/g, '').trim();
}
function parseNum(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/[\s\u00a0]+/g, '').replace(',', '.');
  if (!t || !RU_DIGITS.test(t)) return null;
  const n = Number(t); return Number.isFinite(n) ? n : null;
}
function reqNum(v, name, { min = -1e12, max = 1e12, def } = {}) {
  if ((v === undefined || v === null || v === '') && def !== undefined) return def;
  const n = parseNum(v);
  if (n === null || n < min || n > max) throw new HttpError(400, `Некорректное число: ${name}`);
  return n;
}
function fmtNum(n) { return (Math.round(n * 1e9) / 1e9).toString().replace('.', ','); }
function lines(v, max, name, maxItems = 100) {
  let arr = Array.isArray(v) ? v : (typeof v === 'string' ? v.split(/\r?\n/) : (v == null ? [] : null));
  if (!arr) throw new HttpError(400, `Некорректный список: ${name}`);
  arr = arr.map(x => (x && typeof x === 'object') ? x : str(x, max, { name })).filter(x => typeof x === 'object' || x !== '');
  if (arr.length > maxItems) throw new HttpError(400, `Слишком много элементов: ${name} (макс. ${maxItems})`);
  return arr;
}
// Безопасный разбор формулы (без eval): + - * / % ^ ( ), функции abs round floor ceil sqrt min max pow, константа pi.
function evalFormula(src, vars) {
  const s = String(src || ''); let i = 0;
  const FN = { abs: Math.abs, round: (x, d = 0) => { const k = 10 ** d; return Math.round(x * k) / k; }, floor: Math.floor, ceil: Math.ceil,
    sqrt: Math.sqrt, min: Math.min, max: Math.max, pow: Math.pow };
  const fail = (m) => { throw new HttpError(400, 'Формула: ' + m); };
  if (!s.trim()) fail('пустая');
  if (s.length > 500) fail('слишком длинная');
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };
  const expr = () => { let v = term(); for (;;) { ws(); if (s[i] === '+') { i++; v += term(); } else if (s[i] === '-') { i++; v -= term(); } else return v; } };
  const term = () => { let v = power(); for (;;) { ws(); if (s[i] === '*' || s[i] === '×') { i++; v *= power(); } else if (s[i] === '/' || s[i] === ':') { i++; v /= power(); } else if (s[i] === '%') { i++; v %= power(); } else return v; } };
  const power = () => { const b = unary(); ws(); if (s[i] === '^') { i++; return Math.pow(b, power()); } return b; };
  const unary = () => { ws(); if (s[i] === '-') { i++; return -unary(); } if (s[i] === '+') { i++; return unary(); } return atom(); };
  const atom = () => {
    ws();
    if (s[i] === '(') { i++; const v = expr(); ws(); if (s[i] !== ')') fail('нет закрывающей скобки'); i++; return v; }
    let m = /^\d+(?:[.,]\d+)?/.exec(s.slice(i));
    if (m) { i += m[0].length; return Number(m[0].replace(',', '.')); }
    m = /^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*/.exec(s.slice(i));
    if (m) {
      i += m[0].length; const name = m[0]; ws();
      if (s[i] === '(') {
        i++; const args = []; ws();
        if (s[i] !== ')') { for (;;) { args.push(expr()); ws(); if (s[i] === ',' || s[i] === ';') { i++; continue; } break; } }
        ws(); if (s[i] !== ')') fail('нет закрывающей скобки'); i++;
        const f = FN[name.toLowerCase()]; if (!f) fail('неизвестная функция ' + name); return f(...args);
      }
      if (/^pi$/i.test(name)) return Math.PI;
      if (!Object.prototype.hasOwnProperty.call(vars, name)) fail('неизвестная переменная ' + name);
      return vars[name];
    }
    fail('неожиданный символ «' + (s[i] || '') + '» на позиции ' + (i + 1));
  };
  const v = expr(); ws();
  if (i < s.length) fail('лишние символы на позиции ' + (i + 1));
  if (!Number.isFinite(v)) fail('результат не число (деление на ноль?)');
  return v;
}
function varCount(spec) { return spec.values ? spec.values.length : Math.floor((spec.max - spec.min) / spec.step + 1e-9) + 1; }
function genParams(vars) {
  const p = {};
  for (const [k, s] of Object.entries(vars || {})) {
    if (s.values) p[k] = s.values[randInt(s.values.length)];
    else p[k] = Math.round((s.min + randInt(varCount(s)) * s.step) * 1e9) / 1e9;
  }
  return p;
}
function renderTemplate(text, p) { return String(text).replace(/\{([A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]*)\}/g, (m, k) => (k in p ? fmtNum(p[k]) : m)); }
// [[a|b|*c]] — разметка пропусков/фрагментов. Возвращает части: строки и {alts, star}.
function parseMarked(content) {
  const parts = []; const re = /\[\[([\s\S]*?)\]\]/g; let last = 0, m;
  while ((m = re.exec(content))) {
    if (m.index > last) parts.push(content.slice(last, m.index));
    const alts = m[1].split('|').map(x => x.trim()); let star = -1;
    alts.forEach((a, k) => { if (a.startsWith('*')) { if (star < 0) star = k; alts[k] = a.slice(1).trim(); } });
    parts.push({ alts, star }); last = re.lastIndex;
  }
  if (last < content.length) parts.push(content.slice(last));
  return parts;
}
function reuseId(text, prevList, seen) {
  const hit = (prevList || []).find(x => x && x.text === text && x.id && !seen.has(x.id));
  if (hit) { seen.add(hit.id); return hit.id; }
  return newId(seen);
}
function optList(raw, correctIdx, name, prevOpts) {
  if (!Array.isArray(raw)) throw new HttpError(400, `Нужен список вариантов: ${name}`);
  const seen = new Set(); const ci = Array.isArray(correctIdx) ? correctIdx : (correctIdx != null ? [correctIdx] : null);
  return raw.map((x, i) => {
    const obj = (x && typeof x === 'object') ? x : { text: x };
    const text = str(obj.text, 1000, { required: true, name: `${name} ${i + 1}` });
    let id = typeof obj.id === 'string' && /^[a-z0-9]{1,16}$/i.test(obj.id) && !seen.has(obj.id) ? obj.id : null;
    if (id) seen.add(id); else id = reuseId(text, prevOpts, seen);
    const correct = ci ? ci.map(Number).includes(i) : !!obj.correct;
    return { id, text, correct };
  });
}
function parseCriteria(v) {
  return lines(v, 1000, 'критерии', 50).map((c) => {
    if (c && typeof c === 'object') return { text: str(c.text, 1000, { required: true, name: 'критерий' }), points: reqNum(c.points, 'баллы критерия', { min: 0, max: 1000, def: 0 }) };
    let m = /^(.*?)\s*\|\s*([\d.,]+)\s*$/.exec(c) || /^(.*?)\s*\(\s*([\d.,]+)\s*(?:балл\S*|б\.?)?\s*\)\s*\.?$/i.exec(c);
    return m ? { text: m[1].trim(), points: parseNum(m[2]) || 0 } : { text: c, points: 0 };
  });
}
function prevData(cur) { if (!cur) return {}; const d = parseJ(cur.data, {}); d._options = parseJ(cur.options, []); return d; }

// Нормализует вопрос из API/импорта в строку таблицы. prev — текущая строка (для сохранения id вариантов при правке).
function questionInput(b, prev) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) throw new HttpError(400, 'Некорректный вопрос');
  let type = str(b.type, 20, { required: true, name: 'тип' }).toLowerCase();
  type = IMPORT_TYPE_ALIASES[type] || type;
  if (!QTYPE_LIST.includes(type)) throw new HttpError(400, 'Неизвестный тип вопроса: ' + type + '. Допустимо: ' + QTYPE_LIST.join(', '));
  const pd = prevData(prev);
  const text = str(b.text !== undefined ? b.text : (b.question !== undefined ? b.question : b.situation), 10000, { required: true, name: 'текст вопроса' });
  const data = {}; let options = [], correct = [];
  const meta = {};
  for (const k of ['article', 'explanation', 'quote', 'difficulty', 'source']) if (b[k] !== undefined && b[k] !== null && b[k] !== '') meta[k] = str(Array.isArray(b[k]) ? b[k].join('; ') : b[k], 3000, { name: k });
  if (Object.keys(meta).length) data.meta = meta;
  const o = { type, text, reference: str(b.reference !== undefined ? b.reference : b.reference_answer, 10000, { name: 'эталонный ответ' }) };
  switch (type) {
    case 'single': case 'multi': case 'eliminate': {
      const opts = optList(b.options, b.correct_index !== undefined ? b.correct_index : (Array.isArray(b.correct) && b.correct.every(x => typeof x === 'number') ? b.correct : (typeof b.correct === 'number' ? [b.correct] : null)), 'вариант', pd._options);
      if (opts.length < 2 || opts.length > 20) throw new HttpError(400, 'Нужно от 2 до 20 вариантов ответа');
      correct = opts.filter(x => x.correct).map(x => x.id); options = opts.map(({ id, text }) => ({ id, text }));
      if (type !== 'multi' && correct.length !== 1) throw new HttpError(400, type === 'single' ? 'В вопросе с одним ответом должен быть ровно один правильный вариант' : 'В «Последовательном исключении» должен быть ровно один правильный вариант (он должен остаться последним)');
      if (type === 'multi' && correct.length < 1) throw new HttpError(400, 'Отметьте хотя бы один правильный вариант');
      if (type === 'eliminate' && opts.length < 3) throw new HttpError(400, 'Для последовательного исключения нужно минимум 3 варианта');
      break;
    }
    case 'number': {
      data.answer = reqNum(b.answer, 'правильный ответ');
      data.tolerance = reqNum(b.tolerance, 'допуск', { min: 0, def: 0 });
      data.unit = str(b.unit, 40, { name: 'единица' });
      break;
    }
    case 'slider': {
      data.min = reqNum(b.min, 'минимум', { def: 0 }); data.max = reqNum(b.max, 'максимум', { def: 100 });
      data.step = reqNum(b.step, 'шаг', { min: 1e-9, def: 1 });
      if (data.max <= data.min) throw new HttpError(400, 'Слайдер: максимум должен быть больше минимума');
      if ((data.max - data.min) / data.step > 100000) throw new HttpError(400, 'Слайдер: слишком мелкий шаг');
      data.answer = reqNum(b.answer, 'правильный ответ', { min: data.min, max: data.max });
      data.tolerance = reqNum(b.tolerance, 'допуск', { min: 0, def: 0 });
      data.unit = str(b.unit, 40, { name: 'единица' });
      break;
    }
    case 'text': {
      const acc = b.accepted !== undefined ? b.accepted : (b.answers !== undefined ? b.answers : (b.answer !== undefined && b.answer !== '' ? [String(b.answer)] : []));
      data.accepted = lines(acc, 1000, 'допустимые ответы', 50).map(String);
      break;
    }
    case 'param': {
      const vars = b.vars && typeof b.vars === 'object' && !Array.isArray(b.vars) ? b.vars : null;
      if (!vars || !Object.keys(vars).length) throw new HttpError(400, 'Параметризованная задача: задайте хотя бы одну переменную');
      if (Object.keys(vars).length > 10) throw new HttpError(400, 'Не больше 10 переменных');
      data.vars = {};
      for (const [k, s] of Object.entries(vars)) {
        if (!/^[A-Za-zА-Яа-яЁё_][A-Za-zА-Яа-яЁё_0-9]{0,19}$/.test(k)) throw new HttpError(400, 'Некорректное имя переменной: ' + k);
        if (s && Array.isArray(s.values)) {
          const vals = s.values.map(x => reqNum(x, 'значение ' + k));
          if (!vals.length || vals.length > 200) throw new HttpError(400, `Переменная ${k}: от 1 до 200 значений`);
          data.vars[k] = { values: vals };
        } else {
          const sp = { min: reqNum(s && s.min, k + ': минимум'), max: reqNum(s && s.max, k + ': максимум'), step: reqNum(s && s.step, k + ': шаг', { min: 1e-9, def: 1 }) };
          if (sp.max < sp.min) throw new HttpError(400, `Переменная ${k}: максимум меньше минимума`);
          if (varCount(sp) > 100000) throw new HttpError(400, `Переменная ${k}: слишком много значений`);
          data.vars[k] = sp;
        }
      }
      data.formula = str(b.formula, 500, { required: true, name: 'формула ответа' });
      for (let t = 0; t < 5; t++) evalFormula(data.formula, genParams(data.vars));   // проверка формулы
      data.tolerance = reqNum(b.tolerance, 'допуск', { min: 0, def: 0 });
      data.unit = str(b.unit, 40, { name: 'единица' });
      break;
    }
    case 'long': break;
    case 'case': {
      data.criteria = parseCriteria(b.criteria);
      break;
    }
    case 'order': {
      const items = lines(b.items !== undefined ? b.items : b.options, 1000, 'элементы', 30);
      let src = items;
      // формат «options + correct (индексы в правильном порядке)»
      if (b.items === undefined && Array.isArray(b.correct) && b.correct.length === items.length) src = b.correct.map(ix => items[Number(ix)]);
      if (src.some(x => x === undefined)) throw new HttpError(400, 'Порядок: некорректные индексы correct');
      const seen = new Set();
      data.items = src.map((x, i) => { const t = str(typeof x === 'object' ? x.text : x, 1000, { required: true, name: `элемент ${i + 1}` });
        const id = typeof x === 'object' && /^[a-z0-9]{1,16}$/i.test(x.id || '') && !seen.has(x.id) ? (seen.add(x.id), x.id) : reuseId(t, pd.items, seen); return { id, text: t }; });
      if (data.items.length < 2) throw new HttpError(400, 'Установление последовательности: нужно минимум 2 элемента');
      break;
    }
    case 'match': {
      const pairs = Array.isArray(b.pairs) ? b.pairs : null;
      if (!pairs || pairs.length < 2 || pairs.length > 30) throw new HttpError(400, 'Соответствия: нужно от 2 до 30 пар');
      const seenL = new Set(), seenR = new Set();
      const prevL = (pd.pairs || []).map(p => p.l), prevR = (pd.pairs || []).map(p => p.r).concat(pd.distractors || []);
      data.pairs = pairs.map((p, i) => {
        const lt = str(p && p.left, 1000, { required: true, name: `левая часть пары ${i + 1}` }), rt = str(p && p.right, 1000, { required: true, name: `правая часть пары ${i + 1}` });
        return { l: { id: reuseId(lt, prevL, seenL), text: lt }, r: { id: reuseId(rt, prevR, seenR), text: rt } };
      });
      data.distractors = lines(b.distractors, 1000, 'лишние варианты', 20).map(t => ({ id: reuseId(String(t.text || t), prevR, seenR), text: String(t.text || t) }));
      break;
    }
    case 'blanks_input': case 'blanks_select': case 'dictation': case 'find': {
      const content = str(b.content, 20000, { required: true, name: 'текст с разметкой [[…]]' });
      data.content = content;
      const parts = parseMarked(content);
      const marks = parts.filter(x => typeof x === 'object');
      if (!marks.length) throw new HttpError(400, 'В тексте нет ни одного фрагмента в [[двойных скобках]]');
      if (marks.length > 100) throw new HttpError(400, 'Слишком много пропусков (макс. 100)');
      if (type === 'find') {
        const tokens = [];
        const pushWords = (s, c) => { for (const w of s.split(/(\s+)/)) { if (!w) continue; if (/^\s+$/.test(w)) { if (/\n/.test(w)) tokens.push({ br: 1 }); continue; } tokens.push(c ? { t: w, c: 1 } : { t: w }); } };
        for (const p of parts) { if (typeof p === 'string') pushWords(p, false); else pushWords(p.alts.join(' '), true); }
        if (tokens.length > 3000) throw new HttpError(400, 'Слишком длинный текст для поиска (макс. 3000 слов)');
        data.tokens = tokens;
      } else {
        let bi = 0; const seen = new Set(); const prevB = pd.blanks || [];
        data.parts = parts.map(p => typeof p === 'string' ? p : { i: bi++ });
        data.blanks = marks.map((m, k) => {
          if (m.alts.some(a => !a)) throw new HttpError(400, `Пропуск ${k + 1}: пустой вариант`);
          if (type === 'blanks_input') return { accepted: m.alts };
          if (m.alts.length < 2) throw new HttpError(400, `Пропуск ${k + 1}: для выбора нужно минимум 2 варианта через | (правильный — со звёздочкой * или первый)`);
          const prevOpts = prevB[k] && prevB[k].opts;
          const opts = m.alts.map(t => ({ id: reuseId(t, prevOpts, seen), text: t }));
          return { opts, correct: opts[m.star >= 0 ? m.star : 0].id };
        });
      }
      break;
    }
    case 'file': {
      const acc = str(b.accept, 200, { name: 'типы файлов' }) || 'image/*,application/pdf';
      if (!/^[a-z0-9*/.,+\- ]*$/i.test(acc)) throw new HttpError(400, 'Типы файлов: например image/*,application/pdf');
      data.accept = acc;
      data.max_kb = reqNum(b.max_kb, 'макс. размер, КБ', { min: 10, max: UPLOAD_HARD_MAX / 1024, def: 1024 });
      data.allow_url = b.allow_url === undefined ? true : !!bool(b.allow_url, true);
      break;
    }
    case 'voice': {
      data.max_sec = reqNum(b.max_sec, 'макс. длительность, сек', { min: 5, max: 300, def: 120 });
      break;
    }
    case 'info': break;
    case 'letters': {
      const word = str(b.word !== undefined ? b.word : b.answer, 60, { required: true, name: 'слово' });
      if (word.replace(/\s/g, '').length < 2) throw new HttpError(400, 'Слово должно быть не короче 2 букв');
      data.word = word;
      data.extra_letters = str(b.extra_letters, 30, { name: 'лишние буквы' }).replace(/\s/g, '');
      data.accepted = lines(b.accepted, 60, 'другие допустимые слова', 10).map(String);
      break;
    }
    case 'words': {
      const phrase = str(b.phrase !== undefined ? b.phrase : b.answer, 1000, { required: true, name: 'фраза' });
      const ws = phrase.split(/\s+/).filter(Boolean);
      if (ws.length < 2 || ws.length > 60) throw new HttpError(400, 'Фраза: от 2 до 60 слов');
      data.phrase = phrase;
      data.extra_words = lines(b.extra_words, 100, 'лишние слова', 30).map(String).flatMap(x => x.split(/\s+/)).filter(Boolean);
      break;
    }
  }
  if (PARTIAL_TYPES.has(type)) data.partial = !!bool(b.partial, false);
  o.options = options; o.correct = correct; o.data = data;
  if (type === 'info') o.points = 0;
  else {
    let defPts = 1;
    if (type === 'case') defPts = b.max_score ? Number(b.max_score) : (data.criteria.reduce((s, c) => s + c.points, 0) || 5);
    o.points = int(b.points !== undefined && b.points !== null && b.points !== '' ? Number(b.points) : (b.max_score && type !== 'case' ? Number(b.max_score) : defPts), 0, 1000, 'баллы', 1);
  }
  o.category = str(b.category, 100, { name: 'категория' });
  const kind = b.kind ? str(b.kind, 20, { name: 'вид' }) : (type === 'case' ? 'case' : 'question');
  if (!['question', 'case'].includes(kind)) throw new HttpError(400, 'Вид: question или case');
  o.kind = kind;
  o.easy = b.easy !== undefined && b.easy !== null ? bool(b.easy, false) : (meta.difficulty === 'easy' ? 1 : 0);
  o.active = bool(b.active, true);
  o.ext_id = b.ext_id !== undefined ? (str(b.ext_id, 100, { name: 'ext_id' }) || null) : (b.id !== undefined && typeof b.id === 'string' ? str(b.id, 100, { name: 'id' }) || null : undefined);
  if (b.position !== undefined) o.position = int(b.position, 0, 1000000, 'порядок', 0);
  return o;
}

// Строка таблицы → «родной» JSON-формат (для редактора и экспорта).
function toNative(q) {
  const d = parseJ(q.data, {}); const opts = parseJ(q.options, []); const corr = parseJ(q.correct, []);
  const o = { id: q.id, ext_id: q.ext_id || undefined, type: q.type, category: q.category || '', kind: q.kind || 'question', easy: !!q.easy, active: q.active === undefined ? true : !!q.active,
    text: q.text, points: q.points, reference: q.reference || '' };
  switch (q.type) {
    case 'single': case 'multi': case 'eliminate': o.options = opts.map(x => ({ id: x.id, text: x.text, correct: corr.includes(x.id) })); break;
    case 'number': Object.assign(o, { answer: d.answer, tolerance: d.tolerance || 0, unit: d.unit || '' }); break;
    case 'slider': Object.assign(o, { min: d.min, max: d.max, step: d.step, answer: d.answer, tolerance: d.tolerance || 0, unit: d.unit || '' }); break;
    case 'text': o.accepted = d.accepted || []; break;
    case 'param': Object.assign(o, { vars: d.vars || {}, formula: d.formula || '', tolerance: d.tolerance || 0, unit: d.unit || '' }); break;
    case 'case': o.criteria = d.criteria || []; break;
    case 'order': o.items = (d.items || []).map(x => ({ id: x.id, text: x.text })); break;
    case 'match': o.pairs = (d.pairs || []).map(p => ({ left: p.l.text, right: p.r.text })); o.distractors = (d.distractors || []).map(x => x.text); break;
    case 'blanks_input': case 'blanks_select': case 'dictation': case 'find': o.content = d.content || ''; break;
    case 'file': Object.assign(o, { accept: d.accept, max_kb: d.max_kb, allow_url: d.allow_url !== false }); break;
    case 'voice': o.max_sec = d.max_sec; break;
    case 'letters': Object.assign(o, { word: d.word, extra_letters: d.extra_letters || '', accepted: d.accepted || [] }); break;
    case 'words': Object.assign(o, { phrase: d.phrase, extra_words: d.extra_words || [] }); break;
  }
  if (PARTIAL_TYPES.has(q.type)) o.partial = !!d.partial;
  if (d.meta) Object.assign(o, d.meta);
  return o;
}
function isManual(q, d) { return q.type === 'long' || q.type === 'case' || q.type === 'file' || q.type === 'voice' || (q.type === 'text' && !(d.accepted && d.accepted.length)); }
function pubOrder(pool, st) { return st && Array.isArray(st.o) && st.o.length === pool.length ? st.o.map(i => pool[i]) : pool; }   // как видит кандидат
function letterPool(d) { return (d.word.replace(/\s/g, '') + (d.extra_letters || '')).split(''); }
function wordPool(d) { return d.phrase.split(/\s+/).filter(Boolean).concat(d.extra_words || []); }
function shuffleDiff(arr, same) {   // перемешать, стараясь не оставить исходный (правильный) порядок
  let r = shuffle(arr);
  for (let t = 0; t < 8 && arr.length > 1 && same(r); t++) r = shuffle(arr);
  return r;
}

// Состояние вопроса в попытке (порядок вариантов, параметры).
function makeState(q, shuffleOpts) {
  const d = parseJ(q.data, {});
  const ids = (a) => a.map(x => x.id);
  switch (q.type) {
    case 'single': case 'multi': case 'eliminate': { const o = parseJ(q.options, []).map(x => x.id); return shuffleOpts ? shuffle(o) : o; }
    case 'param': return { p: genParams(d.vars) };
    case 'order': { const o = ids(d.items || []); return { o: shuffleDiff(o, r => r.join() === o.join()) }; }
    case 'match': { const l = ids((d.pairs || []).map(p => p.l)); return { l: shuffleOpts ? shuffle(l) : l, r: shuffle(ids((d.pairs || []).map(p => p.r).concat(d.distractors || []))) }; }
    case 'blanks_select': case 'dictation': return { b: (d.blanks || []).map(bl => shuffle(ids(bl.opts))) };
    case 'letters': { const pool = letterPool(d); const idx = pool.map((_, i) => i); return { o: shuffleDiff(idx, r => r.map(i => pool[i]).join('') === pool.join('')) }; }
    case 'words': { const pool = wordPool(d); const idx = pool.map((_, i) => i); return { o: shuffleDiff(idx, r => r.join() === idx.join()) }; }
    default: return null;
  }
}
function stateFor(q, all) {   // устойчиво к старым попыткам и изменённым вопросам
  let st = all ? all[q.id] : undefined;
  if (st === undefined || st === null) st = makeState(q, false);
  return st;
}
function orderBy(list, order) {
  const m = new Map(list.map(x => [x.id, x])); const out = [];
  for (const id of order || []) if (m.has(id)) { out.push(m.get(id)); m.delete(id); }
  for (const x of m.values()) out.push(x);
  return out;
}
// Что видит кандидат. Никаких правильных ответов.
function publicQuestion(q, st) {
  const d = parseJ(q.data, {});
  const o = { id: q.id, type: q.type, text: q.text, points: q.points, kind: q.kind || 'question', category: q.category || '' };
  switch (q.type) {
    case 'single': case 'multi': case 'eliminate': o.options = orderBy(parseJ(q.options, []), Array.isArray(st) ? st : []).map(x => ({ id: x.id, text: x.text })); break;
    case 'number': o.unit = d.unit || ''; break;
    case 'slider': Object.assign(o, { min: d.min, max: d.max, step: d.step, unit: d.unit || '' }); break;
    case 'param': { const p = (st && st.p) || genParams(d.vars); o.text = renderTemplate(q.text, p); o.unit = d.unit || ''; break; }
    case 'order': o.items = orderBy(d.items || [], st && st.o).map(x => ({ id: x.id, text: x.text })); break;
    case 'match': o.left = orderBy((d.pairs || []).map(p => p.l), st && st.l); o.right = orderBy((d.pairs || []).map(p => p.r).concat(d.distractors || []), st && st.r); break;
    case 'blanks_input': o.parts = d.parts || []; o.blank_count = (d.blanks || []).length; break;
    case 'blanks_select': case 'dictation': o.parts = d.parts || []; o.blanks = (d.blanks || []).map((bl, k) => orderBy(bl.opts, st && st.b && st.b[k]).map(x => ({ id: x.id, text: x.text }))); break;
    case 'find': o.tokens = (d.tokens || []).map(t => t.br ? '\n' : t.t); break;
    case 'file': Object.assign(o, { accept: d.accept, max_kb: d.max_kb, allow_url: d.allow_url !== false }); break;
    case 'voice': o.max_sec = d.max_sec; break;
    case 'letters': o.letters = pubOrder(letterPool(d), st); break;
    case 'words': o.words = pubOrder(wordPool(d), st); break;
  }
  return o;
}
function badAns() { throw new HttpError(400, 'Некорректный ответ'); }
function idxArray(v, n) {
  if (!Array.isArray(v) || v.length > n) badAns();
  const seen = new Set();
  for (const x of v) { if (!Number.isInteger(x) || x < 0 || x >= n || seen.has(x)) badAns(); seen.add(x); }
  return v;
}
// Проверка формы ответа (без оценки). Возвращает нормализованное значение или null.
function validateAnswer(q, st, v) {
  if (v === null || v === undefined) return null;
  const d = parseJ(q.data, {});
  switch (q.type) {
    case 'single': { const opts = parseJ(q.options, []).map(o => o.id); if (typeof v !== 'string' || !opts.includes(v)) badAns(); return v; }
    case 'multi': case 'eliminate': { const opts = parseJ(q.options, []).map(o => o.id); if (!Array.isArray(v) || v.length > opts.length || v.some(x => typeof x !== 'string' || !opts.includes(x))) badAns(); return [...new Set(v)]; }
    case 'number': case 'slider': case 'param': {
      if (typeof v === 'string' && !v.trim()) return null;
      const n = parseNum(v); if (n === null) throw new HttpError(400, 'Ответ должен быть числом'); return n;
    }
    case 'text': case 'long': case 'case': {
      if (typeof v !== 'string') badAns();
      const max = q.type === 'text' ? 1000 : 8000;
      if (v.length > max) throw new HttpError(400, `Ответ слишком длинный (макс. ${max} символов)`);
      return v;
    }
    case 'order': { const ids = (d.items || []).map(x => x.id); if (!Array.isArray(v) || v.length !== ids.length || v.some(x => !ids.includes(x)) || new Set(v).size !== v.length) badAns(); return v; }
    case 'match': {
      if (typeof v !== 'object' || Array.isArray(v)) badAns();
      const L = new Set((d.pairs || []).map(p => p.l.id)), R = new Set((d.pairs || []).map(p => p.r.id).concat((d.distractors || []).map(x => x.id)));
      const out = {};
      for (const [k, x] of Object.entries(v)) { if (!L.has(k)) badAns(); if (x === null || x === '') continue; if (typeof x !== 'string' || !R.has(x)) badAns(); out[k] = x; }
      return out;
    }
    case 'blanks_input': {
      const n = (d.blanks || []).length;
      if (!Array.isArray(v) || v.length > n || v.some(x => x !== null && (typeof x !== 'string' || x.length > 500))) badAns();
      return v.map(x => x == null ? '' : x);
    }
    case 'blanks_select': case 'dictation': {
      const bl = d.blanks || [];
      if (!Array.isArray(v) || v.length > bl.length) badAns();
      return v.map((x, k) => { if (x === null || x === '') return null; if (typeof x !== 'string' || !bl[k].opts.some(o => o.id === x)) badAns(); return x; });
    }
    case 'find': {
      const tk = d.tokens || []; idxArray(v, tk.length);
      if (v.some(i => tk[i].br)) badAns(); return v;
    }
    case 'letters': return idxArray(v, letterPool(d).length);
    case 'words': return idxArray(v, wordPool(d).length);
    case 'file': case 'voice': {
      if (typeof v !== 'object' || Array.isArray(v)) badAns();
      if (v.upload_id !== undefined) { const id = Number(v.upload_id); if (!Number.isInteger(id) || id <= 0) badAns(); return { upload_id: id }; }
      if (q.type === 'file' && v.url !== undefined) {
        if (d.allow_url === false) throw new HttpError(400, 'Для этого вопроса нужно загрузить файл');
        const u = str(v.url, 1000, { name: 'ссылка' }); if (!u) return null;
        let url; try { url = new URL(u); } catch (_) { throw new HttpError(400, 'Некорректная ссылка'); }
        if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new HttpError(400, 'Ссылка должна начинаться с https://');
        return { url: url.toString() };
      }
      badAns();
    }
    case 'info': return null;
  }
  return null;
}
function isEmptyAnswer(v) {
  if (v === null || v === undefined) return true;
  if (typeof v === 'string') return !v.trim();
  if (Array.isArray(v)) return !v.length || v.every(x => x === null || x === '');
  if (typeof v === 'object') return !Object.keys(v).length;
  return false;
}
function frac(ok, total, partial) { if (!total) return 0; if (partial) return Math.max(0, Math.min(1, ok / total)); return ok >= total ? 1 : 0; }
// Оценка ответа: { ap: баллы | null (ручная проверка), nr: 1 если нужна ручная проверка }.
function gradeAnswer(q, st, v) {
  const d = parseJ(q.data, {}); const P = q.points; const part = !!d.partial;
  if (q.type === 'info') return { ap: 0, nr: 0 };
  if (isManual(q, d)) return isEmptyAnswer(v) ? { ap: 0, nr: 0 } : { ap: null, nr: 1 };
  if (isEmptyAnswer(v)) return { ap: 0, nr: 0 };
  let f = 0;
  try {
    switch (q.type) {
      case 'single': { const c = parseJ(q.correct, []); f = c.length === 1 && v === c[0] ? 1 : 0; break; }
      case 'multi': {
        const c = new Set(parseJ(q.correct, [])); const s = new Set(Array.isArray(v) ? v : []);
        if (part) { let good = 0, bad = 0; for (const x of s) (c.has(x) ? good++ : bad++); f = frac(good - bad, c.size, true); }
        else f = (c.size === s.size && [...c].every(x => s.has(x))) ? 1 : 0;
        break;
      }
      case 'eliminate': {
        const all = parseJ(q.options, []).map(x => x.id); const c = parseJ(q.correct, [])[0]; const el = new Set(v);
        if (el.has(c)) f = 0;
        else { const wrong = all.filter(x => x !== c); const done = wrong.filter(x => el.has(x)).length; f = frac(done, wrong.length, part); }
        break;
      }
      case 'number': case 'slider': f = Math.abs(v - d.answer) <= (d.tolerance || 0) + 1e-9 ? 1 : 0; break;
      case 'param': { const exp = evalFormula(d.formula, (st && st.p) || {}); f = Math.abs(v - exp) <= (d.tolerance || 0) + 1e-9 ? 1 : 0; break; }
      case 'text': { const a = normText(v); f = (d.accepted || []).some(x => normText(x) === a) ? 1 : 0; break; }
      case 'order': { const c = (d.items || []).map(x => x.id); const ok = c.filter((id, i) => v[i] === id).length; f = frac(ok, c.length, part); break; }
      case 'match': { const ok = (d.pairs || []).filter(p => v[p.l.id] === p.r.id).length; f = frac(ok, (d.pairs || []).length, part); break; }
      case 'blanks_input': { const bl = d.blanks || []; const ok = bl.filter((b, k) => b.accepted.some(a => normText(a) === normText(v[k]))).length; f = frac(ok, bl.length, part); break; }
      case 'blanks_select': case 'dictation': { const bl = d.blanks || []; const ok = bl.filter((b, k) => v[k] === b.correct).length; f = frac(ok, bl.length, part); break; }
      case 'find': {
        const tk = d.tokens || []; const c = new Set(tk.map((t, i) => t.c ? i : -1).filter(i => i >= 0)); const s = new Set(v);
        let tp = 0, fp = 0; for (const i of s) (c.has(i) ? tp++ : fp++);
        f = part ? frac(tp - fp, c.size, true) : (tp === c.size && fp === 0 ? 1 : 0);
        break;
      }
      case 'letters': {
        const pool = pubOrder(letterPool(d), st); const word = v.map(i => pool[i]).join('');
        const norm = (s) => normText(s).replace(/\s/g, '');
        f = [d.word].concat(d.accepted || []).some(w => norm(w) === norm(word)) ? 1 : 0; break;
      }
      case 'words': {
        const pool = pubOrder(wordPool(d), st); const got = v.map(i => pool[i]); const need = d.phrase.split(/\s+/).filter(Boolean);
        if (part) { const ok = need.filter((w, i) => got[i] !== undefined && normText(got[i]) === normText(w)).length - Math.max(0, got.length - need.length); f = frac(ok, need.length, true); }
        else f = normText(got.join(' ')) === normText(need.join(' ')) ? 1 : 0;
        break;
      }
    }
  } catch (_) { f = 0; }
  return { ap: Math.round(P * f * 100) / 100, nr: 0 };
}
// Человекочитаемые «ответ кандидата» и «правильный ответ» для проверяющего.
function describeQA(q, st, v) {
  const d = parseJ(q.data, {}); const opts = parseJ(q.options, []); const corr = parseJ(q.correct, []);
  const ot = (id) => { const x = opts.find(o => o.id === id); return x ? x.text : '?'; };
  const unit = d.unit ? ' ' + d.unit : '';
  let ans = isEmptyAnswer(v) ? '' : null, exp = '';
  try {
    switch (q.type) {
      case 'single': if (ans === null) ans = ot(v); exp = corr.map(ot).join('; '); break;
      case 'multi': if (ans === null) ans = v.map(ot).join('; '); exp = corr.map(ot).join('; '); break;
      case 'eliminate': if (ans === null) { const rest = opts.filter(o => !v.includes(o.id)); ans = 'Исключены по порядку: ' + v.map(ot).join(' → ') + (rest.length === 1 ? `\nОсталось: ${rest[0].text}` : `\nОсталось вариантов: ${rest.length}`); } exp = 'Должен остаться: ' + corr.map(ot).join(''); break;
      case 'number': case 'slider': if (ans === null) ans = fmtNum(v) + unit; exp = fmtNum(d.answer) + unit + (d.tolerance ? ` (± ${fmtNum(d.tolerance)})` : ''); break;
      case 'param': { const p = (st && st.p) || {}; if (ans === null) ans = fmtNum(v) + unit; let e = '?'; try { e = fmtNum(evalFormula(d.formula, p)); } catch (_) {}
        exp = e + unit + (d.tolerance ? ` (± ${fmtNum(d.tolerance)})` : '') + `\nФормула: ${d.formula}; значения: ` + Object.entries(p).map(([k, x]) => `${k} = ${fmtNum(x)}`).join(', '); break; }
      case 'text': if (ans === null) ans = v; exp = (d.accepted || []).length ? 'Допустимо: ' + d.accepted.join(' | ') : ''; break;
      case 'long': case 'case': if (ans === null) ans = v; exp = ''; break;
      case 'order': { const m = new Map((d.items || []).map(x => [x.id, x.text])); if (ans === null) ans = v.map((id, i) => `${i + 1}. ${m.get(id)}`).join('\n'); exp = (d.items || []).map((x, i) => `${i + 1}. ${x.text}`).join('\n'); break; }
      case 'match': { const R = new Map((d.pairs || []).map(p => [p.r.id, p.r.text]).concat((d.distractors || []).map(x => [x.id, x.text])));
        if (ans === null) ans = (d.pairs || []).map(p => `${p.l.text} → ${v[p.l.id] ? R.get(v[p.l.id]) : '—'}`).join('\n');
        exp = (d.pairs || []).map(p => `${p.l.text} → ${p.r.text}`).join('\n'); break; }
      case 'blanks_input': if (ans === null) ans = (d.blanks || []).map((b, k) => `${k + 1}) ${v[k] || '—'}`).join('\n'); exp = (d.blanks || []).map((b, k) => `${k + 1}) ${b.accepted.join(' | ')}`).join('\n'); break;
      case 'blanks_select': case 'dictation': { const t = (b, id) => { const x = b.opts.find(o => o.id === id); return x ? x.text : '—'; };
        if (ans === null) ans = (d.blanks || []).map((b, k) => `${k + 1}) ${t(b, v[k])}`).join('\n'); exp = (d.blanks || []).map((b, k) => `${k + 1}) ${t(b, b.correct)}`).join('\n'); break; }
      case 'find': { const tk = d.tokens || []; if (ans === null) ans = v.slice().sort((a, b) => a - b).map(i => tk[i].t).join(' · '); exp = tk.filter(t => t.c).map(t => t.t).join(' · '); break; }
      case 'letters': { const pool = pubOrder(letterPool(d), st); if (ans === null) ans = v.map(i => pool[i]).join(''); exp = [d.word].concat(d.accepted || []).join(' | '); break; }
      case 'words': { const pool = pubOrder(wordPool(d), st); if (ans === null) ans = v.map(i => pool[i]).join(' '); exp = d.phrase; break; }
      case 'file': case 'voice': if (ans === null) ans = v.url ? v.url : `Файл #${v.upload_id}`; break;
      case 'info': ans = ''; break;
    }
  } catch (_) { if (ans === null) ans = JSON.stringify(v); }
  return { answer_text: ans || '', expected_text: exp || '' };
}

async function loadQs(env, ids) {
  if (!ids || !ids.length) return [];
  const { results } = await env.DB.prepare('SELECT * FROM questions WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(ids)).all();
  return results;
}
function buildStates(qs, shuffleOpts) { const st = {}; for (const q of qs) { const s = makeState(q, shuffleOpts); if (s !== null) st[q.id] = s; } return st; }
async function startExam(env, user, id) {
  await rateLimit(env, 'start:' + user.id, 10, 60);
  const e = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1 AND published = 1').bind(id).first();
  if (!e) throw new HttpError(404, 'Экзамен не найден');
  const req = await examReqFor(env, user, e);
  if (!req.done) throw new HttpError(403, lecturesReason(req));
  const av = await examAvailability(env, user, e, req);
  if (av.active_attempt_id) {
    const a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(av.active_attempt_id).first();
    if (!(await finalizeIfExpired(env, a))) return json({ attempt_id: a.id });
    throw new HttpError(409, 'Время предыдущей попытки истекло — она завершена автоматически. Обновите страницу.');
  }
  if (!av.can_start) throw new HttpError(403, av.reason || 'Экзамен недоступен');
  const { results: qs } = await env.DB.prepare('SELECT * FROM questions WHERE exam_id = ?1 AND active = 1 ORDER BY position, id').bind(id).all();
  if (!qs.length) throw new HttpError(409, 'В экзамене пока нет вопросов');
  const order = e.shuffle_questions ? shuffle(qs.map(q => q.id)) : qs.map(q => q.id);
  const states = buildStates(qs, !!e.shuffle_options);
  const max = qs.reduce((s, q) => s + q.points, 0);
  const now = Date.now();
  const deadline = e.time_limit_min ? now + e.time_limit_min * 60000 : null;
  const r = await env.DB.prepare(`INSERT INTO attempts (exam_id, user_id, status, started_at, deadline_at, q_order, opt_order, max_score) VALUES (?1, ?2, 'in_progress', ?3, ?4, ?5, ?6, ?7) RETURNING id`)
    .bind(id, user.id, now, deadline, JSON.stringify(order), JSON.stringify(states), max).first();
  return json({ attempt_id: r.id });
}

async function saveAnswers(env, attempt, answers) {
  if (!answers || typeof answers !== 'object' || Array.isArray(answers)) throw new HttpError(400, 'Некорректные ответы');
  const order = parseJ(attempt.q_order, []); const states = parseJ(attempt.opt_order, {});
  const qs = await loadQs(env, order);
  const qm = new Map(qs.map(q => [q.id, q]));
  const stmts = [];
  for (const [k, v] of Object.entries(answers)) {
    const qid = Number(k);
    if (!order.includes(qid) || !qm.has(qid)) continue;
    const q = qm.get(qid);
    const val = validateAnswer(q, stateFor(q, states), v);
    if (val && val.upload_id) {
      const up = await env.DB.prepare('SELECT id FROM uploads WHERE id = ?1 AND attempt_id = ?2 AND question_id = ?3').bind(val.upload_id, attempt.id, qid).first();
      if (!up) throw new HttpError(400, 'Файл не найден — загрузите его заново');
    }
    stmts.push(env.DB.prepare('INSERT INTO answers (attempt_id, question_id, answer) VALUES (?1, ?2, ?3) ON CONFLICT(attempt_id, question_id) DO UPDATE SET answer = excluded.answer')
      .bind(attempt.id, qid, JSON.stringify(val)));
  }
  if (stmts.length) await env.DB.batch(stmts);
}
// Название и проходной балл: экзамен или версия переаттестации.
async function attemptCtx(env, a) {
  if (a.reatt) {
    const cfg = await getReattConfig(env); const v = cfg[a.reatt] || {};
    return { kind: 'reatt', id: null, reatt: a.reatt, title: v.title || ('Переаттестация (' + a.reatt + ')'), pass_pct: v.pass_pct ?? 70, description: v.description || '' };
  }
  const e = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1').bind(a.exam_id).first();
  return e ? { kind: 'exam', ...e } : { kind: 'exam', id: a.exam_id, title: '(экзамен удалён)', pass_pct: 70 };
}
async function finalizeAttempt(env, attempt, expired) {
  const ctx = await attemptCtx(env, attempt);
  const order = parseJ(attempt.q_order, []); const states = parseJ(attempt.opt_order, {});
  const qs = await loadQs(env, order);
  const qm = new Map(qs.map(q => [q.id, q]));
  const { results: ans } = await env.DB.prepare('SELECT * FROM answers WHERE attempt_id = ?1').bind(attempt.id).all();
  const am = new Map(ans.map(a => [a.question_id, parseJ(a.answer, null)]));
  let auto = 0, max = 0, needReview = false;
  const stmts = [];
  for (const qid of order) {
    const q = qm.get(qid); if (!q) continue;
    max += q.points;
    const v = am.has(qid) ? am.get(qid) : null;
    const g = gradeAnswer(q, stateFor(q, states), v);
    if (g.nr) needReview = true;
    if (g.ap) auto += g.ap;
    stmts.push(env.DB.prepare('INSERT INTO answers (attempt_id, question_id, answer, auto_points, needs_review) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(attempt_id, question_id) DO UPDATE SET auto_points = excluded.auto_points, needs_review = excluded.needs_review')
      .bind(attempt.id, qid, JSON.stringify(v), g.ap, g.nr));
  }
  auto = Math.round(auto * 100) / 100;
  const pct = max ? Math.round(auto / max * 1000) / 10 : 0;
  const status = needReview ? 'pending_review' : (pct >= ctx.pass_pct ? 'passed' : 'failed');
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
function ctxPublic(ctx) { return ctx.kind === 'reatt' ? { id: null, reatt: ctx.reatt, title: ctx.title, pass_pct: ctx.pass_pct, description: ctx.description } : examPublic(ctx); }
async function getAttempt(env, user, id) {
  const a = await loadOwnAttempt(env, user, id);
  const ctx = await attemptCtx(env, a);
  const base = { id: a.id, exam: ctxPublic(ctx), reatt: a.reatt || null, status: a.status, started_at: a.started_at, deadline_at: a.deadline_at,
    submitted_at: a.submitted_at, expired: !!a.expired, server_now: Date.now() };
  if (a.status === 'in_progress') {
    const order = parseJ(a.q_order, []), states = parseJ(a.opt_order, {});
    const qs = await loadQs(env, order);
    const qm = new Map(qs.map(q => [q.id, q]));
    const { results: ans } = await env.DB.prepare('SELECT question_id, answer FROM answers WHERE attempt_id = ?1').bind(a.id).all();
    const saved = {}; for (const r of ans) saved[r.question_id] = parseJ(r.answer, null);
    // для загруженных файлов — имя/размер (без содержимого)
    const upIds = Object.values(saved).filter(v => v && v.upload_id).map(v => v.upload_id);
    if (upIds.length) {
      const { results: ups } = await env.DB.prepare('SELECT id, name, mime, size FROM uploads WHERE id IN (SELECT value FROM json_each(?1)) AND attempt_id = ?2').bind(JSON.stringify(upIds), a.id).all();
      const um = new Map(ups.map(u => [u.id, u]));
      for (const k of Object.keys(saved)) { const v = saved[k]; if (v && v.upload_id && um.has(v.upload_id)) saved[k] = { upload_id: v.upload_id, name: um.get(v.upload_id).name, mime: um.get(v.upload_id).mime, size: um.get(v.upload_id).size }; }
    }
    base.questions = order.filter(qid => qm.has(qid)).map(qid => publicQuestion(qm.get(qid), stateFor(qm.get(qid), states)));
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
  if (!a.reatt) {
    const exam = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1').bind(a.exam_id).first();
    if (exam) { const req = await examReqFor(env, user, exam); if (!req.done) throw new HttpError(403, lecturesReason(req)); }
  }
  if (b.answers) await saveAnswers(env, a, b.answers);
  const status = await finalizeAttempt(env, a, false);
  return json({ ok: true, status });
}
async function attemptTitles(env, rows) {
  if (!rows.some(r => r.reatt)) return rows;
  const cfg = await getReattConfig(env);
  return rows.map(r => r.reatt ? { ...r, title: (cfg[r.reatt] || {}).title || 'Переаттестация', exam_title: (cfg[r.reatt] || {}).title || 'Переаттестация' } : r);
}
async function myAttempts(env, user) {
  const { results } = await env.DB.prepare('SELECT a.id, a.exam_id, a.reatt, e.title, a.status, a.started_at, a.submitted_at, a.score_pct, a.reviewer_comment FROM attempts a LEFT JOIN exams e ON e.id = a.exam_id WHERE a.user_id = ?1 ORDER BY a.id DESC').bind(user.id).all();
  return json({ attempts: (await attemptTitles(env, results)).map(r => ({ ...r, score_pct: r.status === 'pending_review' ? null : r.score_pct })) });
}

// ---------- загрузка файлов / голосовых ответов (в D1, base64, до 1 МБ) ----------
function mimeAllowed(accept, mime) {
  const list = String(accept || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  if (!list.length) return true;
  mime = String(mime || '').toLowerCase();
  return list.some(a => a === '*/*' || a === mime || (a.endsWith('/*') && mime.startsWith(a.slice(0, -1))));
}
async function uploadAnswerFile(request, env, user, id) {
  await rateLimit(env, 'up:' + user.id, 20, 60);
  const a = await loadOwnAttempt(env, user, id);
  if (a.status !== 'in_progress') throw new HttpError(409, 'Попытка уже завершена');
  const b = await readJson(request, 1500000);
  const qid = idParam(b.question_id);
  if (!parseJ(a.q_order, []).includes(qid)) throw new HttpError(400, 'Вопрос не из этой попытки');
  const q = await env.DB.prepare('SELECT * FROM questions WHERE id = ?1').bind(qid).first();
  if (!q || (q.type !== 'file' && q.type !== 'voice')) throw new HttpError(400, 'В этот вопрос нельзя загрузить файл');
  const d = parseJ(q.data, {});
  const mime = str(b.mime, 100, { required: true, name: 'тип файла' }).toLowerCase();
  const name = str(b.name, 200, { name: 'имя файла' }) || (q.type === 'voice' ? 'voice' : 'file');
  if (q.type === 'voice' ? !mime.startsWith('audio/') : !mimeAllowed(d.accept, mime)) throw new HttpError(400, 'Недопустимый тип файла: ' + mime);
  const data = typeof b.data === 'string' ? b.data.replace(/^data:[^,]*,/, '') : '';
  if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw new HttpError(400, 'Некорректные данные файла');
  const size = Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0);
  const limit = Math.min(UPLOAD_HARD_MAX, (q.type === 'file' ? (d.max_kb || 1024) : 1024) * 1024);
  if (size > limit) throw new HttpError(413, `Файл слишком большой: ${Math.ceil(size / 1024)} КБ (макс. ${Math.floor(limit / 1024)} КБ)`);
  const now = Date.now();
  await env.DB.prepare('DELETE FROM uploads WHERE attempt_id = ?1 AND question_id = ?2').bind(a.id, qid).run();
  const r = await env.DB.prepare('INSERT INTO uploads (user_id, attempt_id, question_id, kind, name, mime, size, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9) RETURNING id')
    .bind(user.id, a.id, qid, q.type, name, mime, size, data, now).first();
  await env.DB.prepare('INSERT INTO answers (attempt_id, question_id, answer) VALUES (?1, ?2, ?3) ON CONFLICT(attempt_id, question_id) DO UPDATE SET answer = excluded.answer')
    .bind(a.id, qid, JSON.stringify({ upload_id: r.id })).run();
  return json({ upload_id: r.id, name, mime, size });
}
async function getUpload(env, user, id) {
  const u = await env.DB.prepare('SELECT * FROM uploads WHERE id = ?1').bind(id).first();
  if (!u) throw new HttpError(404, 'Файл не найден');
  const lvl = { candidate: 0, examiner: 1, admin: 2 };
  if (u.user_id !== user.id && (lvl[user.role] ?? 0) < 1) throw new HttpError(404, 'Файл не найден');
  return json({ id: u.id, name: u.name, mime: u.mime, size: u.size, data: u.data });
}

// ---------- переаттестация ----------
const REATT_VERSIONS = ['full', 'simple'];
const STATUTE_CATS = ['ВУ', 'СУ', 'ДУ', 'КПС'];
const REATT_DEFAULT = {
  full: {
    enabled: true, title: 'Переаттестация — полная (общая)', time_limit_min: 120, pass_pct: 70, cooldown_min: 0, max_attempts: 0,
    description: 'Вопросы по законодательству (ПК, УК, ТК, ФЗ/ФКЗ) и внутренним уставам (ВУ, СУ, ДУ, КПС). Вопросы и варианты перемешиваются в каждой попытке. Кейсы проверяет экзаменатор.',
    groups: [
      { label: 'ПК', categories: ['ПК'], questions: 4, cases: 1, prefer_easy: false },
      { label: 'УК', categories: ['УК'], questions: 4, cases: 1, prefer_easy: false },
      { label: 'ВУ', categories: ['ВУ'], questions: 8, cases: 2, prefer_easy: false },
      { label: 'СУ', categories: ['СУ'], questions: 2, cases: 1, prefer_easy: false },
      { label: 'КПС', categories: ['КПС'], questions: 2, cases: 1, prefer_easy: false },
      { label: 'ДУ', categories: ['ДУ'], questions: 2, cases: 1, prefer_easy: false },
      { label: 'ФЗ / ФКЗ / КоАП', categories: ['ФЗ*', 'ФКЗ*', 'КоАП'], questions: 6, cases: 2, prefer_easy: false },
      { label: 'ТК', categories: ['ТК'], questions: 4, cases: 1, prefer_easy: false },
    ],
  },
  simple: {
    enabled: true, title: 'Переаттестация — упрощённая (уставы)', time_limit_min: 60, pass_pct: 70, cooldown_min: 0, max_attempts: 0,
    description: 'Только внутренние уставы: ВУ, СУ, ДУ, КПС. 15 вопросов (большая часть — ВУ) и 3 кейса. Вопросы и варианты перемешиваются в каждой попытке.',
    groups: [
      { label: 'ВУ', categories: ['ВУ'], questions: 9, cases: 0, prefer_easy: true },
      { label: 'СУ', categories: ['СУ'], questions: 2, cases: 0, prefer_easy: true },
      { label: 'ДУ', categories: ['ДУ'], questions: 2, cases: 0, prefer_easy: true },
      { label: 'КПС', categories: ['КПС'], questions: 2, cases: 0, prefer_easy: true },
      { label: 'Кейсы по уставам', categories: STATUTE_CATS, questions: 0, cases: 3, prefer_easy: true },
    ],
  },
};
function catMatch(pattern, cat) {
  const p = String(pattern).trim().toLowerCase(), c = String(cat || '').trim().toLowerCase();
  if (!p) return false;
  return p.endsWith('*') ? c.startsWith(p.slice(0, -1)) : c === p;
}
async function getReattConfig(env) {
  const row = await env.DB.prepare("SELECT v FROM settings WHERE k = 'reatt_config'").first();
  const saved = row ? parseJ(row.v, {}) : {};
  const out = {};
  for (const v of REATT_VERSIONS) out[v] = { ...REATT_DEFAULT[v], ...(saved[v] || {}) };
  return out;
}
function reattVersionInput(b, name) {
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Некорректная конфигурация: ' + name);
  const o = {
    enabled: !!bool(b.enabled, true),
    title: str(b.title, 200, { required: true, name: 'название' }),
    description: str(b.description, 5000, { name: 'описание' }),
    time_limit_min: int(b.time_limit_min, 0, 1440, 'лимит времени', 0),
    pass_pct: int(b.pass_pct, 0, 100, 'проходной балл', 70),
    cooldown_min: int(b.cooldown_min, 0, 60 * 24 * 60, 'пауза между попытками', 0),
    max_attempts: int(b.max_attempts, 0, 1000, 'лимит попыток', 0),
  };
  if (!Array.isArray(b.groups) || !b.groups.length || b.groups.length > 30) throw new HttpError(400, 'Нужно от 1 до 30 блоков квот');
  o.groups = b.groups.map((g, i) => {
    const cats = (Array.isArray(g.categories) ? g.categories : String(g.categories || '').split(',')).map(x => str(x, 100, { name: 'категория' })).filter(Boolean);
    if (!cats.length) throw new HttpError(400, `Блок ${i + 1}: укажите категории`);
    return { label: str(g.label, 60, { required: true, name: `название блока ${i + 1}` }), categories: cats.slice(0, 30),
      questions: int(g.questions, 0, 200, `вопросов в блоке ${i + 1}`, 0), cases: int(g.cases, 0, 50, `кейсов в блоке ${i + 1}`, 0), prefer_easy: !!bool(g.prefer_easy, false) };
  });
  if (!o.groups.some(g => g.questions + g.cases > 0)) throw new HttpError(400, 'Квоты: всего должно быть больше 0 вопросов');
  return o;
}
async function bankIndex(env) {
  const { results } = await env.DB.prepare("SELECT id, category, kind, easy, type FROM questions WHERE exam_id = 0 AND active = 1 AND type != 'info'").all();
  return results;
}
// Случайная выборка по квотам. Вопросы не повторяются между блоками.
function sampleReatt(bank, groups) {
  const used = new Set();
  return groups.map(g => {
    const pick = (kind, n) => {
      if (!n) return [];
      const pool = bank.filter(q => (q.kind || 'question') === kind && !used.has(q.id) && g.categories.some(p => catMatch(p, q.category)));
      const chosen = g.prefer_easy ? shuffle(pool.filter(q => q.easy)).concat(shuffle(pool.filter(q => !q.easy))).slice(0, n) : shuffle(pool).slice(0, n);
      chosen.forEach(q => used.add(q.id));
      return chosen.map(q => q.id);
    };
    const q = pick('question', g.questions), c = pick('case', g.cases);
    return { label: g.label, q, c, need_q: g.questions, need_c: g.cases, short_q: g.questions - q.length, short_c: g.cases - c.length };
  });
}
function availability(bank, groups) {
  return groups.map(g => {
    const m = bank.filter(q => g.categories.some(p => catMatch(p, q.category)));
    const qs = m.filter(q => (q.kind || 'question') === 'question'), cs = m.filter(q => q.kind === 'case');
    return { label: g.label, need_q: g.questions, need_c: g.cases, have_q: qs.length, have_easy_q: qs.filter(q => q.easy).length, have_c: cs.length, have_easy_c: cs.filter(q => q.easy).length,
      ok: qs.length >= g.questions && cs.length >= g.cases };
  });
}
async function reattState(env, user, key, v) {
  const { results: atts } = await env.DB.prepare('SELECT id, status, started_at, submitted_at, score_pct, deadline_at FROM attempts WHERE user_id = ?1 AND reatt = ?2 ORDER BY id DESC').bind(user.id, key).all();
  const now = Date.now();
  let can = true, reason = null, nextAt = null;
  const active = atts.find(a => a.status === 'in_progress');
  if (!v.enabled) { can = false; reason = 'Эта версия переаттестации сейчас выключена'; }
  else if (active) { can = true; }
  else if (atts.some(a => a.status === 'pending_review')) { can = false; reason = 'Предыдущая попытка ожидает проверки'; }
  else if (v.max_attempts && atts.length >= v.max_attempts) { can = false; reason = 'Попытки закончились'; }
  else if (v.cooldown_min && atts.length) {
    const t = (atts[0].submitted_at || atts[0].started_at) + v.cooldown_min * 60000;
    if (t > now) { can = false; reason = 'Следующая попытка будет доступна позже'; nextAt = t; }
  }
  return { can_start: can, reason, next_at: nextAt, active_attempt_id: active ? active.id : null,
    attempts: atts.map(a => ({ id: a.id, status: a.status, started_at: a.started_at, submitted_at: a.submitted_at, score_pct: a.status === 'pending_review' ? null : a.score_pct })) };
}
async function listReatt(env, user) {
  const cfg = await getReattConfig(env);
  const out = [];
  for (const key of REATT_VERSIONS) {
    const v = cfg[key];
    out.push({ key, title: v.title, description: v.description, enabled: v.enabled, time_limit_min: v.time_limit_min, pass_pct: v.pass_pct,
      cooldown_min: v.cooldown_min, max_attempts: v.max_attempts,
      composition: v.groups.map(g => ({ label: g.label, questions: g.questions, cases: g.cases })),
      total_questions: v.groups.reduce((s, g) => s + g.questions, 0), total_cases: v.groups.reduce((s, g) => s + g.cases, 0),
      ...(await reattState(env, user, key, v)) });
  }
  return json({ versions: out });
}
async function startReatt(env, user, key) {
  if (!REATT_VERSIONS.includes(key)) throw new HttpError(404, 'Нет такой версии переаттестации');
  await rateLimit(env, 'start:' + user.id, 10, 60);
  const cfg = await getReattConfig(env); const v = cfg[key];
  const st = await reattState(env, user, key, v);
  if (st.active_attempt_id) {
    const a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(st.active_attempt_id).first();
    if (!(await finalizeIfExpired(env, a))) return json({ attempt_id: a.id });
    throw new HttpError(409, 'Время предыдущей попытки истекло — она завершена автоматически. Обновите страницу.');
  }
  if (!st.can_start) throw new HttpError(403, st.reason || 'Переаттестация недоступна');
  const groups = sampleReatt(await bankIndex(env), v.groups);
  const ids = groups.flatMap(g => g.q.concat(g.c));
  if (!ids.length) throw new HttpError(409, 'Банк вопросов пока пуст — обратитесь к учебному отделу');
  const qs = await loadQs(env, ids);
  const order = shuffle(ids);
  const states = buildStates(qs, true);
  const max = qs.reduce((s, q) => s + q.points, 0);
  const now = Date.now();
  const deadline = v.time_limit_min ? now + v.time_limit_min * 60000 : null;
  const meta = { version: key, groups: groups.map(g => ({ label: g.label, q: g.q, c: g.c, short_q: g.short_q, short_c: g.short_c })) };
  const r = await env.DB.prepare(`INSERT INTO attempts (exam_id, user_id, status, started_at, deadline_at, q_order, opt_order, max_score, reatt, meta) VALUES (0, ?1, 'in_progress', ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`)
    .bind(user.id, now, deadline, JSON.stringify(order), JSON.stringify(states), max, key, JSON.stringify(meta)).first();
  return json({ attempt_id: r.id });
}
async function adminReatt(env) {
  const cfg = await getReattConfig(env);
  const bank = await bankIndex(env);
  const cats = {};
  for (const q of bank) { const c = q.category || '(без категории)'; cats[c] = cats[c] || { category: c, questions: 0, easy: 0, cases: 0 }; if (q.kind === 'case') cats[c].cases++; else { cats[c].questions++; if (q.easy) cats[c].easy++; } }
  const { results: stats } = await env.DB.prepare("SELECT reatt, status, COUNT(*) AS c FROM attempts WHERE reatt IS NOT NULL GROUP BY reatt, status").all();
  return json({ config: cfg, defaults: REATT_DEFAULT, availability: Object.fromEntries(REATT_VERSIONS.map(k => [k, availability(bank, cfg[k].groups)])),
    categories: Object.values(cats).sort((a, b) => a.category.localeCompare(b.category, 'ru')), attempt_stats: stats });
}
async function putReattConfig(request, env, actor) {
  const b = await readJson(request);
  const cur = await getReattConfig(env);
  const next = { ...cur };
  for (const k of REATT_VERSIONS) if (b[k] !== undefined) next[k] = reattVersionInput(b[k], k);
  await env.DB.prepare("INSERT INTO settings (k, v) VALUES ('reatt_config', ?1) ON CONFLICT(k) DO UPDATE SET v = excluded.v").bind(JSON.stringify(next)).run();
  await audit(env, actor, 'reatt.config', null, Object.fromEntries(REATT_VERSIONS.map(k => [k, next[k].groups.map(g => `${g.label}:${g.questions}+${g.cases}`).join(', ')])));
  return adminReatt(env);
}
async function previewReatt(env, key) {
  if (!REATT_VERSIONS.includes(key)) throw new HttpError(404, 'Нет такой версии');
  const cfg = await getReattConfig(env);
  const groups = sampleReatt(await bankIndex(env), cfg[key].groups);
  const qs = await loadQs(env, groups.flatMap(g => g.q.concat(g.c)));
  const qm = new Map(qs.map(q => [q.id, q]));
  const brief = (id) => { const q = qm.get(id); return { id, type: q.type, kind: q.kind, category: q.category, easy: !!q.easy, points: q.points, text: q.text.slice(0, 200) }; };
  return json({ version: key, groups: groups.map(g => ({ ...g, q: g.q.map(brief), c: g.c.map(brief) })),
    total: groups.reduce((s, g) => s + g.q.length + g.c.length, 0), max_score: qs.reduce((s, q) => s + q.points, 0) });
}

// ---------- банк вопросов и импорт ----------
const CODE_CATEGORY = { pk: 'ПК', uk: 'УК', tk: 'ТК', koap: 'КоАП', vu: 'ВУ', su: 'СУ', du: 'ДУ', kps: 'КПС',
  fz_oborona: 'ФЗ об обороне', fz_territorii: 'ФЗ о закрытых и охраняемых территориях', fz_gossluzhba: 'ФЗ о гос. службе', fz_gostayna: 'ФЗ о гос. тайне',
  fz_oruzhie: 'ФЗ об оружии', fz_vozduh: 'ФЗ о воздушном пространстве', fkz_rezhimy: 'ФКЗ об особых правовых режимах' };
// Принимает: массив вопросов; {questions:[…]}; файл закона {law, code, questions:[…], cases:[…]}.
function importItems(body) {
  let src = body;
  if (Array.isArray(body)) src = { questions: body };
  if (!src || typeof src !== 'object') throw new HttpError(400, 'Ожидается JSON-объект или массив');
  const defCat = src.category || (src.code && CODE_CATEGORY[String(src.code).toLowerCase()]) || (src.code ? String(src.code) : '') || '';
  const items = [];
  for (const q of Array.isArray(src.questions) ? src.questions : []) items.push({ ...q, category: q.category || defCat });
  for (const c of Array.isArray(src.cases) ? src.cases : []) {
    const text = c.text || [c.situation, c.question].filter(Boolean).join('\n\n');
    items.push({ ...c, type: c.type || 'case', kind: 'case', text, category: c.category || defCat, article: c.article || c.articles });
  }
  if (!items.length) throw new HttpError(400, 'Нет вопросов для импорта (ожидаются поля questions и/или cases)');
  if (items.length > 5000) throw new HttpError(400, 'Слишком много вопросов за раз (макс. 5000)');
  return items;
}
async function importQuestions(request, env, user, examId) {
  const b = await readJson(request, 8000000);
  const payload = b.data !== undefined ? b.data : b;
  const items = importItems(payload);
  const mode = b.mode === 'add' ? 'add' : 'upsert';
  const dry = !!b.dry_run;
  const errors = [], rows = [];
  items.forEach((it, i) => {
    try {
      const o = questionInput(it, null);
      if (examId === 0 && !o.category) throw new HttpError(400, 'не указана категория (category)');
      rows.push({ i, o });
    } catch (e) { errors.push({ index: i, id: it && (it.ext_id || it.id) || null, error: e.message }); }
  });
  const report = { total: items.length, valid: rows.length, errors: errors.slice(0, 200), error_count: errors.length, created: 0, updated: 0, dry_run: dry,
    by_category: {}, by_type: {} };
  for (const { o } of rows) { const k = (o.category || '—') + ' / ' + (o.kind === 'case' ? 'кейсы' : 'вопросы'); report.by_category[k] = (report.by_category[k] || 0) + 1; report.by_type[o.type] = (report.by_type[o.type] || 0) + 1; }
  if (dry || (errors.length && !b.skip_invalid)) {
    if (errors.length && !dry) report.aborted = 'Есть ошибки — ничего не импортировано. Исправьте их или передайте skip_invalid: true.';
    return json({ report }, errors.length && !dry ? 400 : 200);
  }
  const ext = rows.map(r => r.o.ext_id).filter(Boolean);
  const existing = new Map();
  if (mode === 'upsert' && ext.length) {
    for (let k = 0; k < ext.length; k += 500) {
      const { results } = await env.DB.prepare('SELECT id, ext_id FROM questions WHERE exam_id = ?1 AND ext_id IN (SELECT value FROM json_each(?2))').bind(examId, JSON.stringify(ext.slice(k, k + 500))).all();
      for (const r of results) existing.set(r.ext_id, r.id);
    }
  }
  const mx = await env.DB.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM questions WHERE exam_id = ?1').bind(examId).first();
  let pos = mx.m; const now = Date.now(); const stmts = [];
  for (const { o } of rows) {
    const id = o.ext_id ? existing.get(o.ext_id) : null;
    if (id) { stmts.push(updateQStmt(env, id, o, now)); report.updated++; }
    else { pos += 10; stmts.push(insertQStmt(env, examId, { ...o, position: o.position ?? pos }, now)); report.created++; }
  }
  for (let k = 0; k < stmts.length; k += 80) await env.DB.batch(stmts.slice(k, k + 80));
  await audit(env, user, 'question.import', examId || 'bank', { created: report.created, updated: report.updated, errors: errors.length });
  return json({ report });
}
function insertQStmt(env, examId, o, now) {
  return env.DB.prepare('INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15)')
    .bind(examId, o.type, o.text, JSON.stringify(o.options), JSON.stringify(o.correct), o.reference, o.points, o.position || 0, JSON.stringify(o.data), o.category || '', o.kind, o.easy, o.active, o.ext_id || null, now);
}
function updateQStmt(env, id, o, now) {
  return env.DB.prepare('UPDATE questions SET type = ?1, text = ?2, options = ?3, correct = ?4, reference = ?5, points = ?6, position = COALESCE(?7, position), data = ?8, category = ?9, kind = ?10, easy = ?11, active = ?12, ext_id = COALESCE(?13, ext_id), updated_at = ?14 WHERE id = ?15')
    .bind(o.type, o.text, JSON.stringify(o.options), JSON.stringify(o.correct), o.reference, o.points, o.position ?? null, JSON.stringify(o.data), o.category || '', o.kind, o.easy, o.active, o.ext_id || null, now, id);
}
async function adminBank(env, url) {
  const f = (k) => (url.searchParams.get(k) || '').trim();
  const where = ['exam_id = 0']; const binds = [];
  const add = (sql, v) => { binds.push(v); where.push(sql.replace('?', '?' + binds.length)); };
  if (f('category')) { const c = f('category'); if (c.endsWith('*')) add("category LIKE ? ESCAPE '\\'", c.slice(0, -1).replace(/[%_\\]/g, m => '\\' + m) + '%'); else add('category = ?', c); }
  if (f('kind')) add('kind = ?', f('kind'));
  if (f('type')) add('type = ?', f('type'));
  if (f('easy') === '1') where.push('easy = 1');
  if (f('active') === '0') where.push('active = 0');
  if (f('q')) { binds.push('%' + f('q').replace(/[%_\\]/g, m => '\\' + m) + '%'); const n = binds.length; where.push(`(text LIKE ?${n} ESCAPE '\\' OR ext_id LIKE ?${n} ESCAPE '\\')`); }
  const limit = Math.min(500, Math.max(1, Number(f('limit')) || 100)), offset = Math.max(0, Number(f('offset')) || 0);
  const w = where.join(' AND ');
  const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM questions WHERE ${w}`).bind(...binds).first();
  const { results } = await env.DB.prepare(`SELECT * FROM questions WHERE ${w} ORDER BY category, kind, id LIMIT ${limit} OFFSET ${offset}`).bind(...binds).all();
  const { results: cats } = await env.DB.prepare("SELECT category, kind, SUM(easy) AS easy, COUNT(*) AS c FROM questions WHERE exam_id = 0 GROUP BY category, kind ORDER BY category").all();
  return json({ total: total.c, questions: results.map(q => toNative(q)), categories: cats });
}
async function exportQuestions(env, examId, url) {
  const cat = (url.searchParams.get('category') || '').trim();
  const { results } = cat ? await env.DB.prepare('SELECT * FROM questions WHERE exam_id = ?1 AND category = ?2 ORDER BY id').bind(examId, cat).all()
    : await env.DB.prepare('SELECT * FROM questions WHERE exam_id = ?1 ORDER BY position, id').bind(examId).all();
  return json({ format: 'vp-exam-questions/1', exported_at: Date.now(), questions: results.map(q => { const n = toNative(q); delete n.id; return n; }) });
}
async function deleteExamples(request, env, user) {
  const b = await readJson(request);
  const cats = Array.isArray(b.categories) ? b.categories.map(x => str(x, 100, { name: 'категория' })).filter(Boolean) : null;
  let n = 0;
  if (cats && cats.length) {
    const { results } = await env.DB.prepare("SELECT id, category FROM questions WHERE exam_id = 0 AND ext_id LIKE 'example-%'").all();
    const ids = results.filter(r => cats.some(p => catMatch(p, r.category))).map(r => r.id);
    for (let k = 0; k < ids.length; k += 500) { const r = await env.DB.prepare('DELETE FROM questions WHERE id IN (SELECT value FROM json_each(?1))').bind(JSON.stringify(ids.slice(k, k + 500))).run(); n += r.meta.changes || 0; }
  } else { const r = await env.DB.prepare("DELETE FROM questions WHERE exam_id = 0 AND ext_id LIKE 'example-%'").run(); n = r.meta.changes || 0; }
  await audit(env, user, 'question.delete_examples', 'bank', { deleted: n, categories: cats });
  return json({ ok: true, deleted: n });
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
  const { results: lec } = await env.DB.prepare('SELECT id, title, published, required, position FROM lectures ORDER BY position, id').all();
  const links = await examLinks(env);
  return json({ exams: results.map(e => ({ ...e, ...examLecturesAdmin(e, lec, links) })) });
}
// Обязательные лекции экзамена для админки: что учитывается и что игнорируется (черновики / удалённые).
function examLecturesAdmin(e, lec, links) {
  const mode = examMode(e);
  const lm = new Map(lec.map(l => [l.id, l]));
  const ids = mode === 'selected' ? (links.get(e.id) || []).slice().sort((a, b) => {
    const la = lm.get(a), lb = lm.get(b); return (la ? la.position : 1e9) - (lb ? lb.position : 1e9) || a - b; }) : [];
  const required_lectures = ids.map(id => { const l = lm.get(id); return l ? { id, title: l.title, published: !!l.published, deleted: false } : { id, title: null, published: false, deleted: true }; });
  const effective = mode === 'all' ? lec.filter(l => l.published && l.required).length : required_lectures.filter(l => l.published).length;
  const warnings = [];
  for (const l of required_lectures) {
    if (l.deleted) warnings.push(`Лекция #${l.id} удалена — не учитывается`);
    else if (!l.published) warnings.push(`«${l.title}» — черновик, не учитывается, пока не опубликована`);
  }
  if (mode === 'selected' && required_lectures.length && !effective) warnings.push('Ни одна выбранная лекция не опубликована — экзамен сейчас открыт без лекций');
  return { lecture_mode: mode, required_lecture_ids: ids, required_lectures, effective_lecture_count: effective, lecture_warnings: warnings };
}
async function adminExam(env, id) {
  const e = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1').bind(id).first();
  if (!e) throw new HttpError(404, 'Экзамен не найден');
  const { results } = await env.DB.prepare('SELECT * FROM questions WHERE exam_id = ?1 ORDER BY position, id').bind(id).all();
  const { results: lec } = await env.DB.prepare('SELECT id, title, published, required, position FROM lectures ORDER BY position, id').all();
  return json({ exam: { ...e, ...examLecturesAdmin(e, lec, await examLinks(env, id)) }, questions: results.map(qOut) });
}
// required_lectures: 'all' — все опубликованные обязательные (по умолчанию); массив id — только выбранные; [] — лекции не нужны.
async function parseRequiredLectures(env, v) {
  if (v === undefined || v === null) return null;
  if (v === 'all') return { requires_lectures: 1, lecture_mode: 'all', ids: [] };
  if (!Array.isArray(v) || v.length > 500) throw new HttpError(400, 'Обязательные лекции: укажите "all" или список id лекций');
  const ids = [...new Set(v.map(x => { const n = Number(x); if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Обязательные лекции: некорректный id лекции'); return n; }))];
  if (ids.length) {
    const { results } = await env.DB.prepare(`SELECT id FROM lectures WHERE id IN (${ids.map((_, i) => '?' + (i + 1)).join(', ')})`).bind(...ids).all();
    const have = new Set(results.map(r => r.id));
    const bad = ids.filter(id => !have.has(id));
    if (bad.length) throw new HttpError(400, `Обязательные лекции: лекция ${bad.map(x => '#' + x).join(', ')} не найдена (возможно, удалена). Обновите страницу.`);
  }
  return { requires_lectures: ids.length ? 1 : 0, lecture_mode: 'selected', ids };
}
function lectureLinkStmts(env, examId, rl) {
  return [env.DB.prepare('DELETE FROM exam_lectures WHERE exam_id = ?1').bind(examId),
    ...rl.ids.map(lid => env.DB.prepare('INSERT OR IGNORE INTO exam_lectures (exam_id, lecture_id) VALUES (?1, ?2)').bind(examId, lid))];
}
function qOut(q) { return { ...q, options: parseJ(q.options, []), correct: parseJ(q.correct, []), data: undefined, native: toNative(q) }; }
async function saveExam(request, env, user, id) {
  const b = await readJson(request);
  const o = examInput(b, !!id);
  const rl = await parseRequiredLectures(env, b.required_lectures);
  if (rl) { o.requires_lectures = rl.requires_lectures; o.lecture_mode = rl.lecture_mode; }
  else if (!id) o.lecture_mode = 'all';
  const now = Date.now();
  if (id) {
    const cur = await env.DB.prepare('SELECT id FROM exams WHERE id = ?1').bind(id).first();
    if (!cur) throw new HttpError(404, 'Экзамен не найден');
    if (o.published) {
      const qc = await env.DB.prepare('SELECT COUNT(*) AS c FROM questions WHERE exam_id = ?1').bind(id).first();
      if (!qc.c) throw new HttpError(400, 'Чтобы опубликовать экзамен, добавьте хотя бы один вопрос. Черновик можно сохранить и без вопросов.');
    }
    const keys = Object.keys(o);
    const stmts = [];
    if (keys.length) stmts.push(env.DB.prepare(`UPDATE exams SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${keys.length + 1} WHERE id = ?${keys.length + 2}`).bind(...keys.map(k => o[k]), now, id));
    if (rl) stmts.push(...lectureLinkStmts(env, id, rl));
    if (stmts.length) await env.DB.batch(stmts);
    await audit(env, user, 'exam.update', id, rl ? { ...o, required_lecture_ids: rl.ids } : o);
    return adminExam(env, id);
  }
  if (o.published) throw new HttpError(400, 'Сначала сохраните экзамен как черновик и добавьте вопросы — потом его можно опубликовать.');
  const keys = Object.keys(o);
  const r = await env.DB.prepare(`INSERT INTO exams (${keys.join(', ')}, created_at, updated_at) VALUES (${keys.map((_, i) => '?' + (i + 1)).join(', ')}, ?${keys.length + 1}, ?${keys.length + 1}) RETURNING id`)
    .bind(...keys.map(k => o[k]), now).first();
  if (rl && rl.ids.length) await env.DB.batch(lectureLinkStmts(env, r.id, rl));
  await audit(env, user, 'exam.create', r.id, { title: o.title, lecture_mode: o.lecture_mode, required_lecture_ids: rl ? rl.ids : [] });
  return adminExam(env, r.id);
}
async function deleteExam(env, user, id) {
  const cur = await env.DB.prepare('SELECT id, title FROM exams WHERE id = ?1').bind(id).first();
  if (!cur) throw new HttpError(404, 'Экзамен не найден');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM answers WHERE attempt_id IN (SELECT id FROM attempts WHERE exam_id = ?1)').bind(id),
    env.DB.prepare('DELETE FROM uploads WHERE attempt_id IN (SELECT id FROM attempts WHERE exam_id = ?1)').bind(id),
    env.DB.prepare('DELETE FROM attempts WHERE exam_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM questions WHERE exam_id = ?1 AND exam_id != 0').bind(id),
    env.DB.prepare('DELETE FROM exam_lectures WHERE exam_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM exams WHERE id = ?1').bind(id),
  ]);
  await audit(env, user, 'exam.delete', id, { title: cur.title });
  return json({ ok: true });
}
async function saveQuestion(request, env, user, examId, qid) {
  const b = await readJson(request, 400000);
  if (qid) {
    const cur = await env.DB.prepare('SELECT * FROM questions WHERE id = ?1').bind(qid).first();
    if (!cur) throw new HttpError(404, 'Вопрос не найден');
    const o = questionInput({ category: cur.category, kind: b.type === 'case' ? undefined : cur.kind, ...b }, cur);
    if (cur.exam_id === 0 && !o.category) throw new HttpError(400, 'Укажите категорию вопроса');
    await updateQStmt(env, qid, o, Date.now()).run();
    await audit(env, user, 'question.update', qid, { exam_id: cur.exam_id });
    return json({ question: qOut(await env.DB.prepare('SELECT * FROM questions WHERE id = ?1').bind(qid).first()) });
  }
  const o = questionInput(b, null);
  if (examId) {
    const e = await env.DB.prepare('SELECT id FROM exams WHERE id = ?1').bind(examId).first();
    if (!e) throw new HttpError(404, 'Экзамен не найден');
  } else if (!o.category) throw new HttpError(400, 'Укажите категорию вопроса');
  if (o.position === undefined) { const mx = await env.DB.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM questions WHERE exam_id = ?1').bind(examId).first(); o.position = mx.m + 10; }
  if (o.ext_id) { const dup = await env.DB.prepare('SELECT id FROM questions WHERE exam_id = ?1 AND ext_id = ?2').bind(examId, o.ext_id).first(); if (dup) throw new HttpError(400, `Вопрос с ext_id «${o.ext_id}» уже есть (#${dup.id})`); }
  const r = await insertQStmt(env, examId, o, Date.now()).run();
  const id = r.meta.last_row_id;
  await audit(env, user, 'question.create', id, { exam_id: examId });
  return json({ question: qOut(await env.DB.prepare('SELECT * FROM questions WHERE id = ?1').bind(id).first()) });
}
async function deleteQuestion(env, user, qid) {
  const cur = await env.DB.prepare('SELECT id, exam_id FROM questions WHERE id = ?1').bind(qid).first();
  if (!cur) throw new HttpError(404, 'Вопрос не найден');
  await env.DB.prepare('DELETE FROM questions WHERE id = ?1').bind(qid).run();
  await audit(env, user, 'question.delete', qid, { exam_id: cur.exam_id });
  return json({ ok: true });
}
// Тестовый просмотр вопроса глазами кандидата (админ): публичная форма + проверка ответа.
async function tryQuestion(request, env, qid) {
  const q = await env.DB.prepare('SELECT * FROM questions WHERE id = ?1').bind(qid).first();
  if (!q) throw new HttpError(404, 'Вопрос не найден');
  const b = await readJson(request);
  const st = b.state !== undefined ? b.state : makeState(q, true);
  const out = { state: st, question: publicQuestion(q, st) };
  if (b.answer !== undefined) {
    const v = validateAnswer(q, st, b.answer);
    out.grade = gradeAnswer(q, st, v);
    Object.assign(out, describeQA(q, st, v));
  }
  return json(out);
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
  const { results: atts0 } = await env.DB.prepare('SELECT a.*, e.title AS exam_title FROM attempts a LEFT JOIN exams e ON e.id = a.exam_id WHERE a.user_id = ?1 ORDER BY a.id DESC').bind(id).all();
  const atts = await attemptTitles(env, atts0);
  return json({ user: publicUser({ ...u, super: isSuper(env, u.id), role: isSuper(env, u.id) ? 'admin' : u.role }), lectures: lec,
    attempts: atts.map(a => ({ id: a.id, exam_id: a.exam_id, reatt: a.reatt || null, exam_title: a.exam_title, status: a.status, started_at: a.started_at, submitted_at: a.submitted_at, score_pct: a.score_pct, expired: !!a.expired })) });
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
    env.DB.prepare(`DELETE FROM uploads WHERE attempt_id IN (SELECT id FROM attempts WHERE user_id = ?1${w})`).bind(...binds),
    env.DB.prepare(`DELETE FROM attempts WHERE user_id = ?1${w}`).bind(...binds),
  ]);
  await audit(env, actor, 'user.reset_attempts', id, { exam_id: eid });
  return adminUser(env, id);
}

async function adminAttempts(env, url) {
  const status = url.searchParams.get('status') || '';
  const kind = url.searchParams.get('kind') || '';
  if (status && !['in_progress', 'pending_review', 'passed', 'failed'].includes(status)) throw new HttpError(400, 'Некорректный статус');
  const kw = kind === 'reatt' ? ' AND a.reatt IS NOT NULL' : kind === 'exam' ? ' AND a.reatt IS NULL' : (REATT_VERSIONS.includes(kind) ? ` AND a.reatt = '${kind}'` : '');
  const { results } = await env.DB.prepare(`SELECT a.id, a.exam_id, a.reatt, e.title AS exam_title, a.user_id, u.username, u.global_name, u.ic_name, u.static_id, a.status, a.started_at, a.submitted_at, a.score_pct, a.expired, a.reviewer_id, a.reviewed_at
    FROM attempts a LEFT JOIN exams e ON e.id = a.exam_id LEFT JOIN users u ON u.id = a.user_id WHERE (?1 = '' OR a.status = ?1)${kw} ORDER BY a.id DESC LIMIT 500`).bind(status).all();
  return json({ attempts: await attemptTitles(env, results) });
}
async function adminAttempt(env, id) {
  let a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(id).first();
  if (!a) throw new HttpError(404, 'Попытка не найдена');
  if (await finalizeIfExpired(env, a)) a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(id).first();
  const ctx = await attemptCtx(env, a);
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(a.user_id).first();
  const rv = a.reviewer_id ? await env.DB.prepare('SELECT id, username, global_name FROM users WHERE id = ?1').bind(a.reviewer_id).first() : null;
  const order = parseJ(a.q_order, []), states = parseJ(a.opt_order, {});
  const qs = await loadQs(env, order);
  const qm = new Map(qs.map(q => [q.id, q]));
  const { results: ans } = await env.DB.prepare('SELECT * FROM answers WHERE attempt_id = ?1').bind(id).all();
  const am = new Map(ans.map(x => [x.question_id, x]));
  const { results: ups } = await env.DB.prepare('SELECT id, question_id, kind, name, mime, size FROM uploads WHERE attempt_id = ?1').bind(id).all();
  const meta = parseJ(a.meta, {});
  const groupOf = new Map(); for (const g of meta.groups || []) { for (const x of g.q || []) groupOf.set(x, g.label); for (const x of g.c || []) groupOf.set(x, g.label); }
  const items = order.map(qid => {
    const q = qm.get(qid); const x = am.get(qid);
    const v = x ? parseJ(x.answer, null) : null;
    if (!q) return { question: { id: qid, text: '(вопрос удалён)', type: 'long', points: 0, options: [], correct: [], native: {} }, answer: v, auto_points: x ? x.auto_points : null, manual_points: x ? x.manual_points : null, needs_review: !!(x && x.needs_review) };
    const st = stateFor(q, states);
    return { question: qOut(q), public: publicQuestion(q, st), group: groupOf.get(qid) || null, answer: v, ...describeQA(q, st, v),
      upload: v && v.upload_id ? ups.find(u => u.id === v.upload_id) || null : null,
      auto_points: x ? x.auto_points : null, manual_points: x ? x.manual_points : null, needs_review: !!(x && x.needs_review) };
  });
  // сводка по блокам переаттестации
  let groups = null;
  if (meta.groups) groups = meta.groups.map(g => {
    let got = 0, max = 0, pending = 0;
    for (const qid of (g.q || []).concat(g.c || [])) { const it = items.find(i => i.question.id === qid); if (!it) continue; max += it.question.points; const p = it.manual_points ?? it.auto_points; if (p == null && it.needs_review) pending++; else got += p || 0; }
    return { label: g.label, questions: (g.q || []).length, cases: (g.c || []).length, short_q: g.short_q || 0, short_c: g.short_c || 0, points: Math.round(got * 100) / 100, max, pending };
  });
  return json({ attempt: { ...a, q_order: undefined, opt_order: undefined, meta: undefined }, exam: ctxPublic(ctx), groups, user: u ? publicUser({ ...u, super: isSuper(env, u.id) }) : null, reviewer: rv, items });
}
async function reviewAttempt(request, env, actor, id) {
  const b = await readJson(request);
  const a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(id).first();
  if (!a) throw new HttpError(404, 'Попытка не найдена');
  if (a.status === 'in_progress') throw new HttpError(409, 'Попытка ещё не завершена кандидатом');
  const ctx = await attemptCtx(env, a);
  const qs = await loadQs(env, parseJ(a.q_order, []));
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
  if (verdict === 'auto' && missing) throw new HttpError(400, 'Оцените все ответы, требующие ручной проверки, или выберите итог вручную');
  const comment = str(b.comment, 5000, { name: 'комментарий' });
  const total = auto + manual;
  const pct = a.max_score ? Math.round(total / a.max_score * 1000) / 10 : 0;
  const status = verdict === 'auto' ? (pct >= ctx.pass_pct ? 'passed' : 'failed') : verdict;
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
    env.DB.prepare('DELETE FROM uploads WHERE attempt_id = ?1').bind(id),
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
    bank_questions: await one(`SELECT COUNT(*) AS c FROM questions WHERE exam_id = 0 AND kind = 'question'`),
    bank_cases: await one(`SELECT COUNT(*) AS c FROM questions WHERE exam_id = 0 AND kind = 'case'`),
    reatt_pending: await one(`SELECT COUNT(*) AS c FROM attempts WHERE status = 'pending_review' AND reatt IS NOT NULL`),
    reatt_total: await one(`SELECT COUNT(*) AS c FROM attempts WHERE reatt IS NOT NULL`),
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
  if ((m = /^\/api\/attempts\/(\d+)\/upload$/.exec(p)) && M === 'POST') return uploadAnswerFile(request, env, user, idParam(m[1]));
  if ((m = /^\/api\/uploads\/(\d+)$/.exec(p)) && M === 'GET') return getUpload(env, user, idParam(m[1]));
  if (p === '/api/reatt' && M === 'GET') return listReatt(env, user);
  if ((m = /^\/api\/reatt\/(full|simple)\/start$/.exec(p)) && M === 'POST') return startReatt(env, user, m[1]);

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
    if ((m = /^\/api\/admin\/exams\/(\d+)\/import$/.exec(p)) && M === 'POST') { A(); const eid = idParam(m[1]); if (!(await env.DB.prepare('SELECT id FROM exams WHERE id = ?1').bind(eid).first())) throw new HttpError(404, 'Экзамен не найден'); return importQuestions(request, env, user, eid); }
    if ((m = /^\/api\/admin\/exams\/(\d+)\/export$/.exec(p)) && M === 'GET') { A(); return exportQuestions(env, idParam(m[1]), url); }
    if ((m = /^\/api\/admin\/questions\/(\d+)\/try$/.exec(p)) && M === 'POST') { A(); return tryQuestion(request, env, idParam(m[1])); }
    // банк вопросов
    if (p === '/api/admin/bank' && M === 'GET') { A(); return adminBank(env, url); }
    if (p === '/api/admin/bank' && M === 'POST') { A(); return saveQuestion(request, env, user, 0, null); }
    if (p === '/api/admin/bank/import' && M === 'POST') { A(); return importQuestions(request, env, user, 0); }
    if (p === '/api/admin/bank/export' && M === 'GET') { A(); return exportQuestions(env, 0, url); }
    if (p === '/api/admin/bank/delete-examples' && M === 'POST') { A(); return deleteExamples(request, env, user); }
    // переаттестация
    if (p === '/api/admin/reatt' && M === 'GET') { A(); return adminReatt(env); }
    if (p === '/api/admin/reatt' && M === 'PUT') { A(); return putReattConfig(request, env, user); }
    if ((m = /^\/api\/admin\/reatt\/(full|simple)\/preview$/.exec(p)) && M === 'POST') { A(); return previewReatt(env, m[1]); }
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
