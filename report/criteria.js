// Панель критериев для еженедельного отчёта и рапорта на повышение. Три группы (официальная градация):
// «Основная отчётность», «Дополнительная отчётность», «Работа ГУ ВП» — window.PROMO.groups.
// Список берётся из window.PROMO.acts (promo-rules.js); группа — поле group. Можно добавлять свои пункты.
(() => {
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const GLIST = (window.PROMO && window.PROMO.groups) || [{ key: "main", name: "Основная отчётность" }, { key: "extra", name: "Дополнительная отчётность" }, { key: "gu", name: "Работа ГУ ВП" }];
  const GROUPS = {}; GLIST.forEach(g => { GROUPS[g.key] = g.name; });
  const GKEYS = GLIST.map(g => g.key);
  const grpOf = g => GROUPS[g] ? g : "extra"; // неизвестная/старая группа → дополнительная
  const SHORT = { main: "основная", extra: "дополнительная", gu: "ГУ ВП" };
  // 1 балл, 3 балла, 5 баллов
  const ballov = k => { const m = Math.abs(k) % 100, d = m % 10; return m > 10 && m < 20 ? "баллов" : d === 1 ? "балл" : d >= 2 && d <= 4 ? "балла" : "баллов"; };
  window.VP_BALLOV = ballov;
  const linksOf = s => String(s || "").split(/\s+/).map(x => x.trim()).filter(x => window.VPDOC.isLink(x));

  window.VP_CRIT = function (opt) {
    const acts = opt.acts;
    let state = {};
    try { state = JSON.parse(localStorage.getItem(opt.storeKey) || "{}"); } catch (e) {}
    state.n = state.n || {}; state.links = state.links || {}; state.custom = state.custom || []; state.vp = state.vp || {}; state.tp = state.tp || {};
    // перенос отметок убранных пунктов (PROMO.merged: старый → новый): счёт складывается, ссылки дописываются
    const MERGED = (window.PROMO && window.PROMO.merged) || {};
    let migrated = false;
    Object.entries(MERGED).forEach(([from, to]) => {
      const k = state.n[from] || 0, l = String(state.links[from] || "").trim();
      if (k) state.n[to] = (state.n[to] || 0) + k;
      if (l) state.links[to] = [String(state.links[to] || "").trim(), l].filter(Boolean).join("\n");
      if (from in state.n || from in state.links || from in state.vp) { delete state.n[from]; delete state.links[from]; delete state.vp[from]; migrated = true; }
    });
    if (migrated) try { localStorage.setItem(opt.storeKey, JSON.stringify(state)); } catch (e) {}
    // weekly: true — баллы еженедельного отчёта (поле wk, только «Основная отчётность»); иначе — pts (повышение).
    const weekly = !!opt.weekly;
    const isVar = a => weekly && grpOf(a.group) === "main" && a.wk === "n";
    const unit = a => weekly ? (grpOf(a.group) === "main" && typeof a.wk === "number" ? a.wk : 0) : (a.pts || 0);
    const sumOf = a => isVar(a) ? (n(a.key) > 0 ? Math.max(0, parseInt(state.vp[a.key]) || 0) : 0) : n(a.key) * unit(a);
    const save = () => localStorage.setItem(opt.storeKey, JSON.stringify(state));
    const box = opt.box;
    const changed = () => { save(); paintCounts(); opt.onChange && opt.onChange(); };

    function card(key, name, pts, custom, hint, a) {
      const n = custom ? custom.n : (state.n[key] || 0), links = custom ? custom.links : (state.links[key] || "");
      return `<div class="act${n > 0 ? " done" : ""}" data-key="${esc(key)}"${custom ? ' data-custom="1"' : ""}>
        <div class="act-top">
          ${custom ? `<input class="cust-name" data-cname placeholder="свой пункт: что сделано" value="${esc(custom.name)}">` : `<div class="act-name"${hint ? ` title="${esc(hint)}"` : ""}>${esc(name)}${pts ? `<span class="pts">+${pts}</span>` : ""}</div>`}
          <div class="ctr"><button type="button" data-d="-1">−</button><input type="number" min="0" value="${n}" data-n><button type="button" data-d="1">+</button></div>
          ${custom ? `<button type="button" class="ev-x" data-cdel title="Убрать">×</button>` : ""}
        </div>
        ${a && isVar(a) ? `<div class="act-vp"><label>баллы (сумма за все) <input type="number" min="0" data-vp value="${esc(state.vp[key] || "")}" placeholder="0"></label><span class="act-note">баллы зависят от мероприятия</span></div>` : ""}
        ${a && a.perPoints ? `<div class="act-vp"><label>баллы от руководства <input type="number" min="0" data-tp value="${esc(state.tp[key] || "")}" placeholder="0"></label><span class="act-note">каждые ${a.perPoints} баллов = 1 благодарность</span></div>` : ""}
        ${a && weekly && a.wkNote ? `<div class="act-note">${esc(a.wkNote)}</div>` : ""}
        ${custom ? `<div class="cust-grp">${GKEYS.map(g => `<label><input type="radio" name="g_${esc(key)}" value="${g}"${grpOf(custom.group) === g ? " checked" : ""} data-cgrp> ${esc(SHORT[g] || GROUPS[g])}</label>`).join("")}</div>` : ""}
        <details${links ? " open" : ""}><summary>ссылки (<span data-lc>${linksOf(links).length}</span>)</summary><textarea data-links rows="2" placeholder="по одной ссылке на строку">${esc(links)}</textarea></details>
      </div>`;
    }
    function draw() {
      let html = "";
      GKEYS.forEach(g => {
        html += `<h3>${GROUPS[g]}</h3>`;
        acts.filter(a => grpOf(a.group) === g).forEach(a => { html += card(a.key, a.name, isVar(a) ? 0 : unit(a), null, a.hint, a); });
        state.custom.filter(c => grpOf(c.group) === g).forEach(c => { html += card(c.id, "", 0, c); });
      });
      html += `<button type="button" class="btn ghost" data-cadd>+ свой пункт</button>`;
      box.innerHTML = html;
    }
    // количество благодарностей поменяли вручную — баллы больше не источник счёта
    function dropTp(row) { if (state.tp[row.dataset.key] != null) { delete state.tp[row.dataset.key]; const i = row.querySelector("[data-tp]"); if (i) i.value = ""; } }
    function find(row) { return row.dataset.custom ? state.custom.find(c => c.id === row.dataset.key) : null; }
    function setN(row, n) {
      n = Math.max(0, n | 0); const c = find(row);
      if (c) c.n = n; else state.n[row.dataset.key] = n;
      row.querySelector("[data-n]").value = n;
    }
    function getN(row) { const c = find(row); return c ? c.n : (state.n[row.dataset.key] || 0); }
    box.addEventListener("click", e => {
      const row = e.target.closest(".act");
      if (e.target.matches("[data-cadd]")) { state.custom.push({ id: "c" + Date.now().toString(36), name: "", group: "extra", n: 1, links: "" }); draw(); changed(); const ins = box.querySelectorAll("[data-cname]"); ins[ins.length - 1] && ins[ins.length - 1].focus(); return; }
      if (!row) return;
      if (e.target.matches("[data-d]")) { setN(row, getN(row) + Number(e.target.dataset.d)); dropTp(row); changed(); }
      if (e.target.matches("[data-cdel]")) { state.custom = state.custom.filter(c => c.id !== row.dataset.key); draw(); changed(); }
    });
    box.addEventListener("change", e => {
      const row = e.target.closest(".act"); if (!row) return;
      if (e.target.matches("[data-cgrp]")) { const c = find(row); c.group = e.target.value; draw(); changed(); }
    });
    box.addEventListener("input", e => {
      const row = e.target.closest(".act"); if (!row) return;
      const c = find(row);
      if (e.target.matches("[data-n]")) { const n = Math.max(0, parseInt(e.target.value) || 0); if (c) c.n = n; else state.n[row.dataset.key] = n; dropTp(row); }
      if (e.target.matches("[data-cname]")) c.name = e.target.value;
      if (e.target.matches("[data-vp]")) state.vp[row.dataset.key] = Math.max(0, parseInt(e.target.value) || 0);
      if (e.target.matches("[data-tp]")) { const a = acts.find(x => x.key === row.dataset.key), p = Math.max(0, parseInt(e.target.value) || 0); state.tp[row.dataset.key] = p; if (a && a.perPoints) setN(row, Math.floor(p / a.perPoints)); }
      if (e.target.matches("[data-links]")) {
        if (c) c.links = e.target.value; else state.links[row.dataset.key] = e.target.value;
        const got = linksOf(e.target.value).length;
        if (got > getN(row)) setN(row, got);
      }
      changed();
    });
    function paintCounts() {
      box.querySelectorAll(".act").forEach(row => {
        const c = find(row), links = c ? c.links : state.links[row.dataset.key];
        row.querySelector("[data-lc]").textContent = linksOf(links).length;
        row.classList.toggle("done", getN(row) > 0);
      });
    }
    function n(key) { return state.n[key] || 0; }
    // Пункты для документа: {group, text, n, pts, sum, links}; sum — баллы за пункт в текущем режиме
    function items() {
      const out = [];
      acts.forEach(a => { const k = n(a.key); if (k > 0) out.push({ key: a.key, group: grpOf(a.group), text: a.doc || a.name, n: k, pts: unit(a), sum: sumOf(a), links: linksOf(state.links[a.key]), vp: isVar(a) ? Math.max(0, parseInt(state.vp[a.key]) || 0) : undefined, points: a.perPoints && state.tp[a.key] ? state.tp[a.key] : undefined }); });
      state.custom.forEach(c => { if (c.n > 0 && String(c.name || "").trim()) out.push({ key: c.id, group: grpOf(c.group), text: c.name.trim(), n: c.n, pts: 0, sum: 0, links: linksOf(c.links), custom: true }); });
      return out;
    }
    function total() { return acts.reduce((s, a) => s + sumOf(a), 0); }
    function reset() { state = { n: {}, links: {}, custom: [], vp: {}, tp: {} }; save(); draw(); opt.onChange && opt.onChange(); }
    // Строки пункта документа. att — общий счётчик приложений {n}.
    // «Вид работы — штук: N (… баллов);», под ним каждая ссылка с новой строки: «а) адрес» (в PNG — «а) Приложение №N»).
    // Каждое действие заканчивается «;», последнее в разделе — «.»; свой «.», «,» или «;» в конце названия убирается.
    function docList(group, att, showPts) {
      const list = items().filter(i => i.group === group);
      return list.map((i, idx) => {
        const r = [`${String(i.text).replace(/[\s.,;]+$/, "")} — штук: `, { t: String(i.n), b: true }];
        if (showPts && i.sum) r.push(` (${i.sum} ${ballov(i.sum)})`);
        r.push(idx === list.length - 1 ? "." : ";");
        const links = i.links.map(u => ({ url: u, alt: `Приложение №${++att.n}` }));
        return links.length ? { r, links } : r;
      });
    }
    // всего выполнено мероприятий и служебных действий (сумма «штук» по всем отмеченным пунктам)
    function count() { return items().reduce((s, i) => s + i.n, 0); }
    draw();
    return { items, total, count, n, reset, docList, groups: GLIST, redraw: draw, state: () => state };
  };
})();
