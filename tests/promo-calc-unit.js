// Расчёт рапорта на повышение одинаков на сервере (worker.js promoSummary), на сайте ГУ ВП и на сайте бланков (promo-calc.js):
// одинаковые правила и отметки → одинаковые баллы, «не хватает», замена пунктов баллами, курсы. Плюс: копии promo-calc.js
// и promo-rules.js в обоих репозиториях совпадают, а значения по умолчанию в promo-rules.js = снимок прода.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../worker/worker.js'), 'utf8').replace(/^import .*$/mg, '').replace(/^export default/m, 'const __default =');
const W = new Function(src + '\nreturn { promoSummary, PROMO_DEFAULT };')();
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
  ok('пример: 180+250+90+150+140+250 = 1060 из 1500, не хватает 440 баллов', r.total === 1060 && !r.met && r.left.pts === 440 && r.left.swap === 0, r);
}
console.log(fail ? `FAILED ${fail} (passed ${pass})` : `ALL OK ${pass} (случаев ${cases})`);
process.exit(fail ? 1 : 0);
