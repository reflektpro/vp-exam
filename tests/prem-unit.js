// Юнит-тест движка премий (приказ № 01_10 + уточнения руководства): node tests/prem-unit.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../worker/worker.js'), 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '').replace(/^import .*$/gm, '');
const W = new Function(src + '\nreturn { PREM_DEFAULT, computePremiums, premBase, premPlan, premPoints, premCounts, premShare, weeklyPoints, reportInput, weekOf, weekDeadline, positionKey, strikeLabel, premConfigInput, reportToDefault, REPORT_TO };')();
let fail = 0, pass = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } };
const cfg = JSON.parse(JSON.stringify(W.PREM_DEFAULT));
const rub = n => n.toLocaleString('ru-RU') + ' ₽';

// --- таблицы как в приказе ---
ok('40 оплачиваемых пунктов (Таблицы 1–2 + «Проверка рапортов на взыскание»)', cfg.items.filter(i => i.pay > 0).length === 40);
ok('7 должностей, максимальная выплата = 2,5 × средний оклад', cfg.positions.length === 7 && cfg.positions.every(p => p.max === p.avg * 2.5 && p.avg === p.min * 2 && p.min === p.zero * 2));
ok('Инспектор ВП: 55 000 / 110 000 / 220 000 / 550 000', JSON.stringify(cfg.positions.find(p => p.key === 'insp')) === JSON.stringify({ key: 'insp', name: 'Инспектор ВП', zero: 55000, min: 110000, avg: 220000, max: 550000 }));
ok('план: ровно две строки — баллы отчёта и действия ГУ ВП; пороги 200/400 и 5/10', cfg.plan.map(l => `${l.key}:${l.min}/${l.normal}`).join() === 'points:200/400,gu:5/10', cfg.plan);
ok('действия ГУ ВП включают проц. действия и тренировки (тот же набор)', ['proc', 'training', 'soch', 'prof', 'city', 'docs'].every(k => cfg.plan.find(l => l.key === 'gu').items.includes(k)));
ok('лимитов доп. премии и на человека больше нет', cfg.rules.add_cap === undefined && cfg.rules.person_cap === undefined);

// --- уровень плана: только баллы отчёта + действия ГУ ВП ---
const P = (o) => ({ user_id: o.id || 'u', name: o.name || o.id, report: true, late: false, status: 'submitted', position: 'insp', counts: {}, award: 0, ss: 0, award_budget: 0, senior: false, ...o });
const lvl = (counts, points) => W.premPlan(cfg, counts, points).level;
ok('400 баллов и 10 действий → нормальный', lvl({ city: 10 }, 400) === 'normal');
ok('399 баллов и 10 действий → минимальный', lvl({ city: 10 }, 399) === 'min');
ok('400 баллов и 9 действий → минимальный', lvl({ city: 9 }, 400) === 'min');
ok('200 баллов и 5 действий → минимальный', lvl({ city: 3, docs: 2 }, 200) === 'min');
ok('199 баллов при 100 действиях → нет плана', lvl({ city: 100 }, 199) === 'none');
ok('1000 баллов при 4 действиях → нет плана', lvl({ city: 4 }, 1000) === 'none');
ok('поставки/отбития/ПМП/мероприятия больше не нужны', lvl({ proc: 2, training: 3, docs: 5 }, 450) === 'normal');
ok('проц. действия и тренировки идут в действия ГУ ВП', W.premPlan(cfg, { proc: 2, training: 3, prof: 1, city: 1 }, 0).lines.find(l => l.key === 'gu').got === 7);
let pl = W.premPlan(cfg, { city: 6 }, 260);
ok('видно, чего не хватает до нормального', pl.level === 'min' && pl.missing_normal.map(x => `${x.key}:${x.need}`).join() === 'points:140,gu:4', pl.missing_normal);
// пороги из настроек
const cfg2 = JSON.parse(JSON.stringify(cfg)); cfg2.plan = W.premConfigInput('plan', [{ key: 'points', name: 'Баллы', min: 100, normal: 300 }, { key: 'gu', name: 'ГУ', min: 2, normal: 4, items: ['city'] }]);
ok('пороги настраиваются: 100/300 и 2/4, набор пунктов ГУ — тоже', W.premPlan(cfg2, { city: 4, docs: 50 }, 300).level === 'normal' && W.premPlan(cfg2, { docs: 50 }, 300).level === 'none' && W.premPlan(cfg2, { city: 2 }, 100).level === 'min');
let threw = ''; try { W.premConfigInput('plan', [{ key: 'points', name: 'Баллы', min: 500, normal: 300 }, { key: 'gu', name: 'ГУ', min: 5, normal: 10, items: ['city'] }]); } catch (e) { threw = e.message; }
ok('настройки плана: нормальный не меньше минимального', /не может быть меньше/.test(threw));
ok('настройки плана: лишние старые строки отбрасываются', W.premConfigInput('plan', [{ key: 'postavka', name: 'x', min: 6, normal: 10, items: ['postavka'] }, { key: 'gu', name: 'ГУ', min: 5, normal: 10, items: ['city'] }]).map(l => l.key).join() === 'points,gu');

