// Общий расчёт рапорта на повышение. Один и тот же файл на сайте бланков (vp-raport-offline/promo-calc.js)
// и на сайте ГУ ВП (vp-exam/report/promo-calc.js); сервер (worker.js, promoSummary) считает так же —
// совпадение проверяет vp-exam/tests/promo-calc-unit.js. Меняешь здесь — скопируй в оба репозитория.
(function (root) {
  "use strict";
  var has = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };
  // Правила с сервера (GET /api/promo-config) → window.PROMO: баллы за пункты, ступени, пункты (названия и группы),
  // «баллы за недостающий пункт». Пункты, которых нет в promo-rules.js, добавляются. Возвращает true, если применено.
  function applyConfig(P, r) {
    if (!P || !r || !r.config) return false;
    var c = r.config;
    if (Array.isArray(r.items)) r.items.forEach(function (i) {
      if (!i || !i.key) return;
      var a = P.acts.find(function (x) { return x.key === i.key; });
      if (!a) P.acts.push({ key: i.key, name: i.name || i.key, group: i.group || "extra", pts: 0 });
      else { if (i.name) a.name = i.name; if (i.group) a.group = i.group; }
    });
    if (c.pts) P.acts.forEach(function (a) { a.pts = has(c.pts, a.key) ? Number(c.pts[a.key]) || 0 : 0; });
    if (c.points_per_item) P.pointsPerItem = c.points_per_item;
    if (Array.isArray(c.ladder)) {
      Object.keys(P.ladder).forEach(function (k) { delete P.ladder[k]; });
      c.ladder.forEach(function (s) { P.ladder[s.rank] = { to: s.to, points: s.points, need: s.need || {} }; });
    }
    if (has(r, "missing_points")) P.missingPoints = r.missing_points !== false;
    return true;
  }
  function findRank(P, rank) {
    var r = String(rank || "").trim().toLowerCase();
    return Object.keys(P.ladder || {}).find(function (k) { return k.toLowerCase() === r; }) || null;
  }
  // counts — {ключ пункта: штук}; opt.missingPoints — закрывать ли недостающий пункт баллами сверх нормы
  // (по умолчанию P.missingPoints); opt.courses — обязательные курсы [{id, title, done}].
  function calc(P, rank, counts, opt) {
    opt = opt || {};
    counts = counts || {};
    var pts = {}; (P.acts || []).forEach(function (a) { pts[a.key] = a.pts || 0; });
    var total = 0; Object.keys(counts).forEach(function (k) { total += (pts[k] || 0) * (counts[k] || 0); });
    var swap = has(opt, "missingPoints") ? opt.missingPoints !== false : P.missingPoints !== false;
    var ppi = P.pointsPerItem || 100;
    var courses = (opt.courses || []).map(function (c) { return { id: c.id, title: c.title, done: !!c.done }; });
    var name = findRank(P, rank), step = name ? P.ladder[name] : null;
    var res = { rank: name, step: step, total: total, items: [], lack: 0, canCover: 0, covered: 0, met: false, swap: swap, pointsPerItem: ppi, courses: courses, coursesLeft: [], left: null };
    if (!step) return res;
    Object.keys(step.need || {}).forEach(function (k) {
      var need = step.need[k], have = counts[k] || 0;
      var a = (P.acts || []).find(function (x) { return x.key === k; }) || { key: k, name: k, pts: 0 };
      res.items.push({ key: k, a: a, need: need, have: have, lack: Math.max(0, need - have) });
    });
    res.lack = res.items.reduce(function (s, i) { return s + i.lack; }, 0);
    res.canCover = swap ? Math.floor(Math.max(0, total - step.points) / ppi) : 0;
    res.covered = Math.min(res.lack, res.canCover);
    res.coursesLeft = courses.filter(function (c) { return !c.done; });
    res.met = total >= step.points && res.lack <= res.canCover && !res.coursesLeft.length;
    res.left = { pts: Math.max(0, step.points - total), swap: Math.max(0, res.lack - res.canCover), courses: res.coursesLeft };
    return res;
  }
  var api = { applyConfig: applyConfig, calc: calc, findRank: findRank };
  root.VP_PROMO_CALC = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
