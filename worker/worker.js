// ГУ ВП — портал. API (Cloudflare Worker + D1).
// Без внешних npm-зависимостей. См. README.md.
import { assertLawWrite, parseLawReport, lawOverview, lawHistory, lawProposal, lawDocument, ingestLawReport, decideProposal, acknowledgeFlag } from './laws.js';

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

// Иерархия: главный администратор (ADMIN_IDS) > администратор сайта (admin) > руководство (СС) (manager) > проверяющий (examiner) и роли-флаги.
const ROLES = ['candidate', 'examiner', 'manager', 'admin'];
const ROLE_LVL = { candidate: 0, examiner: 1, manager: 2, admin: 3 };

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
  const s = { site_title: 'ГУ ВП — портал', welcome_text: '', sequential_lectures: '1', promo_missing_points: '1' };
  for (const r of results) s[r.k] = r.v;
  // promo_missing_points — заменять ли недостающий пункт ступени лишними баллами (система повышения)
  return { site_title: s.site_title, welcome_text: s.welcome_text, sequential_lectures: s.sequential_lectures === '1', promo_missing_points: s.promo_missing_points !== '0' };
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
  if ((ROLE_LVL[user.role] ?? 0) < ROLE_LVL[role]) throw new HttpError(403, 'Недостаточно прав');
}
// Роли доступа (можно несколько): «ВП» (users.vp) — учебный отдел, отчёты, премирование, система повышения;
// «Переаттестация» (users.reatt); «Проверяющий» / «Администратор» (users.role); «Руководство ГУ ВП» (users.leader).
// Администратор видит все разделы; главные администраторы (ADMIN_IDS) — всё. Без ролей — только База данных и профиль.
// «Личные дела» — только старший состав (caps.ss).
function caps(u) {
  const admin = u.role === 'admin' || !!u.super;
  // «Руководство (СС)»: выдаёт роли ниже своего уровня, видит отчёты и работы, проверяет; правки сайта — нет
  const manager = u.role === 'manager';
  const lead = !!u.leader || admin || manager;
  // ss — старший состав ГУ ВП: «Руководство ГУ ВП», администраторы и отметка «Старший состав» в составе (users.senior)
  return { vp: !!u.vp || admin || manager, reatt: !!u.reatt || admin || manager, examiner: admin || manager || u.role === 'examiner', admin, manager: manager || admin, grant: admin || manager, lead, ss: lead || !!u.senior, super: !!u.super };
}
const CAP_MSG = { grant: 'Выдавать роли и доступы могут администратор сайта и руководство (СС)', manager: 'Доступно руководству (СС) и администраторам', vp: 'Раздел доступен роли «ВП». Роль назначает администратор.', reatt: 'Раздел доступен роли «Переаттестация». Роль назначает администратор.',
  examiner: 'Раздел доступен проверяющим и администраторам', ss: 'Личные дела доступны только старшему составу ГУ ВП', admin: 'Только для администраторов', lead: 'Раздел доступен роли «Руководство ГУ ВП» и администраторам' };
function requireCap(user, cap) { if (!caps(user)[cap]) throw new HttpError(403, CAP_MSG[cap] || 'Недостаточно прав'); }
function publicUser(u) {
  return {
    id: u.id, username: u.username, global_name: u.global_name, avatar: u.avatar,
    avatar_url: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null,
    ic_name: u.ic_name || '', static_id: u.static_id || '', rank: u.rank || '',
    role: u.role, super: !!u.super, blocked: !!u.blocked,
    leader: !!u.leader, staff: !!u.staff, senior: !!u.senior, staff_position: u.staff_position || '',
    vp: !!u.vp, reatt: !!u.reatt, position: u.position || '', caps: caps(u),
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
  // лекции скрытых (неопубликованных) курсов кандидатам не показываются; лекции без курса — общий раздел
  const { results: lectures } = await env.DB.prepare(`SELECT l.id, l.title, l.description, l.video_url, l.duration_sec, l.position, l.required, l.published, l.course_id, l.created_at, l.updated_at, (l.body != '') AS has_body, l.topic_id FROM lectures l LEFT JOIN courses c ON c.id = l.course_id LEFT JOIN topics t ON t.id = l.topic_id
    WHERE l.published = 1 AND (l.course_id IS NULL OR c.id IS NULL OR c.published = 1) AND (l.topic_id IS NULL OR t.id IS NULL OR t.published = 1) ORDER BY l.position, l.id`).all();
  const { results: trows } = await env.DB.prepare('SELECT * FROM topics ORDER BY position, id').all();
  const topics = new Map(trows.map(t => [t.id, t]));
  const { results: prog } = await env.DB.prepare('SELECT * FROM lecture_progress WHERE user_id = ?1').bind(userId).all();
  const pm = new Map(prog.map(p => [p.lecture_id, p]));
  const blocked = new Set(); // «строго по порядку» — внутри каждой темы (лекции без темы — внутри курса)
  const out = [];
  for (const l of lectures) {
    const p = pm.get(l.id);
    const ck = l.topic_id && topics.has(l.topic_id) ? 't' + l.topic_id : 'c' + (l.course_id || 0);
    let status = 'not_started';
    if (p && p.completed_at) status = 'watched';
    else if (p && (p.max_pos > 0 || p.watched_sec > 0)) status = 'in_progress';
    const locked = settings.sequential_lectures && blocked.has(ck) && status !== 'watched';
    if (locked) status = 'locked';
    out.push({ lecture: l, progress: p || null, status, locked });
    if (l.required && !(p && p.completed_at)) blocked.add(ck);
  }
  const allRequiredDone = lectures.filter(l => l.required).every(l => { const p = pm.get(l.id); return p && p.completed_at; });
  return { items: out, allRequiredDone, sequential: settings.sequential_lectures, topics };
}
// Темы: «связанная» тема (link_topic_id) показывает лекции, выгрузку и видео исходной темы — прохождение общее (напр. «Основы ГУ ВП» в «Стажёр ВП»).
function topicRoot(tmap, id) { const t = tmap.get(id); return t && t.link_topic_id && tmap.has(t.link_topic_id) ? t.link_topic_id : id; }
function examTopicIds(e) { const v = parseJ(e.topic_ids, []); return Array.isArray(v) ? v.filter(x => Number.isInteger(x)) : []; }
function topicProgress(st, rootId) {
  const items = st.items.filter(i => i.lecture.topic_id === rootId);
  const req = items.filter(i => i.lecture.required);
  const done = req.filter(i => i.progress && i.progress.completed_at).length;
  return { items, total: items.length, required_total: req.length, required_done: done, done: items.length > 0 && done === req.length };
}
// Какие лекции нужны для допуска к конкретному экзамену.
//   mode: 'none' — лекции не нужны; 'all' — все опубликованные обязательные (как раньше); 'selected' — выбранные админом.
// Неопубликованные и удалённые лекции из выбранных не учитываются.
// Порядок «строго по порядку» на допуск к экзамену не влияет — он ограничивает только очерёдность просмотра лекций.
function examMode(e) { return !e.requires_lectures ? 'none' : (e.lecture_mode === 'selected' ? 'selected' : e.lecture_mode === 'topics' ? 'topics' : 'all'); }
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
  if (mode === 'all') items = st.items.filter(i => i.lecture.required && (!exam.course_id || i.lecture.course_id === exam.course_id)); // экзамен курса — обязательные лекции своего курса
  else if (mode === 'selected') { const ids = new Set(links.get(exam.id) || []); items = st.items.filter(i => ids.has(i.lecture.id)); }
  else if (mode === 'topics') { const tids = new Set(examTopicIds(exam).map(id => topicRoot(st.topics, id))); items = st.items.filter(i => i.lecture.required && tids.has(i.lecture.topic_id)); }
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
    position: l.position, status: it.status, locked: it.locked, course_id: l.course_id || null, topic_id: l.topic_id || null,
    progress: p ? { max_pos: p.max_pos, last_pos: p.last_pos, watched_sec: Math.round(p.watched_sec), completed_at: p.completed_at } : null,
  };
  o.kind = !l.video_url && (l.has_body || l.body) ? 'text' : 'video';
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
  const o = lectureOut(it, true);
  if (it.lecture.has_body) o.body = (await env.DB.prepare('SELECT body FROM lectures WHERE id = ?1').bind(id).first()).body;
  return json({ lecture: o });
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
  return { id: e.id, course_id: e.course_id || null, topic_ids: examTopicIds(e), title: e.title, description: e.description, time_limit_min: e.time_limit_min, max_attempts: e.max_attempts,
    cooldown_min: e.cooldown_min, pass_pct: e.pass_pct, requires_lectures: !!e.requires_lectures, from_bank: e.bank_count > 0 && !!e.bank_category };
}
// Сколько вопросов будет в попытке: для экзамена из банка — bank_count (не больше, чем позволяют topic), иначе — вопросы экзамена.
async function examQCount(env, e, own) {
  if (!(e.bank_count > 0 && e.bank_category)) return own;
  const cats = String(e.bank_category).split(',').map(x => x.trim()).filter(Boolean);
  const pool = (await bankIndex(env)).filter(q => (q.kind || 'question') === 'question' && cats.some(p => catMatch(p, q.category)));
  return Math.min(e.bank_count, distinctCapacity(pool));
}
async function listExams(env, user) {
  const st = await lectureStates(env, user.id);
  const links = await examLinks(env);
  const results = await visibleExams(env);
  const out = [];
  for (const e of results) {
    const qc = await env.DB.prepare('SELECT COUNT(*) AS c FROM questions WHERE exam_id = ?1').bind(e.id).first();
    out.push({ ...examPublic(e), question_count: await examQCount(env, e, qc.c), ...(await examAvailability(env, user, e, examRequirement(e, st, links))) });
  }
  return json({ exams: out, all_required_done: st.allRequiredDone, sequential_lectures: st.sequential });
}
// Проверка лекций для конкретного экзамена (используется при открытии, старте и отправке).
async function examReqFor(env, user, exam) {
  const st = await lectureStates(env, user.id);
  return examRequirement(exam, st, await examLinks(env, exam.id));
}
async function visibleExams(env) {
  const { results } = await env.DB.prepare(`SELECT e.* FROM exams e LEFT JOIN courses c ON c.id = e.course_id
    WHERE e.published = 1 AND (e.course_id IS NULL OR c.id IS NULL OR c.published = 1) ORDER BY e.position, e.id`).all();
  return results;
}
// Учебный отдел: курсы (курс → лекции по порядку → экзамен курса). Лекции/экзамены без курса — в разделе «Без курса».
async function listCourses(env, user) {
  const st = await lectureStates(env, user.id);
  const links = await examLinks(env);
  const { results: courses } = await env.DB.prepare('SELECT * FROM courses WHERE published = 1 ORDER BY position, id').all();
  const exams = await visibleExams(env);
  const { results: qc } = await env.DB.prepare('SELECT exam_id, COUNT(*) AS c FROM questions WHERE exam_id > 0 GROUP BY exam_id').all();
  const qm = new Map(qc.map(r => [r.exam_id, r.c]));
  const known = new Set(courses.map(c => c.id));
  const groups = courses.map(c => ({ id: c.id, title: c.title, description: c.description || '', subtitle: c.subtitle || '', track: c.track || 'rank', position: c.position, lectures: [], exams: [], topics: [] }));
  const other = { id: 0, title: 'Без курса', description: '', subtitle: '', track: 'rank', lectures: [], exams: [], topics: [] };
  const gm = new Map(groups.map(g => [g.id, g]));
  for (const it of st.items) (known.has(it.lecture.course_id) ? gm.get(it.lecture.course_id) : other).lectures.push(lectureOut(it, false));
  for (const e of exams) {
    const x = { ...examPublic(e), question_count: await examQCount(env, e, qm.get(e.id) || 0), ...(await examAvailability(env, user, e, examRequirement(e, st, links))) };
    (known.has(e.course_id) ? gm.get(e.course_id) : other).exams.push(x);
  }
  const allEx = groups.flatMap(g => g.exams);
  for (const t of st.topics.values()) {
    if (!t.published || !gm.has(t.course_id)) continue;
    const root = topicRoot(st.topics, t.id), rt = st.topics.get(root), tp = topicProgress(st, root);
    const ex = allEx.filter(e => e.topic_ids.includes(t.id) || e.topic_ids.includes(root));
    gm.get(t.course_id).topics.push({ id: t.id, title: t.title, description: t.description || '', status: t.status, position: t.position, linked: root !== t.id ? { id: root, title: rt.title } : null,
      lectures_total: tp.total, required_total: tp.required_total, required_done: tp.required_done, done: tp.done, has_material: !!rt.doc_id, has_video: !!(rt.video_url || rt.video_plan),
      exam_ids: ex.map(e => e.id), exam_passed: ex.length > 0 && ex.every(e => e.attempts.some(a => a.status === 'passed')) });
  }
  const out = [...groups, other].filter(g => g.id || g.lectures.length || g.exams.length).map(g => {
    const req = g.lectures.filter(l => l.required);
    const done = req.filter(l => l.status === 'watched').length;
    const topicsDone = g.topics.filter(t => t.status !== 'placeholder').every(t => t.done || !t.required_total);
    return { ...g, lectures_total: g.lectures.length, required_total: req.length, required_done: done, watched: g.lectures.filter(l => l.status === 'watched').length,
      topics_total: g.topics.length, topics_done: g.topics.filter(t => t.done).length,
      exam_passed: g.exams.some(e => e.attempts.some(a => a.status === 'passed')),
      complete: (g.topics.length ? topicsDone && g.topics.some(t => t.done) : done === req.length) && g.exams.every(e => e.attempts.some(a => a.status === 'passed')) };
  });
  return json({ courses: out, sequential_lectures: st.sequential });
}
// Тема: лекции по порядку → полная выгрузка (статья Базы данных, открывается после всех лекций) → видео (тоже после лекций) → экзамены темы.
async function getTopic(env, user, id) {
  const admin = caps(user).admin;
  const st = await lectureStates(env, user.id);
  const t = st.topics.get(id);
  if (!t || (!t.published && !admin)) throw new HttpError(404, 'Тема не найдена');
  const c = await env.DB.prepare('SELECT * FROM courses WHERE id = ?1').bind(t.course_id).first();
  if (!c || (!c.published && !admin)) throw new HttpError(404, 'Тема не найдена');
  const root = topicRoot(st.topics, id), rt = st.topics.get(root), tp = topicProgress(st, root);
  const open = tp.done || admin;
  let material = null;
  if (rt.doc_id) { const d = await env.DB.prepare('SELECT id, title FROM docs WHERE id = ?1 AND deleted_at IS NULL').bind(rt.doc_id).first(); if (d) material = open ? { doc_id: d.id, title: d.title } : { locked: true, title: d.title }; }
  let video = null;
  if (rt.video_url) video = open ? { url: rt.video_url, ...videoInfo(rt.video_url) } : { locked: true };
  else if (rt.video_plan) video = { planned: true };
  const links = await examLinks(env);
  const exams = [];
  for (const e of await visibleExams(env)) {
    const ids = examTopicIds(e); if (!ids.includes(id) && !ids.includes(root)) continue;
    const qc = await env.DB.prepare('SELECT COUNT(*) AS c FROM questions WHERE exam_id = ?1').bind(e.id).first();
    exams.push({ ...examPublic(e), topic_titles: ids.map(x => st.topics.get(x)).filter(Boolean).map(x => x.title), question_count: await examQCount(env, e, qc.c), ...(await examAvailability(env, user, e, examRequirement(e, st, links))) });
  }
  const siblings = [...st.topics.values()].filter(x => x.course_id === t.course_id && (x.published || admin)).map(x => ({ id: x.id, title: x.title, status: x.status }));
  return json({ topic: { id: t.id, title: t.title, description: t.description || '', status: t.status, published: !!t.published, linked: root !== id ? { id: root, title: rt.title, course_id: rt.course_id } : null,
      video_plan: admin ? rt.video_plan || '' : undefined },
    course: { id: c.id, title: c.title, track: c.track || 'rank' }, siblings,
    lectures: tp.items.map(i => lectureOut(i, false)), progress: { total: tp.total, required_total: tp.required_total, required_done: tp.required_done, done: tp.done },
    material, video, exams });
}
// Статья-«выгрузка» темы открывается после всех лекций темы (админам — всегда).
async function docGate(env, user, docId) {
  if (caps(user).admin) return null;
  const { results: ts } = await env.DB.prepare('SELECT id, title FROM topics WHERE doc_id = ?1 AND published = 1').bind(docId).all();
  if (!ts.length) return null;
  for (const t of ts) {
    const r = await env.DB.prepare(`SELECT COUNT(*) AS n, SUM(CASE WHEN p.completed_at IS NOT NULL THEN 1 ELSE 0 END) AS d FROM lectures l LEFT JOIN lecture_progress p ON p.lecture_id = l.id AND p.user_id = ?2
      WHERE l.topic_id = ?1 AND l.published = 1 AND l.required = 1`).bind(t.id, user.id).first();
    if (r.n > 0 && r.d === r.n) return null;
  }
  return ts[0].title;
}
async function getExam(env, user, id) {
  const e = (await visibleExams(env)).find(x => x.id === id);
  if (!e) throw new HttpError(404, 'Экзамен не найден');
  const req = await examReqFor(env, user, e);
  const qc = await env.DB.prepare('SELECT COUNT(*) AS c FROM questions WHERE exam_id = ?1').bind(id).first();
  return json({ exam: { ...examPublic(e), question_count: await examQCount(env, e, qc.c), ...(await examAvailability(env, user, e, req)) } });
}
// ---------- движок вопросов (все типы) ----------
// Хранение: questions.options/correct — варианты для single/multi/eliminate (как раньше);
// questions.data (JSON) — всё остальное по типу (в т.ч. правильные ответы). Кандидату уходит только publicQuestion().
// Состояние вопроса в конкретной попытке (перемешивание, параметры) — attempts.opt_order[qid].
const QTYPE_LIST = ['single', 'multi', 'number', 'text', 'param', 'long', 'order', 'match', 'blanks_input', 'blanks_select', 'dictation',
  'eliminate', 'slider', 'file', 'voice', 'info', 'letters', 'words', 'find', 'case', 'hotspot'];
const CHOICE_TYPES = new Set(['single', 'multi', 'eliminate']);
const PARTIAL_TYPES = new Set(['multi', 'order', 'match', 'blanks_input', 'blanks_select', 'dictation', 'find', 'eliminate', 'words', 'hotspot']);
const UPLOAD_HARD_MAX = 1024 * 1024;   // 1 МБ на файл (D1, base64)
const IMPORT_TYPE_ALIASES = { multiple: 'multi', choice: 'single', radio: 'single', checkbox: 'multi', numeric: 'number', input: 'text', short: 'text',
  free: 'long', essay: 'long', sequence: 'order', matching: 'match', fill: 'blanks_input', blanks: 'blanks_input', fill_input: 'blanks_input', fill_select: 'blanks_select',
  select: 'blanks_select', exclude: 'eliminate', elimination: 'eliminate', range: 'slider', upload: 'file', audio: 'voice', information: 'info',
  anagram: 'letters', phrase: 'words', search: 'find', situation: 'case', image_click: 'hotspot', zones: 'hotspot', image_zones: 'hotspot' };
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
    const media = obj.media ? mediaItem(obj.media, `${name} ${i + 1}: изображение`) : null;
    return media ? { id, text, correct, media } : { id, text, correct };
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