// --- баллы плана = баллы еженедельного отчёта по принятым количествам ---
const ITEMS = [{ key: 'postavka', n: 10 }, { key: 'otbitie', n: 5 }, { key: 'event6', n: 1, vp: 30 }, { key: 'thanks', n: 4 }, { key: 'city', n: 6 }];
ok('без проверки: баллы плана = баллы отчёта (благодарности и ГУ ВП в баллы не входят)', W.premPoints(cfg, ITEMS, {}) === W.weeklyPoints(cfg, ITEMS) && W.weeklyPoints(cfg, ITEMS) === 330);
ok('отклонённый пункт и уменьшенное количество снижают баллы', W.premPoints(cfg, ITEMS, { otbitie: { status: 'rejected' }, postavka: { status: 'ok', n_ok: 8 } }) === 190);
ok('МП с баллами вручную: отклонён — 0', W.premPoints(cfg, ITEMS, { event6: { status: 'rejected' } }) === 300);

// --- примеры базовой премии ---
const NORMAL = { postavka: 10, otbitie: 10, city: 6, docs: 4 };      // 400 баллов, 10 действий ГУ
const MIN = { postavka: 10, city: 5 };                                // 200 баллов, 5 действий ГУ
let r = W.premBase(cfg, P({ counts: NORMAL }));
ok('нормальный план: 400 баллов, 10 действий → средний оклад 220 000 + действия 288 000, без вычета = 508 000', r.plan.level === 'normal' && r.plan_points === 400 && r.oklad === 220000 && r.actions === 288000 && r.deduction === 0 && r.base === 508000, r);
console.log(`  Пример 1 (Инспектор ВП, нормальный план): оклад ${rub(r.oklad)} + действия ${rub(r.actions)} = ${rub(r.base)}`);
r = W.premBase(cfg, P({ counts: MIN }));
ok('минимальный план: 110 000 + 150 000 − 20% (30 000) = 230 000', r.plan.level === 'min' && r.oklad === 110000 && r.actions === 150000 && r.deduction === 30000 && r.base === 230000, r);
console.log(`  Пример 2 (Инспектор ВП, минимальный план): ${rub(r.oklad)} + ${rub(r.actions)} − 20% ${rub(r.deduction)} = ${rub(r.base)}`);
r = W.premBase(cfg, P({ counts: { postavka: 2, thanks: 15 } }));
ok('без плана: нулевой оклад 55 000 + (25 000 + 15×2 500) − 50% = 86 250', r.plan.level === 'none' && r.oklad === 55000 && r.actions === 62500 && r.deduction === 31250 && r.base === 86250, r);
console.log(`  Пример 3 (без плана, 15 благодарностей): ${rub(r.oklad)} + ${rub(r.actions)} − 50% ${rub(r.deduction)} = ${rub(r.base)}`);
r = W.premBase(cfg, P({ counts: NORMAL, points: 380 }));
ok('принятые баллы ниже порога (380) → минимальный, хотя пунктов на 400', r.plan.level === 'min' && r.deduct_pct === 20, r.plan);
r = W.premBase(cfg, P({ counts: NORMAL, items: [{ key: 'postavka', n: 10 }, { key: 'otbitie', n: 10 }], review: { otbitie: { status: 'ok', n_ok: 9 } } }));
ok('баллы из пунктов с учётом проверки (n_ok 9 → 380)', r.plan_points === 380 && r.plan.level === 'min', r.plan_points);

