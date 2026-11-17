// E2E «Благодарность от руководства в рапорте на повышение»: баллы вписываются как есть (1500) и идут в итог —
// на портале (#/promo/raport), в проверке руководства (#/lead/promo/:id), на сервере и в офлайн-бланке (povyshenie.html).
// Старые черновики (30 благодарностей) и старая форма (n = 30 без баллов) переводятся в 1500 баллов.
// Запуск: bash /tmp/reset.sh; офлайн-бланк — SITE_DIR=/workspace/vp_raport_offline PORT=8081 node serve.js (если не запущен — часть пропускается).
const { chromium } = require('playwright');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/', OFF = 'http://localhost:8081/';
const SHOTS = __dirname + '/shots/';
const SUPER = '417660389723996170', EMP = '500000000000000041', LEAD = '500000000000000049', EMP2 = '500000000000000042';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 600) : '')); };
const call = async (m, p, t, b) => { const h = {}; if (t) h.Authorization = 'Bearer ' + t; if (b !== undefined) h['Content-Type'] = 'application/json'; const r = await fetch(API + p, { method: m, headers: h, body: b !== undefined ? JSON.stringify(b) : undefined }); let d = null; try { d = await r.json(); } catch (e) {} return { status: r.status, d }; };
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;

(async () => {
  const A = await login(SUPER, 'Шерман Ассман');
  const U = await login(EMP, 'thanks-emp', 'vp');
  const L = await login(LEAD, 'thanks-lead', 'leader,vp');
  const U2 = await login(EMP2, 'thanks-emp2', 'vp');
  await call('PUT', '/api/admin/users/' + EMP, A, { ic_name: 'Артём Козырев', rank: 'Младший лейтенант', static_id: '5511' });
  await call('PUT', '/api/admin/users/' + EMP2, A, { ic_name: 'Дмитрий Старый', rank: 'Младший лейтенант', static_id: '5512' });
  await call('PUT', '/api/admin/settings', A, { promo_missing_points: true });
  await call('PUT', '/api/promo/courses', A, { all: [], by_rank: {} });
  const pc = await call('GET', '/api/promo-config');
  const PTS = pc.d.config.pts, step = pc.d.config.ladder.find(s => s.rank === 'Младший лейтенант');
  check('правила: благодарность помечена как пункт с баллами', (pc.d.items.find(i => i.key === 'thanks') || {}).direct === true && !PTS.thanks, PTS.thanks);

  const b = await chromium.launch({ args: ['--no-sandbox'] });
  const errs = [];
  const open = async (tok, init) => { const ctx = await b.newContext({ viewport: { width: 1400, height: 900 }, locale: 'ru-RU' });
    if (tok) await ctx.addInitScript(t => localStorage.setItem('vpexam_token', t), tok);
    if (init) await ctx.addInitScript(init);
    const p = await ctx.newPage(); p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return p; };

  // ---------- 1. портал: черновик со старым счётом (30 благодарностей) → 1500 баллов ----------
  const p = await open(U, () => { if (!localStorage.getItem('vp_promo_crit_seeded')) { localStorage.setItem('vp_promo_crit', JSON.stringify({ n: { thanks: 30 }, links: {}, custom: [], vp: {}, tp: {} })); localStorage.setItem('vp_promo_crit_seeded', '1'); } });
  await p.goto(SITE + '#/promo/raport'); await p.waitForSelector('#promoSend'); await p.waitForFunction(() => window.__vp && window.__vp.crit);
  const row = p.locator('.act[data-key=thanks]');
  check('портал: у благодарности нет счётчика штук, одно поле «баллы от руководства»', (await row.locator('.ctr').count()) === 0 && (await row.locator('[data-n]').count()) === 1 && /баллы от руководства/.test(await row.textContent()) && !/каждые 50/.test(await row.textContent()), await row.textContent());
  check('портал: старый черновик (30 благодарностей) показан как 1500 баллов', (await row.locator('[data-n]').inputValue()) === '1500', await row.locator('[data-n]').inputValue());
  check('портал: 1500 баллов благодарностей в итоге', (await p.evaluate(() => window.__vp.crit.total())) === 1500 && /1500 \//.test(await p.textContent('#barText')), await p.textContent('#barText'));
  await row.locator('[data-n]').fill('1200'); await row.locator('[data-n]').dispatchEvent('input');
  await row.locator('summary').click(); await row.locator('[data-links]').fill('https://imgur.com/a/th1\nhttps://imgur.com/a/th2'); await row.locator('[data-links]').dispatchEvent('input');
  check('портал: ссылки не меняют баллы благодарностей', (await row.locator('[data-n]').inputValue()) === '1200');
  await row.locator('[data-n]').fill('1500'); await row.locator('[data-n]').dispatchEvent('input');
  const setAct = async (key, n) => { const r = p.locator(`.act[data-key=${key}]`); await r.locator('[data-n]').fill(String(n)); await r.locator('[data-n]').dispatchEvent('input'); };
  await setAct('patrol', 1); await setAct('prof', 3); await setAct('prizyv', 2);
  const exp = (PTS.patrol || 0) * 1 + (PTS.prof || 0) * 3 + (PTS.prizyv || 0) * 2 + 1500;
  check(`портал: итог = пункты + 1500 = ${exp}`, (await p.evaluate(() => window.__vp.crit.total())) === exp && (await p.evaluate(() => window.__vp.compute().total)) === exp);
  check('портал: критерии выполнены', /выполнены|Готово/.test(await p.textContent('#critNote')), await p.textContent('#critNote'));
  const doc = await p.evaluate(() => JSON.stringify(window.__vp.crit.docList('extra', { n: 0 }, true)));
  check('документ: «Благодарность от руководства — баллов: 1500»', /Благодарность от руководства — баллов: /.test(doc) && /"t":"1500"/.test(doc), doc);
  check('общий результат: баллы благодарностей не считаются штуками', (await p.evaluate(() => window.__vp.crit.count())) === 6);
  await p.fill('#fromUnit', 'Батальон военной полиции'); await p.fill('#toDate', '2026-11-15');
  if (await p.$('select#fromPos')) await p.selectOption('#fromPos', { index: 1 }); else await p.fill('#fromPos', 'Инспектор ВП');
  await p.click('#promoSend');
  await p.waitForFunction(() => /отправлен руководству/.test(document.getElementById('promoSendStatus').textContent), null, { timeout: 10000 });
  const my = await call('GET', '/api/promo/raports/my', U), R = my.d.raport;
  const th = R && R.items.find(i => i.key === 'thanks');
  check('сервер: благодарность сохранена баллами (1500), заявлено ' + exp, th && th.n === 1500 && th.points === 1500 && th.direct && R.summary.claimed === exp, R && { th, s: R.summary });
  check('портал: «Мой рапорт» — «1500 баллов»', /1500 баллов/.test(await p.textContent('#promoMine')));
  await p.reload(); await p.waitForFunction(() => window.__vp && window.__vp.crit);
  check('портал: после перезагрузки черновик не пересчитывается повторно (1500)', (await p.locator('.act[data-key=thanks] [data-n]').inputValue()) === '1500');

  // ---------- 2. руководство ----------
  const lp = await open(L);
  await lp.goto(SITE + '#/lead/promo/' + R.id); await lp.waitForSelector('#sumCard');
  const lrow = lp.locator('.ritem[data-key=thanks]');
  check('руководство: «баллов: 1500», «идут в итог как есть»', /баллов: 1500/.test(await lrow.textContent()) && /идут в итог как есть/.test(await lrow.textContent()), await lrow.textContent());
  for (const k of ['patrol', 'prof', 'prizyv', 'thanks']) { await lp.locator(`.ritem[data-key=${k}] .i-ok`).click(); await lp.waitForFunction((k) => document.querySelector(`.ritem[data-key=${k}]`).classList.contains('acc'), k); }
  const sumTxt = await lp.textContent('#sumCard');
  check(`руководство: засчитано ${exp} баллов, критерии выполнены`, sumTxt.includes(String(exp)) && /критерии выполнены/.test(sumTxt), sumTxt.slice(0, 300));
  await lp.locator('.ritem[data-key=thanks] .nok').fill('1000'); await lp.locator('.ritem[data-key=thanks] .i-ok').click();
  await lp.waitForFunction(() => /1000 из 1500/.test(document.querySelector('.ritem[data-key=thanks]').textContent));
  const g = await call('GET', '/api/lead/promo/' + R.id, L);
  check('руководство: засчитать 1000 из 1500 → итог меньше на 500', g.d.raport.summary.points === exp - 500, g.d.raport.summary);
  await lp.screenshot({ path: SHOTS + 'promo-thanks-lead.png', fullPage: true });

  // ---------- 3. старая форма: n = 30 без баллов → 1500 ----------
  const old = await call('POST', '/api/promo/raports', U2, { header: { rank: 'Младший лейтенант', name: 'Дмитрий Старый', static_id: '5512', target: 'Лейтенант' }, items: [{ key: 'thanks', n: 30, links: [] }, { key: 'prof', n: 3, links: [] }] });
  const oth = old.d && old.d.raport && old.d.raport.items.find(i => i.key === 'thanks');
  check('старая форма: 30 благодарностей приняты как 1500 баллов', old.status === 200 && oth && oth.n === 1500 && old.d.raport.summary.claimed === 1500 + (PTS.prof || 0) * 3, old.d);
  const bad = await call('POST', '/api/promo/raports', U2, { header: { rank: 'Младший лейтенант', name: 'x', static_id: '1', target: 'Лейтенант' }, items: [{ key: 'thanks', points: 200000, links: [] }] });
  check('больше 100000 баллов — 400', bad.status === 400);

  // ---------- 4. правила повышения ----------
  const ap = await open(A);
  await ap.goto(SITE + '#/promo'); await ap.waitForSelector('.ladder');
  const trs = await ap.$$eval('table tr', rs => rs.map(r => r.textContent.replace(/\s+/g, ' ')));
  check('«Система повышения»: благодарность — «как выданы»', trs.some(t => /Благодарность от руководства/.test(t) && /как выданы/.test(t)), trs);

  // ---------- 5. офлайн-бланк ----------
  let offOk = false; try { offOk = (await fetch(OFF + 'povyshenie.html')).ok; } catch (e) {}
  if (offOk) {
    const op = await open(null); await op.route(/discord(app)?\.com/, rt => rt.abort());
    await op.goto(OFF + 'povyshenie.html'); await op.waitForFunction(() => window.__vp && window.__vp.crit);
    await op.fill('#fromRank', 'Младший лейтенант'); await op.dispatchEvent('#fromRank', 'input');
    const orow = op.locator('.act[data-key=thanks]');
    check('бланк: у благодарности одно поле баллов', (await orow.locator('.ctr').count()) === 0 && (await orow.locator('[data-n]').count()) === 1);
    await orow.locator('[data-n]').fill('1500'); await orow.locator('[data-n]').dispatchEvent('input');
    check('бланк: 1500 баллов благодарностей в итоге', (await op.evaluate(() => window.__vp.compute().total)) === 1500 && /1500 \//.test(await op.textContent('#barText')), await op.textContent('#barText'));
  } else console.log('SKIP офлайн-бланк не запущен на :8081');

  check('без ошибок JS', !errs.length, errs);
  await b.close();
  const f = results.filter(r => !r.ok).length;
  console.log(`${results.length - f}/${results.length} PASS`);
  process.exit(f ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