// ---------- переаттестации v2: базы вопросов, сложность, источники, изображения ----------
// Каждый вопрос переаттестации принадлежит одной базе (questions.base), имеет сложность 1/2/3 (questions.difficulty)
// и привязку к документу проекта (questions.source_doc — id из SOURCE_DOCS, questions.source_ref — пункт/статья; цитата — data.meta.quote).
const R6_BASES = { cases_int: 'Внутренние кейсы', cases_gen: 'Общие кейсы', simple: 'Упрощённая', medium: 'Средняя', full: 'Полная общая', vp: 'Полная ВП' };
const R6_BASE_ORDER = ['cases_int', 'cases_gen', 'simple', 'medium', 'full', 'vp'];
const DIFF_NAMES = { 1: 'лёгкий', 2: 'средний', 3: 'сложный' };
const DIFF_ALIASES = { '1': 1, '2': 2, '3': 3, easy: 1, basic: 1, 'базовый': 1, 'лёгкий': 1, 'легкий': 1, 'простой': 1, medium: 2, 'средний': 2, hard: 3, 'сложный': 3, 'трудный': 3 };
// Документы, загруженные в проект (тексты — content/reatt6/docs/<id>.md в репозитории сайта). topic — тема для распределения в попытке.
const SOURCE_DOCS = [
  { id: 'vu', short: 'ВУ', topic: 'vu', title: 'Внутренний устав (ВС РФ, сервер)', group: 'internal' },
  { id: 'du', short: 'ДУ', topic: 'du', title: 'Дисциплинарный устав (ред. 27.09.2026)', group: 'internal' },
  { id: 'kps', short: 'КПС', topic: 'kps', title: 'Устав караульной и патрульной службы', group: 'internal' },
  { id: 'su', short: 'СУ', topic: 'su', title: 'Строевой устав', group: 'internal' },
  { id: 'pk', short: 'ПК', topic: 'pk', title: 'Процессуальный кодекс', group: 'law' },
  { id: 'uk', short: 'УК', topic: 'uk', title: 'Уголовный кодекс', group: 'law' },
  { id: 'koap', short: 'КоАП', topic: 'koap', title: 'Кодекс об административных правонарушениях', group: 'law' },
  { id: 'tk', short: 'ТК', topic: 'tk', title: 'Трудовой кодекс', group: 'law' },
  { id: 'fz_oborona', short: 'ФЗ «Об обороне»', topic: 'fz', title: 'Федеральный закон «Об обороне»', group: 'law' },
  { id: 'fz_oruzhie', short: 'ФЗ «Об оружии»', topic: 'fz', title: 'Федеральный закон «Об оружии»', group: 'law' },
  { id: 'fz_territorii', short: 'ФЗ о закрытых и охраняемых территориях', topic: 'fz', title: 'Федеральный закон о закрытых и охраняемых территориях', group: 'law' },
  { id: 'fz_gostayna', short: 'ФЗ «О государственной тайне»', topic: 'fz', title: 'Федеральный закон «О государственной тайне»', group: 'law' },
  { id: 'fz_gossluzhba', short: 'ФЗ о госслужбе', topic: 'fz', title: 'Федеральный закон о государственной службе', group: 'law' },
  { id: 'fz_vozduh', short: 'ФЗ о воздушном пространстве', topic: 'fz', title: 'Федеральный закон об использовании воздушного пространства', group: 'law' },
  { id: 'fkz_rezhimy', short: 'ФКЗ об особых правовых режимах', topic: 'fkz', title: 'Федеральный конституционный закон об особых правовых режимах', group: 'law' },
  { id: 'upk', short: 'УПК', topic: 'upk', title: 'Уголовно-процессуальный кодекс', group: 'law' },
];
const SOURCE_DOC_MAP = new Map(SOURCE_DOCS.map(d => [d.id, d]));
const R6_TOPICS = { vu: 'ВУ', du: 'ДУ', kps: 'КПС', su: 'СУ', pk: 'ПК', uk: 'УК', koap: 'КоАП', tk: 'ТК', fz: 'ФЗ', fkz: 'ФКЗ', upk: 'УПК' };
function docTopic(id) { const d = SOURCE_DOC_MAP.get(id); return d ? d.topic : (id || '—'); }
function diffInput(v, strict) {
  if (v === undefined || v === null || v === '') return null;
  const n = DIFF_ALIASES[String(v).trim().toLowerCase()];
  if (!n) { if (strict) throw new HttpError(400, 'Сложность: 1 (лёгкий), 2 (средний) или 3 (сложный)'); return null; }
  return n;
}
const MEDIA_KEY_RE = /^[A-Za-z0-9_-]{16,48}$/;
const MEDIA_MIMES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
// SVG-схемы хранятся в вопросе и вставляются в страницу: всё, что может исполнять код или ходить во внешнюю сеть, отклоняется.
function sanitizeSvg(src) {
  const s = String(src || '').trim();
  if (!/^<svg[\s>]/i.test(s) || !/<\/svg>$/i.test(s)) throw new HttpError(400, 'Схема: ожидается разметка <svg>…</svg>');
  if (s.length > 200000) throw new HttpError(400, 'Схема слишком большая (макс. 200 000 символов)');
  if (/<\s*(script|foreignobject|iframe|object|embed|image|a|animate\w*|set|style|link|meta)\b/i.test(s) || /\son[a-z]+\s*=/i.test(s) || /<!(entity|doctype)/i.test(s)
    || /(?:xlink:)?href\s*=\s*["']\s*[^#"'\s]/i.test(s) || /url\s*\(\s*['"]?\s*(?!#)/i.test(s) || /javascript:/i.test(s))
    throw new HttpError(400, 'Схема: недопустимые элементы (скрипты, обработчики событий, ссылки, внешние ресурсы, <image>, <style>)');
  return s;
}
function mediaItem(x, name) {
  if (x === undefined || x === null || x === '') return null;
  if (typeof x === 'string') x = /^\s*</.test(x) ? { svg: x } : { m: x };
  if (typeof x !== 'object' || Array.isArray(x)) throw new HttpError(400, `${name}: некорректное изображение`);
  const out = {};
  const key = x.m || x.media || x.key;
  if (key) { const k = String(key).trim().replace(/^.*\/media\//, ''); if (!MEDIA_KEY_RE.test(k)) throw new HttpError(400, `${name}: некорректный ключ изображения`); out.m = k; }
  else if (x.svg) out.svg = sanitizeSvg(x.svg);
  else throw new HttpError(400, `${name}: нужен ключ загруженного изображения или SVG-схема`);
  const alt = str(x.alt || x.caption || '', 300, { name: 'подпись изображения' }); if (alt) out.alt = alt;
  return out;
}
function mediaList(v, name, max = 6) {
  if (v === undefined || v === null || v === '') return [];
  const arr = Array.isArray(v) ? v : [v];
  if (arr.length > max) throw new HttpError(400, `${name}: не больше ${max}`);
  return arr.map((x, i) => mediaItem(x, `${name} ${i + 1}`)).filter(Boolean);
}
// Зоны изображения: [{x,y,w,h,label,correct}] в процентах или строки «x, y, w, h | подпись | *» (* — правильная зона).
function zoneList(v, prev) {
  let arr = v;
  if (typeof v === 'string') arr = v.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const [geo, label, mark] = l.split('|').map(x => (x || '').trim());
    const [x, y, w, h] = geo.split(/[,;\s]+/).filter(Boolean);
    return { x, y, w, h, label, correct: mark === '*' || /^(да|верно|correct|true|1)$/i.test(mark || '') };
  });
  if (!Array.isArray(arr) || arr.length < 2 || arr.length > 30) throw new HttpError(400, 'Зоны на изображении: от 2 до 30');
  const seen = new Set();
  const zs = arr.map((z, i) => {
    const n = (k, min, max) => reqNum(z && z[k], `зона ${i + 1}: ${k}`, { min, max });
    const o = { x: n('x', 0, 100), y: n('y', 0, 100), w: n('w', 0.5, 100), h: n('h', 0.5, 100) };
    if (o.x + o.w > 100.01 || o.y + o.h > 100.01) throw new HttpError(400, `Зона ${i + 1} выходит за край изображения`);
    o.label = str(z.label, 300, { required: true, name: `подпись зоны ${i + 1}` });
    o.id = z && typeof z.id === 'string' && /^[a-z0-9]{1,16}$/i.test(z.id) && !seen.has(z.id) ? (seen.add(z.id), z.id) : reuseId(o.label, prev, seen);
    o.correct = !!(z.correct === true || z.correct === 1 || z.correct === '1' || z.correct === 'true');
    return o;
  });
  if (!zs.some(z => z.correct)) throw new HttpError(400, 'Отметьте хотя бы одну правильную зону');
  return zs;
}

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
  const material = str(b.material, 20000, { name: 'фрагмент документа' }); if (material) data.material = material;
  const media = mediaList(b.media !== undefined ? b.media : (b.image !== undefined ? b.image : b.svg), 'изображение'); if (media.length) data.media = media;
  const o = { type, text, reference: str(b.reference !== undefined ? b.reference : b.reference_answer, 10000, { name: 'эталонный ответ' }) };
  switch (type) {
    case 'single': case 'multi': case 'eliminate': {
      const opts = optList(b.options, b.correct_index !== undefined ? b.correct_index : (Array.isArray(b.correct) && b.correct.every(x => typeof x === 'number') ? b.correct : (typeof b.correct === 'number' ? [b.correct] : null)), 'вариант', pd._options);
      if (opts.length < 2 || opts.length > 20) throw new HttpError(400, 'Нужно от 2 до 20 вариантов ответа');
      correct = opts.filter(x => x.correct).map(x => x.id); options = opts.map(({ id, text, media }) => (media ? { id, text, media } : { id, text }));
      if (type !== 'multi' && correct.length !== 1) throw new HttpError(400, type === 'single' ? 'В вопросе с одним ответом должен быть ровно один правильный вариант' : 'В «Последовательном исключении» должен быть ровно один правильный вариант (он должен остаться последним)');
      if (type === 'multi' && correct.length < 1) throw new HttpError(400, 'Отметьте хотя бы один правильный вариант');
      if (type === 'eliminate' && opts.length < 3) throw new HttpError(400, 'Для последовательного исключения нужно минимум 3 варианта');
      break;
    }
    case 'number': {
      data.answer = reqNum(b.answer, 'правильный ответ');
      data.tolerance = reqNum(b.tolerance, 'допуск', { min: 0, def: 0 });
      data.unit = str(b.unit, 40, { name: 'единица' });
      if (b.answer_max !== undefined && b.answer_max !== null && b.answer_max !== '') { data.answer_max = reqNum(b.answer_max, 'верхняя граница диапазона'); if (data.answer_max < data.answer) throw new HttpError(400, 'Диапазон: верхняя граница меньше нижней'); }
      break;
    }
    case 'hotspot': {
      if (!data.media || !data.media.length) throw new HttpError(400, 'Вопрос по изображению: загрузите изображение или вставьте SVG-схему');
      data.zones = zoneList(b.zones, pd.zones);
      data.show_labels = !!bool(b.show_labels, false);
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
      const seenL = new Set(), seenR = new Set(); const rByText = new Map();
      const prevL = (pd.pairs || []).map(p => p.l), prevR = (pd.pairs || []).map(p => p.r).concat(pd.distractors || []);
      data.pairs = pairs.map((p, i) => {
        const lt = str(p && p.left, 1000, { required: true, name: `левая часть пары ${i + 1}` }), rt = str(p && p.right, 1000, { required: true, name: `правая часть пары ${i + 1}` });
        // одинаковый текст справа у нескольких пар = один и тот же вариант (например, «смягчающее» / «отягчающее»)
        const rk = normText(rt); const rid = rByText.get(rk) || reuseId(rt, prevR, seenR); rByText.set(rk, rid);
        return { l: { id: reuseId(lt, prevL, seenL), text: lt }, r: { id: rid, text: rt } };
      });
      data.distractors = lines(b.distractors, 1000, 'лишние варианты', 20).map(t => String(t.text || t)).filter(t => !rByText.has(normText(t)) && (rByText.set(normText(t), 1), true)).map(t => ({ id: reuseId(t, prevR, seenR), text: t }));
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
  if (PARTIAL_TYPES.has(type)) {
    data.partial = !!bool(b.partial, false);
    if (b.partial_cap !== undefined && b.partial_cap !== null && b.partial_cap !== '') { const c = int(b.partial_cap, 0, 100, 'потолок частичного балла, %', 100); if (c < 100) data.partial_cap = c; }
  }
  o.options = options; o.correct = correct; o.data = data;
  if (type === 'info') o.points = 0;
  else {
    let defPts = 1;
    if (type === 'case') defPts = b.max_score ? Number(b.max_score) : (data.criteria.reduce((s, c) => s + c.points, 0) || 5);
    else if (b.base && diffInput(b.difficulty, false)) defPts = diffInput(b.difficulty, false);
    o.points = int(b.points !== undefined && b.points !== null && b.points !== '' ? Number(b.points) : (b.max_score && type !== 'case' ? Number(b.max_score) : defPts), 0, 1000, 'баллы', 1);
  }
  o.category = str(b.category, 100, { name: 'категория' });
  const kind = b.kind ? str(b.kind, 20, { name: 'вид' }) : (type === 'case' ? 'case' : 'question');
  if (!['question', 'case'].includes(kind)) throw new HttpError(400, 'Вид: question или case');
  o.kind = kind;
  o.easy = 0;   // признак «простой» больше не используется (столбец оставлен для совместимости)
  o.active = bool(b.active, true);
  o.ext_id = b.ext_id !== undefined ? (str(b.ext_id, 100, { name: 'ext_id' }) || null) : (b.id !== undefined && typeof b.id === 'string' ? str(b.id, 100, { name: 'id' }) || null : undefined);
  if (b.position !== undefined) o.position = int(b.position, 0, 1000000, 'порядок', 0);
  if (b.topic !== undefined) { const t = str(b.topic, 100, { name: 'topic (группа вариантов)' }); if (t && !/^[\p{L}\p{N}_.:-]+$/u.test(t)) throw new HttpError(400, 'topic: буквы, цифры, «-», «_», «.», «:» без пробелов'); o.topic = t || null; }
  // переаттестации v2 (undefined — не менять при правке/импорте)
  if (b.base !== undefined) { const v = str(b.base, 30, { name: 'база' }); if (v && !R6_BASES[v]) throw new HttpError(400, 'База: ' + Object.keys(R6_BASES).join(', ')); o.base = v || null; }
  if (b.difficulty !== undefined) o.difficulty = diffInput(b.difficulty, !!(b.base || (prev && prev.base)));
  if (b.source_doc !== undefined) { const v = str(b.source_doc, 40, { name: 'документ' }); if (v && !SOURCE_DOC_MAP.has(v)) throw new HttpError(400, `Документ «${v}» не загружен в проект. Допустимо: ${SOURCE_DOCS.map(d => d.id).join(', ')}`); o.source_doc = v || null; }
  if (b.source_ref !== undefined) o.source_ref = str(b.source_ref, 300, { name: 'пункт / статья' }) || null;
  return o;
}

// Строка таблицы → «родной» JSON-формат (для редактора и экспорта).
function toNative(q) {
  const d = parseJ(q.data, {}); const opts = parseJ(q.options, []); const corr = parseJ(q.correct, []);
  const o = { id: q.id, ext_id: q.ext_id || undefined, type: q.type, category: q.category || '', kind: q.kind || 'question', active: q.active === undefined ? true : !!q.active,
    text: q.text, points: q.points, reference: q.reference || '', topic: q.topic || undefined };
  switch (q.type) {
    case 'single': case 'multi': case 'eliminate': o.options = opts.map(x => ({ id: x.id, text: x.text, correct: corr.includes(x.id), ...(x.media ? { media: x.media } : {}) })); break;
    case 'number': Object.assign(o, { answer: d.answer, tolerance: d.tolerance || 0, unit: d.unit || '' }); if (d.answer_max !== undefined) o.answer_max = d.answer_max; break;
    case 'hotspot': o.zones = (d.zones || []).map(z => ({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h, label: z.label, correct: !!z.correct })); o.show_labels = !!d.show_labels; break;
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
  if (PARTIAL_TYPES.has(q.type)) { o.partial = !!d.partial; if (d.partial_cap !== undefined) o.partial_cap = d.partial_cap; }
  if (d.meta) Object.assign(o, d.meta);
  if (d.material) o.material = d.material;
  if (d.media) o.media = d.media;
  o.base = q.base || ''; o.difficulty = q.difficulty || null; o.source_doc = q.source_doc || ''; o.source_ref = q.source_ref || '';
  return o;
}
function matchRights(d) { const seen = new Set(); return (d.pairs || []).map(p => p.r).concat(d.distractors || []).filter(x => x && !seen.has(x.id) && (seen.add(x.id), true)); }
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
    case 'match': { const l = ids((d.pairs || []).map(p => p.l)); return { l: shuffleOpts ? shuffle(l) : l, r: shuffle(ids(matchRights(d))) }; }
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
// Источник вопроса для кандидата: название документа; withRef — ещё пункт/статья (только в разборе после отправки).
function sourceInfo(q, withRef) {
  if (!q.source_doc) return null;
  const d = SOURCE_DOC_MAP.get(q.source_doc);
  const o = { doc: q.source_doc, title: d ? d.title : q.source_doc, short: d ? d.short : q.source_doc };
  if (withRef && q.source_ref) o.ref = q.source_ref;
  return o;
}
// Что видит кандидат. Никаких правильных ответов.
function publicQuestion(q, st) {
  const d = parseJ(q.data, {});
  const o = { id: q.id, type: q.type, text: q.text, points: q.points, kind: q.kind || 'question', category: q.category || '' };
  if (d.material) o.material = d.material;
  if (d.media && d.media.length) o.media = d.media;
  if (q.difficulty) o.difficulty = q.difficulty;
  const src = sourceInfo(q, false); if (src) o.source = src;   // документ-источник (без номера пункта — он показывается в разборе)
  switch (q.type) {
    case 'single': case 'multi': case 'eliminate': o.options = orderBy(parseJ(q.options, []), Array.isArray(st) ? st : []).map(x => (x.media ? { id: x.id, text: x.text, media: x.media } : { id: x.id, text: x.text })); break;
    case 'number': o.unit = d.unit || ''; break;
    case 'hotspot': o.zones = (d.zones || []).map((z, i) => ({ id: z.id, x: z.x, y: z.y, w: z.w, h: z.h, label: d.show_labels ? z.label : String(i + 1) })); o.multi = (d.zones || []).filter(z => z.correct).length > 1; break;
    case 'slider': Object.assign(o, { min: d.min, max: d.max, step: d.step, unit: d.unit || '' }); break;
    case 'param': { const p = (st && st.p) || genParams(d.vars); o.text = renderTemplate(q.text, p); o.unit = d.unit || ''; break; }
    case 'order': o.items = orderBy(d.items || [], st && st.o).map(x => ({ id: x.id, text: x.text })); break;
    case 'match': o.left = orderBy((d.pairs || []).map(p => p.l), st && st.l); o.right = orderBy(matchRights(d), st && st.r); break;
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
      let n = parseNum(v);
      // «15 минут», «2 ч.», «30 %» — число с единицей измерения
      if (n === null && typeof v === 'string') { const m = /^\s*([-+]?[\d\s\u00a0]*[.,]?\d+)\s*[A-Za-zА-Яа-яЁё.%°]*\s*$/.exec(v); if (m) n = parseNum(m[1]); }
      if (n === null) throw new HttpError(400, 'Ответ должен быть числом'); return n;
    }
    case 'hotspot': {
      const ids = (d.zones || []).map(z => z.id); const arr = typeof v === 'string' ? [v] : v;
      if (!Array.isArray(arr) || arr.length > ids.length || arr.some(x => typeof x !== 'string' || !ids.includes(x))) badAns();
      return [...new Set(arr)];
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
// opt.partial: 'on' — частичные баллы для всех типов, где они возможны; 'off' — всё или ничего; иначе — как в вопросе.
function gradeAnswer(q, st, v, opt) {
  const d = parseJ(q.data, {}); const P = q.points;
  const pm = opt && opt.partial; const part = pm === 'on' ? true : pm === 'off' ? false : !!d.partial;
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
      case 'number': case 'slider': f = (d.answer_max !== undefined ? (v >= d.answer - 1e-9 && v <= d.answer_max + 1e-9) : Math.abs(v - d.answer) <= (d.tolerance || 0) + 1e-9) ? 1 : 0; break;
      case 'hotspot': {
        const c = new Set((d.zones || []).filter(z => z.correct).map(z => z.id)); const s = new Set(v);
        let good = 0, bad = 0; for (const x of s) (c.has(x) ? good++ : bad++);
        f = part ? frac(good - bad, c.size, true) : (good === c.size && bad === 0 ? 1 : 0);
        break;
      }
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
  if (f > 0 && f < 1 && d.partial_cap !== undefined) f = Math.min(f, d.partial_cap / 100);   // частичный балл не выше потолка
  f = Math.max(0, Math.min(1, f));
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
      case 'number': case 'slider': if (ans === null) ans = fmtNum(v) + unit; exp = d.answer_max !== undefined ? `от ${fmtNum(d.answer)} до ${fmtNum(d.answer_max)}${unit}` : fmtNum(d.answer) + unit + (d.tolerance ? ` (± ${fmtNum(d.tolerance)})` : ''); break;
      case 'hotspot': { const zs = d.zones || []; const lab = (id) => { const i = zs.findIndex(z => z.id === id); return i < 0 ? '?' : `${i + 1}) ${zs[i].label}`; };
        if (ans === null) ans = v.map(lab).join('; '); exp = zs.filter(z => z.correct).map(z => lab(z.id)).join('; '); break; }
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
  const e = (await visibleExams(env)).find(x => x.id === id);
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
  let qs, order;
  if (e.bank_count > 0 && e.bank_category) {
    // экзамен из банка: bank_count случайных вопросов категории, без повторов topic; порядок всегда случайный
    const cats = String(e.bank_category).split(',').map(x => x.trim()).filter(Boolean);
    const pool = (await bankIndex(env)).filter(q => (q.kind || 'question') === 'question' && cats.some(p => catMatch(p, q.category)));
    const ids = takeDistinct(pool, e.bank_count, new Set(), new Set()).map(q => q.id);
    if (!ids.length) throw new HttpError(409, 'В банке пока нет вопросов для этого экзамена');
    qs = await loadQs(env, ids); order = ids;
  } else {
    ({ results: qs } = await env.DB.prepare('SELECT * FROM questions WHERE exam_id = ?1 AND active = 1 ORDER BY position, id').bind(id).all());
    if (!qs.length) throw new HttpError(409, 'В экзамене пока нет вопросов');
    // вопросы экзамена с одинаковым topic: в попытку попадает один случайный из группы
    if (qs.some(q => q.topic)) { const keep = new Set(takeDistinct(qs, qs.length, new Set(), new Set()).map(q => q.id)); qs = qs.filter(q => keep.has(q.id)); }
    order = e.shuffle_questions ? shuffle(qs.map(q => q.id)) : qs.map(q => q.id);
  }
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
    const v = (await getReatt(env, a.reatt, true)) || {}; const m = parseJ(a.meta, {});
    return { kind: 'reatt', id: null, reatt: a.reatt, title: v.title || m.title || ('Переаттестация (' + a.reatt + ')'), pass_pct: v.pass_pct ?? m.pass_pct ?? 70, description: v.description || '',
      pass_points: m.pass_points ?? null, partial: m.partial || null };
  }
  const e = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1').bind(a.exam_id).first();
  return e ? { kind: 'exam', ...e } : { kind: 'exam', id: a.exam_id, title: '(экзамен удалён)', pass_pct: 70 };
}
// Сдано: процент не ниже проходного; если задан проходной балл в баллах — ещё и набрано не меньше него.
function isPassed(ctx, score, pct) { return pct >= ctx.pass_pct && (ctx.pass_points == null || score >= ctx.pass_points - 1e-9); }
async function finalizeAttempt(env, attempt, expired) {
  const ctx = await attemptCtx(env, attempt);
  const order = parseJ(attempt.q_order, []); const states = parseJ(attempt.opt_order, {});
  const qs = await loadAttemptQs(env, attempt, order);
  const qm = new Map(qs.map(q => [q.id, q]));
  const { results: ans } = await env.DB.prepare('SELECT * FROM answers WHERE attempt_id = ?1').bind(attempt.id).all();
  const am = new Map(ans.map(a => [a.question_id, parseJ(a.answer, null)]));
  let auto = 0, max = 0, needReview = false;
  const stmts = [];
  for (const qid of order) {
    const q = qm.get(qid); if (!q) continue;
    max += q.points;
    const v = am.has(qid) ? am.get(qid) : null;
    const g = gradeAnswer(q, stateFor(q, states), v, { partial: ctx.partial });
    if (g.nr) needReview = true;
    if (g.ap) auto += g.ap;
    stmts.push(env.DB.prepare('INSERT INTO answers (attempt_id, question_id, answer, auto_points, needs_review) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(attempt_id, question_id) DO UPDATE SET auto_points = excluded.auto_points, needs_review = excluded.needs_review')
      .bind(attempt.id, qid, JSON.stringify(v), g.ap, g.nr));
  }
  auto = Math.round(auto * 100) / 100;
  const pct = max ? Math.round(auto / max * 1000) / 10 : 0;
  const status = needReview ? 'pending_review' : (isPassed(ctx, auto, pct) ? 'passed' : 'failed');
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
function ctxPublic(ctx) { return ctx.kind === 'reatt' ? { id: null, reatt: ctx.reatt, title: ctx.title, pass_pct: ctx.pass_pct, pass_points: ctx.pass_points ?? null, description: ctx.description } : examPublic(ctx); }
async function getAttempt(env, user, id) {
  const a = await loadOwnAttempt(env, user, id);
  const ctx = await attemptCtx(env, a);
  const base = { id: a.id, exam: ctxPublic(ctx), reatt: a.reatt || null, status: a.status, started_at: a.started_at, deadline_at: a.deadline_at,
    submitted_at: a.submitted_at, expired: !!a.expired, server_now: Date.now() };
  if (a.status === 'in_progress') {
    const order = parseJ(a.q_order, []), states = parseJ(a.opt_order, {});
    const qs = await loadAttemptQs(env, a, order);
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
    if (a.status !== 'pending_review') { base.score = Math.round(((a.auto_score || 0) + (a.manual_score || 0)) * 100) / 100; base.max_score = a.max_score; }
    base.reviewer_comment = a.reviewer_comment || null;
    base.reviewed_at = a.reviewed_at;
    if (a.reatt && a.status !== 'pending_review') base.review = await attemptReview(env, a);
  }
  return json({ attempt: base });
}
// Разбор завершённой переаттестации для кандидата: по каждому вопросу — верно / частично / неверно и источник
// (документ + пункт). Правильные варианты не раскрываются.
async function attemptReview(env, a) {
  const order = parseJ(a.q_order, []), states = parseJ(a.opt_order, {});
  const qs = await loadAttemptQs(env, a, order); const qm = new Map(qs.map(q => [q.id, q]));
  const { results: ans } = await env.DB.prepare('SELECT question_id, auto_points, manual_points FROM answers WHERE attempt_id = ?1').bind(a.id).all();
  const am = new Map(ans.map(r => [r.question_id, r]));
  return order.filter(qid => qm.has(qid) && qm.get(qid).type !== 'info').map((qid, i) => {
    const q = qm.get(qid), x = am.get(qid); const max = q.points || 0;
    const got = x ? (x.manual_points ?? x.auto_points) : 0; const g = got == null ? null : Math.round(got * 100) / 100;
    const result = g == null ? 'pending' : (max > 0 && g >= max - 1e-9 ? 'correct' : g > 0 ? 'partial' : 'wrong');
    const text = q.type === 'param' ? renderTemplate(q.text, (stateFor(q, states) || {}).p || {}) : q.text;
    return { n: i + 1, id: qid, type: q.type, kind: q.kind || 'question', text: String(text || '').slice(0, 600), points: max, got: g, result, source: sourceInfo(q, true) };
  });
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
  const map = await reattMap(env);
  return rows.map(r => { if (!r.reatt) return r; const t = (map.get(r.reatt) || {}).title || 'Переаттестация'; return { ...r, title: t, exam_title: t }; });
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
// Каждая переаттестация — запись в таблице reattestations (создаются/редактируются админом). attempts.reatt = reattestations.key.
// Стандартные «Полная» (key 'full') и «Упрощённая» (key 'simple') заводятся миграцией 0005 и редактируются как обычные записи.
const REATT_KEY_RE = /^[a-z0-9_-]{1,40}$/;
function catMatch(pattern, cat) {
  const p = String(pattern).trim().toLowerCase(), c = String(cat || '').trim().toLowerCase();
  if (!p) return false;
  return p.endsWith('*') ? c.startsWith(p.slice(0, -1)) : c === p;
}
function reattRow(r) {
  if (!r) return null;
  return { id: r.id, key: r.key, title: r.title, description: r.description || '', enabled: !!r.enabled, visible: !!r.visible,
    time_limit_min: r.time_limit_min, pass_pct: r.pass_pct, cooldown_min: r.cooldown_min, max_attempts: r.max_attempts,
    q_points: r.q_points ?? null, c_points: r.c_points ?? null, position: r.position, deleted: !!r.deleted_at,
    groups: parseJ(r.groups, []).map(g => ({ label: g.label, categories: g.categories || [], questions: g.questions || 0, cases: g.cases || 0, pref_types: g.pref_types || [], pref_count: g.pref_count || 0 })),
    mode: r.mode === 'bank' ? 'bank' : 'groups', cfg: r.mode === 'bank' ? reattCfgNorm(parseJ(r.cfg, {})) : null, level: r.level || 0, track: r.track || '',
    created_at: r.created_at, updated_at: r.updated_at };
}
// Настройки выборки по базе (mode = 'bank'). mix — доли лёгких/средних/сложных в %, pts — баллы за вопрос каждой сложности.
const R6_DEFAULT_MIX = { simple: [50, 50, 0], medium: [30, 50, 20], full: [20, 45, 35], vp: [10, 35, 55], cases_int: [25, 50, 25], cases_gen: [15, 40, 45] };
function reattCfgNorm(c) {
  const base = R6_BASES[c.base] ? c.base : 'simple';
  const mix = Array.isArray(c.mix) && c.mix.length === 3 ? c.mix.map(x => Number(x) || 0) : R6_DEFAULT_MIX[base];
  return { base, count: Number(c.count) || 10, mix, pts: Array.isArray(c.pts) && c.pts.length === 3 ? c.pts.map(Number) : [1, 2, 3],
    topics: c.topics && typeof c.topics === 'object' ? c.topics : {}, types: Array.isArray(c.types) ? c.types : [],
    max_topic_pct: c.max_topic_pct ?? 40, max_type_pct: c.max_type_pct ?? 50, partial: ['on', 'off'].includes(c.partial) ? c.partial : 'question',
    pass_points: c.pass_points ?? null, unique_ref: c.unique_ref !== false, avoid_repeat: c.avoid_repeat !== false, choice_balance: c.choice_balance !== false };
}
function reattCfgInput(c) {
  if (!c || typeof c !== 'object' || Array.isArray(c)) throw new HttpError(400, 'Настройки выборки: ожидается объект');
  const base = str(c.base, 30, { required: true, name: 'база вопросов' });
  if (!R6_BASES[base]) throw new HttpError(400, 'База вопросов: ' + R6_BASE_ORDER.join(', '));
  const count = int(c.count, 1, 200, 'количество вопросов', 10);
  const mixIn = Array.isArray(c.mix) ? c.mix : (c.mix && typeof c.mix === 'object' ? [c.mix[1], c.mix[2], c.mix[3]] : R6_DEFAULT_MIX[base]);
  const mix = [0, 1, 2].map(i => int(mixIn[i] ?? 0, 0, 100, `доля сложности ${i + 1}, %`, 0));
  if (mix[0] + mix[1] + mix[2] !== 100) throw new HttpError(400, `Доли лёгких / средних / сложных вопросов в сумме должны давать 100% (сейчас ${mix[0] + mix[1] + mix[2]}%)`);
  const pts = [0, 1, 2].map(i => { const v = Array.isArray(c.pts) ? c.pts[i] : undefined; const n = v === undefined || v === null || v === '' ? i + 1 : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new HttpError(400, `Баллы за вопрос сложности ${i + 1}: от 0 до 100`); return Math.round(n * 100) / 100; });
  const topics = {};
  if (c.topics && typeof c.topics === 'object') for (const [k, v] of Object.entries(c.topics)) {
    if (!R6_TOPICS[k]) throw new HttpError(400, `Неизвестная тема «${k}». Допустимо: ${Object.keys(R6_TOPICS).join(', ')}`);
    if (v === '' || v === null || v === undefined) continue; topics[k] = int(v, 0, 1000, `вес темы ${R6_TOPICS[k]}`, 0);
  }
  const types = [...new Set((Array.isArray(c.types) ? c.types : String(c.types || '').split(',')).map(x => String(x).trim()).filter(Boolean))];
  for (const t of types) if (!QTYPE_LIST.includes(t) || t === 'info') throw new HttpError(400, `Неизвестный тип «${t}»`);
  let pass_points = null;
  if (c.pass_points !== undefined && c.pass_points !== null && c.pass_points !== '') { pass_points = Number(c.pass_points); if (!Number.isFinite(pass_points) || pass_points < 0 || pass_points > 100000) throw new HttpError(400, 'Проходной балл в баллах: число ≥ 0 или пусто'); }
  return { base, count, mix, pts, topics, types,
    max_topic_pct: int(c.max_topic_pct ?? 40, 0, 100, 'макс. доля одной темы, %', 40), max_type_pct: int(c.max_type_pct ?? 50, 0, 100, 'макс. доля одного типа, %', 50),
    partial: ['on', 'off', 'question'].includes(c.partial) ? c.partial : 'question', pass_points,
    unique_ref: c.unique_ref === undefined ? true : !!bool(c.unique_ref, true), avoid_repeat: c.avoid_repeat === undefined ? true : !!bool(c.avoid_repeat, true),
    choice_balance: c.choice_balance === undefined ? true : !!bool(c.choice_balance, true) };
}
function largestRemainder(total, pcts) {
  const raw = pcts.map(p => total * p / 100); const fl = raw.map(Math.floor);
  let rest = total - fl.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => [r - fl[i], i]).filter(x => pcts[x[1]] > 0).sort((a, b) => b[0] - a[0] || pcts[b[1]] - pcts[a[1]]);
  for (let k = 0; rest > 0 && order.length; k = (k + 1) % order.length) { fl[order[k][1]]++; rest--; }
  return fl;
}
function wordSet(t) { return new Set(normText(t).replace(/[^a-zа-я0-9]+/g, ' ').split(' ').filter(w => w.length > 3)); }
function nearDup(a, b) { if (a.size < 4 || b.size < 4) return false; let i = 0; for (const w of a) if (b.has(w)) i++; return i / (a.size + b.size - i) >= 0.75; }
function refKey(q) { return q.source_doc && q.source_ref ? q.source_doc + '|' + normText(q.source_ref) : null; }
// Выборка попытки из базы: число вопросов каждой сложности по долям (метод наибольших остатков), темы — по весам,
// не больше max_topic_pct на тему и max_type_pct на тип, без повторов (id, topic-группы, пункта документа, почти одинакового текста).
// seen — вопросы прошлых попыток этого кандидата (берутся в последнюю очередь).
const CHOICE_PAIR = { single: 'multi', multi: 'single' };
function sampleBank(pool, cfg, seen) {
  seen = seen || new Set();
  const list = pool.filter(q => !cfg.types.length || cfg.types.includes(q.type));
  const D = (q) => q.difficulty || 2;
  const want = largestRemainder(cfg.count, cfg.mix);
  const have = [1, 2, 3].map(d => list.filter(q => D(q) === d).length);
  const need = want.slice(); let lacking = 0; const moved = [];
  for (let i = 0; i < 3; i++) {
    if (need[i] <= have[i]) continue;
    let extra = need[i] - have[i]; need[i] = have[i];
    for (const j of (i === 0 ? [1, 2] : i === 2 ? [1, 0] : [2, 0])) { const t = Math.min(Math.max(0, have[j] - need[j]), extra); if (t > 0) { need[j] += t; extra -= t; moved.push({ from: i + 1, to: j + 1, n: t }); } }
    lacking += extra;
  }
  const topicsAll = [...new Set(list.map(q => docTopic(q.source_doc)))];
  const wts = {}; const explicit = Object.keys(cfg.topics || {}).length > 0;
  for (const t of topicsAll) wts[t] = explicit ? (cfg.topics[t] || 0) : 1;
  const sumW = Object.values(wts).reduce((a, b) => a + b, 0) || 1;
  const total = need.reduce((a, b) => a + b, 0);
  const target = {}; for (const t of topicsAll) target[t] = total * wts[t] / sumW;
  const maxTopic = cfg.max_topic_pct ? Math.max(1, Math.ceil(cfg.count * cfg.max_topic_pct / 100)) : Infinity;
  const maxType = cfg.max_type_pct ? Math.max(1, Math.ceil(cfg.count * cfg.max_type_pct / 100)) : Infinity;
  const chosen = [], ids = new Set(), cntT = {}, cntY = {}, usedTk = new Set(), usedRef = new Set(), sets = [];
  const slots = shuffle([].concat(...need.map((n, i) => Array(n).fill(i + 1))));
  const ws = new Map();
  const wsOf = (q) => { if (!ws.has(q.id)) ws.set(q.id, wordSet(q.text || '')); return ws.get(q.id); };
  for (const d of slots) {
    let pick = null;
    // choice_balance: вопросы с одним и с несколькими ответами — поровну (разница не больше 1), пока в базе есть вопросы второго типа этой сложности
    const otherLeft = {};
    if (cfg.choice_balance !== false) for (const t of ['single', 'multi']) otherLeft[t] = list.some(x => D(x) === d && x.type === CHOICE_PAIR[t] && !ids.has(x.id));
    for (let relax = 0; relax < 3 && !pick; relax++) {
      const cand = [];
      for (const q of list) {
        if (D(q) !== d || ids.has(q.id)) continue;
        const tk = q.topic ? String(q.topic).toLowerCase() : null; if (tk && usedTk.has(tk)) continue;
        const T = docTopic(q.source_doc); if (!wts[T]) continue;
        const rk = cfg.unique_ref ? refKey(q) : null; if (relax < 1 && rk && usedRef.has(rk)) continue;
        if (relax < 2 && (cntY[q.type] || 0) >= maxType) continue;
        if (relax < 2 && CHOICE_PAIR[q.type] && otherLeft[q.type] && (cntY[q.type] || 0) > (cntY[CHOICE_PAIR[q.type]] || 0)) continue;
        if (relax < 2 && (cntT[T] || 0) >= maxTopic) continue;
        cand.push({ q, sc: (target[T] - (cntT[T] || 0)) + Math.random() * 0.9 - (cfg.avoid_repeat && seen.has(q.id) ? 3 : 0) });
      }
      cand.sort((a, b) => b.sc - a.sc);
      for (const c of cand) { const w = wsOf(c.q); if (relax < 1 && sets.some(s => nearDup(w, s))) continue; pick = c.q; break; }
    }
    if (!pick) { lacking++; continue; }
    const T = docTopic(pick.source_doc);
    chosen.push(pick); ids.add(pick.id); cntT[T] = (cntT[T] || 0) + 1; cntY[pick.type] = (cntY[pick.type] || 0) + 1;
    if (pick.topic) usedTk.add(String(pick.topic).toLowerCase()); const rk = refKey(pick); if (rk) usedRef.add(rk); sets.push(wsOf(pick));
  }
  const byD = { 1: 0, 2: 0, 3: 0 }; for (const q of chosen) byD[D(q)]++;
  return { ids: chosen.map(q => q.id), rows: chosen, want: { 1: want[0], 2: want[1], 3: want[2] }, got: byD, by_topic: cntT, by_type: cntY, short: Math.max(0, cfg.count - chosen.length), moved, repeated: chosen.filter(q => seen.has(q.id)).length };
}
async function baseIndex(env, base) {
  const { results } = await env.DB.prepare("SELECT id, kind, type, topic, difficulty, source_doc, source_ref, points, substr(text, 1, 600) AS text FROM questions WHERE exam_id = 0 AND active = 1 AND base = ?1 AND type != 'info'").bind(base).all();
  return results;
}
function baseAvailability(pool, cfg) {
  const list = pool.filter(q => !cfg.types.length || cfg.types.includes(q.type));
  const want = largestRemainder(cfg.count, cfg.mix);
  const have = [1, 2, 3].map(d => list.filter(q => (q.difficulty || 2) === d).length);
  return { base: cfg.base, total: list.length, want: { 1: want[0], 2: want[1], 3: want[2] }, have: { 1: have[0], 2: have[1], 3: have[2] },
    ok: list.length >= cfg.count && want.every((w, i) => have[i] >= w), ratio: cfg.count ? Math.round(list.length / cfg.count * 10) / 10 : 0 };
}
// группы для сводки попытки: по темам (документам)
function bankGroups(rows) {
  const m = new Map();
  for (const q of rows) { const t = docTopic(q.source_doc); const label = R6_TOPICS[t] || t; if (!m.has(label)) m.set(label, { label, q: [], c: [], short_q: 0, short_c: 0 }); (q.kind === 'case' ? m.get(label).c : m.get(label).q).push(q.id); }
  return [...m.values()];
}
async function getReatt(env, key, withDeleted) {
  const r = await env.DB.prepare(`SELECT * FROM reattestations WHERE key = ?1${withDeleted ? '' : ' AND deleted_at IS NULL'}`).bind(key).first();
  return reattRow(r);
}
async function reattMap(env) {
  const { results } = await env.DB.prepare('SELECT * FROM reattestations').all();
  return new Map(results.map(r => [r.key, reattRow(r)]));
}
function reattGroupsInput(groups) {
  if (!Array.isArray(groups) || !groups.length || groups.length > 30) throw new HttpError(400, 'Нужно от 1 до 30 блоков квот');
  const out = groups.map((g, i) => {
    const cats = (Array.isArray(g && g.categories) ? g.categories : String((g && g.categories) || '').split(',')).map(x => str(x, 100, { name: 'категория' })).filter(Boolean);
    if (!cats.length) throw new HttpError(400, `Блок ${i + 1}: укажите категории`);
    return { label: str(g.label, 60, { required: true, name: `название блока ${i + 1}` }), categories: cats.slice(0, 30),
      questions: int(g.questions, 0, 200, `вопросов в блоке ${i + 1}`, 0), cases: int(g.cases, 0, 50, `кейсов в блоке ${i + 1}`, 0),
      pref_types: [...new Set((Array.isArray(g.pref_types) ? g.pref_types : String(g.pref_types || '').split(',')).map(x => String(x).trim()).filter(Boolean))].map(t => { if (!QTYPE_LIST.includes(t) || t === 'case' || t === 'info') throw new HttpError(400, `Блок ${i + 1}: неизвестный тип «${t}»`); return t; }),
      pref_count: int(g.pref_count, 0, 200, `«из них предпочтительных» в блоке ${i + 1}`, 0) };
  }).map(g => (g.pref_count > g.questions ? { ...g, pref_count: g.questions } : g)).map(g => (g.pref_types.length ? g : { ...g, pref_count: 0 }));
  if (!out.some(g => g.questions + g.cases > 0)) throw new HttpError(400, 'Квоты: всего должно быть больше 0 вопросов');
  return out;
}
function optPoints(v, name) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v); if (!Number.isFinite(n) || n < 0 || n > 1000) throw new HttpError(400, `${name}: число от 0 до 1000 или пусто`);
  return Math.round(n * 100) / 100;
}
function reattInput(b, cur) {
  if (!b || typeof b !== 'object') throw new HttpError(400, 'Некорректные данные');
  const g = (k, d) => b[k] !== undefined ? b[k] : (cur ? cur[k] : d);
  const mode = g('mode', 'groups') === 'bank' ? 'bank' : 'groups';
  const level = int(g('level', 0), 0, 100, 'уровень', 0);
  const track = str(g('track', ''), 20, { name: 'линия' });
  if (track && !['line', 'cases'].includes(track)) throw new HttpError(400, 'Линия: line (основная) или cases (кейсы)');
  if (mode === 'bank') {
    const cfg = reattCfgInput(g('cfg', null));
    const gr = b.groups !== undefined && Array.isArray(b.groups) && b.groups.length ? reattGroupsInput(b.groups) : (cur ? cur.groups : []);
    return { ...reattCommon(g), mode, cfg, level, track, groups: gr };
  }
  return { ...reattCommon(g), mode, cfg: cur && cur.cfg ? cur.cfg : {}, level, track, groups: reattGroupsInput(g('groups', null)) };
}
function reattCommon(g) {
  return {
    title: str(g('title', ''), 200, { required: true, name: 'название' }),
    description: str(g('description', ''), 5000, { name: 'описание' }),
    enabled: bool(g('enabled', true), true) ? 1 : 0,
    visible: bool(g('visible', true), true) ? 1 : 0,
    time_limit_min: int(g('time_limit_min', 0), 0, 1440, 'лимит времени', 0),
    pass_pct: int(g('pass_pct', 70), 0, 100, 'проходной балл', 70),
    cooldown_min: int(g('cooldown_min', 0), 0, 60 * 24 * 60, 'пауза между попытками', 0),
    max_attempts: int(g('max_attempts', 0), 0, 1000, 'лимит попыток', 0),
    q_points: optPoints(g('q_points', null), 'Баллы за вопрос'),
    c_points: optPoints(g('c_points', null), 'Баллы за кейс'),
    position: int(g('position', 0), 0, 1000000, 'порядок', 0),
  };
}
async function bankIndex(env) {
  const { results } = await env.DB.prepare("SELECT id, category, kind, type, topic FROM questions WHERE exam_id = 0 AND active = 1 AND type != 'info'").all();
  return results;
}
// Случайно n вопросов из списка так, чтобы в попытке не было двух вопросов с одинаковым topic (общий набор usedTopics на всю попытку).
// Вопросы без topic ограничений не имеют. Возвращает выбранные строки.
function takeDistinct(list, n, usedIds, usedTopics) {
  const out = [];
  for (const q of shuffle(list)) {
    if (out.length >= n) break;
    if (usedIds.has(q.id)) continue;
    const t = q.topic ? String(q.topic).toLowerCase() : null;
    if (t && usedTopics.has(t)) continue;
    out.push(q); usedIds.add(q.id); if (t) usedTopics.add(t);
  }
  return out;
}
// Сколько вопросов максимум можно взять из списка без повторов topic.
function distinctCapacity(list) { const t = new Set(); let n = 0; for (const q of list) { if (q.topic) t.add(String(q.topic).toLowerCase()); else n++; } return n + t.size; }
// Случайная выборка по квотам. Вопросы не повторяются между блоками; вопросы одного topic — не больше одного на попытку.
function sampleReatt(bank, groups) {
  const used = new Set(), usedTopics = new Set();
  return groups.map(g => {
    const pool = (kind) => bank.filter(q => (q.kind || 'question') === kind && !used.has(q.id) && g.categories.some(p => catMatch(p, q.category)));
    const take = (list, n) => takeDistinct(list, n, used, usedTopics).map(q => q.id);
    // «Предпочтительные типы»: сначала pref_count вопросов этих типов (если их не хватает — добираются любые), остальные — случайно из всего блока
    const q = [];
    const pt = new Set(g.pref_types || []), pc = Math.min(g.pref_count || 0, g.questions);
    if (pc && pt.size) q.push(...take(pool('question').filter(x => pt.has(x.type)), pc));
    if (g.questions - q.length > 0) q.push(...take(pool('question'), g.questions - q.length));
    const c = g.cases ? take(pool('case'), g.cases) : [];
    return { label: g.label, q, c, need_q: g.questions, need_c: g.cases, short_q: g.questions - q.length, short_c: g.cases - c.length };
  });
}
function availability(bank, groups) {
  return groups.map(g => {
    const m = bank.filter(q => g.categories.some(p => catMatch(p, q.category)));
    const qs = m.filter(q => (q.kind || 'question') === 'question'), cs = m.filter(q => q.kind === 'case');
    const pt = new Set(g.pref_types || []);
    return { label: g.label, need_q: g.questions, need_c: g.cases, have_q: qs.length, have_c: cs.length, have_pref: pt.size ? qs.filter(q => pt.has(q.type)).length : null, need_pref: pt.size ? g.pref_count || 0 : 0,
      ok: qs.length >= g.questions && cs.length >= g.cases };
  });
}
// Веса из настроек переаттестации (снимок в attempts.meta.points) поверх баллов вопроса; критерии кейса масштабируются.
function applyWeights(qs, attempt) {
  const pts = attempt && attempt.reatt ? (parseJ(attempt.meta, {}).points || null) : null;
  if (!pts) return qs;
  return qs.map(q => {
    const w = pts[q.id]; if (w === undefined || w === null || w === q.points) return q;
    const nq = { ...q, points: w };
    if (q.type === 'case') {
      const d = parseJ(q.data, {}); const sum = (d.criteria || []).reduce((s, c) => s + (c.points || 0), 0);
      if (sum > 0 && d.criteria.length) { const k = w / (q.points || sum); d.criteria = d.criteria.map(c => ({ ...c, points: Math.round(c.points * k * 2) / 2 })); nq.data = JSON.stringify(d); }
    }
    return nq;
  });
}
async function loadAttemptQs(env, attempt, ids) { return applyWeights(await loadQs(env, ids), attempt); }
// ---------- доступ к переаттестации ----------
// Переаттестация видна и запускается, только если администратор выдал доступ (reatt_access): конкретному пользователю
// или всем с ролью «Переаттестация» (user_id NULL), до момента expires_at (NULL — бессрочно), на attempts попыток (NULL — без ограничения).
// Попытки считаются по каждой выдаче отдельно (attempts.meta.grant). Администраторы видят всё без выдачи (для проверки).
async function reattGrants(env, user, key) {
  const now = Date.now();
  const { results } = await env.DB.prepare(`SELECT g.*, (SELECT COUNT(*) FROM attempts a WHERE a.user_id = ?1 AND a.reatt = g.reatt_key AND json_extract(a.meta, '$.grant') = g.id) AS used
    FROM reatt_access g WHERE g.revoked_at IS NULL AND (g.user_id = ?1 OR g.user_id IS NULL) AND (g.expires_at IS NULL OR g.expires_at > ?2)${key ? ' AND g.reatt_key = ?3' : ''}
    ORDER BY g.id`).bind(...(key ? [user.id, now, key] : [user.id, now])).all();
  return results.map(g => ({ id: g.id, key: g.reatt_key, personal: !!g.user_id, expires_at: g.expires_at, attempts: g.attempts, used: g.used, left: g.attempts == null ? null : Math.max(0, g.attempts - g.used) }));
}
// лучшая действующая выдача: с оставшимися попытками, затем — с самым поздним сроком
function bestGrant(gs) {
  const ok = gs.filter(g => g.left === null || g.left > 0);
  const list = ok.length ? ok : gs;
  return list.sort((a, b) => ((b.left === null) - (a.left === null)) || ((b.left || 0) - (a.left || 0)) || ((b.expires_at || 9e15) - (a.expires_at || 9e15)))[0] || null;
}
async function reattState(env, user, v, grant) {
  const { results: atts } = await env.DB.prepare('SELECT id, status, started_at, submitted_at, score_pct, deadline_at FROM attempts WHERE user_id = ?1 AND reatt = ?2 ORDER BY id DESC').bind(user.id, v.key).all();
  const now = Date.now();
  let can = true, reason = null, nextAt = null;
  const active = atts.find(a => a.status === 'in_progress');
  if (!v.enabled || v.deleted) { can = false; reason = 'Эта переаттестация сейчас выключена'; }
  else if (active) { can = true; }
  else if (grant !== undefined && !grant) { can = false; reason = 'Доступ к переаттестации не выдан'; }
  else if (grant && grant.left === 0) { can = false; reason = 'Попытки по выданному доступу закончились'; }
  else if (atts.some(a => a.status === 'pending_review')) { can = false; reason = 'Предыдущая попытка ожидает проверки'; }
  else if (v.max_attempts && atts.length >= v.max_attempts) { can = false; reason = 'Попытки закончились'; }
  else if (v.cooldown_min && atts.length) {
    const t = (atts[0].submitted_at || atts[0].started_at) + v.cooldown_min * 60000;
    if (t > now) { can = false; reason = 'Следующая попытка будет доступна позже'; nextAt = t; }
  }
  return { can_start: can, reason, next_at: nextAt, active_attempt_id: active ? active.id : null,
    access: grant ? { expires_at: grant.expires_at, attempts: grant.attempts, left: grant.left } : null,
    attempts: atts.map(a => ({ id: a.id, status: a.status, started_at: a.started_at, submitted_at: a.submitted_at, score_pct: a.status === 'pending_review' ? null : a.score_pct })) };
}
async function listReatt(env, user) {
  const { results } = await env.DB.prepare('SELECT * FROM reattestations WHERE deleted_at IS NULL AND enabled = 1 AND visible = 1 ORDER BY position, id').all();
  const admin = caps(user).admin;
  const grants = admin ? [] : await reattGrants(env, user, null);
  const out = [];
  for (const r of results) {
    const v = reattRow(r);
    let grant;
    if (!admin) {
      const gs = grants.filter(g => g.key === v.key);
      const act = await env.DB.prepare("SELECT id FROM attempts WHERE user_id = ?1 AND reatt = ?2 AND status = 'in_progress' LIMIT 1").bind(user.id, v.key).first();
      if (!gs.length && !act) continue; // без выданного доступа переаттестация не видна
      grant = bestGrant(gs);
    }
    const bank = v.mode === 'bank';
    out.push({ key: v.key, title: v.title, description: v.description, enabled: v.enabled, time_limit_min: v.time_limit_min, pass_pct: v.pass_pct,
      cooldown_min: v.cooldown_min, max_attempts: v.max_attempts, level: v.level, track: v.track, mode: v.mode,
      base: bank ? v.cfg.base : null, pass_points: bank ? v.cfg.pass_points : null,
      total_questions: bank ? v.cfg.count : v.groups.reduce((s, g) => s + g.questions, 0), total_cases: bank ? 0 : v.groups.reduce((s, g) => s + g.cases, 0),
      manual: bank ? !!(await env.DB.prepare("SELECT 1 FROM questions WHERE exam_id = 0 AND active = 1 AND base = ?1 AND type IN ('case','long','file','voice') LIMIT 1").bind(v.cfg.base).first()) : v.groups.some(g => g.cases > 0),
      ...(await reattState(env, user, v, grant)) });
  }
  return json({ versions: out });
}
async function startReatt(env, user, key) {
  const v = await getReatt(env, key);
  if (!v) throw new HttpError(404, 'Нет такой переаттестации');
  await rateLimit(env, 'start:' + user.id, 10, 60);
  const admin = caps(user).admin;
  const grant = admin ? undefined : bestGrant(await reattGrants(env, user, key));
  const st = await reattState(env, user, v, grant);
  if (st.active_attempt_id) {
    const a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(st.active_attempt_id).first();
    if (!(await finalizeIfExpired(env, a))) return json({ attempt_id: a.id });
    throw new HttpError(409, 'Время предыдущей попытки истекло — она завершена автоматически. Обновите страницу.');
  }
  if (!st.can_start) throw new HttpError(403, st.reason || 'Переаттестация недоступна');
  let ids, raw, meta;
  const points = {};
  if (v.mode === 'bank') {
    // вопросы прошлых попыток кандидата — в последнюю очередь (разнообразие попыток)
    const { results: prev } = await env.DB.prepare('SELECT q_order FROM attempts WHERE user_id = ?1 AND reatt = ?2 ORDER BY id DESC LIMIT 5').bind(user.id, key).all();
    const seen = new Set(prev.flatMap(a => parseJ(a.q_order, [])));
    const sb = sampleBank(await baseIndex(env, v.cfg.base), v.cfg, seen);
    ids = sb.ids;
    if (!ids.length) throw new HttpError(409, 'База вопросов этой переаттестации пока пуста — обратитесь к учебному отделу');
    raw = await loadQs(env, ids);
    for (const q of raw) { const w = q.difficulty ? v.cfg.pts[q.difficulty - 1] : null; if (w !== null && w !== undefined) points[q.id] = w; }
    meta = { version: key, grant: grant ? grant.id : undefined, title: v.title, pass_pct: v.pass_pct, pass_points: v.cfg.pass_points ?? undefined, partial: v.cfg.partial !== 'question' ? v.cfg.partial : undefined,
      mode: 'bank', base: v.cfg.base, points: Object.keys(points).length ? points : undefined, comp: { want: sb.want, got: sb.got, short: sb.short, by_topic: sb.by_topic, by_type: sb.by_type, repeated: sb.repeated },
      groups: bankGroups(sb.rows) };
  } else {
    const groups = sampleReatt(await bankIndex(env), v.groups);
    ids = groups.flatMap(g => g.q.concat(g.c));
    if (!ids.length) throw new HttpError(409, 'Банк вопросов пока пуст — обратитесь к учебному отделу');
    raw = await loadQs(env, ids);
    for (const q of raw) { const w = q.kind === 'case' ? v.c_points : v.q_points; if (w !== null && w !== undefined) points[q.id] = w; }
    meta = { version: key, grant: grant ? grant.id : undefined, title: v.title, pass_pct: v.pass_pct, points: Object.keys(points).length ? points : undefined,
      groups: groups.map(g => ({ label: g.label, q: g.q, c: g.c, short_q: g.short_q, short_c: g.short_c })) };
  }
  const qs = applyWeights(raw, { reatt: key, meta: JSON.stringify(meta) });
  const order = shuffle(ids);
  const states = buildStates(qs, true);
  const max = qs.reduce((s, q) => s + q.points, 0);
  const now = Date.now();
  const deadline = v.time_limit_min ? now + v.time_limit_min * 60000 : null;
  const r = await env.DB.prepare(`INSERT INTO attempts (exam_id, user_id, status, started_at, deadline_at, q_order, opt_order, max_score, reatt, meta) VALUES (0, ?1, 'in_progress', ?2, ?3, ?4, ?5, ?6, ?7, ?8) RETURNING id`)
    .bind(user.id, now, deadline, JSON.stringify(order), JSON.stringify(states), max, key, JSON.stringify(meta)).first();
  return json({ attempt_id: r.id });
}
async function adminReatt(env) {
  const { results } = await env.DB.prepare('SELECT * FROM reattestations WHERE deleted_at IS NULL ORDER BY position, id').all();
  const bank = await bankIndex(env);
  const cats = {};
  for (const q of bank) { const c = q.category || '(без категории)'; cats[c] = cats[c] || { category: c, questions: 0, cases: 0 }; if (q.kind === 'case') cats[c].cases++; else cats[c].questions++; }
  const { results: stats } = await env.DB.prepare("SELECT reatt, status, COUNT(*) AS c FROM attempts WHERE reatt IS NOT NULL GROUP BY reatt, status").all();
  const { results: ga } = await env.DB.prepare('SELECT reatt_key, COUNT(*) AS c, SUM(user_id IS NULL) AS g FROM reatt_access WHERE revoked_at IS NULL AND (expires_at IS NULL OR expires_at > ?1) GROUP BY reatt_key').bind(Date.now()).all();
  const pools = {};
  for (const v of results.map(reattRow)) if (v.mode === 'bank' && !pools[v.cfg.base]) pools[v.cfg.base] = await baseIndex(env, v.cfg.base);
  const items = results.map(reattRow).map(v => ({ ...v, availability: v.mode === 'bank' ? [] : availability(bank, v.groups), base_availability: v.mode === 'bank' ? baseAvailability(pools[v.cfg.base], v.cfg) : null, access: (() => { const x = ga.find(a => a.reatt_key === v.key); return { active: x ? x.c : 0, global: x ? x.g : 0 }; })(),
    attempts: stats.filter(s => s.reatt === v.key).reduce((o, s) => (o[s.status] = s.c, o), {}) }));
  return json({ items, categories: Object.values(cats).sort((a, b) => a.category.localeCompare(b.category, 'ru')), bases: await reattBaseStats(env), base_names: R6_BASES, topics: R6_TOPICS, docs: SOURCE_DOCS });
}
async function adminReattOne(env, id) {
  const r = reattRow(await env.DB.prepare('SELECT * FROM reattestations WHERE id = ?1 AND deleted_at IS NULL').bind(id).first());
  if (!r) throw new HttpError(404, 'Переаттестация не найдена');
  return r;
}
async function createReatt(request, env, actor) {
  const o = reattInput(await readJson(request), null);
  const now = Date.now();
  let key; for (let t = 0; t < 5; t++) { key = 'r' + [...crypto.getRandomValues(new Uint8Array(4))].map(x => x.toString(16).padStart(2, '0')).join(''); if (key.length > 3 && !(await env.DB.prepare('SELECT 1 FROM reattestations WHERE key = ?1').bind(key).first())) break; }
  const pos = o.position || ((await env.DB.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM reattestations').first()).m + 10);
  const r = await env.DB.prepare(`INSERT INTO reattestations (key, title, description, enabled, visible, time_limit_min, pass_pct, cooldown_min, max_attempts, q_points, c_points, groups, position, created_at, updated_at, mode, cfg, level, track)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14, ?15, ?16, ?17, ?18) RETURNING id`)
    .bind(key, o.title, o.description, o.enabled, o.visible, o.time_limit_min, o.pass_pct, o.cooldown_min, o.max_attempts, o.q_points, o.c_points, JSON.stringify(o.groups), pos, now, o.mode, JSON.stringify(o.cfg || {}), o.level, o.track).first();
  await audit(env, actor, 'reatt.create', String(r.id), { title: o.title, key });
  return json({ item: await adminReattOne(env, r.id) }, 201);
}
async function updateReatt(request, env, actor, id) {
  const cur = await adminReattOne(env, id);
  const o = reattInput(await readJson(request), cur);
  await env.DB.prepare(`UPDATE reattestations SET title = ?1, description = ?2, enabled = ?3, visible = ?4, time_limit_min = ?5, pass_pct = ?6, cooldown_min = ?7, max_attempts = ?8, q_points = ?9, c_points = ?10, groups = ?11, position = ?12, updated_at = ?13,
      mode = ?15, cfg = ?16, level = ?17, track = ?18 WHERE id = ?14`)
    .bind(o.title, o.description, o.enabled, o.visible, o.time_limit_min, o.pass_pct, o.cooldown_min, o.max_attempts, o.q_points, o.c_points, JSON.stringify(o.groups), o.position, Date.now(), id, o.mode, JSON.stringify(o.cfg || {}), o.level, o.track).run();
  await audit(env, actor, 'reatt.update', String(id), { title: o.title, enabled: !!o.enabled, visible: !!o.visible, mode: o.mode,
    ...(o.mode === 'bank' ? { base: o.cfg.base, count: o.cfg.count, mix: o.cfg.mix.join('/'), pass_pct: o.pass_pct, pass_points: o.cfg.pass_points } : { groups: o.groups.map(g => `${g.label}:${g.questions}+${g.cases}`).join(', ') }) });
  return json({ item: await adminReattOne(env, id) });
}
async function deleteReatt(env, actor, id) {
  const cur = await adminReattOne(env, id);
  const n = (await env.DB.prepare('SELECT COUNT(*) AS c FROM attempts WHERE reatt = ?1').bind(cur.key).first()).c;
  // Если есть попытки — запись скрывается (мягкое удаление), чтобы попытки остались привязаны и видны в «Проверке».
  if (n) await env.DB.prepare('UPDATE reattestations SET deleted_at = ?1, enabled = 0, visible = 0 WHERE id = ?2').bind(Date.now(), id).run();
  else await env.DB.prepare('DELETE FROM reattestations WHERE id = ?1').bind(id).run();
  await audit(env, actor, 'reatt.delete', String(id), { title: cur.title, attempts: n });
  return json({ ok: true, soft: !!n });
}
// Пробная выборка: по сохранённой записи (id) или по присланным в теле квотам (до сохранения).
async function previewReatt(request, env, id) {
  const b = await readJson(request).catch(() => ({}));
  let groups, v = null;
  const sv = id ? await adminReattOne(env, id) : null;
  const mode = b && b.mode ? b.mode : (b && b.cfg ? 'bank' : (b && Array.isArray(b.groups) ? 'groups' : (sv ? sv.mode : 'groups')));
  if (mode === 'bank') {
    const cfg = b && b.cfg ? reattCfgInput(b.cfg) : sv && sv.cfg; if (!cfg) throw new HttpError(400, 'Нет настроек выборки');
    const pool = await baseIndex(env, cfg.base);
    const sb = sampleBank(pool, cfg, new Set());
    const qs = await loadQs(env, sb.ids); const qm = new Map(qs.map(q => [q.id, q]));
    const pts = (q) => (q.difficulty ? cfg.pts[q.difficulty - 1] : q.points);
    const brief = (id) => { const q = qm.get(id); return { id, type: q.type, kind: q.kind, category: q.category, points: pts(q), difficulty: q.difficulty, source_doc: q.source_doc, source_ref: q.source_ref, text: q.text.slice(0, 200) }; };
    return json({ mode: 'bank', groups: bankGroups(sb.rows).map(g => ({ ...g, need_q: g.q.length, need_c: g.c.length, q: g.q.map(brief), c: g.c.map(brief) })),
      total: sb.ids.length, max_score: qs.reduce((s, q) => s + pts(q), 0), comp: { want: sb.want, got: sb.got, short: sb.short, by_topic: sb.by_topic, by_type: sb.by_type, moved: sb.moved },
      availability: baseAvailability(pool, cfg) });
  }
  if (b && Array.isArray(b.groups)) groups = reattGroupsInput(b.groups);
  else { v = sv || await adminReattOne(env, id); groups = v.groups; }
  const qp = optPoints(b && b.q_points !== undefined ? b.q_points : v && v.q_points, 'Баллы за вопрос'), cp = optPoints(b && b.c_points !== undefined ? b.c_points : v && v.c_points, 'Баллы за кейс');
  const sg = sampleReatt(await bankIndex(env), groups);
  const qs = await loadQs(env, sg.flatMap(g => g.q.concat(g.c)));
  const qm = new Map(qs.map(q => [q.id, q]));
  const pts = (q) => (q.kind === 'case' ? cp : qp) ?? q.points;
  const brief = (id) => { const q = qm.get(id); return { id, type: q.type, kind: q.kind, category: q.category, points: pts(q), text: q.text.slice(0, 200) }; };
  return json({ groups: sg.map(g => ({ ...g, q: g.q.map(brief), c: g.c.map(brief) })),
    total: sg.reduce((s, g) => s + g.q.length + g.c.length, 0), max_score: qs.reduce((s, q) => s + pts(q), 0) });
}

async function adminReattAccess(env, id, grantId) {
  const v = await adminReattOne(env, id);
  const { results } = await env.DB.prepare(`SELECT g.*, u.ic_name, u.global_name, u.username, b.ic_name AS b_ic, b.global_name AS b_gn, b.username AS b_un,
      (SELECT COUNT(*) FROM attempts a WHERE a.reatt = g.reatt_key AND json_extract(a.meta, '$.grant') = g.id) AS used
    FROM reatt_access g LEFT JOIN users u ON u.id = g.user_id LEFT JOIN users b ON b.id = g.granted_by WHERE g.reatt_key = ?1 ORDER BY g.revoked_at IS NOT NULL, g.id DESC LIMIT 300`).bind(v.key).all();
  const now = Date.now();
  const { results: users } = await env.DB.prepare("SELECT id, ic_name, global_name, username, reatt FROM users WHERE blocked = 0 AND reatt = 1 ORDER BY COALESCE(ic_name, global_name, username)").all();
  const grants = results.map(g => ({ id: g.id, user_id: g.user_id, user_name: g.user_id ? (g.ic_name || g.global_name || g.username || g.user_id) : null, expires_at: g.expires_at, attempts: g.attempts, used: g.used, note: g.note,
      granted_by: g.b_ic || g.b_gn || g.b_un || g.granted_by, granted_at: g.granted_at, revoked_at: g.revoked_at,
      active: !g.revoked_at && (g.expires_at == null || g.expires_at > now) && (g.attempts == null || g.user_id == null || g.used < g.attempts) }));
  return json({ key: v.key, title: v.title, now, users: users.map(u => ({ id: u.id, name: u.ic_name || u.global_name || u.username })), grants,
    ...(grantId ? { grant: grants.find(g => g.id === grantId) || null } : {}) }, grantId ? 201 : 200);
}
async function adminReattGrant(request, env, actor, id) {
  const v = await adminReattOne(env, id);
  const b = await readJson(request);
  const uid = b.user_id ? str(b.user_id, 25, { name: 'пользователь' }) : null;
  if (uid) { const u = await env.DB.prepare('SELECT id, reatt FROM users WHERE id = ?1').bind(uid).first(); if (!u) throw new HttpError(404, 'Пользователь не найден'); if (!u.reatt) throw new HttpError(400, 'У пользователя нет роли «Переаттестация» — сначала выдайте роль'); }
  let exp = null;
  if (b.expires_at !== undefined && b.expires_at !== null && b.expires_at !== '') { exp = Number(b.expires_at); if (!Number.isFinite(exp) || exp <= Date.now() || exp > Date.now() + 366 * 86400000) throw new HttpError(400, 'Срок доступа: момент в будущем (не дальше года)'); exp = Math.floor(exp); }
  const att = b.attempts === undefined || b.attempts === null || b.attempts === '' ? null : int(b.attempts, 1, 100, 'количество попыток');
  const note = str(b.note, 300, { name: 'примечание' });
  const r = await env.DB.prepare('INSERT INTO reatt_access (reatt_key, user_id, expires_at, attempts, note, granted_by, granted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id')
    .bind(v.key, uid, exp, att, note, actor.id, Date.now()).first();
  await audit(env, actor, 'reatt.grant', String(id), { grant: r.id, key: v.key, user_id: uid || 'все с ролью', expires_at: exp, attempts: att });
  return adminReattAccess(env, id, r.id);
}
async function adminReattRevoke(env, actor, gid) {
  const g = await env.DB.prepare('SELECT * FROM reatt_access WHERE id = ?1').bind(gid).first();
  if (!g) throw new HttpError(404, 'Выдача не найдена');
  if (!g.revoked_at) await env.DB.prepare('UPDATE reatt_access SET revoked_at = ?1, revoked_by = ?2 WHERE id = ?3').bind(Date.now(), actor.id, gid).run();
  const v = await env.DB.prepare('SELECT id FROM reattestations WHERE key = ?1').bind(g.reatt_key).first();
  await audit(env, actor, 'reatt.revoke', v ? String(v.id) : g.reatt_key, { grant: gid, user_id: g.user_id || 'все с ролью' });
  return v ? adminReattAccess(env, v.id) : json({ ok: true });
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
  return env.DB.prepare('INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at, topic, base, difficulty, source_doc, source_ref) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?15, ?16, ?17, ?18, ?19, ?20)')
    .bind(examId, o.type, o.text, JSON.stringify(o.options), JSON.stringify(o.correct), o.reference, o.points, o.position || 0, JSON.stringify(o.data), o.category || '', o.kind, o.easy, o.active, o.ext_id || null, now, o.topic || null,
      o.base || null, o.difficulty || null, o.source_doc || null, o.source_ref || null);
}
// topic: undefined — не трогать (правка без поля), null/'' — снять.
function updateQStmt(env, id, o, now) {
  const k = (v) => (v !== undefined ? 1 : 0);
  return env.DB.prepare(`UPDATE questions SET type = ?1, text = ?2, options = ?3, correct = ?4, reference = ?5, points = ?6, position = COALESCE(?7, position), data = ?8, category = ?9, kind = ?10, easy = ?11, active = ?12, ext_id = COALESCE(?13, ext_id), updated_at = ?14, topic = CASE WHEN ?16 = 1 THEN ?17 ELSE topic END,
      base = CASE WHEN ?18 = 1 THEN ?19 ELSE base END, difficulty = CASE WHEN ?20 = 1 THEN ?21 ELSE difficulty END, source_doc = CASE WHEN ?22 = 1 THEN ?23 ELSE source_doc END, source_ref = CASE WHEN ?24 = 1 THEN ?25 ELSE source_ref END WHERE id = ?15`)
    .bind(o.type, o.text, JSON.stringify(o.options), JSON.stringify(o.correct), o.reference, o.points, o.position ?? null, JSON.stringify(o.data), o.category || '', o.kind, o.easy, o.active, o.ext_id || null, now, id, o.topic !== undefined ? 1 : 0, o.topic || null,
      k(o.base), o.base || null, k(o.difficulty), o.difficulty || null, k(o.source_doc), o.source_doc || null, k(o.source_ref), o.source_ref || null);
}
async function adminBank(env, url) {
  const f = (k) => (url.searchParams.get(k) || '').trim();
  const where = ['exam_id = 0']; const binds = [];
  const add = (sql, v) => { binds.push(v); where.push(sql.replace('?', '?' + binds.length)); };
  if (f('category')) { const c = f('category'); if (c.endsWith('*')) add("category LIKE ? ESCAPE '\\'", c.slice(0, -1).replace(/[%_\\]/g, m => '\\' + m) + '%'); else add('category = ?', c); }
  if (f('kind')) add('kind = ?', f('kind'));
  if (f('type')) add('type = ?', f('type'));
  if (f('active') === '0') where.push('active = 0');
  if (f('active') === '1') where.push('active = 1');
  if (f('base') === '-') where.push('base IS NULL'); else if (f('base') === '*') where.push('base IS NOT NULL'); else if (f('base')) add('base = ?', f('base'));
  if (f('difficulty')) add('difficulty = ?', Number(f('difficulty')) || 0);
  if (f('source_doc') === '-') where.push("(source_doc IS NULL OR source_doc = '')"); else if (f('source_doc')) add('source_doc = ?', f('source_doc'));
  if (f('q')) { binds.push('%' + f('q').replace(/[%_\\]/g, m => '\\' + m) + '%'); const n = binds.length; where.push(`(text LIKE ?${n} ESCAPE '\\' OR ext_id LIKE ?${n} ESCAPE '\\')`); }
  const limit = Math.min(500, Math.max(1, Number(f('limit')) || 100)), offset = Math.max(0, Number(f('offset')) || 0);
  const w = where.join(' AND ');
  const total = await env.DB.prepare(`SELECT COUNT(*) AS c FROM questions WHERE ${w}`).bind(...binds).first();
  const { results } = await env.DB.prepare(`SELECT * FROM questions WHERE ${w} ORDER BY category, kind, id LIMIT ${limit} OFFSET ${offset}`).bind(...binds).all();
  const { results: cats } = await env.DB.prepare("SELECT category, kind, COUNT(*) AS c FROM questions WHERE exam_id = 0 GROUP BY category, kind ORDER BY category").all();
  return json({ total: total.c, questions: results.map(q => toNative(q)), categories: cats });
}
// Сводка по базам переаттестаций: количество, распределение по сложности, типам и документам.
async function reattBaseStats(env) {
  const { results } = await env.DB.prepare("SELECT base, active, kind, type, difficulty, source_doc, COUNT(*) AS c FROM questions WHERE exam_id = 0 AND base IS NOT NULL GROUP BY base, active, kind, type, difficulty, source_doc").all();
  const out = {};
  for (const b of R6_BASE_ORDER) out[b] = { base: b, title: R6_BASES[b], active: 0, inactive: 0, by_difficulty: { 1: 0, 2: 0, 3: 0, '-': 0 }, by_type: {}, by_doc: {}, by_topic: {}, cases: 0 };
  for (const r of results) {
    const o = out[r.base]; if (!o) continue;
    if (!r.active) { o.inactive += r.c; continue; }
    o.active += r.c; o.by_difficulty[r.difficulty || '-'] += r.c;
    o.by_type[r.type] = (o.by_type[r.type] || 0) + r.c;
    const doc = r.source_doc || '-'; o.by_doc[doc] = (o.by_doc[doc] || 0) + r.c;
    const t = docTopic(r.source_doc); o.by_topic[t] = (o.by_topic[t] || 0) + r.c;
    if (r.kind === 'case') o.cases += r.c;
  }
  return out;
}
// Проверка привязки вопросов баз к документам и качества (для админки и тестов).
function lintQuestion(q) {
  const d = parseJ(q.data, {}); const issues = [];
  const add = (level, code, msg) => issues.push({ level, code, msg });
  if (!q.source_doc) add('err', 'no_doc', 'Не указан документ-источник');
  else if (!SOURCE_DOC_MAP.has(q.source_doc)) add('err', 'unknown_doc', `Документ «${q.source_doc}» не загружен в проект`);
  if (!q.source_ref) add('err', 'no_ref', 'Не указан пункт / статья');
  if (!(d.meta && d.meta.quote)) add('warn', 'no_quote', 'Нет цитаты из документа');
  if (!q.difficulty) add('err', 'no_difficulty', 'Не указана сложность');
  if (q.type === 'blanks_select') (d.blanks || []).forEach((b, k) => { if ((b.opts || []).length !== 4) add('err', 'blank_opts', `Пропуск ${k + 1}: вариантов ${(b.opts || []).length}, нужно ровно 4`); });
  if (q.type === 'text' && !(d.accepted || []).length) add('err', 'text_no_answer', 'Нет допустимых ответов');
  if (q.type === 'hotspot' && !(d.media || []).length) add('err', 'no_media', 'Нет изображения');
  if (q.type === 'single' || q.type === 'multi') {
    const opts = parseJ(q.options, []), corr = new Set(parseJ(q.correct, []));
    const L = (o) => o.text.length; const right = opts.filter(o => corr.has(o.id)), wrong = opts.filter(o => !corr.has(o.id));
    if (q.type === 'single' && right.length === 1 && wrong.length) {
      const r = L(right[0]), mw = Math.max(...wrong.map(L)), avg = wrong.reduce((s, o) => s + L(o), 0) / wrong.length;
      if (r > mw && r > avg * 1.35 && r - mw > 8) add('warn', 'length_hint', 'Правильный вариант заметно длиннее остальных — угадывается по длине');
    }
    if (wrong.length < 2 && q.type === 'single') add('warn', 'few_options', 'Меньше трёх вариантов ответа');
  }
  return issues;
}
async function bankCheck(env, url) {
  const base = (url.searchParams.get('base') || '').trim();
  const { results } = await env.DB.prepare(`SELECT * FROM questions WHERE exam_id = 0 AND base IS NOT NULL AND active = 1${base ? ' AND base = ?1' : ''} ORDER BY base, id`).bind(...(base ? [base] : [])).all();
  const { results: med } = await env.DB.prepare('SELECT key FROM media').all();
  const mkeys = new Set(med.map(m => m.key));
  const items = []; const sets = new Map();
  for (const q of results) {
    const issues = lintQuestion(q); const d = parseJ(q.data, {});
    const refs = (d.media || []).concat(parseJ(q.options, []).map(o => o.media).filter(Boolean)).filter(m => m.m);
    for (const m of refs) if (!mkeys.has(m.m)) issues.push({ level: 'err', code: 'media_missing', msg: 'Изображение не найдено: ' + m.m });
    const ws = wordSet(q.text + ' ' + (d.content || ''));
    for (const [oid, o] of sets) if (o.base === q.base && nearDup(ws, o.ws)) { issues.push({ level: 'warn', code: 'near_dup', msg: `Почти совпадает с #${oid}` }); break; }
    sets.set(q.id, { base: q.base, ws });
    if (issues.length) items.push({ id: q.id, ext_id: q.ext_id, base: q.base, type: q.type, source_doc: q.source_doc, source_ref: q.source_ref, text: q.text.slice(0, 200), issues });
  }
  const errors = items.reduce((s, x) => s + x.issues.filter(i => i.level === 'err').length, 0);
  return json({ checked: results.length, errors, warnings: items.reduce((s, x) => s + x.issues.filter(i => i.level === 'warn').length, 0), items, docs: SOURCE_DOCS, bases: R6_BASES });
}
// ---------- изображения для вопросов (D1, base64, до 1 МБ; отдаются по неугадываемому ключу) ----------
function b64Size(data) { return Math.floor(data.length * 3 / 4) - (data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0); }
function mediaPayload(b) {
  const mime = str(b.mime, 100, { required: true, name: 'тип файла' }).toLowerCase();
  if (!MEDIA_MIMES.includes(mime)) throw new HttpError(400, 'Допустимы изображения PNG, JPEG, WEBP, GIF (схемы SVG вставляются в вопрос текстом)');
  const data = typeof b.data === 'string' ? b.data.replace(/^data:[^,]*,/, '') : '';
  if (!data || !/^[A-Za-z0-9+/]+=*$/.test(data)) throw new HttpError(400, 'Некорректные данные файла');
  const size = b64Size(data);
  if (size > UPLOAD_HARD_MAX) throw new HttpError(413, `Файл слишком большой: ${Math.ceil(size / 1024)} КБ (макс. ${UPLOAD_HARD_MAX / 1024} КБ)`);
  return { mime, data, size, name: str(b.name, 200, { name: 'имя файла' }) || 'image' };
}
async function uploadMedia(request, env, user) {
  const p = mediaPayload(await readJson(request, 1500000));
  const key = randToken(24).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32);
  const r = await env.DB.prepare('INSERT INTO media (key, name, mime, size, data, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id').bind(key, p.name, p.mime, p.size, p.data, user.id, Date.now()).first();
  await audit(env, user, 'media.upload', String(r.id), { name: p.name, size: p.size });
  return json({ media: { id: r.id, key, name: p.name, mime: p.mime, size: p.size } }, 201);
}
async function replaceMedia(request, env, user, id) {
  const cur = await env.DB.prepare('SELECT id, key FROM media WHERE id = ?1').bind(id).first(); if (!cur) throw new HttpError(404, 'Изображение не найдено');
  const p = mediaPayload(await readJson(request, 1500000));
  await env.DB.prepare('UPDATE media SET name = ?1, mime = ?2, size = ?3, data = ?4, created_by = ?5, created_at = ?6 WHERE id = ?7').bind(p.name, p.mime, p.size, p.data, user.id, Date.now(), id).run();
  await audit(env, user, 'media.replace', String(id), { name: p.name, size: p.size });
  return json({ media: { id, key: cur.key, name: p.name, mime: p.mime, size: p.size } });
}
async function listMedia(env) {
  const { results } = await env.DB.prepare('SELECT id, key, name, mime, size, created_at FROM media ORDER BY id DESC LIMIT 500').all();
  const { results: qs } = await env.DB.prepare(`SELECT id, data, options FROM questions WHERE data LIKE '%"m":%' OR options LIKE '%"m":%'`).all();
  return json({ media: results.map(m => ({ ...m, used_by: qs.filter(q => (q.data || '').includes(m.key) || (q.options || '').includes(m.key)).map(q => q.id) })) });
}
async function deleteMedia(env, user, id) {
  const cur = await env.DB.prepare('SELECT id, key, name FROM media WHERE id = ?1').bind(id).first(); if (!cur) throw new HttpError(404, 'Изображение не найдено');
  const used = await env.DB.prepare('SELECT id FROM questions WHERE data LIKE ?1 OR options LIKE ?1 LIMIT 1').bind('%' + cur.key + '%').first();
  if (used) throw new HttpError(409, `Изображение используется в вопросе #${used.id} — сначала уберите его из вопроса или замените файл`);
  await env.DB.prepare('DELETE FROM media WHERE id = ?1').bind(id).run();
  await audit(env, user, 'media.delete', String(id), { name: cur.name });
  return json({ ok: true });
}
async function serveMedia(env, key) {
  if (!MEDIA_KEY_RE.test(key)) throw new HttpError(404, 'Не найдено');
  const m = await env.DB.prepare('SELECT mime, data FROM media WHERE key = ?1').bind(key).first();
  if (!m) throw new HttpError(404, 'Не найдено');
  const bin = Uint8Array.from(atob(m.data), c => c.charCodeAt(0));
  return new Response(bin, { status: 200, headers: { 'Content-Type': m.mime, 'Cache-Control': 'public, max-age=86400', 'Content-Security-Policy': "default-src 'none'", 'Cross-Origin-Resource-Policy': 'cross-origin' } });
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
const LECTURE_PUB_MSG = 'Чтобы опубликовать лекцию, укажите ссылку на видео или текст лекции и длительность (больше 0; для текстовой — время чтения). Черновик можно сохранить и без них.';
function lectureInput(b, partial) {
  const o = {};
  if (!partial || b.title !== undefined) o.title = str(b.title, 200, { required: true, name: 'название' });
  if (!partial || b.description !== undefined) o.description = str(b.description, 10000, { name: 'описание' });
  if (!partial || b.video_url !== undefined) o.video_url = validVideoUrl(str(b.video_url, 1000, { name: 'ссылка на видео' }));
  if (!partial || b.body !== undefined) o.body = str(b.body, 200000, { name: 'текст лекции' });
  if (!partial || b.duration_sec !== undefined) o.duration_sec = parseDuration(b.duration_sec);
  if (!partial || b.position !== undefined) o.position = int(b.position, 0, 100000, 'порядок', 0);
  if (!partial || b.required !== undefined) o.required = bool(b.required, true);
  if (!partial || b.published !== undefined) o.published = bool(b.published, false);
  if (!partial || b.course_id !== undefined) o.course_id = b.course_id ? idParam(b.course_id) : null;
  if (!partial || b.topic_id !== undefined) o.topic_id = b.topic_id ? idParam(b.topic_id) : null;
  if (o.published && ('video_url' in o || 'duration_sec' in o)) {
    // проверка ниже, при публикации
  }
  return o;
}
async function adminLectures(env) {
  const { results } = await env.DB.prepare(`SELECT l.*, (SELECT COUNT(*) FROM lecture_progress p WHERE p.lecture_id = l.id AND p.completed_at IS NOT NULL) AS watched_count FROM lectures l ORDER BY position, id`).all();
  return json({ lectures: results.map(l => ({ ...l, ...videoInfo(l.video_url) })) });
}
async function checkCourse(env, cid) { if (cid && !(await env.DB.prepare('SELECT id FROM courses WHERE id = ?1').bind(cid).first())) throw new HttpError(400, 'Курс не найден (возможно, удалён). Обновите страницу.'); }
async function saveLecture(request, env, user, id) {
  const b = await readJson(request);
  const o = lectureInput(b, !!id);
  if (o.topic_id) { // лекция темы всегда в курсе этой темы
    const t = await env.DB.prepare('SELECT id, course_id, link_topic_id FROM topics WHERE id = ?1').bind(o.topic_id).first();
    if (!t) throw new HttpError(400, 'Тема не найдена (возможно, удалена). Обновите страницу.');
    if (t.link_topic_id) throw new HttpError(400, 'Эта тема связана с другой — лекции добавляются в исходную тему');
    o.course_id = t.course_id;
  }
  await checkCourse(env, o.course_id);
  const now = Date.now();
  if (id) {
    const cur = await env.DB.prepare('SELECT * FROM lectures WHERE id = ?1').bind(id).first();
    if (!cur) throw new HttpError(404, 'Лекция не найдена');
    const m = { ...cur, ...o };
    if (m.published && ((!m.video_url && !m.body) || !m.duration_sec)) throw new HttpError(400, LECTURE_PUB_MSG);
    const keys = Object.keys(o);
    if (keys.length) {
      await env.DB.prepare(`UPDATE lectures SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${keys.length + 1} WHERE id = ?${keys.length + 2}`)
        .bind(...keys.map(k => o[k]), now, id).run();
    }
    await audit(env, user, 'lecture.update', id, o);
    const lr = await env.DB.prepare('SELECT * FROM lectures WHERE id = ?1').bind(id).first();
    return json({ lecture: { ...lr, ...videoInfo(lr.video_url) } });
  }
  if (o.published && ((!o.video_url && !o.body) || !o.duration_sec)) throw new HttpError(400, LECTURE_PUB_MSG);
  if (b.position === undefined) { const mx = await env.DB.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM lectures').first(); o.position = mx.m + 10; }
  const r = await env.DB.prepare('INSERT INTO lectures (title, description, video_url, duration_sec, position, required, published, course_id, created_at, updated_at, body, topic_id) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?9, ?8, ?8, ?10, ?11) RETURNING *')
    .bind(o.title, o.description, o.video_url, o.duration_sec, o.position, o.required, o.published, now, o.course_id ?? null, o.body || '', o.topic_id ?? null).first();
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
  f('course_id', v => v ? idParam(v) : null);
  f('bank_category', v => str(v, 300, { name: 'категория банка' }) || null);
  f('bank_count', v => int(v, 0, 500, 'вопросов из банка', 0));
  if (b.topic_ids !== undefined) {
    if (!Array.isArray(b.topic_ids) || b.topic_ids.length > 50) throw new HttpError(400, 'Темы экзамена: нужен список id тем');
    o.topic_ids = JSON.stringify([...new Set(b.topic_ids.map(idParam))]);
  }
  return o;
}
async function adminExams(env) {
  const { results } = await env.DB.prepare(`SELECT e.*, (SELECT COUNT(*) FROM questions q WHERE q.exam_id = e.id) AS question_count,
    (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = e.id) AS attempt_count,
    (SELECT COUNT(*) FROM attempts a WHERE a.exam_id = e.id AND a.status = 'pending_review') AS pending_count FROM exams e ORDER BY position, id`).all();
  const { results: lec } = await env.DB.prepare('SELECT id, title, published, required, position, course_id, topic_id FROM lectures ORDER BY position, id').all();
  const links = await examLinks(env); const tmap = await topicMap(env);
  return json({ exams: results.map(e => ({ ...e, topic_ids: examTopicIds(e), ...examLecturesAdmin(e, lec, links, tmap) })) });
}
// Обязательные лекции экзамена для админки: что учитывается и что игнорируется (черновики / удалённые).
function examLecturesAdmin(e, lec, links, tmap) {
  const mode = examMode(e);
  const lm = new Map(lec.map(l => [l.id, l]));
  const ids = mode === 'selected' ? (links.get(e.id) || []).slice().sort((a, b) => {
    const la = lm.get(a), lb = lm.get(b); return (la ? la.position : 1e9) - (lb ? lb.position : 1e9) || a - b; }) : [];
  const required_lectures = ids.map(id => { const l = lm.get(id); return l ? { id, title: l.title, published: !!l.published, deleted: false } : { id, title: null, published: false, deleted: true }; });
  const tids = mode === 'topics' && tmap ? new Set(examTopicIds(e).map(x => topicRoot(tmap, x))) : null;
  const effective = mode === 'all' ? lec.filter(l => l.published && l.required && (!e.course_id || l.course_id === e.course_id)).length
    : mode === 'topics' ? lec.filter(l => l.published && l.required && tids.has(l.topic_id)).length : required_lectures.filter(l => l.published).length;
  const warnings = [];
  for (const l of required_lectures) {
    if (l.deleted) warnings.push(`Лекция #${l.id} удалена — не учитывается`);
    else if (!l.published) warnings.push(`«${l.title}» — черновик, не учитывается, пока не опубликована`);
  }
  if (mode === 'selected' && required_lectures.length && !effective) warnings.push('Ни одна выбранная лекция не опубликована — экзамен сейчас открыт без лекций');
  if (mode === 'topics' && !effective) warnings.push('В темах экзамена нет опубликованных обязательных лекций — экзамен сейчас открыт без лекций');
  return { lecture_mode: mode, required_lecture_ids: ids, required_lectures, effective_lecture_count: effective, lecture_warnings: warnings };
}
async function adminExam(env, id) {
  const e = await env.DB.prepare('SELECT * FROM exams WHERE id = ?1').bind(id).first();
  if (!e) throw new HttpError(404, 'Экзамен не найден');
  const { results } = await env.DB.prepare('SELECT * FROM questions WHERE exam_id = ?1 ORDER BY position, id').bind(id).all();
  const { results: lec } = await env.DB.prepare('SELECT id, title, published, required, position, course_id, topic_id FROM lectures ORDER BY position, id').all();
  return json({ exam: { ...e, topic_ids: examTopicIds(e), ...examLecturesAdmin(e, lec, await examLinks(env, id), await topicMap(env)) }, questions: results.map(qOut) });
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
  await checkCourse(env, o.course_id);
  const rl = await parseRequiredLectures(env, b.required_lectures);
  if (rl) { o.requires_lectures = rl.requires_lectures; o.lecture_mode = rl.lecture_mode; }
  else if (!id) o.lecture_mode = 'all';
  if (o.topic_ids !== undefined) { // экзамен темы / группы тем: допуск — после всех обязательных лекций этих тем
    const ids = JSON.parse(o.topic_ids);
    if (ids.length) {
      const { results } = await env.DB.prepare(`SELECT id FROM topics WHERE id IN (${ids.map((_, i) => '?' + (i + 1)).join(', ')})`).bind(...ids).all();
      if (results.length !== ids.length) throw new HttpError(400, 'Тема экзамена не найдена (возможно, удалена). Обновите страницу.');
      o.requires_lectures = 1; o.lecture_mode = 'topics'; // темы важнее списка лекций
    } else if (!rl) { const cur = id ? await env.DB.prepare('SELECT lecture_mode FROM exams WHERE id = ?1').bind(id).first() : null; if (!id || (cur && cur.lecture_mode === 'topics')) o.lecture_mode = 'all'; }
  }
  const now = Date.now();
  if (id) {
    const cur = await env.DB.prepare('SELECT id FROM exams WHERE id = ?1').bind(id).first();
    if (!cur) throw new HttpError(404, 'Экзамен не найден');
    if (o.published) {
      const m = { ...(await env.DB.prepare('SELECT * FROM exams WHERE id = ?1').bind(id).first()), ...o };
      const qc = await env.DB.prepare('SELECT COUNT(*) AS c FROM questions WHERE exam_id = ?1').bind(id).first();
      if (!(await examQCount(env, m, qc.c))) throw new HttpError(400, 'Чтобы опубликовать экзамен, добавьте хотя бы один вопрос (или укажите категорию банка с вопросами). Черновик можно сохранить и без вопросов.');
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

// --- курсы (админ) ---
function courseInput(b, partial) {
  const o = {};
  if (!partial || b.title !== undefined) o.title = str(b.title, 200, { required: true, name: 'название курса' });
  if (!partial || b.description !== undefined) o.description = str(b.description, 10000, { name: 'описание курса' });
  if (!partial || b.published !== undefined) o.published = bool(b.published, true);
  if (b.position !== undefined) o.position = int(b.position, 0, 100000, 'порядок', 0);
  if (!partial || b.track !== undefined) { o.track = b.track === undefined || b.track === null || b.track === '' ? 'rank' : String(b.track); if (!['rank', 'position'].includes(o.track)) throw new HttpError(400, 'Система курса: «rank» (звания) или «position» (должности)'); }
  if (!partial || b.subtitle !== undefined) o.subtitle = str(b.subtitle, 200, { name: 'подзаголовок' });
  return o;
}
async function topicMap(env) { const { results } = await env.DB.prepare('SELECT * FROM topics').all(); return new Map(results.map(t => [t.id, t])); }
async function adminCourses(env) {
  const { results } = await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM lectures l WHERE l.course_id = c.id) AS lecture_count,
    (SELECT COUNT(*) FROM exams e WHERE e.course_id = c.id) AS exam_count FROM courses c ORDER BY c.position, c.id`).all();
  const { results: lec } = await env.DB.prepare('SELECT id, title, published, required, course_id, position FROM lectures ORDER BY position, id').all();
  const { results: ex } = await env.DB.prepare('SELECT id, title, published, course_id, requires_lectures, lecture_mode FROM exams ORDER BY position, id').all();
  const { results: tp } = await env.DB.prepare('SELECT t.id, t.course_id, t.title, t.status, t.published, t.position, t.link_topic_id, t.doc_id, (t.video_url != \'\') AS has_video, (t.video_plan != \'\') AS has_plan, (SELECT COUNT(*) FROM lectures l WHERE l.topic_id = t.id) AS lecture_count FROM topics t ORDER BY t.position, t.id').all();
  return json({ courses: results, lectures: lec, exams: ex, topics: tp });
}
async function saveCourse(request, env, user, id) {
  const b = await readJson(request); const o = courseInput(b, !!id); const now = Date.now();
  if (id) {
    if (!(await env.DB.prepare('SELECT id FROM courses WHERE id = ?1').bind(id).first())) throw new HttpError(404, 'Курс не найден');
    const keys = Object.keys(o);
    if (keys.length) await env.DB.prepare(`UPDATE courses SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${keys.length + 1} WHERE id = ?${keys.length + 2}`).bind(...keys.map(k => o[k]), now, id).run();
    await audit(env, user, 'course.update', id, o);
  } else {
    if (o.position === undefined) { const mx = await env.DB.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM courses').first(); o.position = mx.m + 10; }
    const r = await env.DB.prepare('INSERT INTO courses (title, description, published, position, created_at, updated_at, track, subtitle) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?7) RETURNING id').bind(o.title, o.description, o.published, o.position, now, o.track, o.subtitle).first();
    id = r.id; await audit(env, user, 'course.create', id, { title: o.title });
  }
  // состав курса: лекции и экзамены (по списку id; остальные из этого курса — «без курса»)
  const stmts = [];
  for (const [k, t] of [['lecture_ids', 'lectures'], ['exam_ids', 'exams']]) {
    if (!Array.isArray(b[k])) continue;
    const ids = [...new Set(b[k].map(idParam))].slice(0, 500);
    stmts.push(env.DB.prepare(`UPDATE ${t} SET course_id = NULL WHERE course_id = ?1`).bind(id));
    // порядок в курсе: те же позиции, что были у этих записей, раздаются в новом порядке
    let pos = [];
    if (ids.length) { const { results } = await env.DB.prepare(`SELECT id, position FROM ${t} WHERE id IN (${ids.map((_, i) => '?' + (i + 1)).join(', ')})`).bind(...ids).all();
      if (results.length !== ids.length) throw new HttpError(400, (t === 'lectures' ? 'Лекция' : 'Экзамен') + ' не найден(а) — обновите страницу');
      pos = results.map(r => r.position).sort((x, y) => x - y); for (let i = 1; i < pos.length; i++) if (pos[i] <= pos[i - 1]) pos[i] = pos[i - 1] + 1; }
    ids.forEach((x, i) => stmts.push(env.DB.prepare(`UPDATE ${t} SET course_id = ?1, position = ?3 WHERE id = ?2`).bind(id, x, pos[i])));
  }
  if (stmts.length) await env.DB.batch(stmts);
  const c = await env.DB.prepare('SELECT * FROM courses WHERE id = ?1').bind(id).first();
  return json({ course: c });
}
async function deleteCourse(env, user, id) {
  const c = await env.DB.prepare('SELECT * FROM courses WHERE id = ?1').bind(id).first(); if (!c) throw new HttpError(404, 'Курс не найден');
  await env.DB.batch([env.DB.prepare('UPDATE lectures SET course_id = NULL, topic_id = NULL WHERE course_id = ?1').bind(id), env.DB.prepare('UPDATE exams SET course_id = NULL WHERE course_id = ?1').bind(id),
    env.DB.prepare('UPDATE topics SET link_topic_id = NULL WHERE link_topic_id IN (SELECT id FROM topics WHERE course_id = ?1)').bind(id),
    env.DB.prepare('DELETE FROM topics WHERE course_id = ?1').bind(id), env.DB.prepare('DELETE FROM courses WHERE id = ?1').bind(id)]);
  await audit(env, user, 'course.delete', id, { title: c.title });
  return json({ ok: true });
}

// --- темы курсов (админ) ---
const TOPIC_STATUS = ['ready', 'draft', 'placeholder'];
async function adminTopics(env) {
  const { results } = await env.DB.prepare(`SELECT t.*, c.title AS course_title, c.track, (SELECT COUNT(*) FROM lectures l WHERE l.topic_id = t.id) AS lecture_count
    FROM topics t LEFT JOIN courses c ON c.id = t.course_id ORDER BY c.track, c.position, t.position, t.id`).all();
  const { results: docs } = await env.DB.prepare('SELECT id, category, title FROM docs WHERE deleted_at IS NULL ORDER BY category, position, id').all();
  const { results: courses } = await env.DB.prepare('SELECT id, title, track FROM courses ORDER BY position, id').all();
  return json({ topics: results.map(t => ({ ...t, video_plan: undefined, has_plan: !!t.video_plan })), docs, courses });
}
async function adminTopic(env, id) {
  const t = await env.DB.prepare('SELECT * FROM topics WHERE id = ?1').bind(id).first(); if (!t) throw new HttpError(404, 'Тема не найдена');
  const { results: lectures } = await env.DB.prepare('SELECT id, title, published, required, position, duration_sec, (body != \'\') AS has_body, video_url FROM lectures WHERE topic_id = ?1 ORDER BY position, id').bind(id).all();
  const { results: exams } = await env.DB.prepare("SELECT id, title, published, topic_ids FROM exams ORDER BY position, id").all();
  return json({ topic: { ...t, ...videoInfo(t.video_url) }, lectures, exams: exams.filter(e => examTopicIds(e).includes(id)).map(e => ({ id: e.id, title: e.title, published: !!e.published })) });
}
async function saveTopic(request, env, user, id) {
  const b = await readJson(request, 120000); const now = Date.now(); const o = {}; const part = !!id;
  const f = (k, fn) => { if (!part || b[k] !== undefined) o[k] = fn(b[k]); };
  f('course_id', v => idParam(v));
  f('title', v => str(v, 200, { required: true, name: 'название темы' }));
  f('description', v => str(v, 5000, { name: 'описание темы' }));
  f('status', v => { const x = v || 'ready'; if (!TOPIC_STATUS.includes(x)) throw new HttpError(400, 'Статус темы: ready, draft или placeholder'); return x; });
  f('published', v => bool(v, true));
  f('link_topic_id', v => v ? idParam(v) : null);
  f('doc_id', v => v ? idParam(v) : null);
  f('video_url', v => validVideoUrl(str(v, 1000, { name: 'ссылка на видео' })));
  f('video_plan', v => str(v, 50000, { name: 'план ролика' }));
  if (b.position !== undefined) o.position = int(b.position, 0, 100000, 'порядок', 0);
  if (o.course_id) await checkCourse(env, o.course_id);
  if (o.doc_id && !(await env.DB.prepare('SELECT id FROM docs WHERE id = ?1 AND deleted_at IS NULL').bind(o.doc_id).first())) throw new HttpError(400, 'Статья Базы данных не найдена');
  if (o.link_topic_id) {
    if (o.link_topic_id === id) throw new HttpError(400, 'Тема не может ссылаться сама на себя');
    const lt = await env.DB.prepare('SELECT id, link_topic_id FROM topics WHERE id = ?1').bind(o.link_topic_id).first();
    if (!lt) throw new HttpError(400, 'Связанная тема не найдена'); if (lt.link_topic_id) throw new HttpError(400, 'Связывать можно только с исходной темой (не со связанной)');
    if (id && (await env.DB.prepare('SELECT COUNT(*) AS c FROM lectures WHERE topic_id = ?1').bind(id).first()).c) throw new HttpError(400, 'В теме есть свои лекции — перенесите их, прежде чем связывать тему с другой');
    if (id && (await env.DB.prepare('SELECT COUNT(*) AS c FROM topics WHERE link_topic_id = ?1').bind(id).first()).c) throw new HttpError(400, 'На эту тему ссылаются другие — её нельзя сделать связанной');
  }
  if (id) {
    const cur = await env.DB.prepare('SELECT * FROM topics WHERE id = ?1').bind(id).first(); if (!cur) throw new HttpError(404, 'Тема не найдена');
    const keys = Object.keys(o);
    const stmts = [];
    if (keys.length) stmts.push(env.DB.prepare(`UPDATE topics SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_at = ?${keys.length + 1} WHERE id = ?${keys.length + 2}`).bind(...keys.map(k => o[k]), now, id));
    if (o.course_id && o.course_id !== cur.course_id) stmts.push(env.DB.prepare('UPDATE lectures SET course_id = ?1 WHERE topic_id = ?2').bind(o.course_id, id));
    if (stmts.length) await env.DB.batch(stmts);
    await audit(env, user, 'topic.update', id, { ...o, video_plan: o.video_plan !== undefined ? '(план ролика)' : undefined });
  } else {
    if (o.position === undefined) { const mx = await env.DB.prepare('SELECT COALESCE(MAX(position), 0) AS m FROM topics WHERE course_id = ?1').bind(o.course_id).first(); o.position = mx.m + 10; }
    const keys = Object.keys(o);
    const r = await env.DB.prepare(`INSERT INTO topics (${keys.join(', ')}, created_at, updated_at) VALUES (${keys.map((_, i) => '?' + (i + 1)).join(', ')}, ?${keys.length + 1}, ?${keys.length + 1}) RETURNING id`).bind(...keys.map(k => o[k]), now).first();
    id = r.id; await audit(env, user, 'topic.create', id, { title: o.title, course_id: o.course_id });
  }
  return adminTopic(env, id);
}
async function deleteTopic(env, user, id) {
  const t = await env.DB.prepare('SELECT * FROM topics WHERE id = ?1').bind(id).first(); if (!t) throw new HttpError(404, 'Тема не найдена');
  const { results: ex } = await env.DB.prepare('SELECT id, topic_ids FROM exams').all();
  const stmts = [env.DB.prepare('UPDATE lectures SET topic_id = NULL WHERE topic_id = ?1').bind(id), env.DB.prepare('UPDATE topics SET link_topic_id = NULL WHERE link_topic_id = ?1').bind(id), env.DB.prepare('DELETE FROM topics WHERE id = ?1').bind(id)];
  for (const e of ex) { const ids = examTopicIds(e); if (ids.includes(id)) stmts.push(env.DB.prepare('UPDATE exams SET topic_ids = ?1 WHERE id = ?2').bind(JSON.stringify(ids.filter(x => x !== id)), e.id)); }
  await env.DB.batch(stmts);
  await audit(env, user, 'topic.delete', id, { title: t.title });
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
  const { results: atts0 } = await env.DB.prepare('SELECT a.*, e.title AS exam_title FROM attempts a LEFT JOIN exams e ON e.id = a.exam_id WHERE a.user_id = ?1 ORDER BY a.id DESC').bind(id).all();
  const atts = await attemptTitles(env, atts0);
  const { results: plog } = await env.DB.prepare(`SELECT a.action, a.details, a.at, a.actor_id, x.ic_name, x.global_name, x.username FROM audit_log a LEFT JOIN users x ON x.id = a.actor_id
    WHERE a.target = ?1 AND a.action IN ('profile.update', 'profile.self') ORDER BY a.id DESC LIMIT 50`).bind(id).all();
  return json({ user: publicUser({ ...u, super: isSuper(env, u.id), role: isSuper(env, u.id) ? 'admin' : u.role }), lectures: lec,
    profile_log: plog.map(r => ({ at: r.at, self: r.action === 'profile.self', by: r.ic_name || r.global_name || r.username || r.actor_id, changes: (({ via, ...c }) => c)(parseJ(r.details, {})) })),
    attempts: atts.map(a => ({ id: a.id, exam_id: a.exam_id, reatt: a.reatt || null, exam_title: a.exam_title, status: a.status, started_at: a.started_at, submitted_at: a.submitted_at, score_pct: a.score_pct, expired: !!a.expired })) });
}
const PROFILE_FIELDS = ['ic_name', 'rank', 'static_id', 'position'];
const PROFILE_NAMES = { ic_name: 'Имя Фамилия', rank: 'звание', static_id: 'статик', position: 'должность' };
function profileInput(b, partial) {
  const o = {}; const lim = { ic_name: 100, rank: 60, static_id: 30, position: 80 };
  for (const k of PROFILE_FIELDS) if (!partial || b[k] !== undefined) o[k] = str(b[k], lim[k], { name: PROFILE_NAMES[k] });
  return o;
}
async function updateUser(request, env, actor, id) {
  const b = await readJson(request);
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first();
  if (!u) throw new HttpError(404, 'Пользователь не найден');
  const ch = {};
  const actorAdmin = caps(actor).admin;
  if (!actorAdmin) {
    // руководство (СС): только роли ниже своего уровня и только людям ниже своего уровня
    if (isSuper(env, id) || (ROLE_LVL[u.role] ?? 0) >= ROLE_LVL.manager) throw new HttpError(403, 'Изменять администраторов и руководство может только администратор сайта');
    const allowed = new Set(['role', 'vp', 'reatt', ...PROFILE_FIELDS]);
    const bad = Object.keys(b).filter(k => !allowed.has(k));
    if (bad.length) throw new HttpError(403, bad.includes('leader') ? 'Роль «Руководство ГУ ВП» назначает администратор сайта' : 'Недостаточно прав');
    if (b.role !== undefined && !['candidate', 'examiner'].includes(b.role)) throw new HttpError(403, 'Руководство (СС) может назначать только роли ниже своего уровня');
  }
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) throw new HttpError(400, 'Роль: candidate, examiner, manager или admin');
    if (isSuper(env, id)) throw new HttpError(400, 'Роль главного администратора задаётся в настройках Worker (ADMIN_IDS)');
    if ((b.role === 'admin' || u.role === 'admin') && !actor.super) throw new HttpError(403, 'Назначать и снимать администраторов может только главный администратор');
    ch.role = b.role;
  }
  if (b.blocked !== undefined) {
    if (isSuper(env, id) || id === actor.id) throw new HttpError(400, 'Нельзя заблокировать этого пользователя');
    if ((u.role === 'admin' && !actor.super) || !actorAdmin) throw new HttpError(403, 'Недостаточно прав');
    ch.blocked = bool(b.blocked, false);
  }
  Object.assign(ch, profileInput(b, true));
  if (b.leader !== undefined) ch.leader = bool(b.leader, false); // роль «Руководство ГУ ВП» — назначают администраторы
  if (b.vp !== undefined) ch.vp = bool(b.vp, false);             // роль «ВП»
  if (b.reatt !== undefined) ch.reatt = bool(b.reatt, false);    // роль «Переаттестация»
  const keys = Object.keys(ch);
  if (!keys.length) throw new HttpError(400, 'Нечего изменять');
  // журнал изменений профиля: было → стало
  const prof = {}; for (const k of PROFILE_FIELDS) if (k in ch && String(u[k] || '') !== String(ch[k] || '')) prof[k] = [u[k] || '', ch[k] || ''];
  if (Object.keys(prof).length) await audit(env, actor, 'profile.update', id, prof);
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
  if (kind && !REATT_KEY_RE.test(kind)) throw new HttpError(400, 'Некорректный фильтр');
  const kw = kind === 'reatt' ? ' AND a.reatt IS NOT NULL' : kind === 'exam' ? ' AND a.reatt IS NULL' : (kind ? ' AND a.reatt = ?2' : '');
  const { results } = await env.DB.prepare(`SELECT a.id, a.exam_id, a.reatt, e.title AS exam_title, a.user_id, u.username, u.global_name, u.ic_name, u.static_id, a.status, a.started_at, a.submitted_at, a.score_pct, a.expired, a.reviewer_id, a.reviewed_at
    FROM attempts a LEFT JOIN exams e ON e.id = a.exam_id LEFT JOIN users u ON u.id = a.user_id WHERE (?1 = '' OR a.status = ?1)${kw} ORDER BY a.id DESC LIMIT 500`).bind(...(kw.includes('?2') ? [status, kind] : [status])).all();
  const { results: rl } = await env.DB.prepare('SELECT key, title, deleted_at FROM reattestations ORDER BY position, id').all();
  return json({ attempts: await attemptTitles(env, results), reatt_list: rl.map(r => ({ key: r.key, title: r.title, deleted: !!r.deleted_at })) });
}
async function adminAttempt(env, id) {
  let a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(id).first();
  if (!a) throw new HttpError(404, 'Попытка не найдена');
  if (await finalizeIfExpired(env, a)) a = await env.DB.prepare('SELECT * FROM attempts WHERE id = ?1').bind(id).first();
  const ctx = await attemptCtx(env, a);
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(a.user_id).first();
  const rv = a.reviewer_id ? await env.DB.prepare('SELECT id, username, global_name FROM users WHERE id = ?1').bind(a.reviewer_id).first() : null;
  const order = parseJ(a.q_order, []), states = parseJ(a.opt_order, {});
  const qs = await loadAttemptQs(env, a, order);
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
  const qs = await loadAttemptQs(env, a, parseJ(a.q_order, []));
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
  const status = verdict === 'auto' ? (isPassed(ctx, total, pct) ? 'passed' : 'failed') : verdict;
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
  if (b.promo_missing_points !== undefined) ch.promo_missing_points = bool(b.promo_missing_points, true) ? '1' : '0';
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
// ===================================================================================
// ---------- Отчёты и премии (единая экосистема с сайтом отчётов vp-raport-offline) ----------
// Неделя — понедельник 'YYYY-MM-DD'. Срок подачи — воскресенье 19:00 МСК (UTC+3, без перехода на летнее время).
// Конфигурация (prem_config): items — пункты отчёта и выплата за 1 действие (Таблицы 1–2 приказа № 01_10),
// positions — оклады по должностям (Таблица «Все выплаты»), plan — строки минимального/нормального плана
// и какие пункты в них засчитываются, rules — проценты вычета, лимиты, сроки.
const PREM_DEFAULT = {
  items: [
    // Основная отчётность (wk — баллы еженедельного отчёта, 'n' — баллы вписываются вручную)
    { key: 'postavka', name: 'Участие в поставочном мероприятии', group: 'main', pay: 12500, pay_name: 'Участие в поставочном мероприятии', wk: 20 },
    { key: 'otbitie', name: 'Участие в отбитии гос. складов', group: 'main', pay: 11500, pay_name: 'Участие в отбитии гос. складов', wk: 20 },
    { key: 'training', name: 'Проведение тренировки для военнослужащих', group: 'main', pay: 9500, pay_name: 'Проведение тренировки для военнослужащих', wk: 3 },
    { key: 'proc', name: 'Передать проц. действия правоохранительным органам', group: 'main', pay: 9500, pay_name: 'Передать проц. действия', wk: 5 },
    { key: 'event6', name: 'Организовать МП', group: 'main', pay: 12000, pay_name: 'Организовать МП', wk: 'n' },
    { key: 'gmp_org', name: 'Организовать ГМП', group: 'main', pay: 50000, pay_name: 'Организовать ГМП', wk: 'n' },
    { key: 'pmp', name: 'Проведение ПМП', group: 'main', pay: 1500, pay_name: 'Проведение ПМП', wk: 3 },
    { key: 'excursion', name: 'Проведение экскурсий для граждан по территории ВЧ', group: 'main', pay: 30000, pay_name: 'Проведение экскурсий для граждан по территории ВЧ', wk: 25 },
    { key: 'oath', name: 'Принятие присяги у ВА', group: 'main', pay: 5000, pay_name: 'Принятие присяги ВА', wk: 1 },
    // Дополнительная отчётность
    { key: 'kraz', name: 'Участие в КРАЗе', group: 'extra', pay: 13000, pay_name: 'Участие в КРАЗе' },
    { key: 'mp_visit', name: 'Посетить МП', group: 'extra', pay: 5000, pay_name: 'Посетить МП' },
    { key: 'gmp', name: 'Посетить ГМП', group: 'extra', pay: 10500, pay_name: 'Посетить ГМП' },
    { key: 'poverka', name: 'Участие в вечерней поверке', group: 'extra', pay: 8500, pay_name: 'Участие в вечерней поверке' },
    { key: 'post_kom', name: 'Пост дежурный по комендатуре 60 минут', group: 'extra', pay: 15000, pay_name: 'Пост Дежурный по Комендатуре 60 минут' },
    { key: 'post_shtab', name: 'Пост дежурный по штабу 60 минут', group: 'extra', pay: 15000, pay_name: 'Пост Дежурный по Штабу 60 минут' },
    { key: 'post_kpp1', name: 'Пост дежурный по КПП - 1 60 минут', group: 'extra', pay: 35000, pay_name: 'Пост Дежурный по КПП-1 60 минут' },
    { key: 'post_kpp2', name: 'Пост дежурный по КПП - 2 60 минут', group: 'extra', pay: 30000, pay_name: 'Пост Дежурный по КПП-2 60 минут' },
    { key: 'naryad', name: 'Наряд ВП (КПП, патруль гарнизона, комендантский пост, 60 мин)', group: 'extra', pay: 0, pay_name: '', legacy: true },
    { key: 'sso', name: 'Участие в налёте в форме ССО', group: 'extra', pay: 13000, pay_name: 'Участие в налёте в форме ССО' },
    { key: 'patrol_city', name: 'Патруль по городу 60 минут', group: 'extra', pay: 38000, pay_name: 'Патруль по городу 60 минут' },
    { key: 'patrol_gar', name: 'Патруль по гарнизону 60 минут', group: 'extra', pay: 35000, pay_name: 'Патруль по гарнизону 60 минут' },
    { key: 'patrol_vch', name: 'Патруль по ВЧ 60 минут', group: 'extra', pay: 27000, pay_name: 'Патруль по ВЧ 60 минут' },
    { key: 'patrol', name: 'Организация патрулирования', group: 'extra', pay: 0, pay_name: '', legacy: true },
    { key: 'lecture_va', name: 'Проведение лекции ВА', group: 'extra', pay: 7000, pay_name: 'Проведение лекции ВА' },
    { key: 'exam_va', name: 'Проведение экзамена ВА', group: 'extra', pay: 7500, pay_name: 'Проведение экзаменов ВА' },
    { key: 'thanks', name: 'Благодарность от руководства', group: 'extra', pay: 2500, pay_name: 'Получение благодарности от руководства (50 баллов)' },
    // Работа ГУ ВП
    { key: 'city', name: 'Вывести военнослужащего в город', group: 'gu', pay: 5000, pay_name: 'Вывести военнослужащего в город' },
    { key: 'reattest', name: 'Провести переаттестацию', group: 'gu', pay: 7500, pay_name: 'Провести переаттестацию' },
    { key: 'vzysk', name: 'Написание рапорта на взыскание / выдача взыскания', group: 'gu', pay: 7000, pay_name: 'Написание рапорта на взыскание / выдача взыскания' },
    { key: 'vygovor', name: 'Выговор, не из рапорта на взыскание', group: 'gu', pay: 0, pay_name: '', legacy: true },
    { key: 'prof', name: 'Организация профилактического мероприятия', group: 'gu', pay: 6500, pay_name: 'Организация профилактического мероприятия' },
    { key: 'prizyv', name: 'Принять участие в призывных мероприятиях', group: 'gu', pay: 13500, pay_name: 'Принять участие в призывных мероприятиях' },
    { key: 'guardhouse', name: 'Посадить военнослужащего на гауптвахту', group: 'gu', pay: 7500, pay_name: 'Посадить военнослужащего на гауптвахту' },
    { key: 'convoy', name: 'Сопровождение колонны ВС РФ', group: 'gu', pay: 4500, pay_name: 'Сопровождение колонны ВС РФ' },
    { key: 'complaint', name: 'Рассмотрение жалобы на сотрудника ВС РФ', group: 'gu', pay: 7500, pay_name: 'Рассмотрение жалобы на сотрудника' },
    { key: 'otrab', name: 'Рассмотрение рапорта на отработку дисц. взыскания', group: 'gu', pay: 8000, pay_name: 'Рассмотрение рапорта на отработку дисц. взыскания' },
    { key: 'obzhal', name: 'Рассмотрение рапорта на обжалование дисц. взыскания', group: 'gu', pay: 8000, pay_name: 'Рассмотрение рапорта на обжалование дисц. взыскания' },
    { key: 'docs', name: 'Проверка документов у личного состава', group: 'gu', pay: 4500, pay_name: 'Проверка документов у личного состава' },
    { key: 'inspect', name: 'Личный осмотр личного состава', group: 'gu', pay: 4000, pay_name: 'Личный осмотр личного состава' },
    { key: 'lecture_vp', name: 'Проведение лекции ВП', group: 'gu', pay: 7000, pay_name: 'Проведение лекции ВП' },
    { key: 'exam_vp', name: 'Проведение экзамена ВП', group: 'gu', pay: 8000, pay_name: 'Проведение экзамена ВП' },
    { key: 'soch', name: 'Поиски и поимка СОЧ', group: 'gu', pay: 40000, pay_name: 'Поиски и поимка СОЧ' },
  ],
  positions: [
    { key: 'kom_gar', name: 'Комендант Гарнизона', zero: 85000, min: 170000, avg: 340000, max: 850000 },
    { key: 'kom_bat', name: 'Ком. Бат. ВП', zero: 80000, min: 160000, avg: 320000, max: 800000 },
    { key: 'zam_kom_bat', name: 'Зам. Ком. Бат. ВП', zero: 75000, min: 150000, avg: 300000, max: 750000 },
    { key: 'insp_kom', name: 'Инспектор Комендатуры', zero: 68750, min: 137500, avg: 275000, max: 687500 },
    { key: 'instr', name: 'Инструктор ВП', zero: 65000, min: 130000, avg: 260000, max: 650000 },
    { key: 'insp', name: 'Инспектор ВП', zero: 55000, min: 110000, avg: 220000, max: 550000 },
    { key: 'stazh', name: 'Стажёр ВП', zero: 35000, min: 70000, avg: 140000, max: 350000 },
  ],
  plan: [
    { key: 'postavka', name: 'Участие в поставочных мероприятиях', min: 6, normal: 10, items: ['postavka'] },
    { key: 'otbitie', name: 'Участие в отбитиях гос. складов', min: 2, normal: 3, items: ['otbitie'] },
    { key: 'proc', name: 'Передача проц. действий правоохранительным органам', min: 1, normal: 2, items: ['proc'] },
    { key: 'event', name: 'Мероприятия внутри ВС РФ (МП, тренировка, профилактическое)', min: 1, normal: 2, items: ['event6', 'training', 'prof'] },
    { key: 'pmp', name: 'Реанимации военнослужащих (ПМП)', min: 3, normal: 5, items: ['pmp'] },
    { key: 'gu', name: 'Действия ГУ ВП (вся «Работа ГУ ВП» + проц. действия + тренировки)', min: 5, normal: 8,
      items: ['city', 'reattest', 'vzysk', 'vygovor', 'prof', 'prizyv', 'guardhouse', 'convoy', 'complaint', 'otrab', 'obzhal', 'docs', 'inspect', 'lecture_vp', 'exam_vp', 'soch', 'proc', 'training'] },
  ],
  rules: {
    ded_none: 50, ded_min: 20,           // вычет из выплат за действия, %: отчёт без минимального плана / минимальный план
    add_cap: 400000,                     // дополнительная премия — не больше на человека
    award_min: 100000, award_max: 700000, // наградная премия из фонда
    ss_max: 500000,                      // премия старшего состава
    person_cap: 2000000,                 // оклад + премия + дополнительная + наградная (из фонда)
    thanks_points: 50,                   // 1 благодарность = 50 баллов
    fund_min: 8000000, fund_max: 20000000,
    ss_contrib_min: 150000,              // еженедельный взнос СС в бюджет ГУ ВП
    deadline_dow: 0, deadline_hour: 19,  // воскресенье 19:00 МСК
  },
};
const PREM_CFG_KEYS = ['items', 'positions', 'plan', 'rules'];
const MSK_OFFSET_MS = 3 * 3600 * 1000;
const WEEK_RE = /^\d{4}-\d{2}-\d{2}$/;
const POS_ALIASES = { 'комендант гарнизона': 'kom_gar', 'ком. бат. вп': 'kom_bat', 'ком. бат вп': 'kom_bat', 'командир батальона вп': 'kom_bat', 'командир батальона военной полиции': 'kom_bat',
  'зам. ком. бат. вп': 'zam_kom_bat', 'зам. ком. бат вп': 'zam_kom_bat', 'заместитель командира батальона вп': 'zam_kom_bat', 'инспектор комендатуры': 'insp_kom', 'инспектор военной комендатуры': 'insp_kom',
  'инструктор вп': 'instr', 'инспектор вп': 'insp', 'стажёр вп': 'stazh', 'стажер вп': 'stazh' };

// --- даты ---
function weekOf(ms) { // понедельник недели (по МСК), куда попадает момент ms
  const d = new Date(ms + MSK_OFFSET_MS); const dow = (d.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow)).toISOString().slice(0, 10);
}
function weekParam(v, name = 'неделя') {
  const s = String(v || '');
  if (!WEEK_RE.test(s)) throw new HttpError(400, `Некорректная ${name}: нужен понедельник ГГГГ-ММ-ДД`);
  const d = new Date(s + 'T00:00:00Z'); if (isNaN(d) || d.toISOString().slice(0, 10) !== s || d.getUTCDay() !== 1) throw new HttpError(400, `Некорректная ${name}: нужен понедельник ГГГГ-ММ-ДД`);
  return s;
}
function addDays(week, n) { const d = new Date(week + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
function weekDeadline(week, rules = PREM_DEFAULT.rules) { // epoch ms: день недели deadline_dow (0 = вс) в deadline_hour по МСК
  const off = rules.deadline_dow === 0 ? 6 : rules.deadline_dow - 1;
  return Date.parse(addDays(week, off) + 'T00:00:00Z') + rules.deadline_hour * 3600000 - MSK_OFFSET_MS;
}

// --- конфигурация ---
async function premConfig(env) {
  const cfg = JSON.parse(JSON.stringify(PREM_DEFAULT));
  const { results } = await env.DB.prepare('SELECT k, v FROM prem_config').all();
  for (const r of results) { const v = parseJ(r.v, null); if (v && PREM_CFG_KEYS.includes(r.k)) cfg[r.k] = r.k === 'rules' ? { ...PREM_DEFAULT.rules, ...v } : v; }
  return cfg;
}
function money(v, name, max = 100000000) { return int(v === '' || v == null ? 0 : Math.round(Number(v)), 0, max, name); }
function premConfigInput(k, v) {
  if (k === 'items') {
    if (!Array.isArray(v) || !v.length || v.length > 200) throw new HttpError(400, 'Пункты: нужен непустой список');
    const seen = new Set();
    return v.map((x, i) => {
      const key = str(x.key, 40, { required: true, name: `пункт ${i + 1}: ключ` });
      if (!/^[a-z0-9_]{1,40}$/.test(key) || seen.has(key)) throw new HttpError(400, `Пункт ${i + 1}: ключ — латиница/цифры/_, без повторов`); seen.add(key);
      const group = ['main', 'extra', 'gu'].includes(x.group) ? x.group : (() => { throw new HttpError(400, `Пункт ${key}: группа main/extra/gu`); })();
      const o = { key, name: str(x.name, 200, { required: true, name: `пункт ${key}: название` }), group, pay: money(x.pay, `пункт ${key}: выплата`, 10000000), pay_name: str(x.pay_name, 200, { name: 'строка таблицы' }) };
      if (group === 'main') o.wk = x.wk === 'n' ? 'n' : int(x.wk, 0, 1000, `пункт ${key}: баллы`, 0);
      if (x.legacy) o.legacy = true;
      return o;
    });
  }
  if (k === 'positions') {
    if (!Array.isArray(v) || !v.length || v.length > 30) throw new HttpError(400, 'Должности: нужен непустой список');
    const seen = new Set();
    return v.map((x, i) => {
      const key = str(x.key, 40, { required: true, name: `должность ${i + 1}: ключ` });
      if (!/^[a-z0-9_]{1,40}$/.test(key) || seen.has(key)) throw new HttpError(400, `Должность ${i + 1}: ключ — латиница/цифры/_, без повторов`); seen.add(key);
      const o = { key, name: str(x.name, 100, { required: true, name: `должность ${key}: название` }) };
      for (const f of ['zero', 'min', 'avg', 'max']) o[f] = money(x[f], `должность ${o.name}: ${f}`);
      if (!(o.zero <= o.min && o.min <= o.avg && o.avg <= o.max)) throw new HttpError(400, `Должность ${o.name}: должно быть нулевой ≤ минимальный ≤ средний ≤ максимальная выплата`);
      return o;
    });
  }
  if (k === 'plan') {
    if (!Array.isArray(v) || v.length > 30) throw new HttpError(400, 'План: нужен список строк');
    const seen = new Set();
    return v.map((x, i) => {
      const key = str(x.key, 40, { required: true, name: `строка плана ${i + 1}: ключ` });
      if (!/^[a-z0-9_]{1,40}$/.test(key) || seen.has(key)) throw new HttpError(400, `Строка плана ${i + 1}: ключ — латиница/цифры/_, без повторов`); seen.add(key);
      const items = (Array.isArray(x.items) ? x.items : String(x.items || '').split(',')).map(s => String(s).trim()).filter(Boolean);
      if (!items.length) throw new HttpError(400, `Строка плана «${x.name || key}»: укажите пункты`);
      const o = { key, name: str(x.name, 200, { required: true, name: `строка плана ${key}: название` }), min: int(x.min, 0, 1000, 'минимальный план'), normal: int(x.normal, 0, 1000, 'нормальный план'), items: [...new Set(items)] };
      if (o.normal < o.min) throw new HttpError(400, `Строка плана «${o.name}»: нормальный план не может быть меньше минимального`);
      return o;
    });
  }
  if (k === 'rules') {
    const d = PREM_DEFAULT.rules, o = {};
    o.ded_none = int(v.ded_none ?? d.ded_none, 0, 100, 'вычет без плана, %'); o.ded_min = int(v.ded_min ?? d.ded_min, 0, 100, 'вычет при минимальном плане, %');
    for (const f of ['add_cap', 'award_min', 'award_max', 'ss_max', 'person_cap', 'fund_min', 'fund_max', 'ss_contrib_min']) o[f] = money(v[f] ?? d[f], f, 1000000000);
    o.thanks_points = int(v.thanks_points ?? d.thanks_points, 1, 10000, 'баллов за благодарность');
    o.deadline_dow = int(v.deadline_dow ?? d.deadline_dow, 0, 6, 'день срока'); o.deadline_hour = int(v.deadline_hour ?? d.deadline_hour, 0, 23, 'час срока');
    if (o.award_min > o.award_max) throw new HttpError(400, 'Наградная премия: минимум больше максимума');
    if (o.fund_min > o.fund_max) throw new HttpError(400, 'Фонд: минимум больше максимума');
    return o;
  }
  throw new HttpError(400, 'Неизвестный раздел настроек');
}
function positionKey(cfg, v) {
  const s = String(v || '').trim(); if (!s) return '';
  if (cfg.positions.some(p => p.key === s)) return s;
  const low = s.toLowerCase().replace(/\s+/g, ' ');
  const byName = cfg.positions.find(p => p.name.toLowerCase() === low); if (byName) return byName.key;
  return POS_ALIASES[low] && cfg.positions.some(p => p.key === POS_ALIASES[low]) ? POS_ALIASES[low] : '';
}

// --- движок премий (чистые функции, покрыты tests/prem-unit.js) ---
// Засчитанные количества: отклонённые проверяющим пункты не идут, n_ok — принятое количество (если проверяющий его уменьшил).
function premCounts(items, review) {
  const c = {};
  for (const it of items || []) {
    if (it.custom) continue;
    const rv = (review || {})[it.key] || {};
    if (rv.status === 'rejected') continue;
    const n = rv.n_ok != null ? Math.min(rv.n_ok, it.n) : it.n;
    if (n > 0) c[it.key] = (c[it.key] || 0) + n;
  }
  return c;
}
function premPlan(cfg, counts) {
  const lines = cfg.plan.map(l => { const got = l.items.reduce((s, k) => s + (counts[k] || 0), 0); return { key: l.key, name: l.name, got, min: l.min, normal: l.normal, ok_min: got >= l.min, ok_normal: got >= l.normal }; });
  const level = lines.every(l => l.ok_normal) ? 'normal' : lines.every(l => l.ok_min) ? 'min' : 'none';
  return { level, lines, missing_min: lines.filter(l => !l.ok_min).map(l => ({ key: l.key, name: l.name, need: l.min - l.got })), missing_normal: lines.filter(l => !l.ok_normal).map(l => ({ key: l.key, name: l.name, need: l.normal - l.got })) };
}
// Базовая премия одного сотрудника: оклад по уровню плана + выплаты за действия − вычет, не больше максимальной выплаты должности.
function premBase(cfg, p) {
  const r = { eligible: false, reason: '', plan: null, actions: 0, deduct_pct: 0, deduction: 0, oklad: 0, oklad_tier: '', gross: 0, base: 0, excess: 0, max: 0 };
  if (!p.report) { r.reason = 'нет отчёта'; return r; }
  if (p.late) { r.reason = 'отчёт после срока'; return r; }
  if (p.status === 'rejected') { r.reason = 'отчёт отклонён'; return r; }
  const pos = cfg.positions.find(x => x.key === p.position);
  const counts = p.counts || {};
  r.plan = premPlan(cfg, counts);
  const pay = new Map(cfg.items.map(i => [i.key, i.pay || 0]));
  r.actions = Object.entries(counts).reduce((s, [k, n]) => s + (pay.get(k) || 0) * n, 0);
  if (!pos) { r.reason = 'должность не указана'; return r; }
  r.max = pos.max;
  const R = cfg.rules;
  if (r.plan.level === 'normal') { r.oklad_tier = 'avg'; r.oklad = pos.avg; r.deduct_pct = 0; }
  else if (r.plan.level === 'min') { r.oklad_tier = 'min'; r.oklad = pos.min; r.deduct_pct = R.ded_min; }
  else { r.oklad_tier = 'zero'; r.oklad = pos.zero; r.deduct_pct = R.ded_none; }
  r.deduction = Math.round(r.actions * r.deduct_pct / 100);
  r.gross = r.oklad + r.actions - r.deduction;
  r.base = Math.min(r.gross, pos.max);
  r.excess = Math.max(0, r.gross - pos.max);
  r.eligible = true;
  return r;
}
// Делит available между запросами want[] пропорционально (целые рубли, вниз); если хватает — платит всё.
function premShare(want, available) {
  const total = want.reduce((s, x) => s + x, 0);
  if (total <= 0) return { paid: want.map(() => 0), short: false };
  if (available >= total) return { paid: want.slice(), short: false };
  if (available <= 0) return { paid: want.map(() => 0), short: true };
  return { paid: want.map(x => Math.floor(available * x / total)), short: true };
}
// people: [{user_id, name, position, report:boolean, late, status, counts, award, ss, award_budget, senior}]
// Порядок: базовая премия (оклад + действия) платится всегда → дополнительная (превышение над максимальной выплатой,
// ≤ add_cap, при нехватке — пропорционально) → наградная из фонда → премия СС. Надбавки, на которые не хватает фонда,
// урезаются (пропорционально внутри своей очереди). Лимит на человека person_cap: оклад + премия + доп. + наградная.
// Премия СС и наградная из бюджета ГУ ВП в лимит не входят. total (= total_fund) — итог из фонда; award_budget — отдельно (бюджет ГУ ВП).
function computePremiums(cfg, fund, people) {
  const R = cfg.rules;
  const rows = people.map(p => ({ user_id: p.user_id, name: p.name, position: p.position, ...premBase(cfg, p), add: 0, award: 0, ss: 0, award_budget: 0, add_want: 0, award_want: 0, ss_want: 0 }));
  const base = rows.reduce((s, r) => s + r.base, 0);
  let left = (fund || 0) - base;
  const fundShort = left < 0;
  const room = (r) => Math.max(0, R.person_cap - r.base - r.add - r.award);
  // дополнительная
  rows.forEach(r => { r.add_want = r.eligible ? Math.min(r.excess, R.add_cap, room(r)) : 0; });
  let sh = premShare(rows.map(r => r.add_want), left); rows.forEach((r, i) => { r.add = sh.paid[i]; }); left -= rows.reduce((s, r) => s + r.add, 0);
  const addShort = sh.short;
  // наградная (из фонда)
  rows.forEach((r, i) => { r.award_want = r.eligible ? Math.min(people[i].award || 0, room(r)) : 0; });
  sh = premShare(rows.map(r => r.award_want), left); rows.forEach((r, i) => { r.award = sh.paid[i]; }); left -= rows.reduce((s, r) => s + r.award, 0);
  const awardShort = sh.short;
  // премия СС (вне лимита на человека)
  rows.forEach((r, i) => { r.ss_want = people[i].senior && r.eligible ? Math.min(people[i].ss || 0, R.ss_max) : 0; });
  sh = premShare(rows.map(r => r.ss_want), left); rows.forEach((r, i) => { r.ss = sh.paid[i]; }); left -= rows.reduce((s, r) => s + r.ss, 0);
  const ssShort = sh.short;
  // «Итого» — только из премиального фонда; наградная из бюджета ГУ ВП идёт из другого источника и считается отдельно
  rows.forEach((r, i) => { r.award_budget = people[i].award_budget || 0; r.total_fund = r.base + r.add + r.award + r.ss; r.total = r.total_fund; });
  const paid = rows.reduce((s, r) => s + r.total_fund, 0);
  return { rows, fund: fund || 0, base_total: base, paid_from_fund: paid, remaining: (fund || 0) - paid, fund_short: fundShort, add_short: addShort, award_short: awardShort, ss_short: ssShort,
    award_budget_total: rows.reduce((s, r) => s + r.award_budget, 0) };
}
function weeklyPoints(cfg, items) {
  const wk = new Map(cfg.items.filter(i => i.group === 'main').map(i => [i.key, i.wk]));
  return (items || []).reduce((s, it) => { const w = wk.get(it.key); if (w === 'n') return s + (it.n > 0 ? (it.vp || 0) : 0); return s + (typeof w === 'number' ? w * it.n : 0); }, 0);
}
function strikeLabel(n) { return n <= 0 ? '' : n === 1 ? 'предупреждение' : n === 2 ? 'выговор' : 'увольнение'; }

// --- отчёты сотрудника ---
// Адресат еженедельного отчёта (блок «Кому» в шапке). gu — прежний фиксированный адресат (по умолчанию для сотрудников и для всех старых отчётов).
// По умолчанию: командир батальона и комендант гарнизона — командиру бригады; старший состав (СС) — заместителю командира бригады по РЛС; остальные — gu.
// Сотрудник может выбрать адресата вручную; руководство может исправить его при проверке. Видимость отчётов адресат не меняет: их видят «Руководство ГУ ВП» и администраторы.
const REPORT_TO = [
  { key: 'gu', name: 'Военный комендант гарнизона, начальник ГУ ВП', short: 'Нач. ГУ ВП', to: 'Военному коменданту гарнизона, начальнику ГУ ВП' },
  { key: 'zam_kombrig_rls', name: 'Заместитель командира бригады по РЛС', short: 'Зам. ком. брига по РЛС', to: 'Заместителю командира бригады по РЛС' },
  { key: 'kombrig', name: 'Командир бригады', short: 'Ком. бриг', to: 'Командиру бригады' },
];
const REPORT_TO_KEYS = REPORT_TO.map(a => a.key);
function reportToDefault(position, senior) {
  if (position === 'kom_bat' || position === 'kom_gar') return 'kombrig';
  if (senior) return 'zam_kombrig_rls';
  return 'gu';
}
function reportToKey(v) {
  const s = String(v == null ? '' : v).trim(); if (!s) return '';
  if (REPORT_TO_KEYS.includes(s)) return s;
  const low = s.toLowerCase(); const a = REPORT_TO.find(x => [x.name, x.short, x.to].some(t => t.toLowerCase() === low));
  if (a) return a.key;
  throw new HttpError(400, 'Адресат отчёта: ' + REPORT_TO.map(a => a.name).join(', '));
}
const reportToInfo = (k) => REPORT_TO.find(a => a.key === k) || REPORT_TO[0];
const REPORT_STATUS = ['submitted', 'review', 'approved', 'rejected'];
function cleanLinks(v) {
  const arr = (Array.isArray(v) ? v : String(v || '').split(/\s+/)).map(s => String(s).trim()).filter(Boolean);
  if (arr.length > 60) throw new HttpError(400, 'Слишком много ссылок у одного пункта (макс. 60)');
  return arr.map(u => { if (u.length > 1000 || !/^https?:\/\/[^\s]+$/i.test(u)) throw new HttpError(400, 'Ссылка должна начинаться с http:// или https://: ' + u.slice(0, 80)); return u; });
}
function reportInput(cfg, b, senior) {
  const week = weekParam(b.week);
  const h = b.header || {};
  const position = positionKey(cfg, b.position || h.position);
  if (!position) throw new HttpError(400, 'Выберите должность из списка (' + cfg.positions.map(p => p.name).join(', ') + ')');
  const header = {
    number: str(h.number, 40, { name: 'номер' }), date: str(h.date, 20, { name: 'дата' }),
    rank: str(h.rank, 60, { required: true, name: 'звание' }), name: str(h.name, 100, { required: true, name: 'имя фамилия' }),
    static_id: str(h.static_id, 30, { required: true, name: 'номер удостоверения' }), unit: str(h.unit, 120, { name: 'подразделение' }),
    from: str(h.from, 20, { name: 'начало периода' }), to: str(h.to, 20, { name: 'конец периода' }),
    result: str(h.result, 2000, { name: 'общий результат' }), extra: str(h.extra, 2000, { name: 'дополнительные сведения' }),
  };
  if (header.from && header.from !== week) throw new HttpError(400, 'Отчётный период должен начинаться с понедельника выбранной недели');
  if (header.to && header.to !== addDays(week, 6)) throw new HttpError(400, 'Отчётный период — с понедельника по воскресенье одной недели');
  const known = new Map(cfg.items.map(i => [i.key, i]));
  if (!Array.isArray(b.items) || b.items.length > 200) throw new HttpError(400, 'Пункты отчёта: нужен список');
  const seen = new Set();
  const items = b.items.map((x, i) => {
    const custom = !!x.custom;
    const key = str(x.key, 40, { required: true, name: `пункт ${i + 1}` });
    if (!/^[a-z0-9_]{1,40}$/i.test(key) || seen.has(key)) throw new HttpError(400, `Пункт ${i + 1}: некорректный или повторный ключ`); seen.add(key);
    if (!custom && !known.has(key)) throw new HttpError(400, `Неизвестный пункт отчёта: ${key}`);
    const k = known.get(key);
    const o = { key, name: custom ? str(x.name, 200, { required: true, name: 'свой пункт' }) : k.name, group: custom ? (['main', 'extra', 'gu'].includes(x.group) ? x.group : 'extra') : k.group,
      n: int(x.n, 0, 1000, `количество «${custom ? x.name : k.name}»`), links: cleanLinks(x.links) };
    if (custom) o.custom = true;
    if (!custom && k.wk === 'n') o.vp = int(x.vp, 0, 100000, `баллы «${k.name}»`, 0);
    if (!custom && key === 'thanks' && x.points != null && x.points !== '') { o.points = int(x.points, 0, 1000000, 'баллы благодарностей'); o.n = Math.floor(o.points / cfg.rules.thanks_points); }
    return o;
  }).filter(x => x.n > 0);
  if (!items.length) throw new HttpError(400, 'В отчёте нет ни одного выполненного пункта');
  // header.to — конец периода (дата), поэтому адресат — отдельное поле: b.addressee (или header.addressee)
  const addressee = reportToKey(b.addressee ?? h.addressee) || reportToDefault(position, senior);
  header.addressee = addressee;
  return { week, position, header, items, addressee };
}
function sameItem(a, b) { return a && b && a.n === b.n && (a.vp || 0) === (b.vp || 0) && JSON.stringify(a.links) === JSON.stringify(b.links); }
async function submitReport(request, env, user) {
  await rateLimit(env, 'report:' + user.id, 30, 600);
  const cfg = await premConfig(env);
  const b = await readJson(request, 400000);
  // имя, звание и статик — из профиля (если заполнены): в отчёте те же данные, что в личном деле
  b.header = { ...(b.header || {}) };
  if (user.ic_name) b.header.name = user.ic_name; if (user.rank) b.header.rank = user.rank; if (user.static_id) b.header.static_id = user.static_id;
  const r = reportInput(cfg, b, !!user.senior);
  const now = Date.now();
  if (r.week > weekOf(now)) throw new HttpError(400, 'Нельзя отправить отчёт за будущую неделю');
  const deadline = weekDeadline(r.week, cfg.rules);
  const points = weeklyPoints(cfg, r.items);
  const old = await env.DB.prepare('SELECT * FROM reports WHERE user_id = ?1 AND week = ?2').bind(user.id, r.week).first();
  const data = JSON.stringify({ header: r.header, items: r.items });
  let id, version;
  if (!old) {
    const late = now > deadline ? 1 : 0;
    const row = await env.DB.prepare(`INSERT INTO reports (user_id, week, position, data, points, status, late, first_submitted_at, submitted_at, version, item_review, created_at, updated_at, addressee)
      VALUES (?1, ?2, ?3, ?4, ?5, 'submitted', ?6, ?7, ?7, 1, '{}', ?7, ?7, ?8) RETURNING id`).bind(user.id, r.week, r.position, data, points, late, now, r.addressee).first();
    id = row.id; version = 1;
  } else {
    // правка в том же отчёте: история версий; опоздание определяется первой отправкой; отметки проверки по изменённым пунктам сбрасываются
    const oldItems = parseJ(old.data, {}).items || [];
    const review = parseJ(old.item_review, {});
    const om = new Map(oldItems.map(i => [i.key, i]));
    for (const k of Object.keys(review)) { const ni = r.items.find(i => i.key === k); if (!ni || !sameItem(om.get(k), ni)) delete review[k]; }
    version = (old.version || 1) + 1; id = old.id;
    await env.DB.batch([
      env.DB.prepare('INSERT INTO report_history (report_id, version, data, position, submitted_at, after_deadline) VALUES (?1, ?2, ?3, ?4, ?5, ?6)').bind(old.id, old.version || 1, old.data, old.position, old.submitted_at, old.submitted_at > deadline ? 1 : 0),
      env.DB.prepare(`UPDATE reports SET position = ?1, data = ?2, points = ?3, status = 'submitted', item_review = ?4, submitted_at = ?5, version = ?6, updated_at = ?5, edited_after_deadline = CASE WHEN ?5 > ?7 THEN 1 ELSE edited_after_deadline END, addressee = ?9 WHERE id = ?8`)
        .bind(r.position, data, points, JSON.stringify(review), now, version, deadline, old.id, r.addressee),
    ]);
  }
  return json({ report: await reportPublic(env, cfg, await env.DB.prepare('SELECT * FROM reports WHERE id = ?1').bind(id).first(), true), created: !old });
}
async function reportPublic(env, cfg, row, mine) {
  if (!row) return null;
  const d = parseJ(row.data, {});
  const review = parseJ(row.item_review, {});
  const counts = premCounts(d.items, review);
  const pos = cfg.positions.find(p => p.key === row.position);
  const o = { id: row.id, user_id: row.user_id, week: row.week, deadline: weekDeadline(row.week, cfg.rules), position: row.position, position_name: pos ? pos.name : row.position,
    header: d.header || {}, items: (d.items || []).map(i => ({ ...i, review: review[i.key] || null })), points: row.points, status: row.status, late: !!row.late, edited_after_deadline: !!row.edited_after_deadline,
    first_submitted_at: row.first_submitted_at, submitted_at: row.submitted_at, version: row.version, comment: row.comment || '', reviewed_at: row.reviewed_at, reviewed_by: row.reviewed_by,
    plan: premPlan(cfg, counts) };
  const to = reportToInfo(row.addressee || (d.header && d.header.addressee) || 'gu');
  Object.assign(o, { addressee: to.key, addressee_name: to.name, addressee_to: to.to });
  return o;
}
async function myReports(env, user, url) {
  const cfg = await premConfig(env);
  const cur = weekOf(Date.now());
  const week = url.searchParams.get('week') ? weekParam(url.searchParams.get('week')) : cur;
  const row = await env.DB.prepare('SELECT * FROM reports WHERE user_id = ?1 AND week = ?2').bind(user.id, week).first();
  const { results } = await env.DB.prepare('SELECT id, week, status, late, submitted_at, version, comment, addressee FROM reports WHERE user_id = ?1 ORDER BY week DESC LIMIT 20').bind(user.id).all();
  return json({ week, current_week: cur, deadline: weekDeadline(week, cfg.rules), now: Date.now(), report: await reportPublic(env, cfg, row, true),
    recent: results.map(r => ({ ...r, late: !!r.late, addressee: r.addressee || 'gu', addressee_name: reportToInfo(r.addressee).name })),
    addressees: REPORT_TO, addressee_default: reportToDefault(user.staff_position || '', !!user.senior), user: publicUser(user) });
}
function premConfigPublic(cfg) {
  return { items: cfg.items, positions: cfg.positions.map(p => ({ key: p.key, name: p.name })), plan: cfg.plan, rules: { thanks_points: cfg.rules.thanks_points, deadline_dow: cfg.rules.deadline_dow, deadline_hour: cfg.rules.deadline_hour },
    addressees: REPORT_TO, addressee_defaults: { kom_bat: 'kombrig', kom_gar: 'kombrig', senior: 'zam_kombrig_rls', other: 'gu' } };
}

// --- руководство: неделя, премии ---
function requireLead(user) { requireCap(user, 'lead'); }
function requireSuper(user) { if (!user.super) throw new HttpError(403, 'Изменять таблицы выплат может только главный администратор'); }
async function weekData(env, week) {
  const cfg = await premConfig(env);
  const [wk, rep, staff, man] = await Promise.all([
    env.DB.prepare('SELECT * FROM prem_weeks WHERE week = ?1').bind(week).first(),
    env.DB.prepare('SELECT r.*, u.username, u.global_name, u.ic_name, u.static_id, u.rank, u.staff, u.senior FROM reports r JOIN users u ON u.id = r.user_id WHERE r.week = ?1').bind(week).all(),
    env.DB.prepare("SELECT id, username, global_name, ic_name, static_id, rank, staff, senior, staff_position, staff_since FROM users WHERE staff = 1 AND (staff_since IS NULL OR staff_since <= ?1)").bind(week).all(),
    env.DB.prepare('SELECT * FROM prem_manual WHERE week = ?1').bind(week).all(),
  ]);
  const manual = new Map(man.results.map(m => [m.user_id, m]));
  const people = new Map();
  const nm = (u) => u.ic_name || u.global_name || u.username || u.id;
  for (const u of staff.results) people.set(u.id, { user_id: u.id, name: nm(u), rank: u.rank || '', static_id: u.static_id || '', staff: 1, senior: !!u.senior, position: u.staff_position || '', report: false, row: null });
  for (const r of rep.results) {
    const d = parseJ(r.data, {}); const p = people.get(r.user_id) || { user_id: r.user_id, name: nm(r), rank: r.rank || '', static_id: r.static_id || '', staff: r.staff ? 1 : 0, senior: !!r.senior };
    Object.assign(p, { report: true, row: r, position: r.position, late: !!r.late, status: r.status, counts: premCounts(d.items, parseJ(r.item_review, {})), items: d.items || [], header: d.header || {} });
    p.name = r.ic_name || (d.header && d.header.name) || p.name; if (!p.static_id && d.header) p.static_id = d.header.static_id || ''; if (!p.rank && d.header) p.rank = d.header.rank || '';
    people.set(r.user_id, p);
  }
  const list = [...people.values()].map(p => { const m = manual.get(p.user_id) || {}; return { ...p, award: m.award || 0, ss: m.ss || 0, award_budget: m.award_budget || 0, manual_note: m.note || '' }; });
  const posOrder = new Map(cfg.positions.map((p, i) => [p.key, i]));
  list.sort((a, b) => (posOrder.get(a.position) ?? 99) - (posOrder.get(b.position) ?? 99) || String(a.name).localeCompare(String(b.name), 'ru'));
  const calc = computePremiums(cfg, wk ? wk.fund : 0, list);
  return { cfg, wk, list, calc };
}
async function leadWeek(env, url) {
  const week = url.searchParams.get('week') ? weekParam(url.searchParams.get('week')) : weekOf(Date.now());
  const { cfg, wk, list, calc } = await weekData(env, week);
  const deadline = weekDeadline(week, cfg.rules);
  const strikes = await strikeMap(env, cfg);
  const rows = list.map((p, i) => ({ user_id: p.user_id, name: p.name, static_id: p.static_id, staff: !!p.staff, senior: !!p.senior, position: p.position, report_id: p.row ? p.row.id : null,
    status: p.report ? p.status : 'missing', late: !!p.late, submitted_at: p.row ? p.row.first_submitted_at : null, edited_after_deadline: p.row ? !!p.row.edited_after_deadline : false,
    points: p.row ? p.row.points : 0, counts: p.counts || {}, manual_note: p.manual_note, m_award: p.award, m_ss: p.ss, strikes: strikes.get(p.user_id) || 0,
    addressee: p.row ? (p.row.addressee || 'gu') : null, addressee_default: reportToDefault(p.position, !!p.senior), ...calc.rows[i] }));
  const leftover = await env.DB.prepare("SELECT id, amount FROM budget_ledger WHERE kind = 'leftover' AND week = ?1 AND deleted_at IS NULL").bind(week).first();
  const { results: delr } = await env.DB.prepare('SELECT COUNT(*) AS c FROM reports_deleted WHERE week = ?1').bind(week).all();
  return json({ week, deadline, deadline_passed: Date.now() > deadline, current_week: weekOf(Date.now()), fund: wk ? wk.fund : 0, fund_note: wk ? wk.note || '' : '', fund_set: !!wk,
    rows, totals: { base: calc.base_total, paid: calc.paid_from_fund, remaining: calc.remaining, award_budget: calc.award_budget_total, fund_short: calc.fund_short, add_short: calc.add_short, award_short: calc.award_short, ss_short: calc.ss_short },
    leftover_posted: leftover ? leftover.amount : null, leftover_stale: !!leftover && leftover.amount !== Math.max(0, calc.remaining), deleted_count: delr[0] ? delr[0].c : 0,
    totals_fund: calc.paid_from_fund, config: { items: cfg.items, positions: cfg.positions, plan: cfg.plan, rules: cfg.rules, addressees: REPORT_TO } });
}
async function leadSetFund(request, env, actor, week) {
  const cfg = await premConfig(env); const b = await readJson(request);
  const fund = money(b.fund, 'премиальный фонд', 1000000000);
  if (fund && (fund < cfg.rules.fund_min || fund > cfg.rules.fund_max)) throw new HttpError(400, `Премиальный фонд — от ${cfg.rules.fund_min.toLocaleString('ru-RU')} до ${cfg.rules.fund_max.toLocaleString('ru-RU')} ₽`);
  const note = str(b.note, 500, { name: 'примечание' });
  await env.DB.prepare('INSERT INTO prem_weeks (week, fund, note, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(week) DO UPDATE SET fund = excluded.fund, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at')
    .bind(week, fund, note, actor.id, Date.now()).run();
  await audit(env, actor, 'prem.fund', week, { fund, note });
  return json({ ok: true });
}
async function leadSetManual(request, env, actor, week, uid) {
  const cfg = await premConfig(env); const R = cfg.rules; const b = await readJson(request);
  const u = await env.DB.prepare('SELECT id, senior FROM users WHERE id = ?1').bind(uid).first();
  if (!u) throw new HttpError(404, 'Пользователь не найден');
  const award = money(b.award, 'наградная премия'), ss = money(b.ss, 'премия СС'), award_budget = money(b.award_budget, 'наградная из бюджета ГУ ВП');
  if (award && (award < R.award_min || award > R.award_max)) throw new HttpError(400, `Наградная премия — от ${R.award_min.toLocaleString('ru-RU')} до ${R.award_max.toLocaleString('ru-RU')} ₽ (или 0)`);
  if (ss && !u.senior) throw new HttpError(400, 'Премия СС — только сотрудникам старшего состава (отметка «СС» в списке состава)');
  if (ss > R.ss_max) throw new HttpError(400, `Премия СС — не больше ${R.ss_max.toLocaleString('ru-RU')} ₽`);
  const note = str(b.note, 500, { name: 'примечание' });
  await env.DB.prepare(`INSERT INTO prem_manual (week, user_id, award, ss, award_budget, note, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
    ON CONFLICT(week, user_id) DO UPDATE SET award = excluded.award, ss = excluded.ss, award_budget = excluded.award_budget, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at`)
    .bind(week, uid, award, ss, award_budget, note, actor.id, Date.now()).run();
  await audit(env, actor, 'prem.manual', uid, { week, award, ss, award_budget, note });
  return json({ ok: true });
}
async function leadPostLeftover(env, actor, week) {
  const { calc } = await weekData(env, week);
  const cfg = await premConfig(env);
  if (Date.now() <= weekDeadline(week, cfg.rules)) throw new HttpError(400, 'Остаток можно перенести только после срока подачи отчётов');
  const amount = Math.max(0, calc.remaining);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare("UPDATE budget_ledger SET deleted_at = ?1, deleted_by = ?2 WHERE kind = 'leftover' AND week = ?3 AND deleted_at IS NULL").bind(now, actor.id, week),
    env.DB.prepare("INSERT INTO budget_ledger (kind, amount, user_id, week, note, created_by, created_at) VALUES ('leftover', ?1, NULL, ?2, ?3, ?4, ?5)").bind(amount, week, 'Остаток премиального фонда', actor.id, now),
  ]);
  await audit(env, actor, 'budget.leftover', week, { amount });
  return json({ ok: true, amount });
}
async function leadReport(env, id) {
  const cfg = await premConfig(env);
  const row = await env.DB.prepare('SELECT * FROM reports WHERE id = ?1').bind(id).first();
  if (!row) throw new HttpError(404, 'Отчёт не найден');
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(row.user_id).first();
  const { results: hist } = await env.DB.prepare('SELECT id, version, position, submitted_at, after_deadline, data FROM report_history WHERE report_id = ?1 ORDER BY version DESC').bind(id).all();
  const rep = await reportPublic(env, cfg, row, false);
  const { calc, list } = await weekData(env, row.week);
  const idx = list.findIndex(p => p.user_id === row.user_id);
  const reviewer = row.reviewed_by ? await env.DB.prepare('SELECT username, global_name, ic_name FROM users WHERE id = ?1').bind(row.reviewed_by).first() : null;
  return json({ report: rep, user: u ? publicUser({ ...u, super: isSuper(env, u.id) }) : null, calc: idx >= 0 ? calc.rows[idx] : null,
    reviewer: reviewer ? (reviewer.ic_name || reviewer.global_name || reviewer.username) : null,
    history: hist.map(h => { const d = parseJ(h.data, {}); return { version: h.version, position: h.position, submitted_at: h.submitted_at, after_deadline: !!h.after_deadline, items: (d.items || []).map(i => ({ key: i.key, name: i.name, n: i.n, links: (i.links || []).length })) }; }),
    config: { items: cfg.items, positions: cfg.positions, plan: cfg.plan, addressees: REPORT_TO } });
}
async function leadReview(request, env, actor, id) {
  const cfg = await premConfig(env);
  const row = await env.DB.prepare('SELECT * FROM reports WHERE id = ?1').bind(id).first();
  if (!row) throw new HttpError(404, 'Отчёт не найден');
  const b = await readJson(request);
  const d = parseJ(row.data, {});
  const review = parseJ(row.item_review, {});
  if (b.items && typeof b.items === 'object') {
    for (const [k, v] of Object.entries(b.items)) {
      const it = (d.items || []).find(i => i.key === k); if (!it) throw new HttpError(400, 'Нет такого пункта в отчёте: ' + k);
      if (v === null || v.status === 'pending') { delete review[k]; continue; }
      if (!['ok', 'rejected'].includes(v.status)) throw new HttpError(400, 'Статус пункта: ok или rejected');
      const o = { status: v.status, comment: str(v.comment, 500, { name: 'комментарий к пункту' }), by: actor.id, at: Date.now() };
      if (v.status === 'ok' && v.n_ok != null && v.n_ok !== '') { o.n_ok = int(v.n_ok, 0, it.n, `принято штук «${it.name}» (0…${it.n})`); if (o.n_ok === it.n) delete o.n_ok; }
      review[k] = o;
    }
  }
  let status = row.status;
  if (b.status !== undefined) { if (!REPORT_STATUS.includes(b.status)) throw new HttpError(400, 'Статус отчёта: submitted, review, approved, rejected'); status = b.status; }
  else if (status === 'submitted' && b.items) status = 'review';
  const comment = b.comment !== undefined ? str(b.comment, 2000, { name: 'комментарий' }) : row.comment;
  let position = row.position;
  if (b.position !== undefined) { position = positionKey(cfg, b.position); if (!position) throw new HttpError(400, 'Неизвестная должность'); }
  let addressee = row.addressee || 'gu';
  if (b.addressee !== undefined) { addressee = reportToKey(b.addressee); if (!addressee) throw new HttpError(400, 'Неизвестный адресат'); }
  await env.DB.prepare('UPDATE reports SET item_review = ?1, status = ?2, comment = ?3, position = ?4, reviewed_by = ?5, reviewed_at = ?6, addressee = ?8 WHERE id = ?7')
    .bind(JSON.stringify(review), status, comment, position, actor.id, Date.now(), id, addressee).run();
  await audit(env, actor, 'report.review', id, { status, items: b.items ? Object.keys(b.items).length : 0, position: position !== row.position ? position : undefined, addressee: addressee !== (row.addressee || 'gu') ? addressee : undefined });
  return leadReport(env, id);
}
// --- состав, нарушения ---
async function leadStaff(env) {
  const { results } = await env.DB.prepare(`SELECT u.id, u.username, u.global_name, u.ic_name, u.static_id, u.staff, u.senior, u.leader, u.staff_position, u.staff_since, u.last_login_at,
      (SELECT COUNT(*) FROM reports r WHERE r.user_id = u.id) AS reports FROM users u ORDER BY u.staff DESC, COALESCE(u.ic_name, u.global_name, u.username)`).all();
  return json({ users: results.map(u => ({ ...u, staff: !!u.staff, senior: !!u.senior, leader: !!u.leader })), current_week: weekOf(Date.now()) });
}
async function leadSetStaff(request, env, actor, uid) {
  const cfg = await premConfig(env); const b = await readJson(request);
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(uid).first(); if (!u) throw new HttpError(404, 'Пользователь не найден');
  const ch = {};
  if (b.staff !== undefined) { ch.staff = bool(b.staff, false); if (ch.staff && !u.staff && b.staff_since === undefined && !u.staff_since) ch.staff_since = weekOf(Date.now()); }
  if (b.senior !== undefined) ch.senior = bool(b.senior, false);
  if (b.staff_position !== undefined) { ch.staff_position = b.staff_position ? positionKey(cfg, b.staff_position) : ''; if (b.staff_position && !ch.staff_position) throw new HttpError(400, 'Неизвестная должность'); }
  if (b.staff_since !== undefined) ch.staff_since = b.staff_since ? weekParam(b.staff_since, 'неделя начала учёта') : null;
  const keys = Object.keys(ch); if (!keys.length) throw new HttpError(400, 'Нечего изменять');
  await env.DB.prepare(`UPDATE users SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')} WHERE id = ?${keys.length + 1}`).bind(...keys.map(k => ch[k]), uid).run();
  await audit(env, actor, 'staff.update', uid, ch);
  return json({ ok: true });
}
// Нарушения: по каждому сотруднику состава — недели с начала учёта (staff_since), срок которых прошёл, без отчёта в срок.
// Снятые руководством (violation_excuses) не считаются. 1 — предупреждение, 2 — выговор, 3+ — увольнение.
async function violationsData(env, cfg) {
  const now = Date.now();
  const { results: staff } = await env.DB.prepare('SELECT id, username, global_name, ic_name, static_id, staff_since, staff_position FROM users WHERE staff = 1').all();
  const { results: reps } = await env.DB.prepare('SELECT user_id, week, late, first_submitted_at FROM reports').all();
  const { results: exc } = await env.DB.prepare('SELECT user_id, week, note, by_id, at FROM violation_excuses').all();
  const rm = new Map(reps.map(r => [r.user_id + '|' + r.week, r]));
  const em = new Map(exc.map(e => [e.user_id + '|' + e.week, e]));
  // ручные взыскания из личных дел — показываются рядом с нарушениями по отчётам (лестница 1–2–3 считается только по отчётам)
  const { results: pen } = await env.DB.prepare("SELECT user_id, COUNT(*) AS n FROM dossier_events WHERE kind = 'penalty' AND deleted_at IS NULL AND lifted_at IS NULL GROUP BY user_id").all();
  const pm = new Map(pen.map(r => [r.user_id, r.n]));
  const lastClosed = (() => { let w = weekOf(now); if (now <= weekDeadline(w, cfg.rules)) w = addDays(w, -7); return w; })();
  const out = [];
  for (const u of staff) {
    const since = u.staff_since || lastClosed;
    const list = [];
    for (let w = since; w <= lastClosed && list.length < 400; w = addDays(w, 7)) {
      const r = rm.get(u.id + '|' + w);
      if (r && !r.late) continue;
      const e = em.get(u.id + '|' + w);
      list.push({ week: w, kind: r ? 'late' : 'missing', excused: !!e, note: e ? e.note : '' });
    }
    const n = list.filter(x => !x.excused).length;
    out.push({ user_id: u.id, name: u.ic_name || u.global_name || u.username, static_id: u.static_id || '', staff_since: u.staff_since, strikes: n, label: strikeLabel(n), list, dossier_penalties: pm.get(u.id) || 0 });
  }
  out.sort((a, b) => b.strikes - a.strikes || String(a.name).localeCompare(String(b.name), 'ru'));
  return { last_closed_week: lastClosed, users: out };
}
async function strikeMap(env, cfg) { const v = await violationsData(env, cfg); return new Map(v.users.map(u => [u.user_id, u.strikes])); }
async function leadExcuse(request, env, actor) {
  const b = await readJson(request);
  const uid = str(b.user_id, 25, { required: true, name: 'пользователь' }); const week = weekParam(b.week);
  if (b.excused) await env.DB.prepare('INSERT OR REPLACE INTO violation_excuses (user_id, week, note, by_id, at) VALUES (?1, ?2, ?3, ?4, ?5)').bind(uid, week, str(b.note, 300, { name: 'причина' }), actor.id, Date.now()).run();
  else await env.DB.prepare('DELETE FROM violation_excuses WHERE user_id = ?1 AND week = ?2').bind(uid, week).run();
  await audit(env, actor, b.excused ? 'violation.excuse' : 'violation.restore', uid, { week });
  return json({ ok: true });
}
// --- бюджет ГУ ВП ---
const LEDGER_KINDS = { contribution: 1, leftover: 1, income: 1, withdrawal: -1 };
async function leadBudget(env, url) {
  const cfg = await premConfig(env);
  const week = url.searchParams.get('week') ? weekParam(url.searchParams.get('week')) : weekOf(Date.now());
  const { results } = await env.DB.prepare(`SELECT l.*, u.ic_name, u.global_name, u.username, c.ic_name AS c_ic, c.global_name AS c_gn, c.username AS c_un
    FROM budget_ledger l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN users c ON c.id = l.created_by ORDER BY l.created_at DESC LIMIT 1000`).all();
  const { results: awards } = await env.DB.prepare('SELECT m.week, m.user_id, m.award_budget, u.ic_name, u.global_name, u.username FROM prem_manual m LEFT JOIN users u ON u.id = m.user_id WHERE m.award_budget > 0 ORDER BY m.week DESC').all();
  const live = results.filter(r => !r.deleted_at);
  const balance = live.reduce((s, r) => s + (LEDGER_KINDS[r.kind] || 0) * r.amount, 0) - awards.reduce((s, a) => s + a.award_budget, 0);
  const { results: seniors } = await env.DB.prepare('SELECT id, ic_name, global_name, username FROM users WHERE senior = 1 ORDER BY COALESCE(ic_name, global_name, username)').all();
  const paid = new Map(); live.filter(r => r.kind === 'contribution' && r.week === week).forEach(r => paid.set(r.user_id, (paid.get(r.user_id) || 0) + r.amount));
  const nm = (a, b, c, id) => a || b || c || id || '';
  return json({ week, balance, min_contribution: cfg.rules.ss_contrib_min,
    contributions: seniors.map(s => ({ user_id: s.id, name: nm(s.ic_name, s.global_name, s.username, s.id), paid: paid.get(s.id) || 0, ok: (paid.get(s.id) || 0) >= cfg.rules.ss_contrib_min })),
    entries: results.map(r => ({ id: r.id, kind: r.kind, amount: r.amount, sign: LEDGER_KINDS[r.kind] || 0, user_id: r.user_id, user_name: r.user_id ? nm(r.ic_name, r.global_name, r.username, r.user_id) : '', week: r.week, note: r.note || '',
      created_by: nm(r.c_ic, r.c_gn, r.c_un, r.created_by), created_at: r.created_at, deleted_at: r.deleted_at, deleted_by: r.deleted_by })),
    awards: awards.map(a => ({ week: a.week, user_id: a.user_id, name: nm(a.ic_name, a.global_name, a.username, a.user_id), amount: a.award_budget })) });
}
async function leadBudgetAdd(request, env, actor) {
  const cfg = await premConfig(env); const b = await readJson(request);
  if (!LEDGER_KINDS[b.kind]) throw new HttpError(400, 'Вид операции: contribution, leftover, income или withdrawal');
  const amount = money(b.amount, 'сумма', 1000000000); if (!amount) throw new HttpError(400, 'Сумма должна быть больше 0');
  let uid = null;
  if (b.kind === 'contribution') { uid = str(b.user_id, 25, { required: true, name: 'кто внёс' }); if (!(await env.DB.prepare('SELECT id FROM users WHERE id = ?1').bind(uid).first())) throw new HttpError(404, 'Пользователь не найден'); }
  const week = b.week ? weekParam(b.week) : weekOf(Date.now());
  const note = str(b.note, 500, { name: 'примечание', required: b.kind === 'withdrawal' });
  const row = await env.DB.prepare('INSERT INTO budget_ledger (kind, amount, user_id, week, note, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) RETURNING id').bind(b.kind, amount, uid, week, note, actor.id, Date.now()).first();
  await audit(env, actor, 'budget.add', row.id, { kind: b.kind, amount, user_id: uid, week, note });
  return json({ ok: true, id: row.id });
}
async function leadBudgetDelete(env, actor, id) {
  const r = await env.DB.prepare('SELECT * FROM budget_ledger WHERE id = ?1 AND deleted_at IS NULL').bind(id).first(); if (!r) throw new HttpError(404, 'Запись не найдена');
  await env.DB.prepare('UPDATE budget_ledger SET deleted_at = ?1, deleted_by = ?2 WHERE id = ?3').bind(Date.now(), actor.id, id).run();
  await audit(env, actor, 'budget.delete', id, { kind: r.kind, amount: r.amount });
  return json({ ok: true });
}
async function leadConfigPut(request, env, actor) {
  const b = await readJson(request, 300000);
  const stmts = []; const changed = [];
  for (const k of PREM_CFG_KEYS) if (b[k] !== undefined) { const v = premConfigInput(k, b[k]); stmts.push(env.DB.prepare('INSERT INTO prem_config (k, v, updated_by, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_by = excluded.updated_by, updated_at = excluded.updated_at').bind(k, JSON.stringify(v), actor.id, Date.now())); changed.push(k); }
  if (!stmts.length) throw new HttpError(400, 'Нечего сохранять');
  // строки плана ссылаются только на существующие пункты
  const cfg = await premConfig(env); const items = b.items !== undefined ? premConfigInput('items', b.items) : cfg.items; const plan = b.plan !== undefined ? premConfigInput('plan', b.plan) : cfg.plan;
  const keys = new Set(items.map(i => i.key)); for (const l of plan) for (const k of l.items) if (!keys.has(k)) throw new HttpError(400, `Строка плана «${l.name}»: нет пункта «${k}»`);
  await env.DB.batch(stmts);
  await audit(env, actor, 'prem.config', changed.join(','), null);
  return json({ config: await premConfig(env) });
}
async function leadConfigReset(env, actor, k) {
  if (!PREM_CFG_KEYS.includes(k)) throw new HttpError(400, 'Неизвестный раздел');
  await env.DB.prepare('DELETE FROM prem_config WHERE k = ?1').bind(k).run();
  await audit(env, actor, 'prem.config_reset', k, null);
  return json({ config: await premConfig(env) });
}

// ---------- удаление отчёта (руководство / администраторы) ----------
// Копия отчёта и его истории сохраняется в reports_deleted (журнал), сам отчёт удаляется: неделю можно сдать заново.
// Премии недели пересчитываются сами (считаются на лету); перенесённый в бюджет остаток помечается как устаревший.
async function leadDeleteReport(request, env, actor, id) {
  const row = await env.DB.prepare('SELECT * FROM reports WHERE id = ?1').bind(id).first();
  if (!row) throw new HttpError(404, 'Отчёт не найден (возможно, уже удалён)');
  let b = {}; try { b = await readJson(request); } catch (_) { b = {}; }
  const reason = str(b.reason, 500, { name: 'причина удаления' });
  const { results: hist } = await env.DB.prepare('SELECT * FROM report_history WHERE report_id = ?1 ORDER BY version').bind(id).all();
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO reports_deleted (report_id, user_id, week, row_json, history_json, reason, deleted_by, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)')
      .bind(id, row.user_id, row.week, JSON.stringify(row), JSON.stringify(hist), reason, actor.id, now),
    env.DB.prepare('DELETE FROM report_history WHERE report_id = ?1').bind(id),
    env.DB.prepare('DELETE FROM reports WHERE id = ?1').bind(id),
  ]);
  await audit(env, actor, 'report.delete', id, { user_id: row.user_id, week: row.week, status: row.status, version: row.version, reason });
  return json({ ok: true, week: row.week, user_id: row.user_id });
}
async function leadDeletedReports(env, url) {
  const week = url.searchParams.get('week') ? weekParam(url.searchParams.get('week')) : null;
  const { results } = await env.DB.prepare(`SELECT d.id, d.report_id, d.user_id, d.week, d.reason, d.deleted_at, d.deleted_by, u.ic_name, u.global_name, u.username, x.ic_name AS x_ic, x.global_name AS x_gn, x.username AS x_un
    FROM reports_deleted d LEFT JOIN users u ON u.id = d.user_id LEFT JOIN users x ON x.id = d.deleted_by WHERE (?1 IS NULL OR d.week = ?1) ORDER BY d.id DESC LIMIT 200`).bind(week).all();
  return json({ deleted: results.map(r => ({ id: r.id, report_id: r.report_id, user_id: r.user_id, week: r.week, reason: r.reason || '', deleted_at: r.deleted_at,
    name: r.ic_name || r.global_name || r.username || r.user_id, deleted_by: r.x_ic || r.x_gn || r.x_un || r.deleted_by })) });
}

// ---------- премирование для всех ВП ----------
// Список открывается после срока (вс 19:00 МСК) и только по принятым отчётам, сданным в срок. Суммы — когда проверены все
// отчёты недели, сданные в срок (нет «отправлен» / «на проверке»): до этого они могут измениться (фонд делится между всеми).
function lastClosedWeek(cfg, now = Date.now()) { let w = weekOf(now); if (now <= weekDeadline(w, cfg.rules)) w = addDays(w, -7); return w; }
async function publicPremiums(env, user, url) {
  const now = Date.now();
  const cfg0 = await premConfig(env);
  const week = url.searchParams.get('week') ? weekParam(url.searchParams.get('week')) : lastClosedWeek(cfg0, now);
  const { cfg, list, calc } = await weekData(env, week);
  const deadline = weekDeadline(week, cfg.rules);
  const open = now > deadline;
  const onTime = list.filter(p => p.report && !p.late);
  const pending = onTime.filter(p => p.status === 'submitted' || p.status === 'review').length;
  const final = open && onTime.length > 0 && pending === 0;
  const posName = (k) => (cfg.positions.find(x => x.key === k) || {}).name || '';
  const itemMap = new Map(cfg.items.map(i => [i.key, i]));
  const out = (p, r, money) => {
    const items = Object.entries(p.counts || {}).map(([k, n]) => { const it = itemMap.get(k) || {}; return { key: k, name: it.name || k, group: it.group || '', n, pay: it.pay || 0, sum: (it.pay || 0) * n }; })
      .sort((a, b) => ['main', 'extra', 'gu'].indexOf(a.group) - ['main', 'extra', 'gu'].indexOf(b.group));
    const o = { user_id: p.user_id, name: p.name, rank: p.rank || '', static_id: p.static_id || '', position: p.position, position_name: posName(p.position), points: p.row ? p.row.points : 0,
      thanks: (p.counts || {}).thanks || 0, items, plan: r.plan ? { level: r.plan.level, lines: r.plan.lines.map(l => ({ name: l.name, got: l.got, min: l.min, normal: l.normal })) } : null,
      oklad_tier: r.oklad_tier, deduct_pct: r.deduct_pct };
    if (money) Object.assign(o, { oklad: r.oklad, actions: r.actions, deduction: r.deduction, base: r.base, max: r.max, excess: r.excess, add: r.add, award: r.award, ss: r.ss, total_fund: r.total_fund, award_budget: r.award_budget });
    return o;
  };
  const rows = open ? list.map((p, i) => [p, calc.rows[i]]).filter(([p, r]) => p.report && !p.late && p.status === 'approved' && r.eligible).map(([p, r]) => out(p, r, final)) : [];
  rows.sort((a, b) => final ? b.total_fund - a.total_fund : String(a.name).localeCompare(String(b.name), 'ru'));
  const mi = list.findIndex(p => p.user_id === user.id);
  let my = null;
  if (mi >= 0 && list[mi].report) {
    const p = list[mi], r = calc.rows[mi];
    my = { status: p.status, late: !!p.late, report_id: p.row.id, reason: r.eligible ? '' : r.reason, ...(r.eligible ? out(p, r, final && open) : {}) };
  }
  const { results: wk } = await env.DB.prepare('SELECT DISTINCT week FROM reports ORDER BY week DESC LIMIT 30').all();
  return json({ week, current_week: weekOf(now), last_closed_week: lastClosedWeek(cfg, now), deadline, open, final, now,
    stats: { on_time: onTime.length, reviewed: onTime.length - pending, pending, approved: onTime.filter(p => p.status === 'approved').length },
    list: rows, my, weeks: wk.map(r => r.week),
    totals: final ? { fund: rows.reduce((s, r) => s + r.total_fund, 0), award_budget: rows.reduce((s, r) => s + r.award_budget, 0) } : null });
}

// ---------- личные дела (досье сотрудников ГУ ВП) ----------
// Видит и ведёт ТОЛЬКО старший состав (caps.ss: «Руководство ГУ ВП», администраторы и отметка «СС» в составе ГУ ВП).
// Остальным, включая самого сотрудника, все /api/people… отвечают 403 (проверка в route). Для СС видны все поля.
const DZ_SENSITIVE = ['age', 'timezone', 'law_score', 'law_comment', 'notes'];
const DZ_KINDS = { penalty: 'Взыскание', reward: 'Поощрение', promotion: 'Повышение', demotion: 'Понижение', transfer: 'Перевод', note: 'Заметка' };
const DZ_PENALTIES = ['Устное замечание', 'Предупреждение', 'Выговор', 'Строгий выговор', 'Неполное служебное соответствие', 'Отстранение', 'Другое'];
const DZ_REWARDS = ['Благодарность', 'Поощрение', 'Почётная грамота', 'Денежная премия', 'Досрочное повышение', 'Другое'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function requireSS(user) { requireCap(user, 'ss'); }
function dzDate(v, name, required) {
  const s = String(v == null ? '' : v).trim();
  if (!s) { if (required) throw new HttpError(400, 'Не заполнено: ' + name); return null; }
  const d = new Date(s + 'T00:00:00Z');
  if (!DATE_RE.test(s) || isNaN(d) || d.toISOString().slice(0, 10) !== s) throw new HttpError(400, `Некорректная дата: ${name} (ГГГГ-ММ-ДД)`);
  if (s < '2000-01-01' || s > new Date(Date.now() + 86400000 * 2).toISOString().slice(0, 10)) throw new HttpError(400, `Дата вне допустимого диапазона: ${name}`);
  return s;
}
function dzUrl(v, name) {
  const s = str(v, 500, { name }); if (!s) return '';
  let u; try { u = new URL(s); } catch (_) { throw new HttpError(400, `Нужна ссылка (https://…): ${name}`); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new HttpError(400, `Нужна ссылка (https://…): ${name}`);
  return u.toString();
}
function dzList(v, name, car) {
  if (v == null || v === '') return [];
  if (!Array.isArray(v) || v.length > 15) throw new HttpError(400, `${name}: список до 15 записей`);
  return v.map((x, i) => {
    const o = { model: str(x && x.model, 60, { name: `${name} ${i + 1}: модель` }), plate: str(x && x.plate, 20, { name: `${name} ${i + 1}: номер` }).toUpperCase() };
    if (!o.model && !o.plate) return null;
    if (!o.plate) throw new HttpError(400, `${name} ${i + 1}: укажите номер`);
    if (car) o.main = !!(x.main === true || x.main === 1 || x.main === '1');
    return o;
  }).filter(Boolean);
}
function dossierInput(b) {
  const o = {};
  if (b.joined_on !== undefined) o.joined_on = dzDate(b.joined_on, 'дата вступления в ГУ ВП');
  if (b.age !== undefined) o.age = b.age === '' || b.age == null ? null : int(b.age, 14, 99, 'возраст');
  if (b.timezone !== undefined) o.timezone = str(b.timezone, 40, { name: 'часовой пояс' }) || null;
  if (b.online_hours !== undefined) {
    if (b.online_hours === '' || b.online_hours == null) o.online_hours = null;
    else { const n = Number(String(b.online_hours).replace(',', '.')); if (!Number.isFinite(n) || n < 0 || n > 24) throw new HttpError(400, 'Средний онлайн: от 0 до 24 часов в день'); o.online_hours = Math.round(n * 10) / 10; }
  }
  if (b.online_time !== undefined) o.online_time = str(b.online_time, 80, { name: 'обычное время онлайна' }) || null;
  if (b.discord !== undefined) o.discord = str(b.discord, 60, { name: 'Discord' }) || null;
  if (b.vehicles !== undefined) o.vehicles = JSON.stringify(dzList(b.vehicles, 'Личное ТС', false));
  if (b.service_cars !== undefined) o.service_cars = JSON.stringify(dzList(b.service_cars, 'Служебный автомобиль', true));
  if (b.law_score !== undefined) o.law_score = b.law_score === '' || b.law_score == null ? null : int(b.law_score, 1, 5, 'оценка знания законодательства');
  if (b.law_comment !== undefined) o.law_comment = str(b.law_comment, 1000, { name: 'комментарий к оценке' }) || null;
  if (b.notes !== undefined) o.notes = str(b.notes, 5000, { name: 'характеристика / заметки' });
  return o;
}
const dzName = (u) => u ? (u.ic_name || u.global_name || u.username || u.id) : '';
function dzRoles(env, u) {
  const su = isSuper(env, u.id);
  return [u.vp && 'ВП', u.staff && 'Состав ГУ ВП', u.senior && 'Старший состав', u.leader && 'Руководство ГУ ВП', (u.role === 'admin' || su) && 'Администратор', u.role === 'manager' && 'Руководство (СС)', u.role === 'examiner' && 'Проверяющий', u.reatt && 'Переаттестация'].filter(Boolean);
}
function personCard(env, u, position) {
  return { id: u.id, name: dzName(u), has_ic: !!u.ic_name, discord: u.username, rank: u.rank || '', static_id: u.static_id || '', position: position || '',
    avatar_url: u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=128` : null, roles: dzRoles(env, u) };
}
const dzPos = (cfg, u) => u.position || ((cfg.positions.find(p => p.key === u.staff_position) || {}).name || '');
async function peopleList(env, viewer) {
  requireSS(viewer);
  const cfg = await premConfig(env);
  const { results } = await env.DB.prepare(`SELECT u.id, u.username, u.global_name, u.avatar, u.ic_name, u.static_id, u.rank, u.position, u.staff_position, u.vp, u.reatt, u.leader, u.role, u.staff, u.senior,
      d.status, d.joined_on, d.service_cars, d.archived_at, d.archive_reason,
      (SELECT COUNT(*) FROM dossier_events e WHERE e.user_id = u.id AND e.kind = 'penalty' AND e.deleted_at IS NULL AND e.lifted_at IS NULL) AS pen_active,
      (SELECT COUNT(*) FROM dossier_events e WHERE e.user_id = u.id AND e.kind = 'reward' AND e.deleted_at IS NULL) AS rewards
    FROM dossiers d JOIN users u ON u.id = d.user_id`).all();
  const strikes = await strikeMap(env, cfg);
  const people = results.map(u => {
    const cars = parseJ(u.service_cars, []); const main = cars.find(c => c.main) || cars[0];
    return { ...personCard(env, u, dzPos(cfg, u)), status: u.status, archived: u.status === 'archived', archived_at: u.archived_at, archive_reason: u.status === 'archived' ? u.archive_reason || '' : '',
      joined_on: u.joined_on, car: main ? main.model + ' · ' + main.plate : '', pen_active: u.pen_active, rewards: u.rewards, strikes: strikes.get(u.id) || 0 };
  });
  people.sort((a, b) => a.archived - b.archived || String(a.name).localeCompare(String(b.name), 'ru'));
  let candidates = [];
  if (caps(viewer).ss) {
    const { results: c } = await env.DB.prepare(`SELECT id, username, global_name, avatar, ic_name, static_id, rank, position, staff_position, vp, reatt, leader, role, staff, senior FROM users
      WHERE blocked = 0 AND id NOT IN (SELECT user_id FROM dossiers) ORDER BY COALESCE(ic_name, global_name, username)`).all();
    candidates = c.map(u => ({ ...personCard(env, u, dzPos(cfg, u)), eligible: !!(u.vp || u.staff) }));
  }
  return json({ people, candidates, can_edit: !!caps(viewer).ss, positions: [...new Set(people.map(p => p.position).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')) });
}
const dzAt = (date) => Date.parse(date + 'T12:00:00+03:00');
async function personFile(env, viewer, id) {
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first();
  if (!u || (u.blocked && !caps(viewer).ss)) throw new HttpError(404, 'Личное дело не найдено');
  requireSS(viewer);
  const C = caps(viewer); const self = viewer.id === id; const priv = true; const money = true;
  const cfg = await premConfig(env);
  const dz = await env.DB.prepare('SELECT * FROM dossiers WHERE user_id = ?1').bind(id).first();
  const position = dzPos(cfg, u);
  const names = new Map();
  const nameOf = async (uid) => { if (!uid || uid === 'migration') return uid === 'migration' ? 'система' : ''; if (!names.has(uid)) { const r = await env.DB.prepare('SELECT id, ic_name, global_name, username FROM users WHERE id = ?1').bind(uid).first(); names.set(uid, r ? dzName(r) : uid); } return names.get(uid); };
  // ---- ручные поля
  let dossier = null;
  if (dz) {
    dossier = { status: dz.status, joined_on: dz.joined_on, online_hours: dz.online_hours, online_time: dz.online_time || '', discord: dz.discord || u.username || '',
      vehicles: parseJ(dz.vehicles, []), service_cars: parseJ(dz.service_cars, []), archived_at: dz.archived_at, archive_reason: dz.archive_reason || '',
      created_at: dz.created_at, created_by: await nameOf(dz.created_by), updated_at: dz.updated_at, updated_by: await nameOf(dz.updated_by), sensitive_hidden: !priv };
    if (priv) Object.assign(dossier, { age: dz.age, timezone: dz.timezone || '', law_score: dz.law_score, law_comment: dz.law_comment || '', notes: dz.notes || '' });
  }
  // ---- ручная история
  const { results: ev0 } = await env.DB.prepare('SELECT * FROM dossier_events WHERE user_id = ?1 AND deleted_at IS NULL ORDER BY on_date DESC, id DESC').bind(id).all();
  const events = [];
  for (const e of ev0) events.push({ id: e.id, kind: e.kind, subtype: e.subtype, on_date: e.on_date, reason: e.reason, evidence: e.evidence, issued_by: e.issued_by,
    from_rank: e.from_rank, to_rank: e.to_rank, from_position: e.from_position, to_position: e.to_position, active: e.kind === 'penalty' && !e.lifted_at,
    lifted_at: e.lifted_at, lifted_by: await nameOf(e.lifted_by), lift_reason: e.lift_reason || '', created_at: e.created_at, created_by: await nameOf(e.created_by) });
  // ---- отчёты (авто)
  const { results: reps } = await env.DB.prepare('SELECT id, week, position, status, late, points, data, item_review, first_submitted_at FROM reports WHERE user_id = ?1 ORDER BY week DESC LIMIT 104').bind(id).all();
  let thanks = 0;
  const reports = [];
  const now = Date.now();
  for (const [i, r] of reps.entries()) {
    const d = parseJ(r.data, {}); const c = premCounts(d.items, parseJ(r.item_review, {}));
    if (r.status === 'approved') thanks += c.thanks || 0;
    const o = { week: r.week, status: r.status, late: !!r.late, points: r.points, submitted_at: r.first_submitted_at, position_name: (cfg.positions.find(p => p.key === r.position) || {}).name || '',
      thanks: r.status === 'approved' ? (c.thanks || 0) : 0, plan: r.status === 'rejected' ? null : premPlan(cfg, c).level, plan_final: r.status === 'approved' };
    // премия — только если её видно и в «Премировании»: в срок, принят, срок недели прошёл, все отчёты недели проверены
    if (money && i < 26 && r.status === 'approved' && !r.late && now > weekDeadline(r.week, cfg.rules)) {
      const w = await weekData(env, r.week);
      const onTime = w.list.filter(p => p.report && !p.late);
      const final = onTime.length > 0 && !onTime.some(p => p.status === 'submitted' || p.status === 'review');
      const k = w.list.findIndex(p => p.user_id === id); const row = k >= 0 ? w.calc.rows[k] : null;
      if (row) o.premium = final ? (row.eligible ? { total: row.total_fund, award_budget: row.award_budget } : { total: 0, reason: row.reason || '' }) : { pending: true };
    }
    reports.push(o);
  }
  // ---- авто-нарушения по отчётам (состав ГУ ВП)
  let violations = [];
  if (u.staff) { const v = await violationsData(env, cfg); const x = v.users.find(z => z.user_id === id); if (x) { let n = 0; violations = x.list.map(l => ({ week: l.week, kind: l.kind, excused: l.excused, note: l.excused ? l.note : '', measure: l.excused ? 'снято' : strikeLabel(++n), at: weekDeadline(l.week, cfg.rules) })); } }
  const strikes = violations.filter(v => !v.excused).length;
  // ---- экзамены и переаттестации
  const { results: at0 } = await env.DB.prepare("SELECT a.id, a.exam_id, a.reatt, a.status, a.started_at, a.submitted_at, a.score_pct, e.title AS exam_title FROM attempts a LEFT JOIN exams e ON e.id = a.exam_id WHERE a.user_id = ?1 AND a.status != 'in_progress' ORDER BY a.id DESC LIMIT 200").bind(id).all();
  const attempts = (await attemptTitles(env, at0)).map(a => ({ id: a.id, title: a.exam_title || (a.reatt ? 'Переаттестация' : 'Экзамен'), reatt: !!a.reatt, at: a.submitted_at || a.started_at,
    status: a.status, passed: a.status === 'passed', score_pct: a.status === 'pending_review' ? null : a.score_pct }));
  const scored = attempts.filter(a => a.score_pct != null);
  const stat = (l) => l.length ? { n: l.length, best: Math.max(...l.map(a => a.score_pct)), avg: Math.round(l.reduce((s, a) => s + a.score_pct, 0) / l.length), passed: l.filter(a => a.passed).length } : null;
  const law_auto = { all: stat(scored), exams: stat(scored.filter(a => !a.reatt)), reatt: stat(scored.filter(a => a.reatt)) };
  // ---- обучение: курсы и лекции
  const { results: crs } = await env.DB.prepare('SELECT id, title FROM courses WHERE published = 1 ORDER BY position, id').all();
  const { results: lecs } = await env.DB.prepare(`SELECT l.id, l.title, l.course_id, l.required, p.completed_at FROM lectures l LEFT JOIN lecture_progress p ON p.lecture_id = l.id AND p.user_id = ?1 WHERE l.published = 1 ORDER BY l.position, l.id`).bind(id).all();
  const { results: exs } = await env.DB.prepare('SELECT id, course_id FROM exams WHERE published = 1').all();
  const passedEx = new Set(attempts.filter(a => a.passed && !a.reatt).map(a => at0.find(x => x.id === a.id).exam_id));
  const courses = crs.map(c => { const ls = lecs.filter(l => l.course_id === c.id); const ex = exs.filter(e => e.course_id === c.id);
    return { id: c.id, title: c.title, lectures: ls.length, done: ls.filter(l => l.completed_at).length, exams: ex.length, exams_passed: ex.filter(e => passedEx.has(e.id)).length,
      complete: ls.filter(l => l.required).every(l => l.completed_at) && ex.every(e => passedEx.has(e.id)) && (ls.length + ex.length > 0) }; }).filter(c => c.lectures || c.exams);
  const lectures_done = lecs.filter(l => l.completed_at).map(l => ({ title: l.title, at: l.completed_at }));
  // ---- журнал изменений (профиль, состав, досье) — только СС и сам сотрудник
  let log = [];
  if (priv) {
    const { results: lg } = await env.DB.prepare(`SELECT a.action, a.actor_id, a.details, a.at FROM audit_log a WHERE a.target = ?1 AND (a.action IN ('profile.update', 'profile.self', 'staff.update', 'user.update') OR a.action LIKE 'dossier.%') ORDER BY a.id DESC LIMIT 200`).bind(id).all();
    for (const r of lg) log.push({ action: r.action, at: r.at, by: await nameOf(r.actor_id), self: r.actor_id === id, details: parseJ(r.details, {}) });
  }
  // ---- единая хронология
  const tl = [];
  for (const e of events) tl.push({ at: dzAt(e.on_date), date: e.on_date, type: e.kind, title: (e.subtype || DZ_KINDS[e.kind] || e.kind) + (e.kind === 'penalty' && e.lifted_at ? ' (снято)' : ''),
    text: [e.from_rank || e.to_rank ? `${e.from_rank || '—'} → ${e.to_rank || e.from_rank || '—'}` : '', e.from_position || e.to_position ? `${e.from_position || '—'} → ${e.to_position || e.from_position || '—'}` : '', e.reason].filter(Boolean).join(' · '), by: e.issued_by || e.created_by, link: e.evidence });
  for (const r of reports) tl.push({ at: r.submitted_at || dzAt(r.week), type: 'report', title: 'Еженедельный отчёт · ' + r.week, text: [r.late ? 'после срока' : 'в срок', r.plan ? 'план: ' + ({ normal: 'нормальный', min: 'минимальный', none: 'не выполнен' })[r.plan] + (r.plan_final ? '' : ' (до проверки)') : '', r.points + ' б.'].filter(Boolean).join(' · '), status: r.status });
  for (const v of violations) tl.push({ at: v.at, type: 'violation', title: (v.kind === 'late' ? 'Отчёт после срока' : 'Отчёт не сдан') + ' · ' + v.week, text: v.excused ? 'снято руководством' + (v.note ? ': ' + v.note : '') : v.measure });
  for (const a of attempts) tl.push({ at: a.at, type: a.reatt ? 'reatt' : 'exam', title: a.title, text: (a.status === 'pending_review' ? 'на проверке' : a.passed ? 'сдан' : 'не сдан') + (a.score_pct != null ? ' · ' + a.score_pct + '%' : '') });
  for (const l of lectures_done) tl.push({ at: l.at, type: 'lecture', title: 'Лекция пройдена', text: l.title });
  if (dz && dz.created_by !== 'migration') tl.push({ at: dz.created_at, type: 'dossier', title: 'Заведено личное дело', text: '', by: await nameOf(dz.created_by) });
  tl.sort((a, b) => (b.at || 0) - (a.at || 0));
  const pen = events.filter(e => e.kind === 'penalty');
  return json({ person: personCard(env, u, position), blocked: !!u.blocked, since: u.created_at, last_login_at: priv ? u.last_login_at : undefined,
    staff: !!u.staff, senior: !!u.senior, staff_since: u.staff_since || null, eligible: !!(u.vp || u.staff),
    dossier, events, can_edit: C.ss && (!self || C.admin), can_ss: C.ss, self, show_private: priv, show_money: money,
    reports, thanks_total: thanks, violations, strikes, strike_label: strikeLabel(strikes),
    penalties_active: pen.filter(e => e.active).length, rewards_total: events.filter(e => e.kind === 'reward').length,
    attempts, law_auto, courses, lectures_done: lectures_done.length, log, timeline: tl.slice(0, 400),
    exams: attempts.filter(a => a.passed).map(a => ({ title: a.title, reatt: a.reatt, at: a.at, score_pct: a.score_pct })),
    lists: { penalties: DZ_PENALTIES, rewards: DZ_REWARDS, kinds: DZ_KINDS } });
}
// старший состав не правит собственное дело (кроме администраторов) — чтобы не снимать себе взыскания
async function dzTarget(env, actor, id, needDossier = true) {
  requireSS(actor);
  if (actor.id === id && !caps(actor).admin) throw new HttpError(403, 'Своё личное дело правит другой сотрудник старшего состава');
  const u = await env.DB.prepare('SELECT * FROM users WHERE id = ?1').bind(id).first();
  if (!u) throw new HttpError(404, 'Пользователь не найден');
  const dz = await env.DB.prepare('SELECT * FROM dossiers WHERE user_id = ?1').bind(id).first();
  if (needDossier && !dz) throw new HttpError(404, 'Личное дело не заведено');
  return { u, dz };
}
async function dzCreate(request, env, actor, id) {
  const { u, dz } = await dzTarget(env, actor, id, false);
  if (dz) throw new HttpError(409, 'Личное дело уже заведено');
  if (!(u.vp || u.staff)) throw new HttpError(400, 'Личное дело заводится только на сотрудника ГУ ВП: сначала выдайте роль «ВП» или добавьте в состав');
  const b = await readJson(request).catch(() => ({}));
  const o = dossierInput(b || {}); const now = Date.now();
  if (o.joined_on === undefined) o.joined_on = u.staff_since || new Date(now + 3 * 3600000).toISOString().slice(0, 10);
  const keys = Object.keys(o);
  await env.DB.prepare(`INSERT INTO dossiers (user_id, status, created_by, created_at, updated_by, updated_at${keys.map(k => ', ' + k).join('')}) VALUES (?1, 'active', ?2, ?3, ?2, ?3${keys.map((_, i) => ', ?' + (i + 4)).join('')})`)
    .bind(id, actor.id, now, ...keys.map(k => o[k])).run();
  await audit(env, actor, 'dossier.create', id, { fields: keys });
  return personFile(env, actor, id);
}
async function dzUpdate(request, env, actor, id) {
  const { u, dz } = await dzTarget(env, actor, id);
  const b = await readJson(request, 100000);
  const o = dossierInput(b); const prof = profileInput(b, true);
  const ch = {}; for (const k of Object.keys(o)) if (String(dz[k] ?? '') !== String(o[k] ?? '')) ch[k] = DZ_SENSITIVE.includes(k) || k === 'vehicles' || k === 'service_cars' ? true : [dz[k] ?? '', o[k] ?? ''];
  const pch = {}; for (const k of Object.keys(prof)) if (String(u[k] || '') !== String(prof[k] || '')) pch[k] = [u[k] || '', prof[k] || ''];
  if (!Object.keys(ch).length && !Object.keys(pch).length) return personFile(env, actor, id);
  const keys = Object.keys(o).filter(k => ch[k] !== undefined);
  if (keys.length) await env.DB.prepare(`UPDATE dossiers SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_by = ?${keys.length + 1}, updated_at = ?${keys.length + 2} WHERE user_id = ?${keys.length + 3}`)
    .bind(...keys.map(k => o[k]), actor.id, Date.now(), id).run();
  if (Object.keys(pch).length) {
    const pk = Object.keys(pch);
    await env.DB.prepare(`UPDATE users SET ${pk.map((k, i) => `${k} = ?${i + 1}`).join(', ')} WHERE id = ?${pk.length + 1}`).bind(...pk.map(k => prof[k]), id).run();
    await audit(env, actor, 'profile.update', id, pch);
    if (!keys.length) await env.DB.prepare('UPDATE dossiers SET updated_by = ?1, updated_at = ?2 WHERE user_id = ?3').bind(actor.id, Date.now(), id).run();
  }
  // в журнал: что изменилось (значения чувствительных полей и списков ТС не пишем — только факт изменения)
  if (keys.length) await audit(env, actor, 'dossier.update', id, ch);
  return personFile(env, actor, id);
}
async function dzArchive(request, env, actor, id, archive) {
  const { dz } = await dzTarget(env, actor, id);
  const b = await readJson(request).catch(() => ({})) || {};
  const reason = str(b.reason, 500, { required: archive, name: 'причина (увольнение и т. п.)' });
  if (archive === (dz.status === 'archived')) throw new HttpError(400, archive ? 'Дело уже в архиве' : 'Дело не в архиве');
  const now = Date.now(); const today = new Date(now + 3 * 3600000).toISOString().slice(0, 10);
  await env.DB.prepare('UPDATE dossiers SET status = ?1, archived_at = ?2, archive_reason = ?3, updated_by = ?4, updated_at = ?5 WHERE user_id = ?6')
    .bind(archive ? 'archived' : 'active', archive ? now : null, archive ? reason : null, actor.id, now, id).run();
  await env.DB.prepare(`INSERT INTO dossier_events (user_id, kind, subtype, on_date, reason, issued_by, created_by, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`)
    .bind(id, archive ? 'archive' : 'restore', archive ? 'Увольнение — дело в архиве' : 'Восстановлен — дело из архива', dzDate(b.on_date, 'дата') || today, reason, dzName(actor), actor.id, now).run();
  await audit(env, actor, archive ? 'dossier.archive' : 'dossier.restore', id, { reason });
  return personFile(env, actor, id);
}
function dzEventInput(b, cur, partial) {
  const kind = partial ? cur.kind : String(b.kind || '');
  if (!DZ_KINDS[kind]) throw new HttpError(400, 'Тип записи: взыскание, поощрение, повышение, понижение, перевод или заметка');
  const o = { kind };
  const has = (k) => !partial || b[k] !== undefined;
  if (has('subtype')) o.subtype = str(b.subtype, 60, { name: 'вид' });
  if (has('on_date')) o.on_date = dzDate(b.on_date, 'дата', true);
  if (has('reason')) o.reason = str(b.reason, 2000, { name: kind === 'note' ? 'текст заметки' : 'причина / основание', required: kind === 'penalty' || kind === 'reward' || kind === 'note' });
  if (has('evidence')) o.evidence = dzUrl(b.evidence, 'доказательство');
  if (has('issued_by')) o.issued_by = str(b.issued_by, 100, { name: 'кем выдано' });
  if (kind === 'penalty' && has('subtype') && !o.subtype) o.subtype = 'Выговор';
  if (kind === 'reward' && has('subtype') && !o.subtype) o.subtype = 'Благодарность';
  if (['promotion', 'demotion', 'transfer'].includes(kind)) {
    for (const k of ['from_rank', 'to_rank']) if (has(k)) o[k] = str(b[k], 60, { name: k === 'to_rank' ? 'новое звание' : 'прежнее звание' }) || null;
    for (const k of ['from_position', 'to_position']) if (has(k)) o[k] = str(b[k], 80, { name: k === 'to_position' ? 'новая должность' : 'прежняя должность' }) || null;
    if (!partial && !o.to_rank && !o.to_position) throw new HttpError(400, 'Укажите новое звание и/или новую должность');
  }
  return o;
}
async function dzEventAdd(request, env, actor, id) {
  const { u } = await dzTarget(env, actor, id);
  const b = await readJson(request, 20000);
  const o = dzEventInput(b, null, false); const now = Date.now();
  if (!o.issued_by) o.issued_by = dzName(actor);
  // повышение / понижение / перевод: «с» — по умолчанию из профиля; новое звание/должность записываются в профиль
  const prof = {};
  if (['promotion', 'demotion', 'transfer'].includes(o.kind)) {
    if (o.to_rank && b.from_rank === undefined) o.from_rank = u.rank || null;
    if (o.to_position && b.from_position === undefined) o.from_position = u.position || null;
    if (b.apply_profile !== false) { if (o.to_rank && o.to_rank !== (u.rank || '')) prof.rank = [u.rank || '', o.to_rank]; if (o.to_position && o.to_position !== (u.position || '')) prof.position = [u.position || '', o.to_position]; }
    if (!o.subtype) o.subtype = DZ_KINDS[o.kind];
  }
  const cols = Object.keys(o);
  const r = await env.DB.prepare(`INSERT INTO dossier_events (user_id, ${cols.join(', ')}, created_by, created_at) VALUES (?1, ${cols.map((_, i) => '?' + (i + 2)).join(', ')}, ?${cols.length + 2}, ?${cols.length + 3}) RETURNING id`)
    .bind(id, ...cols.map(k => o[k]), actor.id, now).first();
  const pk = Object.keys(prof);
  if (pk.length) {
    await env.DB.prepare(`UPDATE users SET ${pk.map((k, i) => `${k} = ?${i + 1}`).join(', ')} WHERE id = ?${pk.length + 1}`).bind(...pk.map(k => prof[k][1]), id).run();
    await audit(env, actor, 'profile.update', id, { ...prof, via: 'личное дело: ' + DZ_KINDS[o.kind].toLowerCase() });
  }
  await env.DB.prepare('UPDATE dossiers SET updated_by = ?1, updated_at = ?2 WHERE user_id = ?3').bind(actor.id, now, id).run();
  await audit(env, actor, 'dossier.event.add', id, { event: r.id, kind: o.kind, subtype: o.subtype, on_date: o.on_date });
  return personFile(env, actor, id);
}
async function dzEventGet(env, id, eid) {
  const e = await env.DB.prepare('SELECT * FROM dossier_events WHERE id = ?1 AND user_id = ?2 AND deleted_at IS NULL').bind(eid, id).first();
  if (!e) throw new HttpError(404, 'Запись не найдена');
  if (e.kind === 'archive' || e.kind === 'restore') throw new HttpError(400, 'Запись об архиве меняется кнопками «В архив» / «Вернуть из архива»');
  return e;
}
async function dzEventUpdate(request, env, actor, id, eid) {
  await dzTarget(env, actor, id); const e = await dzEventGet(env, id, eid);
  const o = dzEventInput(await readJson(request, 20000), e, true); delete o.kind;
  const keys = Object.keys(o); if (!keys.length) throw new HttpError(400, 'Нечего изменять');
  await env.DB.prepare(`UPDATE dossier_events SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')}, updated_by = ?${keys.length + 1}, updated_at = ?${keys.length + 2} WHERE id = ?${keys.length + 3}`)
    .bind(...keys.map(k => o[k]), actor.id, Date.now(), eid).run();
  await audit(env, actor, 'dossier.event.update', id, { event: eid, fields: keys });
  return personFile(env, actor, id);
}
async function dzEventLift(request, env, actor, id, eid, lift) {
  await dzTarget(env, actor, id); const e = await dzEventGet(env, id, eid);
  if (e.kind !== 'penalty') throw new HttpError(400, 'Снять можно только взыскание');
  const b = await readJson(request).catch(() => ({})) || {};
  if (lift) {
    if (e.lifted_at) throw new HttpError(400, 'Взыскание уже снято');
    const reason = str(b.reason, 500, { required: true, name: 'основание снятия' });
    await env.DB.prepare('UPDATE dossier_events SET lifted_at = ?1, lifted_by = ?2, lift_reason = ?3 WHERE id = ?4').bind(Date.now(), actor.id, reason, eid).run();
  } else await env.DB.prepare('UPDATE dossier_events SET lifted_at = NULL, lifted_by = NULL, lift_reason = NULL WHERE id = ?1').bind(eid).run();
  await audit(env, actor, lift ? 'dossier.event.lift' : 'dossier.event.unlift', id, { event: eid });
  return personFile(env, actor, id);
}
async function dzEventDelete(request, env, actor, id, eid) {
  await dzTarget(env, actor, id); const e = await dzEventGet(env, id, eid);
  await env.DB.prepare('UPDATE dossier_events SET deleted_at = ?1, updated_by = ?2, updated_at = ?1 WHERE id = ?3').bind(Date.now(), actor.id, eid).run();
  await audit(env, actor, 'dossier.event.delete', id, { event: eid, kind: e.kind, subtype: e.subtype, on_date: e.on_date, reason: String(e.reason || '').slice(0, 300) });
  return personFile(env, actor, id);
}

// ---------- система повышения ----------
// Ступени (звание → следующее, баллы, обязательные пункты отчёта), баллы за пункты и сколько баллов заменяют недостающий пункт.
// По умолчанию — как в promo-rules.js сайта бланков; администраторы меняют здесь, сайт бланков подхватывает изменения.
const PROMO_DEFAULT = {"points_per_item":100,"pts":{"postavka":35,"otbitie":30,"training":30,"proc":0,"event6":30,"gmp_org":0,"pmp":0,"excursion":0,"oath":0,"kraz":0,"mp_visit":0,"gmp":40,"poverka":35,"post_kom":0,"post_shtab":0,"post_kpp1":0,"post_kpp2":0,"naryad":0,"sso":0,"patrol_city":0,"patrol_gar":0,"patrol_vch":0,"patrol":0,"lecture_va":0,"exam_va":0,"thanks":0,"city":20,"reattest":30,"vzysk":30,"vygovor":0,"prof":30,"prizyv":30,"guardhouse":75,"convoy":0,"complaint":0,"otrab":0,"obzhal":0,"docs":0,"inspect":0,"lecture_vp":0,"exam_vp":0,"soch":0},"ladder":[{"rank":"Сержант","to":"Старший сержант","points":150,"need":{"naryad":1,"prof":1,"training":1}},{"rank":"Старший сержант","to":"Старшина","points":250,"need":{"naryad":1,"training":1,"prof":2}},{"rank":"Старшина","to":"Прапорщик","points":350,"need":{"naryad":1,"prof":3,"inspect":5,"training":2}},{"rank":"Прапорщик","to":"Старший прапорщик","points":450,"need":{"naryad":2,"prof":4,"training":3}},{"rank":"Старший прапорщик","to":"Младший лейтенант","points":550,"need":{"training":3,"patrol":2,"prof":4}},{"rank":"Младший лейтенант","to":"Лейтенант","points":650,"need":{"patrol":1,"prof":4,"training":3,"prizyv":3}},{"rank":"Лейтенант","to":"Старший лейтенант","points":750,"need":{"patrol":1,"prof":6,"docs":5,"vzysk":3,"training":3}},{"rank":"Старший лейтенант","to":"Капитан","points":1500,"need":{"prof":7,"vzysk":5,"prizyv":3,"training":5}}]};
async function promoConfig(env) {
  const r = await env.DB.prepare("SELECT v, updated_at FROM prem_config WHERE k = 'promo'").first();
  const v = r ? parseJ(r.v, null) : null;
  const st = await getSettings(env);
  return { config: v ? { ...PROMO_DEFAULT, ...v } : JSON.parse(JSON.stringify(PROMO_DEFAULT)), custom: !!v, updated_at: r ? r.updated_at : null,
    missing_points: st.promo_missing_points, courses_req: await promoCourses(env) };
}
// Обязательные курсы учёбы для повышения: общий список и по званиям (ступеням). Хранится в prem_config 'promo_courses'.
async function promoCourses(env) {
  const r = await env.DB.prepare("SELECT v FROM prem_config WHERE k = 'promo_courses'").first();
  const v = r ? parseJ(r.v, null) : null;
  return { all: Array.isArray(v && v.all) ? v.all : [], by_rank: v && v.by_rank && typeof v.by_rank === 'object' ? v.by_rank : {} };
}
async function promoCoursesPut(request, env, actor) {
  const b = await readJson(request, 50000);
  const { results } = await env.DB.prepare('SELECT id FROM courses').all();
  const known = new Set(results.map(x => x.id));
  const ids = (a, name) => {
    if (a === undefined || a === null) return [];
    if (!Array.isArray(a) || a.length > 50) throw new HttpError(400, name + ': нужен список курсов (до 50)');
    const out = [...new Set(a.map(x => idParam(x)))];
    for (const x of out) if (!known.has(x)) throw new HttpError(400, name + ': курс не найден');
    return out;
  };
  const v = { all: ids(b.all, 'Общие курсы'), by_rank: {} };
  for (const [rank, list] of Object.entries(b.by_rank || {}).slice(0, 60)) { const r = str(rank, 60, { required: true, name: 'звание' }); const l = ids(list, `Звание «${r}»`); if (l.length) v.by_rank[r] = l; }
  await env.DB.prepare("INSERT INTO prem_config (k, v, updated_by, updated_at) VALUES ('promo_courses', ?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_by = excluded.updated_by, updated_at = excluded.updated_at").bind(JSON.stringify(v), actor.id, Date.now()).run();
  await audit(env, actor, 'promo.courses', null, { all: v.all.length, ranks: Object.keys(v.by_rank).length });
  return json({ courses_req: v });
}
// Допуск к выгрузке рапорта на повышение: пройдены ли обязательные курсы (общие + для звания).
async function promoEligibility(env, user, rank) {
  const req = await promoCourses(env);
  const key = Object.keys(req.by_rank).find(k => k.toLowerCase() === String(rank || '').trim().toLowerCase());
  const need = [...new Set([...req.all, ...(key ? req.by_rank[key] : [])])];
  if (!need.length) return { allowed: true, required: [], missing: [] };
  const list = need.length ? (await (await listCourses(env, user)).json()).courses : [];
  const byId = new Map(list.map(c => [c.id, c]));
  const titles = new Map((await env.DB.prepare('SELECT id, title FROM courses').all()).results.map(c => [c.id, c.title]));
  const required = need.map(id => ({ id, title: titles.get(id) || ('Курс ' + id), done: !!(byId.get(id) && byId.get(id).complete) }));
  const missing = required.filter(c => !c.done);
  return { allowed: missing.length === 0, required, missing };
}
function promoInput(cfg, b) {
  const keys = new Set(cfg.items.map(i => i.key));
  const ppi = int(b.points_per_item, 1, 100000, 'баллов за недостающий пункт');
  const pts = {};
  for (const [k, v] of Object.entries(b.pts || {})) { if (!keys.has(k)) throw new HttpError(400, 'Неизвестный пункт: ' + k); pts[k] = int(v, 0, 100000, 'баллы пункта «' + k + '»'); }
  if (!Array.isArray(b.ladder) || !b.ladder.length || b.ladder.length > 60) throw new HttpError(400, 'Ступени повышения: нужен список (до 60)');
  const seen = new Set();
  const ladder = b.ladder.map((x, i) => {
    const rank = str(x.rank, 60, { required: true, name: `ступень ${i + 1}: звание` }), to = str(x.to, 60, { required: true, name: `ступень ${i + 1}: следующее звание` });
    if (seen.has(rank.toLowerCase())) throw new HttpError(400, `Звание «${rank}» указано дважды`); seen.add(rank.toLowerCase());
    const need = {};
    for (const [k, v] of Object.entries(x.need || {})) { if (!keys.has(k)) throw new HttpError(400, `Ступень «${rank}»: неизвестный пункт ${k}`); const n = int(v, 0, 1000, `ступень «${rank}»: количество`); if (n) need[k] = n; }
    return { rank, to, points: int(x.points, 0, 1000000, `ступень «${rank}»: баллы`), need };
  });
  return { points_per_item: ppi, pts, ladder };
}

// ---------- база данных (документация) ----------
function docInput(b) {
  return { category: str(b.category, 80, { name: 'раздел' }) || 'Общее', title: str(b.title, 200, { required: true, name: 'заголовок' }),
    body: str(b.body, 100000, { name: 'текст статьи' }), position: int(b.position, 0, 100000, 'порядок', 0) };
}
async function listDocs(env, url, user) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 100).toLowerCase();
  const { results } = await env.DB.prepare(`SELECT d.id, d.category, d.title, d.position, d.updated_at, substr(d.body, 1, 400) AS snippet, length(d.body) AS len, ${q ? 'd.body' : "'' AS body"},
    u.ic_name, u.global_name, u.username FROM docs d LEFT JOIN users u ON u.id = COALESCE(d.updated_by, d.created_by) WHERE d.deleted_at IS NULL ORDER BY d.category, d.position, d.id`).all();
  const locked = new Map();
  if (!caps(user).admin) { const { results: gd } = await env.DB.prepare('SELECT DISTINCT doc_id FROM topics WHERE doc_id IS NOT NULL AND published = 1').all();
    for (const g of gd) { const tt = await docGate(env, user, g.doc_id); if (tt) locked.set(g.doc_id, tt); } }
  const rows = results.filter(r => !q || (r.title + ' ' + r.category + ' ' + (locked.has(r.id) ? '' : r.body)).toLowerCase().includes(q));
  return json({ docs: rows.map(r => ({ id: r.id, category: r.category, title: r.title, position: r.position, updated_at: r.updated_at, snippet: locked.has(r.id) ? '' : r.snippet, len: r.len, author: r.ic_name || r.global_name || r.username || '',
      ...(locked.has(r.id) ? { locked: true, locked_topic: locked.get(r.id) } : {}) })),
    categories: [...new Set(results.map(r => r.category))] });
}
async function getDoc(env, id, user) {
  const gate = user ? await docGate(env, user, id) : null;
  if (gate) throw new HttpError(403, `Полная выгрузка откроется после прохождения всех лекций темы «${gate}»`);
  const d = await env.DB.prepare(`SELECT d.*, u.ic_name, u.global_name, u.username FROM docs d LEFT JOIN users u ON u.id = COALESCE(d.updated_by, d.created_by) WHERE d.id = ?1 AND d.deleted_at IS NULL`).bind(id).first();
  if (!d) throw new HttpError(404, 'Статья не найдена');
  return json({ doc: { id: d.id, category: d.category, title: d.title, body: d.body, position: d.position, created_at: d.created_at, updated_at: d.updated_at, author: d.ic_name || d.global_name || d.username || '' } });
}
async function saveDoc(request, env, user, id) {
  const o = docInput(await readJson(request, 200000)); const now = Date.now();
  if (id) {
    if (!(await env.DB.prepare('SELECT id FROM docs WHERE id = ?1 AND deleted_at IS NULL').bind(id).first())) throw new HttpError(404, 'Статья не найдена');
    await env.DB.prepare('UPDATE docs SET category = ?1, title = ?2, body = ?3, position = ?4, updated_by = ?5, updated_at = ?6 WHERE id = ?7').bind(o.category, o.title, o.body, o.position, user.id, now, id).run();
    await audit(env, user, 'doc.update', id, { title: o.title, category: o.category });
  } else {
    const r = await env.DB.prepare('INSERT INTO docs (category, title, body, position, created_by, updated_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6, ?6) RETURNING id').bind(o.category, o.title, o.body, o.position, user.id, now).first();
    id = r.id; await audit(env, user, 'doc.create', id, { title: o.title, category: o.category });
  }
  return getDoc(env, id);
}
async function deleteDoc(env, user, id) {
  const d = await env.DB.prepare('SELECT id, title FROM docs WHERE id = ?1 AND deleted_at IS NULL').bind(id).first(); if (!d) throw new HttpError(404, 'Статья не найдена');
  await env.DB.prepare('UPDATE docs SET deleted_at = ?1, updated_by = ?2 WHERE id = ?3').bind(Date.now(), user.id, id).run();
  await audit(env, user, 'doc.delete', id, { title: d.title });
  return json({ ok: true });
}

// Ответ «старта» дополняется самой попыткой: клиенту не нужен второй запрос.
async function withAttempt(env, user, res) {
  if (!res || res.status !== 200) return res;
  let d; try { d = await res.clone().json(); } catch (_) { return res; }
  if (!d || !d.attempt_id) return res;
  try { const a = await getAttempt(env, user, d.attempt_id); if (a.status === 200) d.attempt = (await a.json()).attempt; } catch (_) { /* попытку клиент запросит сам */ }
  return json(d);
}
// Один запрос при входе: настройки сайта, текущий пользователь и данные разделов, которые нужны первому экрану.
// Без входа (или с истёкшей сессией) — гостевой ответ: user = null.
const BOOT_DATA = {
  '/api/courses': [u => caps(u).vp, (env, u) => listCourses(env, u)],
  '/api/exams': [u => caps(u).vp, (env, u) => listExams(env, u)],
  '/api/lectures': [u => caps(u).vp, (env, u) => listLectures(env, u)],
  '/api/reatt': [u => caps(u).reatt, (env, u) => listReatt(env, u)],
  '/api/reports/my': [u => caps(u).vp, (env, u) => myReports(env, u, new URL('https://boot/api/reports/my'))],
  '/api/admin/stats': [u => caps(u).examiner, env => adminStats(env)],
  '/api/admin/users?q=': [u => caps(u).examiner, env => adminUsers(env, new URL('https://boot/api/admin/users?q='))],
  '/api/admin/attempts?status=pending_review&kind=': [u => caps(u).examiner, env => adminAttempts(env, new URL('https://boot/api/admin/attempts?status=pending_review&kind='))],
};
async function bootstrap(request, env, url) {
  const config = { oauth_configured: oauthConfigured(env), settings: await getSettings(env), redirect_uri: redirectUri(env, request) };
  const hasToken = /^Bearer\s+\S+/.test(request.headers.get('Authorization') || '');
  let user = null;
  try { user = await authUser(request, env, { optional: true }); } catch (e) { if (!(e instanceof HttpError) || e.status !== 401) throw e; user = null; }
  if (!user) return json({ config, user: null, session: hasToken ? 'expired' : 'none', data: {} });
  const want = String(url.searchParams.get('want') || '').split(',').map(x => x.trim()).filter(x => BOOT_DATA[x]).slice(0, 8);
  const data = {};
  await Promise.all([...new Set(want)].map(async k => {
    const [ok, fn] = BOOT_DATA[k];
    try { if (!ok(user)) return; const r = await fn(env, user); if (r && r.status === 200) data[k] = await r.json(); } catch (_) { /* раздел клиент загрузит сам */ }
  }));
  return json({ config, user: publicUser(user), session: 'ok', data });
}


// ---------- резервные копии сайта (только главные администраторы, ADMIN_IDS) ----------
// Копия собирается по шагам (таблица за таблицей, кусками), чтобы каждый запрос был коротким и строка D1 не превышала лимит.
// В копию входят настройки, система повышения и выплат, учёба (курсы, темы, лекции, экзамены, вопросы), переаттестации и выданные
// доступы, база данных (статьи), состояние сверки законов и роли пользователей. Сессии, токены, отчёты, попытки, журнал — не входят.
const BACKUP_TABLES = ['settings', 'prem_config', 'courses', 'topics', 'lectures', 'exams', 'exam_lectures', 'questions', 'reattestations', 'reatt_access', 'docs', 'law_doc_state', 'law_proposals', 'law_question_flags', 'users'];
const BACKUP_USER_COLS = ['id', 'role', 'vp', 'reatt', 'leader', 'staff', 'senior', 'staff_position', 'staff_since'];
const BACKUP_ROWS = 150, BACKUP_PART_BYTES = 800000;
function requireBackupAdmin(user) { if (!user.super) throw new HttpError(403, 'Резервные копии доступны только главному администратору'); }
async function tableCols(env, t) {
  const { results } = await env.DB.prepare(`PRAGMA table_info(${t})`).all();
  const cols = results.map(r => r.name);
  return t === 'users' ? BACKUP_USER_COLS.filter(c => cols.includes(c)) : cols;
}
async function backupRow(env, id) {
  const b = await env.DB.prepare('SELECT * FROM site_backups WHERE id = ?1').bind(id).first();
  if (!b) throw new HttpError(404, 'Копия не найдена');
  return { ...b, summary: parseJ(b.summary, {}) };
}
async function backupsList(env) {
  const { results } = await env.DB.prepare('SELECT * FROM site_backups ORDER BY id DESC LIMIT 100').all();
  return json({ backups: results.map(b => ({ ...b, summary: parseJ(b.summary, {}) })), tables: BACKUP_TABLES });
}
async function backupCreate(request, env, user) {
  const b = await readJson(request);
  const kind = ['manual', 'auto', 'upload'].includes(b.kind) ? b.kind : 'manual';
  const label = str(b.label, 120, { name: 'подпись копии' }) || (kind === 'auto' ? 'Перед восстановлением' : '');
  const r = await env.DB.prepare('INSERT INTO site_backups (created_at, created_by, created_by_name, label, kind, status) VALUES (?1, ?2, ?3, ?4, ?5, ?6)')
    .bind(Date.now(), user.id, user.ic_name || user.global_name || user.username || '', label, kind, 'building').run();
  return json({ backup: await backupRow(env, r.meta.last_row_id), tables: BACKUP_TABLES });
}
// Пустая таблица тоже сохраняется частью без строк — при восстановлении она очистится.
async function backupAddPart(env, id, tbl, cols, rows) {
  let idx = ((await env.DB.prepare('SELECT MAX(idx) AS m FROM site_backup_parts WHERE backup_id = ?1').bind(id).first()).m ?? -1) + 1;
  const stmts = []; let chunk = [], bytes = 0;
  const flush = () => { if (!chunk.length) return; const data = JSON.stringify({ tbl, cols, rows: chunk });
    stmts.push(env.DB.prepare('INSERT INTO site_backup_parts (backup_id, idx, tbl, nrows, data) VALUES (?1, ?2, ?3, ?4, ?5)').bind(id, idx++, tbl, chunk.length, data)); chunk = []; bytes = 0; };
  for (const row of rows) { const n = JSON.stringify(row).length; if (n > BACKUP_PART_BYTES) throw new HttpError(413, `Таблица ${tbl}: слишком большая запись`); if (bytes + n > BACKUP_PART_BYTES) flush(); chunk.push(row); bytes += n; }
  flush();
  if (!stmts.length && !rows.length) stmts.push(env.DB.prepare('INSERT INTO site_backup_parts (backup_id, idx, tbl, nrows, data) VALUES (?1, ?2, ?3, 0, ?4)').bind(id, idx, tbl, JSON.stringify({ tbl, cols, rows: [] })));
  if (stmts.length) await env.DB.batch(stmts);
}
async function backupStep(request, env, id) {
  const bk = await backupRow(env, id); if (bk.status !== 'building' || bk.kind === 'upload') throw new HttpError(409, 'Копия уже собрана');
  const b = await readJson(request);
  const tbl = String(b.table || ''); if (!BACKUP_TABLES.includes(tbl)) throw new HttpError(400, 'Неизвестная таблица');
  const offset = Math.max(0, Number(b.offset) || 0);
  const cols = await tableCols(env, tbl);
  const { results } = await env.DB.prepare(`SELECT ${cols.map(c => `"${c}"`).join(', ')} FROM ${tbl} ORDER BY rowid LIMIT ?1 OFFSET ?2`).bind(BACKUP_ROWS, offset).all();
  if (results.length || offset === 0) await backupAddPart(env, id, tbl, cols, results.map(r => cols.map(c => r[c])));
  return json({ table: tbl, rows: results.length, next: results.length === BACKUP_ROWS ? offset + BACKUP_ROWS : null });
}
async function backupUploadPart(request, env, id) {
  const bk = await backupRow(env, id); if (bk.status !== 'building' || bk.kind !== 'upload') throw new HttpError(409, 'В эту копию нельзя загружать части');
  const b = await readJson(request, 1500000);
  const tbl = String(b.tbl || ''); if (!BACKUP_TABLES.includes(tbl)) throw new HttpError(400, 'Файл копии: неизвестная таблица ' + tbl.slice(0, 40));
  const have = new Set(await tableCols(env, tbl));
  if (!Array.isArray(b.cols) || !b.cols.length || b.cols.some(c => typeof c !== 'string' || !have.has(c))) throw new HttpError(400, `Файл копии: таблица ${tbl} — неизвестные столбцы`);
  if (!Array.isArray(b.rows) || b.rows.length > 5000 || b.rows.some(r => !Array.isArray(r) || r.length !== b.cols.length || r.some(v => v !== null && !['string', 'number'].includes(typeof v)))) throw new HttpError(400, `Файл копии: таблица ${tbl} — повреждённые строки`);
  if (tbl === 'users' && !b.cols.includes('id')) throw new HttpError(400, 'Файл копии: у пользователей нет id');
  await backupAddPart(env, id, tbl, b.cols, b.rows);
  return json({ ok: true });
}
async function backupFinish(env, user, id) {
  const bk = await backupRow(env, id); if (bk.status !== 'building') throw new HttpError(409, 'Копия уже собрана');
  const { results } = await env.DB.prepare('SELECT tbl, SUM(nrows) AS n, SUM(LENGTH(data)) AS sz, COUNT(*) AS c FROM site_backup_parts WHERE backup_id = ?1 GROUP BY tbl').bind(id).all();
  if (!results.length) throw new HttpError(400, 'Копия пустая');
  const summary = Object.fromEntries(results.map(r => [r.tbl, r.n]));
  const size = results.reduce((s, r) => s + r.sz, 0), parts = results.reduce((s, r) => s + r.c, 0);
  await env.DB.prepare("UPDATE site_backups SET status = 'ready', size = ?2, parts = ?3, summary = ?4 WHERE id = ?1").bind(id, size, parts, JSON.stringify(summary)).run();
  await audit(env, user, 'backup.create', String(id), { kind: bk.kind, size, parts });
  return json({ backup: await backupRow(env, id) });
}
async function backupPart(env, id, idx) {
  const r = await env.DB.prepare('SELECT data FROM site_backup_parts WHERE backup_id = ?1 AND idx = ?2').bind(id, idx).first();
  if (!r) throw new HttpError(404, 'Часть копии не найдена');
  return json(parseJ(r.data, {}));
}
// Восстановление по частям: часть = одна транзакция (batch). Первая часть таблицы очищает её. Пользователи не удаляются — у них
// восстанавливаются только роли. Перед первой частью нужна свежая (до 15 минут) автоматическая копия текущего состояния.
async function backupRestore(request, env, user, id) {
  const bk = await backupRow(env, id); if (bk.status !== 'ready') throw new HttpError(409, 'Копия ещё не собрана');
  const b = await readJson(request);
  const idx = Math.max(0, Number(b.idx) || 0);
  if (idx === 0) {
    const pre = b.pre_backup_id ? await env.DB.prepare('SELECT * FROM site_backups WHERE id = ?1').bind(idParam(b.pre_backup_id)).first() : null;
    if (!pre || pre.kind !== 'auto' || pre.status !== 'ready' || pre.created_at < Date.now() - 15 * 60 * 1000 || pre.id === id) throw new HttpError(409, 'Сначала нужна автоматическая копия текущего состояния');
  }
  const part = await env.DB.prepare('SELECT * FROM site_backup_parts WHERE backup_id = ?1 AND idx = ?2').bind(id, idx).first();
  if (!part) throw new HttpError(404, 'Часть копии не найдена');
  const d = parseJ(part.data, null);
  if (!d || !BACKUP_TABLES.includes(d.tbl) || !Array.isArray(d.cols) || !Array.isArray(d.rows)) throw new HttpError(400, 'Часть копии повреждена');
  const have = new Set(await tableCols(env, d.tbl));
  const keep = d.cols.map((c, i) => [c, i]).filter(([c]) => have.has(c));
  const stmts = [];
  if (d.tbl === 'users') {
    const ui = d.cols.indexOf('id'); const set = keep.filter(([c]) => c !== 'id');
    if (ui < 0 || !set.length) throw new HttpError(400, 'Часть копии повреждена');
    for (const r of d.rows) stmts.push(env.DB.prepare(`UPDATE users SET ${set.map(([c], j) => `"${c}" = ?${j + 2}`).join(', ')} WHERE id = ?1`).bind(r[ui], ...set.map(([, i]) => r[i])));
  } else {
    const first = !(await env.DB.prepare('SELECT 1 AS x FROM site_backup_parts WHERE backup_id = ?1 AND tbl = ?2 AND idx < ?3 LIMIT 1').bind(id, d.tbl, idx).first());
    if (first) stmts.push(env.DB.prepare(`DELETE FROM ${d.tbl}`));
    const sql = `INSERT OR REPLACE INTO ${d.tbl} (${keep.map(([c]) => `"${c}"`).join(', ')}) VALUES (${keep.map((_, j) => '?' + (j + 1)).join(', ')})`;
    for (const r of d.rows) stmts.push(env.DB.prepare(sql).bind(...keep.map(([, i]) => r[i] === undefined ? null : r[i])));
  }
  if (stmts.length) await env.DB.batch(stmts);
  const last = idx >= bk.parts - 1;
  if (last) {
    await env.DB.prepare('UPDATE site_backups SET restored_at = ?2, restored_by = ?3 WHERE id = ?1').bind(id, Date.now(), user.id).run();
    await audit(env, user, 'backup.restore', String(id), { parts: bk.parts, label: bk.label });
  }
  return json({ idx, table: d.tbl, rows: d.rows.length, done: last, next: last ? null : idx + 1 });
}
async function backupDelete(env, user, id) {
  await backupRow(env, id);
  await env.DB.batch([env.DB.prepare('DELETE FROM site_backup_parts WHERE backup_id = ?1').bind(id), env.DB.prepare('DELETE FROM site_backups WHERE id = ?1').bind(id)]);
  await audit(env, user, 'backup.delete', String(id), null);
  return json({ ok: true });
}

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

  if (p === '/api/report-config' && M === 'GET') return json(premConfigPublic(await premConfig(env)));
  // правила системы повышения — открыты (по ним считает калькулятор рапорта на повышение на сайте бланков)
  if (p === '/api/promo-config' && M === 'GET') { const pc = await promoConfig(env); return json({ ...pc, items: (await premConfig(env)).items.map(i => ({ key: i.key, name: i.name, group: i.group })) }); }

  let m;
  if ((m = /^\/media\/([A-Za-z0-9_-]{16,48})$/.exec(p)) && M === 'GET') return serveMedia(env, m[1]);
  if (!p.startsWith('/api/')) throw new HttpError(404, 'Не найдено');
  if (p === '/api/bootstrap' && M === 'GET') return bootstrap(request, env, url);
  const user = await authUser(request, env);

  if (p === '/api/logout' && M === 'POST') { await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?1').bind(user._token_hash).run(); return json({ ok: true }); }
  if (p === '/api/me' && M === 'GET') return json({ user: publicUser(user) });
  if (p === '/api/me' && M === 'PUT') {
    const b = await readJson(request);
    const o = profileInput(b, true);
    const keys = Object.keys(o); if (!keys.length) throw new HttpError(400, 'Нечего изменять');
    const prof = {}; for (const k of keys) if (String(user[k] || '') !== String(o[k] || '')) prof[k] = [user[k] || '', o[k] || ''];
    await env.DB.prepare(`UPDATE users SET ${keys.map((k, i) => `${k} = ?${i + 1}`).join(', ')} WHERE id = ?${keys.length + 1}`).bind(...keys.map(k => o[k]), user.id).run();
    if (Object.keys(prof).length) await audit(env, user, 'profile.self', user.id, prof);
    return json({ user: publicUser({ ...user, ...o }) });
  }
  // --- доступ по ролям (проверка на сервере) ---
  const C = caps(user);
  if (/^\/api\/(lectures|exams|courses|topics|reports|premiums|promo)(\/|$)/.test(p)) requireCap(user, 'vp');
  if (/^\/api\/reatt(\/|$)/.test(p)) requireCap(user, 'reatt');
  if (/^\/api\/(attempts|uploads)\//.test(p) && !(C.vp || C.reatt)) throw new HttpError(403, CAP_MSG.vp);

  // общедоступное (всем, кто вошёл): база данных; личные дела — только старший состав (403 для всех остальных, в т. ч. самого сотрудника)
  if (/^\/api\/people(\/|$)/.test(p)) requireSS(user);
  if (p === '/api/docs' && M === 'GET') return listDocs(env, url, user);
  if ((m = /^\/api\/docs\/(\d+)$/.exec(p)) && M === 'GET') return getDoc(env, idParam(m[1]), user);
  if (p === '/api/docs' && M === 'POST') { requireCap(user, 'admin'); return saveDoc(request, env, user, null); }
  if ((m = /^\/api\/docs\/(\d+)$/.exec(p)) && M === 'PUT') { requireCap(user, 'admin'); return saveDoc(request, env, user, idParam(m[1])); }
  if ((m = /^\/api\/docs\/(\d+)$/.exec(p)) && M === 'DELETE') { requireCap(user, 'admin'); return deleteDoc(env, user, idParam(m[1])); }
  if (p === '/api/people' && M === 'GET') return peopleList(env, user);
  if ((m = /^\/api\/people\/(\d{5,25})$/.exec(p))) {
    if (M === 'GET') return personFile(env, user, m[1]);
    if (M === 'POST') return dzCreate(request, env, user, m[1]);
    if (M === 'PUT') return dzUpdate(request, env, user, m[1]);
  }
  if ((m = /^\/api\/people\/(\d{5,25})\/(archive|restore)$/.exec(p)) && M === 'POST') return dzArchive(request, env, user, m[1], m[2] === 'archive');
  if ((m = /^\/api\/people\/(\d{5,25})\/events$/.exec(p)) && M === 'POST') return dzEventAdd(request, env, user, m[1]);
  if ((m = /^\/api\/people\/(\d{5,25})\/events\/(\d+)$/.exec(p))) {
    if (M === 'PUT') return dzEventUpdate(request, env, user, m[1], idParam(m[2]));
    if (M === 'DELETE') return dzEventDelete(request, env, user, m[1], idParam(m[2]));
  }
  if ((m = /^\/api\/people\/(\d{5,25})\/events\/(\d+)\/(lift|unlift)$/.exec(p)) && M === 'POST') return dzEventLift(request, env, user, m[1], idParam(m[2]), m[3] === 'lift');

  // роль «ВП»: учебный отдел (курсы), премирование, система повышения
  if (p === '/api/courses' && M === 'GET') return listCourses(env, user);
  if ((m = /^\/api\/topics\/(\d+)$/.exec(p)) && M === 'GET') return getTopic(env, user, idParam(m[1]));
  if (p === '/api/premiums' && M === 'GET') return publicPremiums(env, user, url);
  if (p === '/api/promo' && M === 'GET') { const pc = await promoConfig(env); const cfg = await premConfig(env); return json({ ...pc, defaults: PROMO_DEFAULT, items: cfg.items.map(i => ({ key: i.key, name: i.name, group: i.group })), can_edit: C.admin }); }
  if (p === '/api/promo' && M === 'PUT') {
    requireCap(user, 'admin');
    const v = promoInput(await premConfig(env), await readJson(request, 200000));
    await env.DB.prepare("INSERT INTO prem_config (k, v, updated_by, updated_at) VALUES ('promo', ?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_by = excluded.updated_by, updated_at = excluded.updated_at").bind(JSON.stringify(v), user.id, Date.now()).run();
    await audit(env, user, 'promo.update', null, { ladder: v.ladder.length });
    return json(await promoConfig(env));
  }
  if (p === '/api/promo/courses' && M === 'PUT') { requireCap(user, 'admin'); return promoCoursesPut(request, env, user); }
  if (p === '/api/promo/eligibility' && M === 'GET') return json(await promoEligibility(env, user, url.searchParams.get('rank') || user.rank));
  if (p === '/api/promo/reset' && M === 'POST') { requireCap(user, 'admin'); await env.DB.prepare("DELETE FROM prem_config WHERE k = 'promo'").run(); await audit(env, user, 'promo.reset', null, null); return json(await promoConfig(env)); }

  if (p === '/api/lectures' && M === 'GET') return listLectures(env, user);
  if ((m = /^\/api\/lectures\/(\d+)$/.exec(p)) && M === 'GET') return getLecture(env, user, idParam(m[1]));
  if ((m = /^\/api\/lectures\/(\d+)\/heartbeat$/.exec(p)) && M === 'POST') return heartbeat(request, env, user, idParam(m[1]));
  if (p === '/api/exams' && M === 'GET') return listExams(env, user);
  if ((m = /^\/api\/exams\/(\d+)$/.exec(p)) && M === 'GET') return getExam(env, user, idParam(m[1]));
  if ((m = /^\/api\/exams\/(\d+)\/start$/.exec(p)) && M === 'POST') return withAttempt(env, user, await startExam(env, user, idParam(m[1])));
  if (p === '/api/my/attempts' && M === 'GET') return myAttempts(env, user);
  if ((m = /^\/api\/attempts\/(\d+)$/.exec(p)) && M === 'GET') return getAttempt(env, user, idParam(m[1]));
  if ((m = /^\/api\/attempts\/(\d+)\/answers$/.exec(p)) && M === 'PUT') return putAnswers(request, env, user, idParam(m[1]));
  if ((m = /^\/api\/attempts\/(\d+)\/submit$/.exec(p)) && M === 'POST') return submitAttempt(request, env, user, idParam(m[1]));
  if ((m = /^\/api\/attempts\/(\d+)\/upload$/.exec(p)) && M === 'POST') return uploadAnswerFile(request, env, user, idParam(m[1]));
  if ((m = /^\/api\/uploads\/(\d+)$/.exec(p)) && M === 'GET') return getUpload(env, user, idParam(m[1]));
  if (p === '/api/reatt' && M === 'GET') return listReatt(env, user);
  if ((m = /^\/api\/reatt\/([a-z0-9_-]{1,40})\/start$/.exec(p)) && M === 'POST') return withAttempt(env, user, await startReatt(env, user, m[1]));

  // еженедельные отчёты сотрудника
  if (p === '/api/reports/my' && M === 'GET') return myReports(env, user, url);
  if (p === '/api/reports' && M === 'POST') return submitReport(request, env, user);
  // «Отчёты и премии» — роль «Руководство ГУ ВП» (и главные администраторы)
  if (p.startsWith('/api/lead/')) {
    requireLead(user);
    if (p === '/api/lead/week' && M === 'GET') return leadWeek(env, url);
    if ((m = /^\/api\/lead\/week\/(\d{4}-\d{2}-\d{2})\/fund$/.exec(p)) && M === 'PUT') return leadSetFund(request, env, user, weekParam(m[1]));
    if ((m = /^\/api\/lead\/week\/(\d{4}-\d{2}-\d{2})\/manual\/(\d{5,25})$/.exec(p)) && M === 'PUT') return leadSetManual(request, env, user, weekParam(m[1]), m[2]);
    if ((m = /^\/api\/lead\/week\/(\d{4}-\d{2}-\d{2})\/leftover$/.exec(p)) && M === 'POST') return leadPostLeftover(env, user, weekParam(m[1]));
    if ((m = /^\/api\/lead\/reports\/(\d+)$/.exec(p)) && M === 'GET') return leadReport(env, idParam(m[1]));
    if ((m = /^\/api\/lead\/reports\/(\d+)$/.exec(p)) && M === 'DELETE') return leadDeleteReport(request, env, user, idParam(m[1]));
    if (p === '/api/lead/deleted' && M === 'GET') return leadDeletedReports(env, url);
    if ((m = /^\/api\/lead\/reports\/(\d+)\/review$/.exec(p)) && M === 'POST') return leadReview(request, env, user, idParam(m[1]));
    if (p === '/api/lead/staff' && M === 'GET') return leadStaff(env);
    if ((m = /^\/api\/lead\/staff\/(\d{5,25})$/.exec(p)) && M === 'PUT') return leadSetStaff(request, env, user, m[1]);
    if (p === '/api/lead/violations' && M === 'GET') return json(await violationsData(env, await premConfig(env)));
    if (p === '/api/lead/violations/excuse' && M === 'POST') return leadExcuse(request, env, user);
    if (p === '/api/lead/budget' && M === 'GET') return leadBudget(env, url);
    if (p === '/api/lead/budget' && M === 'POST') return leadBudgetAdd(request, env, user);
    if ((m = /^\/api\/lead\/budget\/(\d+)$/.exec(p)) && M === 'DELETE') return leadBudgetDelete(env, user, idParam(m[1]));
    if (p === '/api/lead/config' && M === 'GET') return json({ config: await premConfig(env), defaults: PREM_DEFAULT, can_edit: !!user.super });
    if (p === '/api/lead/config' && M === 'PUT') { requireSuper(user); return leadConfigPut(request, env, user); }
    if ((m = /^\/api\/lead\/config\/(items|positions|plan|rules)\/reset$/.exec(p)) && M === 'POST') { requireSuper(user); return leadConfigReset(env, user, m[1]); }
    throw new HttpError(404, 'Не найдено');
  }

  if (p.startsWith('/api/admin/')) {
    requireRole(user, 'examiner'); // минимум — проверяющий; ниже уточняется
    const A = () => requireRole(user, 'admin');
    const G = () => requireCap(user, 'grant'); // выдача ролей и доступов: администратор сайта или руководство (СС)
    if (p === '/api/admin/stats' && M === 'GET') return adminStats(env);
    // лекции
    if (p === '/api/admin/lectures' && M === 'GET') { A(); return adminLectures(env); }
    if (p === '/api/admin/lectures' && M === 'POST') { A(); return saveLecture(request, env, user, null); }
    if (p === '/api/admin/lectures/reorder' && M === 'POST') { A(); return reorder(request, env, user, 'lectures'); }
    // курсы
    if (p === '/api/admin/courses' && M === 'GET') { A(); return adminCourses(env); }
    if (p === '/api/admin/courses' && M === 'POST') { A(); return saveCourse(request, env, user, null); }
    if (p === '/api/admin/courses/reorder' && M === 'POST') { A(); return reorder(request, env, user, 'courses'); }
    // темы курсов
    if (p === '/api/admin/topics' && M === 'GET') { A(); return adminTopics(env); }
    if (p === '/api/admin/topics' && M === 'POST') { A(); return saveTopic(request, env, user, null); }
    if ((m = /^\/api\/admin\/topics\/(\d+)$/.exec(p))) { A(); const tid = idParam(m[1]); if (M === 'GET') return adminTopic(env, tid); if (M === 'PUT') return saveTopic(request, env, user, tid); if (M === 'DELETE') return deleteTopic(env, user, tid); }
    if ((m = /^\/api\/admin\/courses\/(\d+)$/.exec(p))) { A(); const cid = idParam(m[1]); if (M === 'PUT') return saveCourse(request, env, user, cid); if (M === 'DELETE') return deleteCourse(env, user, cid); }
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
    if (p === '/api/admin/bank/check' && M === 'GET') { A(); return bankCheck(env, url); }
    if (p === '/api/admin/bank/stats' && M === 'GET') { A(); return json({ bases: await reattBaseStats(env), base_names: R6_BASES, base_order: R6_BASE_ORDER, topics: R6_TOPICS, docs: SOURCE_DOCS }); }
    if (p === '/api/admin/media' && M === 'GET') { A(); return listMedia(env); }
    if (p === '/api/admin/media' && M === 'POST') { A(); return uploadMedia(request, env, user); }
    if ((m = /^\/api\/admin\/media\/(\d+)$/.exec(p))) { A(); if (M === 'PUT') return replaceMedia(request, env, user, idParam(m[1])); if (M === 'DELETE') return deleteMedia(env, user, idParam(m[1])); }
    // переаттестация
    if (p === '/api/admin/reatt' && M === 'GET') { G(); return adminReatt(env); }
    if (p === '/api/admin/reatt' && M === 'POST') { A(); return createReatt(request, env, user); }
    if (p === '/api/admin/reatt/preview' && M === 'POST') { A(); return previewReatt(request, env, null); }
    if ((m = /^\/api\/admin\/reatt\/(\d+)$/.exec(p))) { A(); const rid = idParam(m[1]);
      if (M === 'GET') return json({ item: await adminReattOne(env, rid) }); if (M === 'PUT') return updateReatt(request, env, user, rid); if (M === 'DELETE') return deleteReatt(env, user, rid); }
    if ((m = /^\/api\/admin\/reatt\/(\d+)\/preview$/.exec(p)) && M === 'POST') { A(); return previewReatt(request, env, idParam(m[1])); }
    if ((m = /^\/api\/admin\/reatt\/(\d+)\/access$/.exec(p))) { G(); if (M === 'GET') return adminReattAccess(env, idParam(m[1])); if (M === 'POST') return adminReattGrant(request, env, user, idParam(m[1])); }
    if ((m = /^\/api\/admin\/reatt\/access\/(\d+)$/.exec(p)) && M === 'DELETE') { G(); return adminReattRevoke(env, user, idParam(m[1])); }
    if ((m = /^\/api\/admin\/questions\/(\d+)$/.exec(p))) {
      A(); const id = idParam(m[1]);
      if (M === 'PUT') return saveQuestion(request, env, user, null, id);
      if (M === 'DELETE') return deleteQuestion(env, user, id);
    }
    // пользователи
    if (p === '/api/admin/users' && M === 'GET') return adminUsers(env, url);
    if ((m = /^\/api\/admin\/users\/(\d{5,25})$/.exec(p))) {
      if (M === 'GET') return adminUser(env, m[1]);
      if (M === 'PUT') { G(); return updateUser(request, env, user, m[1]); }
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
    if (p === '/api/admin/laws' && M === 'GET') { A(); return json(await lawOverview(env)); }
    if (p === '/api/admin/laws/history' && M === 'GET') { A(); return json(await lawHistory(env, url)); }
    if (p === '/api/admin/laws/reports' && M === 'POST') {
      A();
      const gate = assertLawWrite(request, allowedOrigins(env), new URL(request.url).origin);
      if (!gate.ok) throw new HttpError(gate.status, gate.error);
      await rateLimit(env, 'laws-ingest:' + user.id, 30, 600);
      const parsed = parseLawReport(await readJson(request, 1500000));
      if (!parsed.ok) throw new HttpError(parsed.status, parsed.error);
      const saved = await ingestLawReport(env, user, parsed.report, sha256);
      await audit(env, user, 'laws.ingest', saved.check && saved.check.id, { duplicate: !!saved.duplicate, status: saved.check && saved.check.status, offline: parsed.report.offline });
      return json(saved, saved.duplicate ? 200 : 201);
    }
    if ((m = /^\/api\/admin\/laws\/docs\/([a-z0-9_]{1,40})$/.exec(p)) && M === 'GET') {
      A(); const doc = await lawDocument(env, m[1]); if (!doc) throw new HttpError(404, 'Документ не найден'); return json(doc);
    }
    if ((m = /^\/api\/admin\/laws\/proposals\/(\d+)$/.exec(p)) && M === 'GET') {
      A(); const item = await lawProposal(env, idParam(m[1])); if (!item) throw new HttpError(404, 'Предложение не найдено'); return json(item);
    }
    if ((m = /^\/api\/admin\/laws\/proposals\/(\d+)\/decision$/.exec(p)) && M === 'POST') {
      A();
      const gate = assertLawWrite(request, allowedOrigins(env), new URL(request.url).origin);
      if (!gate.ok) throw new HttpError(gate.status, gate.error);
      await rateLimit(env, 'laws-decide:' + user.id, 60, 600);
      const b = await readJson(request);
      const result = await decideProposal(env, user, idParam(m[1]), b.action, Number(b.generation), b.note);
      if (!result.ok) throw new HttpError(result.status, result.error);
      await audit(env, user, result.proposal.status === 'approved' ? 'laws.approve' : 'laws.reject', m[1], { doc: undefined, note: String(b.note || '').slice(0, 300) });
      if (result.doc_id) { try { result.doc = await lawDocument(env, result.doc_id); } catch (_) { /* документ не обязателен в ответе */ } }
      return json(result);
    }
    if ((m = /^\/api\/admin\/laws\/flags\/(\d+)\/ack$/.exec(p)) && M === 'POST') {
      A();
      const gate = assertLawWrite(request, allowedOrigins(env), new URL(request.url).origin);
      if (!gate.ok) throw new HttpError(gate.status, gate.error);
      await rateLimit(env, 'laws-ack:' + user.id, 60, 600);
      const b = await readJson(request);
      const result = await acknowledgeFlag(env, user, idParam(m[1]), b.note);
      if (!result.ok) throw new HttpError(result.status, result.error);
      await audit(env, user, 'laws.flag.ack', m[1], { note: String(b.note || '').slice(0, 300) });
      return json(result);
    }
    // резервные копии — только главный администратор
    if (p === '/api/admin/backups' || p.startsWith('/api/admin/backups/')) {
      requireBackupAdmin(user);
      if (p === '/api/admin/backups' && M === 'GET') return backupsList(env);
      if (p === '/api/admin/backups' && M === 'POST') return backupCreate(request, env, user);
      if ((m = /^\/api\/admin\/backups\/(\d+)$/.exec(p)) && M === 'GET') return json({ backup: await backupRow(env, idParam(m[1])) });
      if ((m = /^\/api\/admin\/backups\/(\d+)$/.exec(p)) && M === 'DELETE') return backupDelete(env, user, idParam(m[1]));
      if ((m = /^\/api\/admin\/backups\/(\d+)\/step$/.exec(p)) && M === 'POST') return backupStep(request, env, idParam(m[1]));
      if ((m = /^\/api\/admin\/backups\/(\d+)\/upload$/.exec(p)) && M === 'POST') return backupUploadPart(request, env, idParam(m[1]));
      if ((m = /^\/api\/admin\/backups\/(\d+)\/finish$/.exec(p)) && M === 'POST') return backupFinish(env, user, idParam(m[1]));
      if ((m = /^\/api\/admin\/backups\/(\d+)\/part\/(\d+)$/.exec(p)) && M === 'GET') return backupPart(env, idParam(m[1]), Number(m[2]));
      if ((m = /^\/api\/admin\/backups\/(\d+)\/restore$/.exec(p)) && M === 'POST') return backupRestore(request, env, user, idParam(m[1]));
      throw new HttpError(404, 'Не найдено');
    }
    if (p === '/api/admin/settings' && M === 'GET') { A(); return json({ settings: await getSettings(env) }); }
    if (p === '/api/admin/settings' && M === 'PUT') { A(); return putSettings(request, env, user); }
    if (p === '/api/admin/audit' && M === 'GET') { A(); return adminAudit(env, url); }
  }
  throw new HttpError(404, 'Не найдено');
}
