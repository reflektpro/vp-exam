// E2E «Отчёты и премии»: сайт отчётов (vp-raport-offline, :8081) → вход через Discord (имитация /__test/oauth) → отправка отчёта →
// руководство (vp-exam, :8080, #/lead): сводная таблица, проверка пунктов, фонд, надбавки, экспорт, нарушения, бюджет, таблицы выплат.
// Запуск: bash /tmp/reset.sh (wrangler dev :8787, миграции 0001–0008), node serve.js (:8080), SITE_DIR=../vp_raport_offline PORT=8081 node serve.js.
const { chromium } = require('playwright');
const fs = require('fs');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/', OFF = 'http://localhost:8081/';
const SHOTS = process.env.SHOTS || (__dirname + '/shots/'); fs.mkdirSync(SHOTS, { recursive: true });
const ADMIN = '417660389723996170', E1 = '500000000000000001', E2 = '500000000000000002', E3 = '500000000000000003', LEAD = '500000000000000009';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 600) : '')); };
async function call(method, path, token, body) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  let d = null; try { d = await r.json(); } catch (_) {}
  return { status: r.status, d };
}
const login = async (id, name) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}`)).json()).token;
const mondayMsk = (ms) => { const d = new Date(ms + 3 * 3600000); const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - (d.getUTCDay() + 6) % 7)); return x.toISOString().slice(0, 10); };
const addD = (w, n) => { const d = new Date(w + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const WEEK = mondayMsk(Date.now()), PREV = addD(WEEK, -7);

(async () => {
  const A = await login(ADMIN, 'super-admin');
  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const ctx = await b.newContext({ viewport: { width: 1400, height: 1000 }, locale: 'ru-RU', acceptDownloads: true });
  const page = await ctx.newPage();
  const errs = []; page.on('pageerror', e => errs.push(e.message));
  page.on('dialog', d => d.accept());

  // ---------- 1. сайт отчётов: без входа ----------
  await page.goto(OFF + 'otchet.html'); await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('#ecoBar .eco-in');
  check('отчёты: старой полосы нет, есть кнопка-шторка', !(await page.$('.eco-bar')) && !!(await page.$('header.topbar #ecoBurger')));
  await page.click('#ecoBurger'); await page.waitForFunction(() => document.body.classList.contains('eco-open'));
  check('шторка сайта бланков: бланки + «Сайт ГУ ВП», без входа — только вход', /Еженедельный отчёт/.test(await page.textContent('#ecoDrawer')) && /Вход на сайт ГУ ВП/.test(await page.textContent('#ecoDrawer')) && !/Учебный отдел/.test(await page.textContent('#ecoDrawer')));
  await page.keyboard.press('Escape'); await page.waitForFunction(() => !document.body.classList.contains('eco-open'));
  await page.waitForFunction(() => /войдите через Discord/.test(document.getElementById('sendInfo').textContent));
  check('без входа: кнопка «Войти через Discord»', (await page.textContent('#sendBtn')).includes('Войти'));
  // форма
  await page.fill('#num', '7'); await page.fill('#fromRank', 'Лейтенант'); await page.fill('#fromStatic', '4455'); await page.fill('#fromName', 'Иван Петров');
  await page.fill('#fromUnit', 'Батальон военной полиции');
  check('должность — список из 7 должностей таблицы окладов', (await page.$$eval('#fromPos option', o => o.map(x => x.value).filter(Boolean))).join('|') === 'Комендант Гарнизона|Ком. Бат. ВП|Зам. Ком. Бат. ВП|Инспектор Комендатуры|Инструктор ВП|Инспектор ВП|Стажёр ВП');
  await page.selectOption('#fromPos', 'Инспектор ВП');
  await page.click('#wkCur');
  check('период по умолчанию — текущая неделя пн–вс', (await page.inputValue('#fromDate')) === WEEK && (await page.inputValue('#toDate')) === addD(WEEK, 6), [await page.inputValue('#fromDate'), WEEK]);
  const setAct = async (key, n, links) => {
    const row = page.locator(`.act[data-key=${key}]`);
    if (links) { await row.locator('summary').click(); await row.locator('[data-links]').fill(links.join('\n')); }
    await row.locator('[data-n]').fill(String(n));
  };
  await setAct('postavka', 10, ['https://disk.yandex.ru/d/post1', 'https://disk.yandex.ru/d/post2']);
  await setAct('otbitie', 3, ['https://disk.yandex.ru/d/otb']); await setAct('proc', 2, ['https://imgur.com/a/proc']);
  await setAct('training', 1, ['https://imgur.com/a/tr']); await setAct('event6', 1, ['https://imgur.com/a/mp']); await page.fill('.act[data-key=event6] [data-vp]', '10');
  await setAct('pmp', 5, ['https://imgur.com/a/pmp']); await setAct('city', 5);
  await page.fill('.act[data-key=thanks] [data-tp]', '750');
  check('благодарности: 750 баллов → 15', (await page.inputValue('.act[data-key=thanks] [data-n]')) === '15');
  await page.waitForSelector('#planBox:not([hidden])');
  check('план недели считается на форме: нормальный', /нормальный план выполнен/.test(await page.textContent('#planBox')), await page.textContent('#planBox'));
  // PDF без входа работает
  const dl = page.waitForEvent('download'); await page.click('#pdf'); const pdf = await dl;
  check('PDF выгружается без входа', /otchet_7\.pdf$/.test(pdf.suggestedFilename()), pdf.suggestedFilename());
  // вход: реальная кнопка ведёт на /auth/login (локально OAuth не настроен → возврат с ошибкой)
  await page.click('#sendBtn'); await page.waitForURL(/8081\/otchet\.html/);
  await page.waitForFunction(() => /Вход не выполнен/.test(document.getElementById('sendInfo').textContent));
  check('кнопка входа → /auth/login → возврат на сайт отчётов с сообщением', /OAuth не настроен/.test(await page.textContent('#sendInfo')));
  // имитация успешного входа через Discord: /__test/oauth выдаёт login_code, как /auth/callback
  await page.goto(`${API}/__test/oauth?id=${E1}&name=${encodeURIComponent('ivan_d')}&return=${encodeURIComponent(OFF + 'otchet.html')}`);
  await page.waitForSelector('#ecoBar .eco-out');
  check('после входа: имя в шапке, кнопка «Отправить отчёт»', /ivan_d/.test(await page.textContent('#ecoBar')) && (await page.textContent('#sendBtn')).includes('Отправить'));
  check('черновик формы сохранился после входа', (await page.inputValue('.act[data-key=postavka] [data-n]')) === '10' && (await page.inputValue('#fromPos')) === 'Инспектор ВП');
  await page.click('#sendBtn'); await page.waitForFunction(() => /отправлен руководству|Не отправлено/.test(document.getElementById('sendStatus').textContent));
  check('отчёт отправлен', /отправлен руководству/.test(await page.textContent('#sendStatus')), await page.textContent('#sendStatus'));
  await page.waitForFunction(() => /Отправленный отчёт/.test(document.getElementById('sendInfo').textContent));
  check('статус «отправлен», нормальный план, кнопка «Обновить»', /отправлен/.test(await page.textContent('#sendInfo')) && /нормальный план/.test(await page.textContent('#sendInfo')) && /Обновить/.test(await page.textContent('#sendBtn')));
  await page.screenshot({ path: SHOTS + 'rep-offline-sent.png', fullPage: false });
  // правка в том же отчёте
  await setAct('docs', 2);
  await page.click('#sendBtn'); await page.waitForFunction(() => /обновлён|Не отправлено/.test(document.getElementById('sendStatus').textContent));
  const t1 = await login(E1, 'ivan_d');
  let r = await call('GET', '/api/reports/my?week=' + WEEK, t1);
  check('повторная отправка → тот же отчёт, версия 2', r.d.report && r.d.report.version === 2 && r.d.report.items.some(i => i.key === 'docs'), r.d.report && r.d.report.version);
  check('сервер: баллы основной отчётности (200+60+10+3+10+15 = 298)', r.d.report.points === 298, r.d.report.points);
  const repId = r.d.report.id;

  // ---------- 2. права и роль «Руководство ГУ ВП» ----------
  r = await call('GET', '/api/lead/week', t1); check('сотрудник без роли → 403 на «Отчёты и премии»', r.status === 403);
  const L = await login(LEAD, 'leader');
  r = await call('PUT', '/api/admin/users/' + LEAD, A, { leader: true }); check('админ назначает роль «Руководство ГУ ВП»', r.status === 200 && r.d.user.leader, r.d);
  r = await call('GET', '/api/lead/week', L); check('руководство видит неделю', r.status === 200);
  r = await call('PUT', '/api/lead/config', L, { rules: { ded_none: 40 } }); check('таблицы выплат меняет только главный администратор', r.status === 403);
  await login(E2, 'petr_s'); await login(E3, 'late_guy');
  for (const [u, body] of [[E1, { staff: true }], [E2, { staff: true, senior: true, staff_position: 'Инструктор ВП', staff_since: addD(WEEK, -21) }]]) { r = await call('PUT', '/api/lead/staff/' + u, L, body); check('состав: отметка ' + u, r.status === 200, r.d); }
  // опоздавший: отчёт за прошлую неделю (срок прошёл)
  const t3 = await login(E3, 'late_guy');
  r = await call('POST', '/api/reports', t3, { week: PREV, position: 'Стажёр ВП', header: { rank: 'Рядовой', name: 'Пётр Поздний', static_id: '9', from: PREV, to: addD(PREV, 6) }, items: [{ key: 'postavka', n: 6, links: [] }] });
  check('отчёт после срока сохраняется с отметкой late', r.status === 200 && r.d.report.late, r.d);
  r = await call('POST', '/api/reports', t3, { week: addD(WEEK, 7), position: 'Стажёр ВП', header: { rank: 'Рядовой', name: 'x', static_id: '9' }, items: [{ key: 'postavka', n: 1 }] });
  check('за будущую неделю — нельзя', r.status === 400);

  // ---------- 3. руководство: сводная таблица ----------
  const as = async (tok, hash) => { await page.goto(SITE + '#/'); await page.evaluate(t => localStorage.setItem('vpexam_token', t), tok); await page.reload(); await page.waitForSelector('#logoutBtn'); await page.goto(SITE + '#' + hash); };
  await as(L, '/lead'); await page.waitForSelector('table.prem');
  check('руководство: в шторке «Руководство», без «Админки»', /Руководство/.test(await page.textContent('#drawer')) && !/Админка/.test(await page.textContent('#drawer')), await page.textContent('#drawer'));
  check('учебный сайт: верхней полосы ссылок нет, есть бургер', !(await page.$('.eco-bar')) && !(await page.$('#nav')) && await page.isVisible('#burger'));
  const rowTxt = async (uid) => page.textContent(`tr[data-uid="${uid}"]`);
  check('таблица: сотрудник с отчётом — нормальный план, база 499 000 (220 000 + 279 000)', /Нормальный/.test(await rowTxt(E1)) && /499\s000/.test(await rowTxt(E1)), await rowTxt(E1));
  check('таблица: сотрудник состава без отчёта — подсвечен «Нет отчёта»', (await page.getAttribute(`tr[data-uid="${E2}"]`, 'class')).includes('r-missing') && /Нет отчёта/.test(await rowTxt(E2)));
  check('таблица: колонки пунктов сгруппированы', (await page.$$eval('table.prem th.grp', t => t.map(x => x.textContent))).join('|') === 'Основная отчётность|Дополнительная отчётность|Работа ГУ ВП');
  // фонд
  await page.fill('#fundF [name=fund]', '5000'); await page.click('#fundF button'); await page.waitForSelector('.toast.err');
  check('фонд вне 8–20 млн → ошибка', /от 8/.test(await page.textContent('#toast')));
  await page.fill('#fundF [name=fund]', '10000000'); await page.click('#fundF button'); await page.waitForFunction(() => /9\s501\s000/.test(document.getElementById('remaining')?.textContent || ''));
  check('остаток фонда = 10 000 000 − 499 000', /9\s501\s000/.test(await page.textContent('#remaining')));
  // наградная
  await page.fill(`tr[data-uid="${E1}"] .m-award`, '50000'); await page.dispatchEvent(`tr[data-uid="${E1}"] .m-award`, 'change'); await page.waitForSelector('.toast.err');
  check('наградная < 100 000 → ошибка', /от 100/.test(await page.textContent('#toast')), await page.textContent('#toast'));
  await page.fill(`tr[data-uid="${E1}"] .m-award`, '300000'); await page.dispatchEvent(`tr[data-uid="${E1}"] .m-award`, 'change');
  await page.waitForFunction(() => /9\s201\s000/.test(document.getElementById('remaining')?.textContent || ''));
  check('наградная 300 000 → итого 799 000, остаток 9 201 000', /799\s000/.test(await rowTxt(E1)));
  r = await call('PUT', `/api/lead/week/${WEEK}/manual/${E1}`, L, { ss: 100000 }); check('премия СС не старшему составу → ошибка', r.status === 400);
  r = await call('PUT', `/api/lead/week/${WEEK}/manual/${E2}`, L, { ss: 600000 }); check('премия СС > 500 000 → ошибка', r.status === 400);
  await page.screenshot({ path: SHOTS + 'rep-week.png', fullPage: true });
  // экспорт
  let dlp = page.waitForEvent('download'); await page.click('#csvBtn'); let f = await dlp; const csvPath = SHOTS + 'premii.csv'; await f.saveAs(csvPath);
  const csv = fs.readFileSync(csvPath, 'utf8');
  check('экспорт CSV: заголовки и сотрудники', csv.startsWith('\ufeffСотрудник;') && /Иван Петров/.test(csv) && /Участие в поставочном мероприятии/.test(csv) && /;499000;/.test(csv));
  dlp = page.waitForEvent('download'); await page.click('#xlsxBtn'); f = await dlp; const xPath = SHOTS + 'premii.xlsx'; await f.saveAs(xPath);
  const { execSync } = require('child_process');
  let xl = ''; try { xl = execSync(`python3 -c "import zipfile,sys;z=zipfile.ZipFile('${xPath}');print(z.testzip());x=z.read('xl/worksheets/sheet1.xml').decode();print('Иван Петров' in x, x.count('<row '))"`).toString(); } catch (e) { xl = String(e); }
  check('экспорт XLSX: корректный zip, лист с данными', /^None\nTrue/.test(xl), xl.slice(0, 200));

  // ---------- 4. проверка отчёта по пунктам ----------
  await page.click(`tr[data-uid="${E1}"] a[href^="#/lead/report/"]`); await page.waitForSelector('.ritem');
  check('отчёт: ссылки-доказательства кликабельны', (await page.$$eval('.ritem[data-key=postavka] .links a', a => a.map(x => x.href))).join() === 'https://disk.yandex.ru/d/post1,https://disk.yandex.ru/d/post2');
  await page.fill('.ritem[data-key=pmp] .icom', 'нет бодикамеры'); await page.click('.ritem[data-key=pmp] .i-rej');
  await page.waitForSelector('.ritem.rej[data-key=pmp]');
  const prem = async () => page.textContent('.grid.two .card:nth-child(2)');
  check('отклонён пункт ПМП → план не выполнен, премия пересчитана (55 000 + 271 500 − 50% = 190 750)', /190\s750/.test(await prem()) && /Не выполнен/.test(await page.textContent('.grid.two .card:first-child')), await prem());
  await page.click('.ritem[data-key=pmp] .i-clr'); await page.waitForSelector('.ritem[data-key=pmp]:not(.rej)');
  await page.fill('.ritem[data-key=postavka] .nok', '8'); await page.click('.ritem[data-key=postavka] .i-ok'); await page.waitForSelector('.ritem.acc[data-key=postavka]');
  check('принято частично 8 из 10 поставок → минимальный план', /Минимальный/.test(await page.textContent('.grid.two .card:first-child')));
  await page.fill('.ritem[data-key=postavka] .nok', '10'); await page.click('.ritem[data-key=postavka] .i-ok'); await page.waitForTimeout(300);
  await page.click('#allOk'); await page.waitForFunction(() => document.querySelectorAll('.ritem.acc').length === document.querySelectorAll('.ritem').length);
  await page.fill('#rf [name=comment]', 'Принято, молодец'); await page.click('#rf [data-st=approved]'); await page.waitForTimeout(500);
  await page.waitForSelector('.card .badge.ok');
  check('отчёт принят, премия 499 000 + наградная', /Принят/.test(await page.textContent('.card')) && /799\s000/.test(await prem()), await prem());
  await page.selectOption('#pos', 'insp_kom'); await page.waitForTimeout(600); await page.waitForSelector('#pos');
  check('руководство исправляет должность → оклад Инспектора Комендатуры (275 000)', /275\s000/.test(await prem()), await prem());
  await page.selectOption('#pos', 'insp'); await page.waitForTimeout(600);
  await page.screenshot({ path: SHOTS + 'rep-report.png', fullPage: true });

  // ---------- 5. сотрудник видит статус ----------
  await page.goto(OFF + 'otchet.html'); await page.waitForFunction(() => /Отправленный отчёт/.test(document.getElementById('sendInfo').textContent));
  check('сотрудник видит «принят» и комментарий', /принят/.test(await page.textContent('#sendInfo')) && /Принято, молодец/.test(await page.textContent('#sendInfo')));

  // ---------- 6. нарушения ----------
  await as(L, '/lead/violations'); await page.waitForSelector('table');
  const vrow = async () => page.textContent(`tr:has(button[data-u="${E2}"])`);
  check('нарушения: 3 недели без отчёта → увольнение', /увольнение/.test(await vrow()), await vrow());
  await page.click(`button[data-u="${E2}"][data-e="1"]`); await page.waitForTimeout(600);
  check('снятие одного нарушения → выговор', /выговор/.test(await vrow()), await vrow());
  r = await call('GET', '/api/lead/violations', L); check('сотрудник со сданным отчётом без нарушений', r.d.users.find(u => u.user_id === E1).strikes === 0, r.d.users);

  // ---------- 7. бюджет ГУ ВП ----------
  await as(L, '/lead/budget'); await page.waitForSelector('#bf');
  check('СС без взноса за неделю помечен', /не внесено/.test(await page.textContent('.card.flat:nth-child(2)')));
  await page.selectOption('#bf [name=kind]', 'contribution'); await page.fill('#bf [name=amount]', '150000'); await page.selectOption('#bf [name=user_id]', E2); await page.click('#bf button');
  await page.waitForFunction(() => /внесено/.test(document.body.textContent) && !/не внесено/.test(document.querySelector('.card.flat:nth-child(2)').textContent));
  check('взнос 150 000 → отметка «внесено», баланс 150 000', /150\s000/.test(await page.textContent('#balance')));
  r = await call('POST', '/api/lead/budget', L, { kind: 'withdrawal', amount: 1000 }); check('снятие без примечания → ошибка', r.status === 400);
  r = await call('POST', '/api/lead/budget', L, { kind: 'withdrawal', amount: 50000, note: 'Наградные значки' }); check('снятие с примечанием', r.status === 200);
  r = await call('PUT', `/api/lead/week/${WEEK}/manual/${E1}`, L, { award: 300000, award_budget: 20000 }); check('наградная из бюджета ГУ ВП', r.status === 200);
  r = await call('GET', '/api/lead/budget', L); check('баланс = 150 000 − 50 000 − 20 000', r.d.balance === 80000, r.d.balance);
  const bid = r.d.entries.find(e => e.kind === 'withdrawal').id;
  r = await call('DELETE', '/api/lead/budget/' + bid, L); r = await call('GET', '/api/lead/budget', L);
  check('удаление операции — мягкое, в журнале остаётся', r.d.balance === 130000 && r.d.entries.find(e => e.id === bid).deleted_at);
  r = await call('GET', '/api/admin/audit?limit=50', A); check('журнал: операции бюджета и премий', r.status === 200 && JSON.stringify(r.d).includes('budget.add') && JSON.stringify(r.d).includes('prem.manual'));

  // ---------- 8. таблицы выплат (главный администратор) ----------
  await as(A, '/lead/config'); await page.waitForSelector('#tPos');
  check('таблицы: 7 должностей, план 6 строк, 42 пункта', (await page.$$('#tPos tr')).length === 8 && (await page.$$('#tPlan tr[data-key]')).length === 6 && (await page.$$('#tItems tr[data-key]')).length === 42);
  check('план: «мероприятия внутри ВС РФ» — МП, тренировка, профилактика (без ГМП)', /Организовать МП, Проведение тренировки для военнослужащих, Организация профилактического мероприятия/.test(await page.textContent('#tPlan tr[data-key=event]')) && !/ГМП/.test(await page.textContent('#tPlan tr[data-key=event] summary')));
  await page.fill('#tItems tr[data-key=postavka] [data-f=pay]', '13500'); await page.click('[data-save=items]'); await page.waitForTimeout(600);
  r = await call('GET', '/api/lead/week', L); check('выплата за поставку 13 500 → база 509 000', r.d.rows.find(x => x.user_id === E1).base === 509000, r.d.rows.find(x => x.user_id === E1));
  await page.click('[data-reset=items]'); await page.waitForTimeout(600);
  r = await call('GET', '/api/lead/week', L); check('«Вернуть значения приказа» → снова 499 000', r.d.rows.find(x => x.user_id === E1).base === 499000);
  r = await call('PUT', '/api/lead/config', A, { plan: [{ key: 'x', name: 'X', min: 1, normal: 2, items: ['nope'] }] }); check('план с несуществующим пунктом → ошибка', r.status === 400);
  // админ назначает роль на странице пользователя
  await as(A, '/admin/user/' + E3); await page.waitForSelector('#leader');
  await page.check('#leader'); await page.waitForTimeout(600);
  r = await call('GET', '/api/me', t3); check('чекбокс «Руководство ГУ ВП» на странице пользователя', r.d.user.leader === true);
  await page.goto(OFF + 'otchet.html'); await page.evaluate(t => localStorage.setItem('vpexam_token', t), L); await page.reload(); await page.waitForSelector('#ecoBar .eco-out');
  check('сайт отчётов: руководству в шторке видна ссылка «Руководство: отчёты»', /Руководство: отчёты/.test(await page.textContent('#ecoDrawer')) && (await page.getAttribute('#ecoDrawer a[href$="#/lead"]', 'href')) === SITE + '#/lead');
  // мобильный вид
  const m = await b.newPage({ viewport: { width: 390, height: 800 } }); await m.goto(OFF + 'otchet.html'); await m.waitForSelector('#ecoBar');
  check('мобильный: шапка сайта отчётов помещается в ширину', await m.evaluate(() => { const e = document.querySelector('header.topbar'); return e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= innerWidth + 1; }));
  await m.goto(SITE + '#/'); await m.waitForSelector('.login, #burger:not([hidden])');
  check('мобильный: учебный сайт без горизонтальной прокрутки', await m.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
  await m.screenshot({ path: SHOTS + 'rep-mobile.png' }); await m.close();
  check('нет ошибок JS на страницах', errs.length === 0, errs);
  await b.close();
  const okN = results.filter(x => x.ok).length; console.log(`\nИТОГО: ${okN}/${results.length} PASS`);
  fs.writeFileSync(__dirname + '/e2e-reports-results.json', JSON.stringify(results, null, 1));
  process.exit(okN === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
