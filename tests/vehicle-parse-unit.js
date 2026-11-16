// Юнит-тест разбора списка транспорта (vehicle-parse.js): node tests/vehicle-parse-unit.js
const { parseVehicles, normPlate } = require('../vehicle-parse.js');
let pass = 0, fail = 0; const ok = (n, c, x) => { if (c) { pass++; console.log('PASS', n); } else { fail++; console.log('FAIL', n, x !== undefined ? JSON.stringify(x).slice(0, 500) : ''); } };
const USER = 'Устаревший Тигр - 0372ОХ | 73 Служебный Патриот - 5647МТ| 08 Патриот Минобороны - 7085РН | 75 Служебная Веста - 7407ОВ | 84 Бобик Служебный - 2606НС | 80 Генезис - | ОСНОВНОЙ Бизнес-Вэн-Служебный -8155ВТ | 35 Хавал Ф7 - 4575МР | 38 Тигр - 7596СН | 26 ПавАЗ Некст - 0276ХР | 75 ПавАЗ 3205 - 7046ОС | 57 Военный Грузовик - 8776НО | 87 Тигр - 7596CН / 26';
const r = parseVehicles(USER);
const s = (v) => `${v.model}|${v.plate}|${v.region}|${v.note}`;
ok('пример пользователя: 13 записей до склейки, 12 после, ничего не потеряно', r.all.length === 13 && r.items.length === 12 && r.unparsed.length === 0, { all: r.all.length, items: r.items.length, un: r.unparsed });
ok('названия, номера, регионы', JSON.stringify(r.items.map(s)) === JSON.stringify(['Устаревший Тигр|0372ОХ|73|', 'Служебный Патриот|5647МТ|08|', 'Патриот Минобороны|7085РН|75|', 'Служебная Веста|7407ОВ|84|', 'Бобик Служебный|2606НС|80|',
  'Генезис|||ОСНОВНОЙ', 'Бизнес-Вэн-Служебный|8155ВТ|35|', 'Хавал Ф7|4575МР|38|', 'Тигр|7596СН|26|', 'ПавАЗ Некст|0276ХР|75|', 'ПавАЗ 3205|7046ОС|57|', 'Военный Грузовик|8776НО|87|']), r.items.map(s));
ok('«Генезис - | ОСНОВНОЙ»: номер пуст, пометка, основной', r.items[5].plate === '' && r.items[5].note === 'ОСНОВНОЙ' && r.items[5].main === true);
ok('латинская C в «7596CН» → кириллица, дубль Тигра склеен (×2)', r.all[12].plate === '7596СН' && r.items[8].count === 2 && r.dups.length === 1);
ok('нормализация номера: латиница, пробелы, строчные', normPlate('a 123 bc') === 'А123ВС' && normPlate('7596cн') === '7596СН');
const nl = parseVehicles('Тигр - 0372ОХ | 73\nВеста — 7407ОВ / 84\r\nУАЗ Патриот - 1234АВ\n');
ok('переносы строк, длинное тире, запись без региона в конце строки', nl.items.length === 3 && nl.items[1].model === 'Веста' && nl.items[1].region === '84' && nl.items[2].plate === '1234АВ' && nl.items[2].region === '' && !nl.unparsed.length, nl);
const cm = parseVehicles('Тигр-0372ОХ|73, Веста -7407ОВ/ 84; Хавал Ф7 4575МР | 38;Камаз 6520 - 5555ТТ |177');
ok('запятые, «;», без пробелов, без тире перед номером, регион из 3 цифр', cm.items.length === 4 && s(cm.items[0]) === 'Тигр|0372ОХ|73|' && s(cm.items[2]) === 'Хавал Ф7|4575МР|38|' && s(cm.items[3]) === 'Камаз 6520|5555ТТ|177|' && !cm.unparsed.length, cm);
const bad = parseVehicles('Тигр - 0372ОХ | 73; какая-то ерунда; Веста - 7407ОВ | 84; Генезис -');
ok('неразобранное показывается отдельно, а не теряется', bad.items.length === 2 && bad.unparsed.includes('какая-то ерунда') && bad.unparsed.some(x => /Генезис/.test(x)), bad);
const lat = parseVehicles('Patriot - 1111AA | 50 Тигр - 2222ВВ | 50 Тигр - 2222BB | 50 Тигр - 2222ВВ | 51');
ok('дубли — только при совпадении номера и региона; латиница в номере', lat.items.length === 3 && lat.items[0].plate === '1111АА' && lat.items[1].count === 2, lat.items);
ok('пустой текст', parseVehicles('').items.length === 0 && parseVehicles('   ').unparsed.length === 0);
const mk = parseVehicles('Генезис - | основной, Тигр - 0372ОХ | ДОП.');
ok('пометка строчными и с точкой', mk.items[0].main && mk.items[1].note === 'ДОП' && !mk.items[1].main, mk.items);
console.log(`\n${pass} PASS, ${fail} FAIL`); process.exit(fail ? 1 : 0);
