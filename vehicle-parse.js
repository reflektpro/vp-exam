/* Разбор списка транспорта из текста: «Название - НОМЕР | РЕГИОН Название - НОМЕР / РЕГИОН …» (одной строкой подряд, через переносы,
   запятые или «;»). Номер — буквы/цифры, латиница-двойник приводится к кириллице; вместо региона может быть пометка («| ОСНОВНОЙ»).
   Повторы склеиваются, неразобранные куски возвращаются отдельно. Используется в личном деле (dossier.js) и в тестах. */
(function (root) {
  'use strict';
  const LAT = { A: 'А', B: 'В', E: 'Е', K: 'К', M: 'М', H: 'Н', O: 'О', P: 'Р', C: 'С', T: 'Т', Y: 'У', X: 'Х' };
  const normPlate = (s) => String(s || '').toUpperCase().replace(/Ё/g, 'Е').replace(/[ABEKMHOPCTYX]/g, (c) => LAT[c]).replace(/[\s-]/g, '');
  const L = 'A-Za-zА-Яа-яЁё';
  const PLATE = `(?=[^|/\\s]*\\d)[0-9${L}]{3,10}`;
  // название (без | / ; , и переноса) → «-» (или просто пробел перед номером) → номер? → «|» или «/» → регион (2–3 цифры) или пометка-слово;
  // регион можно опустить, если дальше конец записи (перенос строки, запятая, «;», конец текста)
  const RE = new RegExp(`([^|/;,\\n]+?)(?:\\s*-\\s*(${PLATE})?|\\s+(${PLATE}))\\s*(?:[|/]\\s*(?:(\\d{2,3})(?!\\d)|([${L}][${L}.]*))|(?=\\s*(?:[\\n,;]|$)))`, 'g');
  function parseVehicles(text) {
    const src = String(text || '').replace(/\r/g, '').replace(/[\u00a0\u2009\u202f]/g, ' ').replace(/[\u2010-\u2015\u2212]/g, '-');
    const all = [], unparsed = [];
    let m, last = 0;
    const gap = (a, b) => { const t = src.slice(a, b).replace(/^[\s,;|/]+|[\s,;|/]+$/g, ''); if (t) unparsed.push(t); };
    RE.lastIndex = 0;
    while ((m = RE.exec(src))) {
      if (m[0].length === 0) { RE.lastIndex++; continue; }
      const model = m[1].replace(/^[\s,;|/]+/, '').replace(/\s+/g, ' ').trim();
      if (!model) { gap(last, RE.lastIndex); last = RE.lastIndex; continue; }
      gap(last, m.index + m[0].indexOf(m[1]));
      const plate = normPlate(m[2] || m[3] || ''), region = m[4] || '', note = (m[5] || '').replace(/\.+$/, '');
      if (!plate && !region && !note) { unparsed.push(m[0].trim()); last = RE.lastIndex; continue; } // «Название -» без номера и пометки
      all.push({ model, plate, region, note, main: /^основн/i.test(note) });
      last = RE.lastIndex;
    }
    gap(last, src.length);
    // повторы: одинаковые номер+регион (или название+пометка, если номера нет) — одна запись с пометкой «×N»
    const key = (v) => v.plate ? 'p:' + v.plate + '|' + v.region : 'm:' + v.model.toLowerCase().replace(/ё/g, 'е') + '|' + v.note.toLowerCase();
    const map = new Map(), items = [], dups = [];
    for (const v of all) {
      const k = key(v), e = map.get(k);
      if (e) { e.count++; if (!e.main && v.main) e.main = true; if (!dups.includes(e)) dups.push(e); continue; }
      const o = { ...v, count: 1 }; map.set(k, o); items.push(o);
    }
    return { items, all, dups, unparsed, key };
  }
  const api = { parseVehicles, normPlate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.VPVehicles = api;
})(typeof window !== 'undefined' ? window : globalThis);
