// E2E «Транспорт в личном деле»: вкладка «Транспорт» (#/person/:id?tab=cars) — вставить список одной строкой → «Разобрать» → поправить/убрать
// строки → сохранить одним запросом; показ в деле; права (правит старший состав, сам СС видит своё без правки, обычный ВП — 403).
// Запуск: bash /tmp/reset.sh, затем node tests/e2e-dossier-vehicles.js
const { chromium } = require('playwright');
const fs = require('fs');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const SUPER = '417660389723996170', EMP = '820000000000000001', SS = '820000000000000002', VP = '820000000000000003';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 600) : '')); };
const call = async (m, p, t, b) => { const h = {}; if (t) h.Authorization = 'Bearer ' + t; if (b !== undefined) h['Content-Type'] = 'application/json'; const r = await fetch(API + p, { method: m, headers: h, body: b !== undefined ? JSON.stringify(b) : undefined }); let d = null; try { d = await r.json(); } catch (_) {} return { status: r.status, d }; };
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, a) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args: a }) })).json()).results;
const USER = 'Устаревший Тигр - 0372ОХ | 73 Служебный Патриот - 5647МТ| 08 Патриот Минобороны - 7085РН | 75 Служебная Веста - 7407ОВ | 84 Бобик Служебный - 2606НС | 80 Генезис - | ОСНОВНОЙ Бизнес-Вэн-Служебный -8155ВТ | 35 Хавал Ф7 - 4575МР | 38 Тигр - 7596СН | 26 ПавАЗ Некст - 0276ХР | 75 ПавАЗ 3205 - 7046ОС | 57 Военный Грузовик - 8776НО | 87 Тигр - 7596CН / 26';