ok('опоздание → без премии', W.premBase(cfg, P({ late: true, counts: NORMAL })).base === 0 && W.premBase(cfg, P({ late: true, counts: NORMAL })).reason === 'отчёт после срока');
ok('нет отчёта → без премии', W.premBase(cfg, P({ report: false })).base === 0);
ok('отчёт отклонён → без премии', W.premBase(cfg, P({ status: 'rejected', counts: NORMAL })).base === 0);
ok('нет должности → без премии', W.premBase(cfg, P({ position: '', counts: NORMAL })).reason === 'должность не указана');

// потолок должности больше не режет базу
const BIG = { ...NORMAL, gmp_org: 4, soch: 3 }; // +200 000 +120 000
r = W.premBase(cfg, P({ position: 'stazh', counts: BIG }));
ok('Стажёр: 140 000 + 608 000 = 748 000 > 350 000 — база не урезается', r.gross === 748000 && r.base === 748000 && r.excess === 0, r);

// --- распределение фонда: весь остаток пропорционально базе ---
const sum = (c) => c.rows.reduce((s, x) => s + x.total_fund, 0);
const team5 = [
  P({ id: 'a', name: 'Стажёр (норм.)', position: 'stazh', counts: NORMAL }),
  P({ id: 'b', name: 'Инспектор (мин.)', position: 'insp', counts: MIN }),
  P({ id: 'c', name: 'Инструктор (без плана)', position: 'instr', counts: { postavka: 4, city: 2 } }),
  P({ id: 'd', name: 'Ком. бат (норм., СС)', position: 'kom_bat', counts: BIG, senior: true, ss: 300000 }),
  P({ id: 'e', name: 'Инсп. комендатуры (норм., наградная)', position: 'insp_kom', counts: NORMAL, award: 200000 }),
];
let c = W.computePremiums(cfg, 8000000, team5);
ok('5 человек, фонд 8 000 000: весь фонд распределён (остаток < 5 ₽)', c.remaining >= 0 && c.remaining < 5 && sum(c) === 8000000 - c.remaining && c.paid_from_fund === sum(c), { rem: c.remaining, paid: c.paid_from_fund });
ok('наградная и премия СС выплачены полностью', c.rows[4].award === 200000 && c.rows[3].ss === 300000);
const left8 = 8000000 - c.base_total - 200000 - 300000;
ok('доля остатка пропорциональна базе (рубли вниз)', c.rows.every(x => x.add === Math.floor(left8 * x.base / c.base_total)), c.rows.map(x => [x.base, x.add]));
ok('без лимитов: Ком. бат получает больше 2 000 000 и доля > 400 000', c.rows[3].total_fund > 2000000 && c.rows[3].add > 400000, c.rows[3]);
console.log('  Пример 4 (5 человек, фонд 8 000 000):');
c.rows.forEach(x => console.log(`    ${x.name}: план ${x.plan.level}, база ${rub(x.base)} + доля остатка ${rub(x.add)}${x.award ? ' + наградная ' + rub(x.award) : ''}${x.ss ? ' + СС ' + rub(x.ss) : ''} = ${rub(x.total_fund)}`));
console.log(`    база всего ${rub(c.base_total)}, доля остатка всего ${rub(c.share_total)}, выплачено ${rub(c.paid_from_fund)}, остаток ${rub(c.remaining)}`);
const ex4 = c;

c = W.computePremiums(cfg, 8000000, [...team5, P({ id: 'f', late: true, counts: NORMAL }), P({ id: 'g', report: false })]);
ok('опоздавшие и без отчёта доли не получают; суммы те же', c.rows[5].total_fund === 0 && c.rows[6].total_fund === 0 && c.rows.slice(0, 5).every((x, i) => x.total_fund === ex4.rows[i].total_fund));

