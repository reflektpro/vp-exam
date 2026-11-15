// E2E кэша сессий/ролей в Worker: выход, снятие роли и блокировка срабатывают сразу; чужие данные не утекают; свои записи видны сразу.
const API = 'http://localhost:8787';
const SUPER = '417660389723996170', U1 = '500000000000000041', U2 = '500000000000000042';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 400) : '')); };
const call = async (m, p, t, b, hd) => { const h = { ...(hd || {}) }; if (t) h.Authorization = 'Bearer ' + t; if (b !== undefined) h['Content-Type'] = 'application/json'; const r = await fetch(API + p, { method: m, headers: h, body: b !== undefined ? JSON.stringify(b) : undefined }); let d = null; try { d = await r.json(); } catch (_) {} return { status: r.status, d, h: r.headers }; };
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
(async () => {
  const A = await login(SUPER, 'Шерман Ассман');
  // выход
  const T1 = await login(U1, 'cache-u1', 'vp');
  check('сессия работает (и попала в кэш)', (await call('GET', '/api/me', T1)).status === 200 && (await call('GET', '/api/courses', T1)).status === 200);
  check('выход: 200', (await call('POST', '/api/logout', T1)).status === 200);
  check('после выхода тот же токен сразу 401', (await call('GET', '/api/me', T1)).status === 401 && (await call('GET', '/api/courses', T1)).status === 401);
  // снятие роли
  const T2 = await login(U1, 'cache-u1', 'vp');
  check('с ролью ВП курсы доступны', (await call('GET', '/api/courses', T2)).status === 200);
  check('администратор снял роль ВП', (await call('PUT', '/api/admin/users/' + U1, A, { vp: false })).status === 200);
  const me = await call('GET', '/api/me', T2);
  check('роль снята — сразу видна в /api/me и курсы закрыты', me.d && me.d.user && !me.d.user.vp && (await call('GET', '/api/courses', T2)).status === 403, me.d);
  await call('PUT', '/api/admin/users/' + U1, A, { vp: true });
  check('роль возвращена — сразу доступ', (await call('GET', '/api/courses', T2)).status === 200);
  // блокировка
  check('администратор заблокировал', (await call('PUT', '/api/admin/users/' + U1, A, { blocked: true })).status === 200);
  const bl = await call('GET', '/api/me', T2);
  check('после блокировки токен сразу не работает', bl.status === 401 || bl.status === 403, bl.status);
  await call('PUT', '/api/admin/users/' + U1, A, { blocked: false });
  // персональные кэши: свои записи видны сразу, чужие не утекают
  const Ta = await login(U1, 'cache-u1', 'vp'), Tb = await login(U2, 'cache-u2', 'vp');
  const wk = (await call('GET', '/api/reports/my', Ta)).d;
  await call('GET', '/api/reports/my', Tb);
  const week = wk && (wk.week || (wk.report && wk.report.week));
  const sub = await call('POST', '/api/reports', Ta, { week, header: { name: 'Кэш Тест', rank: 'Сержант', static_id: '1', position: 'Инспектор ВП' }, items: [{ key: 'training', n: 1, links: ['https://imgur.com/a/x'] }] });
  const mineA = (await call('GET', '/api/reports/my', Ta)).d, mineB = (await call('GET', '/api/reports/my', Tb)).d;
  check('отчёт отправлен и сразу виден автору', sub.status === 200 && mineA && mineA.report && mineA.report.id, [sub.status, sub.d, mineA]);
  check('у другого сотрудника отчёта нет (кэш раздельный)', mineB && !mineB.report, mineB);
  // CORS: заголовок свежего чтения разрешён
  const pf = await fetch(API + '/api/me', { method: 'OPTIONS', headers: { Origin: 'http://localhost:8080', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'authorization,x-vp-fresh' } });
  check('CORS разрешает X-VP-Fresh', /x-vp-fresh/i.test(pf.headers.get('access-control-allow-headers') || ''), pf.headers.get('access-control-allow-headers'));
  check('X-VP-Fresh: запрос проходит', (await call('GET', '/api/me', Ta, undefined, { 'X-VP-Fresh': '1' })).status === 200);
  const fail = results.filter(r => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} passed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