(async () => {
  const A = await login(SUPER, 'Шерман Ассман'), E = await login(EMP, 'veh-emp', 'vp'), S = await login(SS, 'veh-ss', 'vp'), V = await login(VP, 'veh-vp', 'vp');
  await sql('UPDATE users SET senior = 1, staff = 1 WHERE id = ?1', [SS]);
  check('дело заведено (сотрудник)', (await call('POST', '/api/people/' + EMP, A, { service_cars: [{ model: 'УАЗ', plate: '1111АА', main: true }] })).status === 200);
  check('дело заведено (сам СС)', (await call('POST', '/api/people/' + SS, A, {})).status === 200);
  // API: регион/пометка, номер не обязателен при пометке
  let r = await call('PUT', '/api/people/' + EMP, A, { vehicles: [{ model: 'Генезис', plate: '', note: 'ОСНОВНОЙ' }, { model: 'Тигр', plate: '7596сн', region: '26' }] });
  check('API: запись без номера с пометкой и регион сохраняются', r.status === 200 && r.d.dossier.vehicles.length === 2 && r.d.dossier.vehicles[1].region === '26' && r.d.dossier.vehicles[0].note === 'ОСНОВНОЙ', r.d);
  check('API: регион — только 2–3 цифры', (await call('PUT', '/api/people/' + EMP, A, { vehicles: [{ model: 'X', plate: '1234АВ', region: 'abc' }] })).status === 400);
  check('API: обычный ВП транспорт чужого дела не правит', (await call('PUT', '/api/people/' + EMP, V, { vehicles: [] })).status === 403);
  await call('PUT', '/api/people/' + EMP, A, { vehicles: [] });

  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const open = async (tok) => { const ctx = await b.newContext({ viewport: { width: 1300, height: 900 }, locale: 'ru-RU' }); await ctx.addInitScript(t => localStorage.setItem('vpexam_token', t), tok);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return p; };
  const p = await open(A);
  const puts = []; p.on('request', q => { if (q.method() === 'PUT' && /\/api\/people\//.test(q.url())) puts.push(q.postDataJSON()); });
  await p.goto(SITE + `#/person/${EMP}?tab=cars`); await p.waitForSelector('#vparse');
  await p.fill('#vtext', USER); await p.click('#vparse');
  await p.waitForSelector('#vrows .vrow');
  const rows = await p.$$eval('#vrows .vrow', l => l.map(r => ['model', 'plate', 'region', 'note'].map(n => r.querySelector(`[name=${n}]`).value).join('|')));
  check('разбор: 12 строк (13 записей, повтор Тигра склеен), сразу таблицей', rows.length === 12 && /Найдено: 13/.test(await p.textContent('#vout')) && /повторы склеены/.test(await p.textContent('#vout')), rows);
  check('строки: название, номер, регион, пометка', rows[0] === 'Устаревший Тигр|0372ОХ|73|' && rows[5] === 'Генезис|||ОСНОВНОЙ' && rows[6] === 'Бизнес-Вэн-Служебный|8155ВТ|35|' && rows[10] === 'ПавАЗ 3205|7046ОС|57|' && rows[8] === 'Тигр|7596СН|26|', rows);
  check('повтор помечен ×2, «ОСНОВНОЙ» отмечен как основной', /×2/.test(await p.locator('#vrows .vrow').nth(8).textContent()) && await p.locator('#vrows .vrow').nth(5).locator('[name=main]').isChecked());
  check('неразобранного нет', !(await p.$('#vout .alert.warn')));
  // правка перед сохранением: убрать «Устаревший Тигр», поправить регион у Весты
  await p.locator('#vrows .vrow').nth(0).locator('.vdel').click();
  await p.locator('#vrows .vrow').nth(2).locator('[name=region]').fill('99');
  check('кнопка показывает число строк после удаления', /Сохранить 11/.test(await p.textContent('#vsave')));
  await p.click('#vsave'); await p.waitForFunction(() => !document.getElementById('vrows'), null, { timeout: 10000 }); await p.waitForSelector('.dzrow .plate');
  check('сохранено одним запросом', puts.length === 1 && puts[0].service_cars.length === 12, puts.map(x => x.service_cars && x.service_cars.length));
  const saved = (await call('GET', '/api/people/' + EMP, A)).d.dossier.service_cars;
  check('в деле: прежний УАЗ + 11 новых, регион поправлен, основной — Генезис', saved.length === 12 && saved[0].model === 'УАЗ' && !saved[0].main && saved.find(c => c.model === 'Служебная Веста').region === '99' && saved.filter(c => c.main).length === 1 && saved.find(c => c.main).model === 'Генезис' && !saved.some(c => c.model === 'Устаревший Тигр'), saved);
  const view = await p.textContent('#dzbody');
  check('показ: номер с регионом, пометка «основной»', /7596СН\s*26/.test(view) && /Генезис/.test(view) && (await p.$$('#dzbody .card .dzrow')).length === 12);
  // повторная вставка того же — «уже есть в деле», грязный кусок отдельно
  await p.fill('#vtext', 'Тигр - 7596CН / 26; какая-то ерунда; Камаз 6520 - 5555TT | 177'); await p.click('#vparse'); await p.waitForSelector('#vout p');
  const o2 = await p.textContent('#vout');
  check('повторная вставка: уже есть в деле, новое — одна строка, неразобранное показано', /уже есть в деле: 1/.test(o2) && (await p.$$('#vrows .vrow')).length === 1 && /какая-то ерунда/.test(await p.textContent('#vout .alert.warn')), o2);
  await p.click('#vcancel');
  check('«Отмена» — ничего не сохраняется', !(await p.$('#vrows')) && puts.length === 1);
  // личные ТС
  await p.fill('#vtext', 'Хавал Ф7 - 4575МР | 38'); await p.click('label:has([name=vto][value=vehicles]) span'); await p.click('#vparse'); await p.waitForSelector('#vsave'); await p.click('#vsave');
  await p.waitForFunction(() => !document.getElementById('vrows'));
  check('в личные ТС', (await call('GET', '/api/people/' + EMP, A)).d.dossier.vehicles.some(v => v.model === 'Хавал Ф7' && v.region === '38'));
  // форма редактирования: регион и пометка видны и не теряются при сохранении
  await p.goto(SITE + `#/person/${EMP}/edit`); await p.waitForSelector('#scars .vrow [name=region]');
  check('редактирование: поля региона и пометки', (await p.$$('#scars .vrow')).length === 12 && (await p.$$eval('#scars .vrow', l => l.map(r => r.querySelector('[name=model]').value + '|' + r.querySelector('[name=note]').value + '|' + r.querySelector('[name=region]').value))).includes('Генезис|ОСНОВНОЙ|'));
  await p.click('#dzf .stickybar .btn.gold'); await p.waitForURL(/#\/person\/\d+$/);
  const after = (await call('GET', '/api/people/' + EMP, A)).d.dossier.service_cars;
  check('сохранение формы не теряет регион и пометку', JSON.stringify(after) === JSON.stringify(saved), after);
  // сам СС видит свой транспорт, без правки
  await call('PUT', '/api/people/' + SS, A, { service_cars: [{ model: 'Тигр', plate: '7596СН', region: '26', main: true }] });
  const sp = await open(S); await sp.goto(SITE + `#/person/${SS}?tab=cars`); await sp.waitForSelector('#dzbody .dzrow');
  check('сам СС: видит свой транспорт, блока вставки нет', /7596СН/.test(await sp.textContent('#dzbody')) && !(await sp.$('#vpaste')));
  check('обычный ВП: личное дело не видно (403)', (await call('GET', '/api/people/' + EMP, V)).status === 403);
  await p.goto(SITE + `#/person/${EMP}?tab=cars`); await p.waitForSelector('#vparse');
  await p.screenshot({ path: __dirname + '/shots/dossier-vehicles.png', fullPage: true });
  check('без ошибок на страницах', errs.length === 0, errs);
  await b.close();
  fs.writeFileSync(__dirname + '/e2e-dossier-vehicles-results.json', JSON.stringify(results, null, 1));
  const f = results.filter(x => !x.ok).length; console.log(`\n${results.length - f} PASS, ${f} FAIL`); process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
