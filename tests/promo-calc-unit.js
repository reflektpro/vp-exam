// Расчёт рапорта на повышение одинаков на сервере (worker.js promoSummary), на сайте ГУ ВП и на сайте бланков (promo-calc.js):
// одинаковые правила и отметки → одинаковые баллы, «не хватает», замена пунктов баллами, курсы. Плюс: копии promo-calc.js
// и promo-rules.js в обоих репозиториях совпадают, а значения по умолчанию в promo-rules.js = снимок прода.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../worker/worker.js'), 'utf8').replace(/^import .*$/mg, '').replace(/^export default/m, 'const __default =');
const W = new Function(src + '\nreturn { promoSummary, PROMO_DEFAULT, promoRaportInput, PREM_DEFAULT };')();
const PC = require('../report/promo-calc.js');
const loadRules = () => { const g = {}; new Function('window', fs.readFileSync(path.join(__dirname, '../report/promo-rules.js'), 'utf8'))(g); return g.PROMO; };
const PROD = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/promo-prod.json'), 'utf8'));
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) pass++; else { fail++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } };
const OFF = path.join(__dirname, '../../vp_raport_offline');
for (const f of ['promo-calc.js', 'promo-rules.js']) {
  if (fs.existsSync(path.join(OFF, f))) ok(`${f}: копии на сайте ГУ ВП и сайте бланков совпадают`, fs.readFileSync(path.join(OFF, f), 'utf8') === fs.readFileSync(path.join(__dirname, '../report/' + f), 'utf8'));
}
// значения по умолчанию = прод
const R0 = loadRules();
ok('promo-rules: баллы за все пункты = прод', Object.entries(PROD.config.pts).every(([k, v]) => (R0.acts.find(a => a.key === k) || {}).pts === v), Object.entries(PROD.config.pts).filter(([k, v]) => (R0.acts.find(a => a.key === k) || {}).pts !== v));
ok('promo-rules: ступени = прод', JSON.stringify(PROD.config.ladder.map(s => [s.rank, s.to, s.points, s.need])) === JSON.stringify(Object.entries(R0.ladder).map(([r, s]) => [r, s.to, s.points, s.need])));
ok('promo-rules: «баллы за недостающий пункт» = прод', R0.missingPoints === PROD.missing_points && R0.pointsPerItem === PROD.config.points_per_item);
ok('promo-rules: все пункты сайта ГУ ВП есть в бланке (включая kraz_otbitie)', PROD.items.every(i => R0.acts.some(a => a.key === i.key)) && R0.acts.some(a => a.key === 'kraz_otbitie'));
// случайные отметки — детерминированный генератор
let seed = 12345; const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };
const cfgs = [
  { name: 'прод', r: { config: PROD.config, items: PROD.items, custom: true } },
  { name: 'по умолчанию (сервер)', r: { config: JSON.parse(JSON.stringify(W.PROMO_DEFAULT)), items: PROD.items, custom: false } },
  { name: 'новый пункт и правки', r: { config: { ...PROD.config, points_per_item: 75, pts: { ...PROD.config.pts, new_item: 40, kraz_otbitie: 45 }, ladder: [...PROD.config.ladder, { rank: 'Капитан', to: 'Майор', points: 2000, need: { new_item: 2, kraz_otbitie: 1 } }] }, items: [...PROD.items, { key: 'new_item', name: 'Новый пункт', group: 'gu' }], custom: true } },
];
let cases = 0;
for (const c of cfgs) {
  for (const mp of [true, false]) {
    const P = loadRules();
    ok(`${c.name}: правила применены`, PC.applyConfig(P, { ...c.r, missing_points: mp }));
    const pc = { config: c.r.config, items: c.r.items, missing_points: mp };
    const keys = c.r.items.map(i => i.key);
    ok(`${c.name}: баллы за каждый пункт = настройки`, keys.every(k => (P.acts.find(a => a.key === k) || {}).pts === (c.r.config.pts[k] || 0)));
    const ranks = c.r.config.ladder.map(s => s.rank).concat(['Рядовой', '']);
    for (const rank of ranks) {
      const step = c.r.config.ladder.find(s => s.rank === rank);
      for (let t = 0; t < 120; t++) {
        const counts = {};
        // обязательные пункты ступени: часто около нормы; остальное — случайно
        if (step) for (const [k, need] of Object.entries(step.need)) { const x = rnd(need + 3) - 1; if (x > 0) counts[k] = x; }
        const extra = rnd(6); for (let i = 0; i < extra; i++) { const k = keys[rnd(keys.length)]; counts[k] = (counts[k] || 0) + 1 + rnd(t % 3 ? 4 : 25); }
        const courses = t % 5 === 0 ? [{ id: 1, title: 'Курс', done: t % 10 === 0 }] : [];
        // благодарность от руководства — баллы (direct): иногда крупные, как в жизни (1500)
        if (t % 7 === 0 && keys.includes('thanks')) counts.thanks = 50 * (1 + rnd(40));
        const items = Object.entries(counts).map(([key, n]) => ({ key, n }));
        const review = {}; items.forEach(i => { review[i.key] = { status: 'ok' }; });
        const s = W.promoSummary(pc, rank.toUpperCase(), items, review, courses);
        const r = PC.calc(P, ' ' + rank.toLowerCase() + ' ', counts, { missingPoints: mp, courses });
        const sv = { points: s.points, step: s.step && [s.step.rank, s.step.to, s.step.points], met: s.met, covered: s.covered || 0, need: s.need.map(x => [x.key, x.need, x.have, x.lack]), left: s.left ? [s.left.points, s.left.items, s.left.courses.length] : null };
        const cv = { points: r.total, step: r.step && [r.rank, r.step.to, r.step.points], met: r.met, covered: r.covered, need: r.items.map(x => [x.key, x.need, x.have, x.lack]), left: r.left ? [r.left.pts, r.left.swap, r.left.courses.length] : null };
        cases++;
        if (JSON.stringify(sv) !== JSON.stringify(cv)) { ok(`${c.name} / ${rank} / замена ${mp}: сервер = бланк`, false, { counts, sv, cv }); break; }
      }
    }
  }
}
ok('проверено случаев (все ступени, оба режима, три набора правил)', cases > 4000, cases);
// пример из жизни: старший лейтенант → капитан по прод-правилам
{
  const P = loadRules(); PC.applyConfig(P, { config: PROD.config, items: PROD.items, missing_points: false });
  const r = PC.calc(P, 'Старший лейтенант', { prof: 6, vygovor: 5, prizyv: 3, proc: 3, kraz_otbitie: 4, postavka: 10 }, {});
  ok('пример: 60+250+90+150+140+250 = 940 из 1500, не хватает 560 баллов', r.total === 940 && !r.met && r.left.pts === 560 && r.left.swap === 0, r);
}
// благодарность от руководства: баллы идут в итог как есть, без деления на 50 (настройка pts.thanks = 0 не мешает)
{
  ok('правила: благодарность — пункт с баллами (direct), pts в проде 0', (R0.acts.find(a => a.key === 'thanks') || {}).direct === true && PROD.config.pts.thanks === 0);
  const P = loadRules(); PC.applyConfig(P, { config: PROD.config, items: PROD.items, missing_points: true });
  const counts = { patrol: 1, thanks: 1500, prof: 3, prizyv: 2 };
  const r = PC.calc(P, 'Младший лейтенант', counts, {});
  ok('бланк: 1500 баллов благодарностей идут в итог (по снимку правил: 25 + 1500 + 30 + 60 = 1615 из 1000, критерии выполнены)', r.total === 1615 && r.met, r);
  ok('бланк: только благодарности 1500 → 1500 баллов', PC.calc(P, 'Рядовой', { thanks: 1500 }, {}).total === 1500);
  const pc = { config: PROD.config, items: PROD.items, missing_points: true };
  const items = Object.entries(counts).map(([key, n]) => ({ key, n })), review = {}; items.forEach(i => { review[i.key] = { status: 'ok' }; });
  const s = W.promoSummary(pc, 'Младший лейтенант', items, review, []);
  ok('сервер: 1500 баллов благодарностей засчитаны (1615, выполнено)', s.points === 1615 && s.claimed === 1615 && s.met, s);
  const s2 = W.promoSummary(pc, 'Младший лейтенант', items, { ...review, thanks: { status: 'ok', n_ok: 1000 } }, []);
  ok('сервер: засчитано меньше баллов благодарностей (1000 из 1500) → 1115', s2.points === 1115 && s2.claimed === 1615, s2);
  const cfg = JSON.parse(JSON.stringify(W.PREM_DEFAULT));
  const hdr = { rank: 'Младший лейтенант', name: 'Тест Тестов', static_id: '1', target: 'Лейтенант' };
  const inNew = W.promoRaportInput(cfg, { header: hdr, items: [{ key: 'thanks', n: 1500, points: 1500 }, { key: 'prof', n: 3 }] });
  ok('приём рапорта: баллы благодарностей сохраняются как есть (1500)', inNew.items[0].n === 1500 && inNew.items[0].points === 1500 && inNew.items[1].n === 3, inNew.items);
  const inOld = W.promoRaportInput(cfg, { header: hdr, items: [{ key: 'thanks', n: 30 }] });
  ok('приём рапорта со старой формы: 30 благодарностей → 1500 баллов', inOld.items[0].n === 1500 && inOld.items[0].points === 1500, inOld.items);
  let big = null; try { W.promoRaportInput(cfg, { header: hdr, items: [{ key: 'thanks', points: 100001 }] }); } catch (e) { big = e.status || e.code || e.message; }
  ok('приём рапорта: больше 100000 баллов — ошибка', big !== null, big);
}
console.log(fail ? `FAILED ${fail} (passed ${pass})` : `ALL OK ${pass} (случаев ${cases})`);
process.exit(fail ? 1 : 0);