// фонд мал
const baseSum = ex4.base_total;
c = W.computePremiums(cfg, baseSum - 50000, team5);
ok('фонд меньше базы: база всем полностью, надбавок и доли нет, остаток отрицательный', c.fund_short && c.rows.every((x, i) => x.base === ex4.rows[i].base && x.add === 0 && x.award === 0 && x.ss === 0) && c.remaining === -50000);
c = W.computePremiums(cfg, baseSum + 300000, team5);
ok('фонда хватает на базу, но не на все надбавки: наградная по очереди полностью, СС урезана до 100 000, доли остатка нет', !c.award_short && c.ss_short && c.rows[4].award === 200000 && c.rows[3].ss === 100000 && c.rows.every(x => x.add === 0) && c.remaining === 0, c.rows.map(x => [x.award, x.ss, x.add]));
c = W.computePremiums(cfg, 0, team5);
ok('фонд не задан: база считается, доли нет', c.rows.every(x => x.add === 0) && c.base_total === baseSum);
c = W.computePremiums(cfg, 8000000, [P({ id: 's', senior: true, ss: 500000, late: true, counts: NORMAL })]);
ok('премия СС — только при отчёте в срок; если премий нет, весь фонд остаётся', c.rows[0].ss === 0 && c.remaining === 8000000);
c = W.computePremiums(cfg, 8000000, [P({ id: 'x', counts: NORMAL, ss: 200000 })]);
ok('премия СС только старшему составу; один человек забирает весь фонд', c.rows[0].ss === 0 && c.rows[0].total_fund === 8000000 && c.remaining === 0);
c = W.computePremiums(cfg, 8000000, [P({ id: 'a', counts: NORMAL, award_budget: 300000 })]);
ok('наградная из бюджета ГУ ВП — отдельно, в фонд не входит', c.rows[0].award_budget === 300000 && c.award_budget_total === 300000 && c.paid_from_fund === 8000000, c.rows[0]);

// отклонённые пункты, принятое количество
const counts = W.premCounts([{ key: 'postavka', n: 10 }, { key: 'otbitie', n: 3 }, { key: 'pmp', n: 5 }, { key: 'c1', n: 2, custom: true }], { otbitie: { status: 'rejected' }, pmp: { status: 'ok', n_ok: 2 } });
ok('отклонённый пункт не считается, n_ok уменьшает, свои пункты без выплаты', counts.postavka === 10 && !counts.otbitie && counts.pmp === 2 && !counts.c1, counts);

// баллы еженедельного отчёта
ok('баллы: только основная, МП — вручную', W.weeklyPoints(cfg, [{ key: 'postavka', n: 2 }, { key: 'event6', n: 1, vp: 7 }, { key: 'thanks', n: 15 }, { key: 'city', n: 4 }]) === 47);

// благодарности: 750 баллов → 15 штук
const rin = W.reportInput(cfg, { week: '2026-10-19', position: 'Инспектор ВП', header: { rank: 'Лейтенант', name: 'Иван Петров', static_id: '1', from: '2026-10-19', to: '2026-10-25' }, items: [{ key: 'thanks', n: 0, points: 750, links: [] }, { key: 'postavka', n: 1, links: ['https://disk.yandex.ru/x'] }] });
ok('750 баллов благодарностей → 15 благодарностей × 2 500', rin.items.find(i => i.key === 'thanks').n === 15 && rin.position === 'insp');
threw = ''; try { W.reportInput(cfg, { week: '2026-10-19', position: 'Дознаватель', header: { rank: 'x', name: 'y', static_id: '1' }, items: [{ key: 'postavka', n: 1 }] }); } catch (e) { threw = e.message; }
ok('должность не из списка → ошибка', /Выберите должность/.test(threw));
threw = ''; try { W.reportInput(cfg, { week: '2026-10-19', position: 'insp', header: { rank: 'x', name: 'y', static_id: '1' }, items: [{ key: 'postavka', n: 1, links: ['javascript:alert(1)'] }] }); } catch (e) { threw = e.message; }
ok('ссылка не http(s) → ошибка', /http/.test(threw));
ok('синонимы должностей', W.positionKey(cfg, 'Ком. Бат ВП') === 'kom_bat' && W.positionKey(cfg, 'Инспектор военной комендатуры') === 'insp_kom' && W.positionKey(cfg, 'Дознаватель ВП') === '');

