// Еженедельный отчёт внутри сайта ГУ ВП — копия бланка otchet.js с сайта бланков (vp-raport-offline, 18e2fad).
// Те же поля, проверки, черновики (localStorage, общие с сайтом бланков) и отправка POST /api/reports.
// Отличия: монтируется функцией в уже открытую страницу, вход и запросы — через портал (ECO передаётся снаружи).
window.VPReportMount = function (ECO) {
  const D = window.VPDOC, C = window.VP_DOC_CONFIG || {}, P = window.PROMO;
  const $ = id => document.getElementById(id);
  const v = id => $(id).value.trim();
  const ph = (x, p) => x ? x : { ph: p };
  D.persist("vp_me", ["fromRank", "fromStatic", "fromName", "fromUnit"]);
  // Должность — список из 7 должностей таблицы окладов (по ней считается премия). Хранится отдельно от общих данных бланков,
  // чтобы не затирать свободный текст должности на других страницах; при первом открытии подставляется из него.
  const POS_ALIAS = { "комендант гарнизона": "Комендант Гарнизона", "ком. бат вп": "Ком. Бат. ВП", "ком. бат. вп": "Ком. Бат. ВП", "командир батальона вп": "Ком. Бат. ВП",
    "зам. ком. бат вп": "Зам. Ком. Бат. ВП", "зам. ком. бат. вп": "Зам. Ком. Бат. ВП", "инспектор военной комендатуры": "Инспектор Комендатуры", "инспектор комендатуры": "Инспектор Комендатуры",
    "инструктор вп": "Инструктор ВП", "инспектор вп": "Инспектор ВП", "стажёр вп": "Стажёр ВП", "стажер вп": "Стажёр ВП" };
  try { if (!JSON.parse(localStorage.getItem("vp_week_pos") || "{}").fromPos) { const old = String(JSON.parse(localStorage.getItem("vp_me") || "{}").fromPos || "").trim().toLowerCase().replace(/\s+/g, " ");
    if (POS_ALIAS[old]) localStorage.setItem("vp_week_pos", JSON.stringify({ fromPos: POS_ALIAS[old] })); } } catch (e) {}
  D.persist("vp_week_pos", ["fromPos"]);
  // в тексте документа — обычным регистром («комендант гарнизона», «инспектор комендатуры»)
  const posText = () => v("fromPos").replace(/ Гарнизона$/, " гарнизона").replace(/ Комендатуры$/, " комендатуры");
  // Адресат (блок «Кому»): по умолчанию — по должности и отметке «СС» (с сайта ГУ ВП после входа), можно выбрать вручную.
  // Ключи совпадают с сервером (REPORT_TO в vp-exam worker): gu — прежний адресат, zam_kombrig_rls, kombrig.
  const TO_TEXT = { gu: C.to || "Военному коменданту гарнизона, начальнику ГУ ВП", zam_kombrig_rls: "Заместителю командира бригады по РЛС", kombrig: "Командиру бригады" };
  const TO_KEY = "vp_week_to";
  let toSt = {}; try { toSt = JSON.parse(localStorage.getItem(TO_KEY) || "{}") || {}; } catch (e) {}
  function autoTo() {
    const p = v("fromPos"); if (p === "Ком. Бат. ВП" || p === "Комендант Гарнизона") return "kombrig";
    const me = ECO && ECO.me; if (me && me.senior) return "zam_kombrig_rls";
    return "gu";
  }
  function syncTo() {
    const sel = $("toSel"); if (!sel) return;
    sel.value = toSt.manual && TO_TEXT[toSt.to] ? toSt.to : autoTo();
    const auto = autoTo(), name = k => (sel.querySelector(`option[value="${k}"]`) || {}).textContent || k;
    $("toHint").innerHTML = toSt.manual && sel.value !== auto ? `Выбрано вручную. По должности — «${D.esc(name(auto))}». <button type="button" class="mini" id="toAuto">по должности</button>`
      : "По умолчанию: командир батальона и комендант гарнизона — командиру бригады, старший состав (СС) — заместителю командира бригады по РЛС, остальные — начальнику ГУ ВП. Можно выбрать вручную.";
    const b = $("toAuto"); if (b) b.onclick = () => { toSt = {}; try { localStorage.removeItem(TO_KEY); } catch (e) {} syncTo(); page.refresh(); };
  }
  const toText = () => TO_TEXT[$("toSel").value] || TO_TEXT.gu;
  $("toSel").addEventListener("change", () => { toSt = { to: $("toSel").value, manual: true }; try { localStorage.setItem(TO_KEY, JSON.stringify(toSt)); } catch (e) {} syncTo(); });
  $("fromPos").addEventListener("change", () => syncTo());
  syncTo();
  const DRAFT = ["date", "fromDate", "toDate", "result", "extra", "stampOn", "showPts"];
  const draft = D.persist("vp_week_draft", DRAFT);
  const num = D.counter("week", $("num"));
  $("numNext").addEventListener("click", () => { num.next(); page.refresh(); });
  const now = new Date();
  if (!$("date").value) $("date").value = D.iso(now);
  // отчётный период — неделя с понедельника по воскресенье
  const monday = d => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; };
  function setWeek(mon) { const sun = new Date(mon); sun.setDate(mon.getDate() + 6); $("fromDate").value = D.iso(mon); $("toDate").value = D.iso(sun);
    ["fromDate", "toDate"].forEach(id => $(id).dispatchEvent(new Event("input", { bubbles: true }))); }
  if (!$("fromDate").value || !$("toDate").value) setWeek(monday(now));
  $("wkCur").addEventListener("click", () => { setWeek(monday(new Date())); page.refresh(); weekChanged(); });
  $("wkPrev").addEventListener("click", () => { const m = monday(new Date()); m.setDate(m.getDate() - 7); setWeek(m); page.refresh(); weekChanged(); });
  function weekOfForm() { // понедельник 'YYYY-MM-DD', если период — ровно неделя пн–вс, иначе null
    const f = v("fromDate"), t = v("toDate"); if (!f || !t) return null;
    const a = new Date(f + "T12:00:00"), b = new Date(t + "T12:00:00");
    return a.getDay() === 1 && Math.round((b - a) / 86400000) === 6 ? f : null;
  }

  const crit = window.VP_CRIT({ box: $("acts"), acts: P.acts, storeKey: "vp_week_crit", weekly: true, onChange: () => { paint(); page.refresh(); paintPlan(); } });
  function paint() {
    const pts = crit.total();
    $("barText").textContent = pts ? `${pts} ${window.VP_BALLOV(pts)} за неделю (только основная отчётность)` : "0 баллов (считается только основная отчётность)";
    $("barFill").style.width = pts ? "100%" : "0"; $("barFill").classList.toggle("full", pts > 0);
    $("vygNote").classList.toggle("ok", !(crit.n("vzysk") > 0 && crit.n("vygovor") > 0));
    $("result").placeholder = autoResult();
  }
  function autoResult() {
    return `выполнено мероприятий и служебных действий: ${crit.count()}.`;
  }
  // Общий результат по умолчанию — одна строка; баллы — отдельной строкой перед датой.
  const summaryLine = () => ["выполнено мероприятий и служебных действий: ", { t: String(crit.count()), b: true }, "."];
  const pointsLine = () => [{ t: "Общее количество баллов: ", b: true }, { t: String(crit.total()), b: true }];

  async function spec() {
    const n = D.parseName(v("fromName"));
    const att = { n: 0 };
    const showPts = $("showPts").checked;
    const main = crit.docList("main", att, showPts), extra = crit.docList("extra", att, showPts), gu = crit.docList("gu", att, showPts);
    const listItem = (no, label, list, none) => list.length ? { item: no, label, list } : { item: no, label, value: none };
    const rank = v("fromRank") ? D.cap(v("fromRank")) : { ph: "звание" };
    return {
      docTitle: `Еженедельный отчёт № ${v("num")}`, author: v("fromName"),
      to: [[{ t: "Кому: ", b: true }, toText()],
           [{ t: "От: ", b: true }, rank, " ", n ? n.short : { ph: "Фамилия И.О." }, ", ", ph(D.lcFirst(posText()), "должность")]],
      title: "РАПОРТ", subtitle: "О результатах служебной деятельности за отчётную неделю",
      metaLine: ["№ ", ph(v("num"), "___")],
      blocks: [
        { p: "Докладываю Вам о результатах выполнения служебных обязанностей и проведённых мероприятиях за установленный отчётный период." },
        { section: "I. ОБЩИЕ СВЕДЕНИЯ" },
        { item: 1, label: "Военнослужащий", value: [rank, " ", n ? n.fi : { ph: "Фамилия Имя" }, ", номер удостоверения ", ph(v("fromStatic"), "____")] },
        { item: 2, label: "Подразделение и должность", value: [ph(v("fromUnit"), "подразделение"), ", ", ph(D.lcFirst(posText()), "должность")] },
        { item: 3, label: "Отчётный период", value: [ph(D.human(v("fromDate")), "ДД.ММ.ГГГГ"), " — ", ph(D.human(v("toDate")), "ДД.ММ.ГГГГ")] },
        { section: "II. РЕЗУЛЬТАТЫ СЛУЖЕБНОЙ ДЕЯТЕЛЬНОСТИ" },
        listItem(4, "Основная отчётность", main, "не выполнялась."),
        listItem(5, "Дополнительная отчётность", extra, "не выполнялась."),
        listItem(6, "Работа ГУ ВП", gu, "не выполнялась."),
        { section: "III. ИТОГОВАЯ ИНФОРМАЦИЯ" },
        v("result") ? { item: 7, label: "Общий результат работы за неделю", value: v("result") } : { item: 7, label: "Общий результат работы за неделю", list: [summaryLine()], bullet: "dash" },
        { item: 8, label: "Дополнительные сведения", value: v("extra") || "отсутствуют." },
        { space: 4 },
        { p: ["На основании изложенного ", { t: "ПРОШУ", b: true }, " принять настоящий еженедельный отчёт, рассмотреть представленные результаты служебной деятельности и учесть их при оценке моей работы, выдать еженедельную премию."] },
        { sign: {
          before: [pointsLine()], date: ph(D.human(v("date")), "ДД.ММ.ГГГГ"), dateLabel: "Дата подачи", label: "Рапорт составил:", pos: posText(),
          rank, name: n ? n.short : { ph: "Фамилия И.О." },
          image: n ? await D.signImage({ name: v("fromName"), stamp: $("stampOn").checked }) : null } }
      ]
    };
  }
  function validate() {
    if (!D.check(["num", "date", "fromRank", "fromStatic", "fromName", "fromUnit", "fromPos", "fromDate", "toDate"])) return false;
    if (!crit.items().length) { page.status("Отметь, что сделано за неделю.", "err"); return false; }
    if (crit.n("vzysk") > 0 && crit.n("vygovor") > 0 && !confirm("И рапорты на взыскание, и выговоры заполнены. Выговор, выданный этим же рапортом, второй раз считать нельзя. Всё равно выгрузить?")) return false;
    return true;
  }
  const page = D.wire({ preview: $("preview"), spec, validate, counter: num, base: () => "otchet_" + (v("num") || "x") });
  $("form").addEventListener("input", () => page.refresh());
  $("form").addEventListener("change", () => page.refresh());
  $("clear").addEventListener("click", () => {
    if (!confirm("Обнулить всё, что отмечено за эту неделю?")) return;
    crit.reset(); draft.clear(["result", "extra"]); $("result").value = ""; $("extra").value = "";
    num.next(); paint(); page.refresh();
  });
  // ---------- план недели и отправка руководству (единая экосистема ГУ ВП) ----------
  const fmt = ms => new Date(ms).toLocaleString("ru-RU", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Moscow" });
  const ST = { submitted: ["отправлен", "info"], review: ["на проверке", "warn"], approved: ["принят", "ok"], rejected: ["отклонён", "err"] };
  const LVL = { normal: ["нормальный план выполнен", "ok"], min: ["минимальный план выполнен", "warn"], none: ["минимальный план не выполнен", "err"] };
  let premCfg = null, mine = null;
  function counts() { const c = {}; crit.items().forEach(i => { if (!i.custom) c[i.key] = (c[i.key] || 0) + i.n; }); return c; }
  function paintPlan() {
    const box = $("planBox"); if (!premCfg || !box) return;
    const c = counts();
    const lines = premCfg.plan.map(l => { const got = l.items.reduce((s, k) => s + (c[k] || 0), 0); return { ...l, got }; });
    const lvl = lines.every(l => l.got >= l.normal) ? "normal" : lines.every(l => l.got >= l.min) ? "min" : "none";
    box.hidden = false;
    box.innerHTML = `<div class="plan-head">План недели: <span class="tag ${LVL[lvl][1]}">${LVL[lvl][0]}</span></div>
      <table>${lines.map(l => `<tr><td>${D.esc(l.name)}</td><td class="n ${l.got >= l.normal ? "ok" : l.got >= l.min ? "warn" : "err"}">${l.got}</td><td class="n">мин ${l.min}</td><td class="n">норм ${l.normal}</td></tr>`).join("")}</table>
      <div class="norm-hint">Один пункт может идти в несколько строк плана. Точный расчёт премии — у руководства после проверки отчёта.</div>`;
  }
  function weekChanged() { const w = weekOfForm(); $("wkHint").textContent = w ? "" : "период для отправки — с понедельника по воскресенье одной недели"; loadMine(); }
  $("fromDate").addEventListener("change", weekChanged); $("toDate").addEventListener("change", weekChanged);
  function sendState(html) { $("sendInfo").innerHTML = html; }
  function sendStatus(t, cls) { const s = $("sendStatus"); s.textContent = t || ""; s.className = "status " + (cls || ""); }
  async function loadMine() {
    if (!ECO || !ECO.online) { sendState("Отправка работает только на сайте ГУ ВП (с интернетом), а не из файла на диске. PDF и PNG — без ограничений."); $("sendBtn").disabled = true; return; }
    if (!ECO.me) {
      sendState(`${ECO.authError ? `<div class="send-err">Вход не выполнен: ${D.esc(ECO.authError)}</div>` : ""}Чтобы отправить отчёт руководству, войдите через Discord — тот же вход, что и на учебном сайте. PDF и PNG работают без входа.`);
      $("sendBtn").textContent = "Войти через Discord"; $("sendBtn").disabled = false; return;
    }
    const w = weekOfForm();
    $("sendBtn").textContent = "Отправить отчёт"; $("sendBtn").disabled = false;
    if (!w) { sendState(`Вы вошли как <b>${D.esc(ECO.me.ic_name || ECO.me.global_name || ECO.me.username)}</b>. Укажите отчётный период — неделю с понедельника по воскресенье.`); mine = null; return; }
    try { mine = await ECO.api("GET", "/api/reports/my?week=" + w); } catch (e) { sendState(`<div class="send-err">${D.esc(e.message)}</div>`); return; }
    const r = mine.report, late = mine.now > mine.deadline;
    const left = mine.deadline - mine.now, dd = Math.floor(left / 86400000), hh = Math.floor(left % 86400000 / 3600000), mm = Math.floor(left % 3600000 / 60000);
    let h = `Вы вошли как <b>${D.esc(ECO.me.ic_name || ECO.me.global_name || ECO.me.username)}</b>.<br>Неделя ${D.human(w)} — ${D.human(D.iso(new Date(new Date(w + "T12:00:00").getTime() + 6 * 86400000)))}, срок: <b>${fmt(mine.deadline)} МСК</b> `;
    h += late ? `<span class="tag err">срок прошёл</span>` : `<span class="tag ok">осталось ${dd ? dd + " д " : ""}${hh} ч ${mm} мин</span>`;
    if (r) {
      h += `<div class="send-cur">Отправленный отчёт: <span class="tag ${ST[r.status][1]}">${ST[r.status][0]}</span>${r.late ? ' <span class="tag err">после срока — без премии</span>' : ""} · версия ${r.version} от ${fmt(r.submitted_at)}
        · ${r.position_name}${r.addressee_name ? ` · кому: ${D.esc(r.addressee_name)}` : ""}${r.plan ? ` · <span class="tag ${LVL[r.plan.level][1]}">${LVL[r.plan.level][0]}</span>` : ""}</div>`;
      if (r.comment) h += `<div class="send-com"><b>Комментарий руководства:</b> ${D.esc(r.comment)}</div>`;
      const rej = r.items.filter(i => i.review && i.review.status === "rejected"), cut = r.items.filter(i => i.review && i.review.status === "ok" && i.review.n_ok != null);
      if (rej.length) h += `<div class="send-com err">Не засчитано: ${rej.map(i => D.esc(i.name) + (i.review.comment ? ` (${D.esc(i.review.comment)})` : "")).join("; ")}</div>`;
      if (cut.length) h += `<div class="send-com">Засчитано частично: ${cut.map(i => `${D.esc(i.name)} — ${i.review.n_ok} из ${i.n}`).join("; ")}</div>`;
      h += `<div class="norm-hint">Повторная отправка обновит этот же отчёт (правки сохраняются в истории).</div>`;
      $("sendBtn").textContent = "Обновить отправленный отчёт";
    } else h += `<div class="send-cur">За эту неделю отчёт ещё не отправлен.</div>`;
    if (late && !r) h += `<div class="send-com err">Срок прошёл: отчёт сохранится с отметкой «после срока», премия за неделю не начисляется.</div>`;
    sendState(h);
  }
  function payload() {
    return { week: weekOfForm(), position: v("fromPos"), addressee: $("toSel").value,
      header: { number: v("num"), date: v("date"), rank: v("fromRank"), name: v("fromName"), static_id: v("fromStatic"), unit: v("fromUnit"), from: v("fromDate"), to: v("toDate"), result: v("result"), extra: v("extra") },
      items: crit.items().map(i => ({ key: i.key, name: i.text, group: i.group, n: i.n, links: i.links, custom: !!i.custom, vp: i.vp, points: i.points })) };
  }
  $("sendBtn").addEventListener("click", async () => {
    if (!ECO || !ECO.online) return;
    if (!ECO.me) { ECO.login(); return; }
    sendStatus("");
    if (!validate()) { sendStatus("Заполни подсвеченные поля и отметь, что сделано.", "err"); return; }
    if (!v("fromPos")) { $("fromPos").classList.add("bad"); sendStatus("Выбери должность из списка.", "err"); return; }
    if (!weekOfForm()) { sendStatus("Отчётный период — с понедельника по воскресенье одной недели (кнопки «текущая неделя» / «прошлая неделя»).", "err"); return; }
    if (mine && mine.now > mine.deadline && !confirm("Срок подачи прошёл. Отчёт сохранится с отметкой «после срока», премия за неделю не начисляется. Отправить?")) return;
    $("sendBtn").disabled = true; sendStatus("Отправляю…");
    try { const r = await ECO.api("POST", "/api/reports", payload()); sendStatus(r.created ? "Отчёт отправлен руководству." : "Отчёт обновлён.", "ok"); await loadMine(); if (ECO.onSent) ECO.onSent(r); }
    catch (e) { sendStatus("Не отправлено: " + e.message, "err"); }
    finally { $("sendBtn").disabled = false; }
  });
  if (ECO && ECO.online) {
    ECO.api("GET", "/api/report-config").then(c => { premCfg = c; paintPlan(); }).catch(() => {});
    ECO.ready.then(() => { syncTo(); page.refresh(); loadMine(); if (ECO.justLoggedIn) sendStatus("Вы вошли через Discord — теперь можно отправить отчёт.", "ok"); });
    ECO.onChange.push(() => { syncTo(); page.refresh(); });
    ECO.onChange.push(loadMine);
  }
  paint();
  window.__vp = { spec, crit, validate, payload, weekOfForm, autoTo, syncTo };
  return { refresh: (now) => page.refresh(now), loadMine };
};
