// Юнит-тест движка премий (приказ № 01_10 + уточнения руководства): node tests/prem-unit.js
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../worker/worker.js'), 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '');
const W = new Function(src + '\nreturn { PREM_DEFAULT, computePremiums, premBase, premPlan, premCounts, premShare, weeklyPoints, reportInput, weekOf, weekDeadline, positionKey, strikeLabel, premConfigInput };')();
let fail = 0, pass = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } };
const cfg = JSON.parse(JSON.stringify(W.PREM_DEFAULT));
const rub = n => n.toLocaleString('ru-RU') + ' ₽';

// --- таблицы как в приказе ---
ok('39 оплачиваемых пунктов (Таблицы 1–2)', cfg.items.filter(i => i.pay > 0).length === 39);
ok('7 должностей, максимальная выплата = 2,5 × средний оклад', cfg.positions.length === 7 && cfg.positions.every(p => p.max === p.avg * 2.5 && p.avg === p.min * 2 && p.min === p.zero * 2));
ok('Инспектор ВП: 55 000 / 110 000 / 220 000 / 550 000', JSON.stringify(cfg.positions.find(p => p.key === 'insp')) === JSON.stringify({ key: 'insp', name: 'Инспектор ВП', zero: 55000, min: 110000, avg: 220000, max: 550000 }));
ok('ГМП не засчитывается в «мероприятия внутри ВС РФ»', !cfg.plan.find(l => l.key === 'event').items.includes('gmp_org'));
ok('действия ГУ ВП включают проц. действия и тренировки', ['proc', 'training', 'soch', 'prof'].every(k => cfg.plan.find(l => l.key === 'gu').items.includes(k)));

// --- примеры ---
const NORMAL = { postavka: 10, otbitie: 3, proc: 2, training: 1, event6: 1, pmp: 5, city: 5 };
const MIN = { postavka: 6, otbitie: 2, proc: 1, training: 1, pmp: 3, city: 3 };
const P = (o) => ({ user_id: o.id || 'u', name: o.name || o.id, report: true, late: false, status: 'submitted', position: 'insp', counts: {}, award: 0, ss: 0, award_budget: 0, senior: false, ...o });

let r = W.premBase(cfg, P({ counts: NORMAL }));
ok('нормальный план → уровень normal', r.plan.level === 'normal', r.plan);
ok('нормальный план: действия 232 500, оклад средний 220 000, без вычета → 452 500', r.actions === 232500 && r.oklad === 220000 && r.deduction === 0 && r.base === 452500, r);
console.log(`  Пример 1 (Инспектор ВП, нормальный план): оклад ${rub(r.oklad)} + действия ${rub(r.actions)} = ${rub(r.base)}`);

r = W.premBase(cfg, P({ counts: MIN }));
ok('минимальный план → min', r.plan.level === 'min' && r.plan.missing_normal.length > 0, r.plan);
ok('минимальный план: 110 000 + 136 500 − 20% (27 300) = 219 200', r.oklad === 110000 && r.actions === 136500 && r.deduction === 27300 && r.base === 219200, r);
console.log(`  Пример 2 (Инспектор ВП, минимальный план): ${rub(r.oklad)} + ${rub(r.actions)} − 20% ${rub(r.deduction)} = ${rub(r.base)}`);

r = W.premBase(cfg, P({ counts: { postavka: 2, thanks: 15 } }));
ok('без минимального плана: нулевой оклад 55 000 + (25 000 + 15×2 500) − 50% = 86 250', r.plan.level === 'none' && r.oklad === 55000 && r.actions === 62500 && r.deduction === 31250 && r.base === 86250, r);
console.log(`  Пример 3 (без плана, 15 благодарностей): ${rub(r.oklad)} + ${rub(r.actions)} − 50% ${rub(r.deduction)} = ${rub(r.base)}`);
ok('без минимального плана: видно, каких строк не хватает', r.plan.missing_min.map(x => x.key).join() === 'postavka,otbitie,proc,event,pmp,gu', r.plan.missing_min);

ok('опоздание → без премии', W.premBase(cfg, P({ late: true, counts: NORMAL })).base === 0 && W.premBase(cfg, P({ late: true, counts: NORMAL })).reason === 'отчёт после срока');
ok('нет отчёта → без премии', W.premBase(cfg, P({ report: false })).base === 0);
ok('отчёт отклонён → без премии', W.premBase(cfg, P({ status: 'rejected', counts: NORMAL })).base === 0);
ok('нет должности → без премии', W.premBase(cfg, P({ position: '', counts: NORMAL })).reason === 'должность не указана');

// лимит должности и дополнительная премия
const BIG = { ...NORMAL, gmp_org: 4, soch: 3 }; // +200 000 +120 000
r = W.premBase(cfg, P({ position: 'stazh', counts: BIG }));
ok('Стажёр: 140 000 + 552 500 = 692 500 > 350 000 → база 350 000, превышение 342 500', r.gross === 692500 && r.base === 350000 && r.excess === 342500, r);

let c = W.computePremiums(cfg, 10000000, [P({ id: 'a', position: 'stazh', counts: BIG })]);
ok('фонд хватает: доп. премия = превышению (342 500 ≤ 400 000)', c.rows[0].add === 342500 && c.rows[0].total_fund === 692500 && c.remaining === 10000000 - 692500, c.rows[0]);
c = W.computePremiums(cfg, 10000000, [P({ id: 'a', position: 'stazh', counts: { ...BIG, patrol_city: 10 } })]);
ok('доп. премия не больше 400 000', c.rows[0].add === 400000, c.rows[0]);