// сроки: воскресенье 19:00 МСК = 16:00 UTC
ok('срок недели 19.10.2026 — 25.10.2026 19:00 МСК', W.weekDeadline('2026-10-19') === Date.parse('2026-10-25T16:00:00Z'));
ok('неделя по МСК: вс 23:30 МСК ещё та же неделя', W.weekOf(Date.parse('2026-10-25T20:30:00Z')) === '2026-10-19' && W.weekOf(Date.parse('2026-10-25T21:30:00Z')) === '2026-10-26');
ok('нарушения: 1 предупреждение, 2 выговор, 3 увольнение', W.strikeLabel(1) === 'предупреждение' && W.strikeLabel(2) === 'выговор' && W.strikeLabel(3) === 'увольнение');
threw = ''; try { W.premConfigInput('positions', [{ key: 'x', name: 'X', zero: 10, min: 5, avg: 20, max: 30 }]); } catch (e) { threw = e.message; }
ok('настройки: проверка порядка окладов', /нулевой ≤ минимальный/.test(threw));
// сверка с сайтом отчётов: пункты promo-rules.js ↔ таблица выплат (ключи, названия, группы, баллы)
const PR = process.env.PROMO || path.join(__dirname, '../../vp_raport_offline/promo-rules.js');
if (fs.existsSync(PR)) {
  const win = {}; new Function('window', fs.readFileSync(PR, 'utf8'))(win);
  const acts = win.PROMO.acts, pk = new Map(cfg.items.map(i => [i.key, i]));
  ok('сайт отчётов: каждый пункт есть в таблице выплат', acts.every(a => pk.has(a.key)), acts.filter(a => !pk.has(a.key)).map(a => a.key));
  ok('таблица выплат: каждый пункт есть на сайте отчётов', cfg.items.every(i => acts.some(a => a.key === i.key)));
  ok('названия, разделы и баллы совпадают', acts.every(a => pk.get(a.key).name === a.name && pk.get(a.key).group === a.group && (a.group !== 'main' || pk.get(a.key).wk === a.wk)));
  ok('без выплаты только пункты вне приказа (наряд, организация патрулирования, выговор, успешное отбитие КРАЗа)', cfg.items.filter(i => !i.pay).map(i => i.key).join() === 'kraz_otbitie,naryad,patrol,vygovor');
  ok('Успешное отбитие КРАЗа: 35 баллов за раз', acts.find(a => a.key === 'kraz_otbitie') && acts.find(a => a.key === 'kraz_otbitie').pts === 35 && acts.find(a => a.key === 'kraz_otbitie').name === 'Успешное отбитие КРАЗа' && pk.get('kraz_otbitie').name === 'Успешное отбитие КРАЗа');
}
// адресат отчёта: дефолт по должности и отметке СС, ручной выбор, header.to (конец периода) не затирается
{
  const base = (pos, extra) => ({ week: '2026-10-19', position: pos, header: { rank: 'x', name: 'y', static_id: '1', from: '2026-10-19', to: '2026-10-25' }, items: [{ key: 'postavka', n: 1 }], ...extra });
  ok('адресаты: gu, зам. ком. брига по РЛС, ком. бриг', W.REPORT_TO.map(a => a.key).join() === 'gu,zam_kombrig_rls,kombrig');
  ok('обычный сотрудник → gu', W.reportInput(cfg, base('Инспектор ВП'), false).addressee === 'gu');
  ok('СС → zam_kombrig_rls', W.reportInput(cfg, base('Инструктор ВП'), true).addressee === 'zam_kombrig_rls');
  ok('ком. бат (и СС) → kombrig', W.reportInput(cfg, base('Ком. Бат. ВП'), true).addressee === 'kombrig' && W.reportToDefault('kom_gar', false) === 'kombrig');
  const man = W.reportInput(cfg, base('Инспектор ВП', { addressee: 'kombrig' }), false);
  ok('ручной выбор, в header.addressee, период цел', man.addressee === 'kombrig' && man.header.addressee === 'kombrig' && man.header.to === '2026-10-25');
  ok('по названию тоже', W.reportInput(cfg, base('Стажёр ВП', { addressee: 'Командир бригады' }), false).addressee === 'kombrig');
  let t = ''; try { W.reportInput(cfg, base('Стажёр ВП', { addressee: 'министр' }), false); } catch (e) { t = e.message; } ok('неизвестный адресат → ошибка', /Адресат/.test(t));
}
console.log(fail ? `FAILED ${fail}` : `ALL OK ${pass}`);
process.exit(fail ? 1 : 0);