// фонд мал: база платится всегда, надбавки — пропорционально остатку
const team = [P({ id: 'a', position: 'stazh', counts: BIG }), P({ id: 'b', position: 'insp', counts: { ...BIG, patrol_city: 4 } }), P({ id: 'c', counts: MIN })];
const full = W.computePremiums(cfg, 20000000, team);
const baseSum = full.base_total;
c = W.computePremiums(cfg, baseSum + 100000, team);
ok('фонд мал: базовая премия всем полностью', c.rows.every((x, i) => x.base === full.rows[i].base));
ok('фонд мал: 100 000 остатка поделены на доп. премии пропорционально', c.add_short && c.rows[0].add + c.rows[1].add <= 100000 && c.rows[0].add > 0 && Math.abs(c.rows[0].add / c.rows[1].add - c.rows[0].add_want / c.rows[1].add_want) < 0.01, c.rows.map(x => [x.add_want, x.add]));
c = W.computePremiums(cfg, baseSum - 50000, team);
ok('фонд меньше базы: база платится, надбавки 0, остаток отрицательный', c.fund_short && c.rows.every(x => x.add === 0) && c.remaining === -50000);

// наградная и СС
c = W.computePremiums(cfg, 20000000, [P({ id: 'a', counts: NORMAL, award: 300000 }), P({ id: 's', counts: NORMAL, senior: true, ss: 500000 }), P({ id: 'x', counts: NORMAL, ss: 200000 })]);
ok('наградная из фонда выплачена', c.rows[0].award === 300000);
ok('премия СС только старшему составу', c.rows[1].ss === 500000 && c.rows[2].ss === 0);
ok('премия СС — тоже только при отчёте в срок', W.computePremiums(cfg, 20000000, [P({ id: 's', senior: true, ss: 500000, late: true, counts: NORMAL })]).rows[0].ss === 0);
c = W.computePremiums(cfg, 20000000, [P({ id: 'a', position: 'kom_gar', counts: { ...BIG, patrol_city: 30 }, award: 700000, senior: true, ss: 500000, award_budget: 300000 })]);
ok('лимит 2 000 000 на оклад+премию+доп.+наградную', c.rows[0].base + c.rows[0].add + c.rows[0].award <= 2000000 && c.rows[0].base === 850000 && c.rows[0].add === 400000 && c.rows[0].award === 700000, c.rows[0]);
ok('премия СС и наградная из бюджета ГУ ВП — сверх лимита', c.rows[0].ss === 500000 && c.rows[0].award_budget === 300000, c.rows[0]);
ok('итог из фонда отдельно от наградной из бюджета ГУ ВП: 2 450 000 + 300 000 (бюджет)', c.rows[0].total === 2450000 && c.rows[0].total_fund === 2450000 && c.award_budget_total === 300000 && c.paid_from_fund === 2450000, c.rows[0]);
c = W.computePremiums(cfg, 20000000, [P({ id: 'a', position: 'kom_gar', counts: { ...BIG, patrol_city: 30 }, award: 700000 }), P({ id: 'b', position: 'kom_gar', counts: { ...BIG, patrol_city: 30, soch: 40 }, award: 700000 })]);
ok('лимит: наградная урезается до 2 000 000 при большой базе', c.rows.every(x => x.base + x.add + x.award <= 2000000));
const t3 = [P({ id: 'a', counts: NORMAL, award: 400000 }), P({ id: 'b', counts: NORMAL, award: 200000 }), P({ id: 's', counts: NORMAL, senior: true, ss: 300000 })];
const b3 = W.computePremiums(cfg, 0, t3).base_total;
c = W.computePremiums(cfg, b3 + 300000, t3);
ok('надбавки по очереди: наградная (2:1 из 300 000), на СС не хватило', c.rows[0].award === 200000 && c.rows[1].award === 100000 && c.rows[2].ss === 0 && c.award_short && c.ss_short, c.rows.map(x => [x.award, x.ss]));

// отклонённые пункты, принятое количество
const counts = W.premCounts([{ key: 'postavka', n: 10 }, { key: 'otbitie', n: 3 }, { key: 'pmp', n: 5 }, { key: 'c1', n: 2, custom: true }], { otbitie: { status: 'rejected' }, pmp: { status: 'ok', n_ok: 2 } });
ok('отклонённый пункт не считается, n_ok уменьшает, свои пункты без выплаты', counts.postavka === 10 && !counts.otbitie && counts.pmp === 2 && !counts.c1, counts);

// баллы еженедельного отчёта
ok('баллы: только основная, МП — вручную', W.weeklyPoints(cfg, [{ key: 'postavka', n: 2 }, { key: 'event6', n: 1, vp: 7 }, { key: 'thanks', n: 15 }, { key: 'city', n: 4 }]) === 47);

// благодарности: 750 баллов → 15 штук
const rin = W.reportInput(cfg, { week: '2026-10-19', position: 'Инспектор ВП', header: { rank: 'Лейтенант', name: 'Иван Петров', static_id: '1', from: '2026-10-19', to: '2026-10-25' }, items: [{ key: 'thanks', n: 0, points: 750, links: [] }, { key: 'postavka', n: 1, links: ['https://disk.yandex.ru/x'] }] });
ok('750 баллов благодарностей → 15 благодарностей × 2 500', rin.items.find(i => i.key === 'thanks').n === 15 && rin.position === 'insp');
let threw = ''; try { W.reportInput(cfg, { week: '2026-10-19', position: 'Дознаватель', header: { rank: 'x', name: 'y', static_id: '1' }, items: [{ key: 'postavka', n: 1 }] }); } catch (e) { threw = e.message; }
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
  ok('без выплаты только пункты вне приказа (наряд, организация патрулирования, выговор)', cfg.items.filter(i => !i.pay).map(i => i.key).join() === 'naryad,patrol,vygovor');
}
console.log(fail ? `FAILED ${fail}` : `ALL OK ${pass}`);
process.exit(fail ? 1 : 0);
