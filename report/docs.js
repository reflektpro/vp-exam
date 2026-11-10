// Ядро автономных бланков ГУ ВП: шрифты, документ → PDF (pdfmake, векторный текст, кликабельные ссылки)
// и PNG (тот же PDF без ссылок, отрисованный pdf.js в картинки A4). Никаких сетевых запросов.
(() => {
  const C = window.VP_DOC_CONFIG || {}; // копия ядра бланков с сайта бланков; настройки документа — VP_DOC_CONFIG
  const FD = window.VP_FONT_DATA || {};
  const A = window.VP_ASSETS || {};
  const MONTHS = ["января","февраля","марта","апреля","мая","июня","июля","августа","сентября","октября","ноября","декабря"];

  // ---------------- шрифты (FontFace из base64: работает и с file://) ----------------
  function b64buf(b) { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; }
  const FACES = [
    ["Tinos", "Tinos-Regular.ttf", {}], ["Tinos", "Tinos-Bold.ttf", { weight: "700" }],
    ["Tinos", "Tinos-Italic.ttf", { style: "italic" }], ["Tinos", "Tinos-BoldItalic.ttf", { weight: "700", style: "italic" }],
    ["Marck Script", "MarckScript-Regular.ttf", {}], ["Oswald", "Oswald.ttf", { weight: "200 700" }]
  ];
  const fontsReady = Promise.all(FACES.map(([fam, file, d]) => {
    if (!FD[file] || !window.FontFace) return null;
    const f = new FontFace(fam, b64buf(FD[file]), d);
    document.fonts.add(f);
    return f.load().catch(() => null);
  }));
  const VFS = {}; Object.keys(FD).forEach(k => { VFS[k] = FD[k]; });
  const FONTS = { Tinos: { normal: "Tinos-Regular.ttf", bold: "Tinos-Bold.ttf", italics: "Tinos-Italic.ttf", bolditalics: "Tinos-BoldItalic.ttf" } };

  function loadImg(src) { return new Promise(r => { if (!src) return r(null); const i = new Image(); i.onload = () => r(i); i.onerror = () => r(null); i.src = src; }); }
  const imgs = { emblem: loadImg(A.emblem), stamp: loadImg(A.stamp) };
  const ready = Promise.all([fontsReady, imgs.emblem, imgs.stamp]);

  // ---------------- утилиты ----------------
  const pad = n => String(n).padStart(2, "0");
  const iso = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const human = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ""); return m ? `${m[3]}.${m[2]}.${m[1]}` : ""; };
  const longDate = v => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v || ""); return m ? `${+m[3]} ${MONTHS[+m[2] - 1]} ${m[1]} г.` : ""; };
  // «Инспектор ВП» → «инспектор ВП» внутри фразы; аббревиатуры («ВП», «ГУ ВП») не трогаем
  const lcFirst = s => { s = String(s || ""); return /^[А-ЯЁA-Z][а-яёa-z]/.test(s) ? s[0].toLowerCase() + s.slice(1) : s; };
  const cap = s => String(s || "").charAt(0).toUpperCase() + String(s || "").slice(1);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const words = s => String(s || "").trim().split(/\s+/).filter(Boolean).map(cap);
  // Ввод «Имя Фамилия» (как в игре) или «Фамилия Имя Отчество».
  function parseName(full) {
    const p = words(full);
    if (p.length >= 3) return { surname: p[0], initial: p[1][0], fi: `${p[0]} ${p[1]}`, short: `${p[0]} ${p[1][0]}.${p[2][0]}.` };
    if (p.length === 2) return { surname: p[1], initial: p[0][0], fi: `${p[1]} ${p[0]}`, short: `${p[1]} ${p[0][0]}.` };
    if (p.length === 1) return { surname: p[0], initial: "", fi: p[0], short: p[0] };
    return null;
  }
  const LINK_RE = /^(https?:\/\/)?[^\s\/.]+(\.[^\s\/.]+)+(\/\S*)?$/i;
  const isLink = s => LINK_RE.test(String(s || "").trim());
  const normUrl = u => { u = String(u || "").trim(); return u && !/^[a-z][a-z0-9+.-]*:/i.test(u) ? "https://" + u : u; };
  // В длинных адресах разрешаем перенос строки (U+200B есть в шрифте), ссылка-аннотация остаётся целой.
  function breakable(u) {
    if (u.length <= 40) return u;
    return u.replace(/([\/?&=#])/g, "$1\u200B").replace(/([^\u200B]{24})(?=[^\u200B])/g, "$1\u200B");
  }
  function rng(seedStr) {
    let h = 2166136261;
    for (const ch of String(seedStr)) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
  }

  // ---------------- подпись + печать одной картинкой ----------------
  // Логический холст 200×200 (2 px на pt → 100×100 pt): печать в центре (100,100), роспись по центру печати.
  // Справа от картинки сразу идёт колонка звания и И.О. Фамилии (см. блок подписи в build).
  async function signImage(opt) {
    await ready;
    const n = parseName(opt.name || "");
    const W = 200, H = 200, K = 2.5;
    const cv = document.createElement("canvas"); cv.width = W * K; cv.height = H * K;
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height); g.scale(K, K);
    const stamp = await imgs.stamp;
    if (opt.stamp !== false && stamp) {
      const r = rng("stamp" + (n ? n.surname : "x")), d = 176;
      g.save(); g.globalAlpha = 0.86; g.translate(100, 100); g.rotate((r() * 40 - 20) * Math.PI / 180);
      g.drawImage(stamp, -d / 2, -d / 2, d, d); g.restore();
    }
    if (n) {
      // Роспись (буквы + росчерк) строится симметрично вокруг центра букв: росчерк уходит влево и вправо
      // от букв на одинаковое расстояние. Рисуется на отдельном прозрачном холсте, затем по фактическим
      // границам нарисованного ставится центром в центр печати (100, 100). Буквы на ~30% крупнее прежних.
      const sc = document.createElement("canvas"); sc.width = W * 2 * K; sc.height = H * K;
      const sg = sc.getContext("2d"); sg.scale(K, K);
      const r = rng(n.surname + n.initial), len = 3 + Math.floor(r() * 3);
      const text = (n.initial || "") + n.surname[0] + n.surname.slice(1, len).toLowerCase();
      let fs = Math.round((34 + Math.round(r() * 8)) * 1.3);
      sg.font = `${fs}px "Marck Script"`;
      const MAXW = 150; // ширина букв: роспись с росчерком остаётся в своей колонке и не задевает текст рядом
      let tw = sg.measureText(text).width;
      if (tw > MAXW) { fs = Math.floor(fs * MAXW / tw); sg.font = `${fs}px "Marck Script"`; tw = sg.measureText(text).width; }
      const X = W, Y = 100, rot = -(4 + r() * 6) * Math.PI / 180, skew = Math.tan(-(6 + r() * 10) * Math.PI / 180);
      sg.fillStyle = "#16205e"; sg.strokeStyle = "#16205e";
      sg.save(); sg.translate(X, Y); sg.rotate(rot);
      sg.save(); sg.transform(1, 0, skew, 1, 0, 0); sg.textAlign = "center"; sg.textBaseline = "alphabetic";
      sg.fillText(text, 0, 0); sg.restore();
      // росчерк: из конца букв петлёй вниз-влево под буквы, затем ровной волной вправо — до той же длины, что и слева
      const h = tw / 2, m = 14 + r() * 6, dy = fs * 0.32;
      const d = `M ${h - 4} ${-fs * 0.2} C ${h + 14} ${dy * 0.6}, ${h - 30} ${dy + 10}, ${-h - m + 6} ${dy + 6} ` +
        `C ${-h - m - 8} ${dy + 5}, ${-h - m + 4} ${dy - 4}, ${-h * 0.4} ${dy - 2 + r() * 4} ` +
        `S ${h * 0.6} ${dy - 8 + r() * 4}, ${h + m} ${dy - 10 - r() * 4}`;
      sg.lineWidth = 2.6; sg.lineCap = "round"; sg.lineJoin = "round"; sg.stroke(new Path2D(d)); sg.restore();
      // границы нарисованного (в пикселях холста) → центр росписи в центр печати
      const px = sg.getImageData(0, 0, sc.width, sc.height).data;
      let x0 = sc.width, y0 = sc.height, x1 = -1, y1 = -1;
      for (let y = 0; y < sc.height; y++) for (let x = 0; x < sc.width; x++) if (px[(y * sc.width + x) * 4 + 3] > 24) {
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      if (x1 >= 0) {
        const bw = (x1 - x0 + 1) / K, bh = (y1 - y0 + 1) / K;
        const k = Math.min(1, 196 / bw); // страховка: не шире колонки (центр 100 → 2…198)
        const cx = 100, cy = 100, dw = bw * k, dh = bh * k;
        g.drawImage(sc, x0, y0, x1 - x0 + 1, y1 - y0 + 1, cx - dw / 2, cy - dh / 2, dw, dh);
        signImage.last = { text, fs, tw, w: dw, h: dh, k };
      }
    }
    return cv.toDataURL("image/jpeg", 0.92); // белый фон: картинка стоит в своей колонке и не перекрывает текст
  }
  // ширина строки (pt) в шрифте документа: те же Tinos, что встраиваются в PDF
  let mctx = null;
  function textWidth(rs, size) {
    mctx = mctx || document.createElement("canvas").getContext("2d");
    return (Array.isArray(rs) ? rs : [rs]).reduce((w, x) => {
      const t = typeof x === "string" ? x : x && x.text != null ? String(x.text) : "";
      mctx.font = `${x && x.italics ? "italic " : ""}${x && x.bold ? "700 " : ""}${size}px Tinos`;
      return w + mctx.measureText(t).width;
    }, 0);
  }
  async function emblemData() { return A.emblem || null; }

  // ---------------- текстовые куски ----------------
  // run: строка | {t, b, i} | {url, alt} (в PDF — видимый кликабельный адрес, в PNG — alt или ничего) | {ph} (пусто)
  function runs(r, mode) {
    const out = [];
    (Array.isArray(r) ? r : [r]).forEach(x => {
      if (x == null || x === false || x === "") return;
      if (typeof x === "string" || typeof x === "number") { out.push({ text: String(x) }); return; }
      if (x.pdf !== undefined || x.png !== undefined) { out.push(...runs(mode === "png" ? (x.png || []) : (x.pdf || []), mode)); return; }
      if (x.url !== undefined) {
        if (mode !== "png") { const u = normUrl(x.url); out.push({ text: breakable(u), link: u, color: "#0b3a8c", decoration: "underline" }); }
        else if (x.alt) out.push({ text: x.alt });
        return;
      }
      if (x.ph !== undefined) { out.push({ text: x.ph || "________", color: mode === "preview" ? "#a58b2c" : "#000" }); return; }
      const o = { text: String(x.t == null ? "" : x.t) };
      if (x.b) o.bold = true; if (x.i) o.italics = true;
      out.push(o);
    });
    return out;
  }
  const rmode = m => m === "png" ? "png" : "pdf";

  // ---------------- HTML бланков (УД) → блоки документа в общем стиле ----------------
  // Тексты бланков (ud-docs.js) остаются как есть; меняется только вёрстка:
  //   p.para → абзац; p.ud-h (УСТАНОВИЛ:, ПОСТАНОВИЛ:) → формула как «ПРОШУ:» в рапортах;
  //   ol.items → нумерованные пункты в стиле рапорта; в протоколах — разделы I, II, III и пункты с жирными подписями.
  const URL_IN_TEXT = /((?:https?:\/\/|www\.)[^\s<>«»"]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:ru|com|net|org|be|tv|io|me|gg|su|рф)\/[^\s<>«»"]*)/gi;
  const URL_ALT = "приобщена к материалам дела";
  function linkify(text, alt) {
    const out = []; let last = 0;
    text.replace(URL_IN_TEXT, (m, _1, off) => {
      if (off > last) out.push(text.slice(last, off));
      const tail = /[.,;:)]+$/.exec(m); const url = tail ? m.slice(0, -tail[0].length) : m;
      out.push({ url, alt: alt || URL_ALT });
      if (tail) out.push(tail[0]);
      last = off + m.length; return m;
    });
    if (last < text.length) out.push(text.slice(last));
    return out;
  }
  // узел → куски текста формата runs(): строки, {t,b,i}, {ph}, {url,alt}, "\n"
  function htmlInline(node, st) {
    let out = [];
    node.childNodes.forEach(ch => {
      if (ch.nodeType === 3) {
        const t = ch.nodeValue.replace(/\s+/g, " ");
        if (!t) return;
        if (st.ph) { out.push({ ph: t }); return; }
        linkify(t).forEach(x => out.push(typeof x === "string" ? ((st.b || st.i) ? { t: x, b: st.b, i: st.i } : x) : x));
      } else if (ch.nodeType === 1) {
        const tag = ch.tagName.toLowerCase();
        if (tag === "br") { out.push("\n"); return; }
        if (tag === "ol" || tag === "ul") return; // блочные — отдельно
        const s2 = Object.assign({}, st);
        if (tag === "b" || tag === "strong") s2.b = true;
        if (tag === "i" || tag === "em") s2.i = true;
        if (ch.classList.contains("ph")) s2.ph = true;
        out = out.concat(htmlInline(ch, s2));
      }
    });
    // обрезаем пробелы по краям
    const txt = x => typeof x === "string" ? x : (x.t != null ? x.t : x.ph != null ? x.ph : null);
    const setTxt = (i, v) => { const x = out[i]; if (typeof x === "string") out[i] = v; else if (x.t != null) out[i] = Object.assign({}, x, { t: v }); else out[i] = Object.assign({}, x, { ph: v }); };
    while (out.length && txt(out[0]) != null && !txt(out[0]).trim()) out.shift();
    while (out.length && txt(out[out.length - 1]) != null && !txt(out[out.length - 1]).trim()) out.pop();
    if (out.length && txt(out[0]) != null) setTxt(0, txt(out[0]).replace(/^\s+/, ""));
    if (out.length && txt(out[out.length - 1]) != null) setTxt(out.length - 1, txt(out[out.length - 1]).replace(/\s+$/, ""));
    return out;
  }
  const runText = r => r.map(x => typeof x === "string" ? x : x.t != null ? x.t : x.ph != null ? x.ph : "\u0001").join("");
  // «Подпись: значение» → [подпись, значение]. Подпись — до первого «: », не длиннее 100 знаков, без конца предложения.
  function splitLabel(r) {
    const s = runText(r), m = /:(\s|$)/.exec(s);
    if (!m || m.index < 3 || m.index > 100 || /[.!?]\s/.test(s.slice(0, m.index)) || s.slice(0, m.index).includes("\u0001")) return null;
    let pos = 0; const label = [], value = [];
    for (const x of r) {
      const t = typeof x === "string" ? x : x.t != null ? x.t : x.ph != null ? x.ph : null;
      if (t == null) { (pos > m.index ? value : label).push(x); continue; }
      const a = pos, b = pos + t.length; pos = b;
      if (b <= m.index) label.push(t);
      else if (a > m.index) value.push(x);
      else { label.push(t.slice(0, m.index - a)); const rest = t.slice(m.index - a + 1).replace(/^\s+/, ""); if (rest) value.push(typeof x === "string" ? rest : x.t != null ? Object.assign({}, x, { t: rest }) : Object.assign({}, x, { ph: rest })); }
    }
    return { label: label.join("").trim(), value };
  }
  // фрагмент HTML (строки через <br>) → массив строк runs()
  function htmlLines(html) {
    return String(html || "").split(/<br\s*\/?>/i).map(x => htmlInline(new DOMParser().parseFromString(`<div>${x}</div>`, "text/html").body.firstChild, {})).filter(r => r.length);
  }
  const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  const liRuns = li => htmlInline(li, {});
  const liSub = li => { const sub = li.querySelector(":scope > ol, :scope > ul"); return sub ? [...sub.children].filter(x => x.tagName.toLowerCase() === "li").map(liRuns) : null; };
  // opt.protocol: разделы «I. СВЕДЕНИЯ О СЛЕДСТВЕННОМ ДЕЙСТВИИ», «II. <формула>», «III. ЗАЯВЛЕНИЯ, ЗАМЕЧАНИЯ И ПОДПИСИ»
  function htmlBlocks(html, opt) {
    opt = opt || {};
    const root = new DOMParser().parseFromString(`<div>${html || ""}</div>`, "text/html").body.firstChild;
    const toks = [];
    root.childNodes.forEach(n => {
      if (n.nodeType === 3) { if (n.nodeValue.trim()) toks.push({ k: "p", r: htmlInline({ childNodes: [n] }, {}) }); return; }
      if (n.nodeType !== 1) return;
      const tag = n.tagName.toLowerCase();
      if (tag === "ol" || tag === "ul") toks.push({ k: "ol", lis: [...n.children].filter(x => x.tagName.toLowerCase() === "li") });
      else if (n.classList.contains("ud-h")) toks.push({ k: "h", text: n.textContent.trim() });
      else toks.push({ k: "p", r: htmlInline(n, {}), nl: n.classList.contains("nl") });
    });
    const out = [];
    let sec = 0, no = 0, phase = opt.protocol ? "facts" : "free";
    const section = t => { out.push({ section: `${ROMAN[sec++] || sec}. ${t}` }); no = 0; };
    if (opt.protocol) section(opt.firstSection || "СВЕДЕНИЯ О СЛЕДСТВЕННОМ ДЕЙСТВИИ");
    for (let i = 0; i < toks.length; i++) {
      const t = toks[i], next = toks[i + 1];
      if (t.k === "h") {
        if (opt.protocol) { section(t.text.replace(/:\s*$/, "")); phase = "body"; }
        else out.push({ formula: t.text });
        continue;
      }
      if (t.k === "ol") {
        t.lis.forEach(li => { const sub = liSub(li); out.push(Object.assign({ item: ++no, value: liRuns(li), dot: false }, sub ? { list: sub } : {})); });
        continue;
      }
      // абзац
      if (opt.protocol && /^(Протокол прочитан|Заявлений и замечаний)/.test(runText(t.r))) { if (phase !== "close") { section("ЗАЯВЛЕНИЯ, ЗАМЕЧАНИЯ И ПОДПИСИ"); phase = "close"; } out.push({ p: t.r }); continue; }
      if (phase === "facts") {
        const sp = splitLabel(t.r);
        const list = next && next.k === "ol" ? next.lis.map(liRuns) : null;
        if (list) i++;
        if (sp) out.push(Object.assign({ item: ++no, label: sp.label, value: sp.value.length ? sp.value : undefined, dot: false }, list ? { list } : {}));
        else out.push(Object.assign({ item: ++no, value: t.r, dot: false }, list ? { list } : {}));
        continue;
      }
      out.push({ p: t.r, indent: !t.nl });
    }
    return out;
  }

  // ---------------- документ → pdfmake ----------------
  const LINE = (w, m, lw) => ({ canvas: [{ type: "line", x1: 0, y1: 0, x2: w || 480, y2: 0, lineWidth: lw || 0.8 }], margin: m || [0, 4, 0, 4] });
  const CW = 595.28 - 70 - 45; // ширина набора
  const DOWN = 21.3; // печать с росписью ниже строки подписи на 0,75 см
  let signDown = 21.3; // текущий сдвиг вниз для build (у низа листа может быть меньше, см. pdfBytes)
  const SIGN_IMG = 120; // картинка печати с росписью (было 100 pt, +20%); колонка под неё остаётся 100 pt, центр тот же
  const SIGN_GROW = (SIGN_IMG - 100) / 2; // на сколько картинка выходит за колонку с каждой стороны
  // Ссылки-доказательства — каждая с новой строки, с отступом: «а) адрес» (в PNG — «а) Приложение №N» без оформления ссылки).
  const LETTERS = "абвгдежзиклмнопрстуфхцчшщэюя";
  const mark = i => (LETTERS[i] || String(i + 1)) + ")";
  function linkLines(links, mode, opt) {
    opt = opt || {};
    const lines = links.map((l, i) => {
      const r = runs([typeof l === "string" ? { url: l } : l], mode);
      if (!r.length) return null;
      const one = links.length === 1 && opt.single;
      return one ? { text: r, margin: [0, 1, 0, 0] } : { columns: [{ width: 16, text: mark(i) }, { width: "*", text: r }], columnGap: 2, margin: [0, 1, 0, 0] };
    }).filter(Boolean);
    return lines.length ? { stack: lines, margin: [opt.indent == null ? 14 : opt.indent, 1, 0, 0] } : null;
  }
  // элемент перечня: runs или {r: runs, links: [url | {url, alt}], single}
  function listCell(li, mode, align) {
    const plain = !li || Array.isArray(li) || typeof li === "string" || li.r === undefined;
    const text = { text: runs(plain ? li : li.r, mode), alignment: align || "left" };
    if (plain || !li.links || !li.links.length) return text;
    const ll = linkLines(li.links, mode, { single: li.single });
    return ll ? { stack: [text, ll] } : text;
  }
  function block(b, mode) {
    const R = x => runs(x, mode);
    if (b.raw) return b.raw;
    if (b.section) return { text: b.section, bold: true, fontSize: 12.5, characterSpacing: 0.4, margin: [0, 14, 0, 7], keepWithNext: true };
    if (b.formula) return { text: b.formula, bold: true, characterSpacing: 0.4, margin: b.margin || [0, 4, 0, 5], keepWithNext: true };
    if (b.p !== undefined) return { text: R(b.p), alignment: b.align || "justify", leadingIndent: b.indent === false ? 0 : 35, bold: !!b.bold, margin: b.margin || [0, 0, 0, 6] };
    // перечень (Приложение) — как подпункты рапорта: «1)» с отступом под текст пунктов
    if (b.olist) return { stack: b.olist.map((li, i) => ({ columns: [{ width: 18, text: `${i + 1})` }, { width: "*", stack: [listCell(li, mode)] }], columnGap: 2, margin: [24, 0, 0, 3], unbreakable: true })), margin: b.margin || [0, 0, 0, 6] };
    if (b.rule) return LINE(CW, b.margin || [0, 8, 0, 8], b.width);
    if (b.space) return { text: "", margin: [0, b.space, 0, 0] };
    if (b.signLine) return { columns: [{ width: 190, text: R(b.signLine[0]) }, { width: 170, canvas: [{ type: "line", x1: 0, y1: 14, x2: 170, y2: 14, lineWidth: 0.6 }] }, { width: "*", text: R(b.signLine[1] || ""), alignment: "right" }], columnGap: 10, margin: [0, 10, 0, 0], unbreakable: true };
    if (b.item !== undefined) {
      const head = b.label ? [{ text: b.label + (b.value !== undefined || b.list ? ":" : ""), bold: true }] : [];
      const val = b.value !== undefined ? R(b.value) : [];
      if (b.dot !== false && val.length) {
        const last = val[val.length - 1];
        if (typeof last.text === "string" && !last.link && !/[.!?…:;]\s*$/.test(last.text)) val.push({ text: "." });
      }
      const headText = { text: head.concat(val.length && head.length ? [{ text: " " }] : []).concat(val), alignment: b.align || (b.label ? "left" : "justify") };
      const listRow = (li, i) => ({ columns: [{ width: 18, text: (b.bullet || "num") === "num" ? `${i + 1})` : "—" }, { width: "*", stack: [listCell(li, mode, b.align)] }], columnGap: 2, margin: [0, 3, 0, 0], unbreakable: true });
      const row = (num, stack, extra) => Object.assign({ columns: [{ width: 22, text: num, bold: true }, { width: "*", stack }], columnGap: 2 }, extra || {});
      // заголовок пункта не отрывается от первой строки перечня: первая строка — вместе с ним, остальные — отдельными строками
      const list = b.list && b.list.length ? b.list : [];
      const rows = [row(`${b.item}.`, [headText].concat(list.length ? [listRow(list[0], 0)] : []), list.length ? { unbreakable: true } : {})];
      list.slice(1).forEach((li, j) => rows.push(row("", [listRow(li, j + 1)], { unbreakable: true })));
      if (b.after) rows.push(row("", [{ text: R(b.after), margin: [0, 2, 0, 0], alignment: "justify" }]));
      return rows.length === 1 ? Object.assign(rows[0], { margin: [0, 0, 0, 6] }) : { stack: rows, margin: [0, 0, 0, 6] };
    }
    if (b.sign) {
      // единый блок подписи: [Дата: …] / слева жирная подпись роли + должность, по центру печать и роспись, справа звание и И.О. Фамилия
      const s = b.sign, out = [];
      const pre = (s.before || []).map((x, i) => ({ text: R(x), margin: [0, i ? 3 : 16, 0, 0] }));
      out.push(...pre);
      if (s.date !== undefined) out.push({ text: [{ text: (s.dateLabel || "Дата") + ": ", bold: true }].concat(R(s.date)), margin: [0, pre.length ? 4 : 16, 0, 0] });
      const left = [];
      if (s.label) left.push({ text: R(s.label), bold: true });
      (Array.isArray(s.pos) ? s.pos : s.pos ? [s.pos] : []).forEach(p => left.push({ text: R(p) }));
      const rightRuns = (s.right || [s.rank || "", s.name || ""]).map(x => R(x));
      const right = rightRuns.map(t => ({ text: t }));
      // Печать с росписью стоит у колонки звания и И.О. Фамилии: ширина колонки = фактическая ширина самой длинной
      // строки (+3 pt запаса); между картинкой (100 pt, печать 88 pt по центру) и колонкой — ещё SHIFT ≈ 3 см.
      // Итоговый зазор печать → текст ≈ 6 + 3 + SHIFT pt. Левая колонка — прежней ширины (CW − 332), чтобы её текст
      // переносился как раньше; если справа длинное звание/ФИО и места не хватает, SHIFT уменьшается (минимум 6 pt
      // свободного места слева от картинки), а при совсем длинной строке левая колонка сжимается.
      const rw = Math.min(230, Math.ceil(Math.max(40, ...rightRuns.map(t => textWidth(t, 12.5)))) + 3);
      const LW = CW - 332, SHIFT = 85; // 3 см левее «вплотную»
      // левый край печати = левый край колонки картинки + 50 − 0,44·SIGN_IMG; он должен быть ≥ 6 pt правее левой колонки
      const free = CW - LW - rw - 100 - (0.44 * SIGN_IMG - 50) - 6;
      const shift = Math.max(0, Math.min(SHIFT, free));
      out.push({
        columns: [
          free >= 0 ? { width: LW, stack: left, margin: [0, s.top || 40, 0, 0] } : { width: "*", stack: left, margin: [0, s.top || 40, 0, 0] },
          free >= 0 ? { width: "*", text: "" } : { width: 6, text: "" },
          // на 0,75 см ниже: relativePosition сдвигает только картинку, раскладка (и всё ниже) не меняется
          // +20%: картинка 120 pt, сдвинута на −10/−10 — центр печати и росписи остаётся на месте
          s.image ? { width: 100, image: s.image, fit: [SIGN_IMG, SIGN_IMG], relativePosition: { x: -SIGN_GROW, y: signDown - SIGN_GROW } } : { width: 100, text: "" },
          { width: shift, text: "" },
          { width: rw, stack: right, alignment: "right", margin: [0, s.top || 40, 0, 0] }
        ], id: "vp-sign", columnGap: 0, margin: [0, s.date !== undefined ? 0 : 14, 0, 0], unbreakable: true
      });
      return { stack: out, unbreakable: true };
    }
    return { text: "" };
  }
  // блок справа (Кому / УТВЕРЖДАЮ): первая строка может начинаться с жирной подписи
  const rightBlock = (lines, mode, top) => ({ columns: [{ width: "*", text: "" }, { width: 245, stack: lines.map(l => ({ text: runs(l, mode), margin: [0, 0, 0, 3] })) }], margin: [0, top, 0, 0] });

  function build(spec, mode, opt) {
    signDown = opt && opt.down != null ? opt.down : DOWN;
    const rm = mode === "preview" ? "preview" : rmode(mode);
    const content = [];
    // шапка — одна на все документы
    if (spec.emblem !== false && A.emblem) content.push({ image: "emblem", width: 58, alignment: "center", margin: [0, 0, 0, 5] });
    (spec.header || C.header || []).forEach(l => content.push({ text: l, bold: true, alignment: "center", fontSize: 12, characterSpacing: 0.3, lineHeight: 1.1 }));
    if (spec.unitLine !== false && (spec.unitLine || C.unitLine)) content.push({ text: spec.unitLine || C.unitLine, alignment: "center", fontSize: 11.5, margin: [0, 2, 0, 0] });
    content.push(LINE(CW, [0, 7, 0, 0], 1.4)); content.push(LINE(CW, [0, 1.6, 0, 0], 0.5));
    if (spec.approve) content.push(rightBlock(spec.approve, rm, 12));
    if (spec.to) content.push(rightBlock(spec.to, rm, spec.approve ? 8 : 14));
    // заголовок вразрядку: «П Р О Т О К О Л» и «ПРОТОКОЛ» выглядят одинаково, текст извлекается слитно
    const title = String(spec.title || "").replace(/^((?:\S ){2,}\S)$/, m => m.replace(/ /g, ""));
    if (title) content.push({ text: title, fontSize: 18, bold: true, alignment: "center", characterSpacing: 6, margin: [0, 16, 0, 2] });
    if (spec.subtitle) content.push({ text: spec.subtitle, alignment: "center", bold: true, fontSize: 12.5, margin: [0, 0, 0, 2] });
    if (spec.metaLine) content.push({ text: runs(spec.metaLine, rm), alignment: "center", fontSize: 12, margin: [0, 2, 0, 0] });
    if (spec.placeDate) content.push({ columns: [{ width: "*", text: runs(spec.placeDate[0], rm) }, { width: "*", text: runs(spec.placeDate[1], rm), alignment: "right" }], fontSize: 12, margin: [0, 8, 0, 0] });
    content.push({ text: "", margin: [0, 8, 0, 0] });
    const blocks = [];
    (spec.blocks || []).forEach(b => { if (b.html !== undefined) blocks.push(...htmlBlocks(b.html, b)); else blocks.push(b); });
    // заголовок раздела / формула («ПРОШУ:») не остаются внизу листа одни: склеиваем их с первой строкой следующего блока
    const plainLen = b => b && b.p !== undefined ? runText(runs(b.p, rm).map(x => x.text)).length : 0;
    // последний блок подписи: небольшой запас снизу, чтобы опущенная печать не заходила на девиз внизу листа
    if (blocks.length && blocks[blocks.length - 1].sign) blocks[blocks.length - 1] = Object.assign({}, blocks[blocks.length - 1], { _last: true });
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i], nb = blocks[i + 1];
      if (!(b.section || b.formula) || !nb || nb.section || nb.sign || nb.space) { content.push(block(b, rm)); continue; }
      const head = block(b, rm), nxt = block(nb, rm);
      i++;
      if (nb.item !== undefined && nxt.stack && nxt.stack.length > 1) {
        content.push({ stack: [head, nxt.stack[0]], unbreakable: true });
        content.push({ stack: nxt.stack.slice(1), margin: nxt.margin });
      } else if (nb.item !== undefined || (nb.olist && nb.olist.length <= 6) || (nb.p !== undefined && plainLen(nb) < 600)) content.push({ stack: [head, nxt], unbreakable: true });
      else { content.push(head); content.push(nxt); }
    }
    const motto = spec.motto === false ? "" : (spec.motto || C.motto || "");
    return {
      pageSize: "A4", pageMargins: [70, 50, 45, 62],
      info: { title: spec.docTitle || title || "Документ", author: spec.author || "", subject: spec.subtitle || "", creator: "ГУ ВП · автономные бланки", producer: "pdfmake" },
      images: A.emblem ? { emblem: A.emblem } : {},
      defaultStyle: { font: "Tinos", fontSize: 12.5, lineHeight: 1.16 },
      header: cur => cur > 1 ? { text: String(cur), alignment: "center", fontSize: 11.5, margin: [0, 24, 0, 0] } : null,
      footer: (cur, count) => (cur === count && motto) ? { stack: [LINE(CW, [0, 0, 0, 4], 0.5), { text: motto, alignment: "center", bold: true, fontSize: 11, characterSpacing: 0.5 }], margin: [70, 14, 45, 0] } : null,
      content
    };
  }

  // ---------------- PDF / PNG ----------------
  async function pdfBytes(spec, mode) {
    await ready;
    if (!window.pdfMake) throw new Error("pdfmake не загрузился");
    const make = dd => new Promise((res, rej) => {
      try { pdfMake.createPdf(dd, null, FONTS, VFS).getBuffer(b => res(new Uint8Array(b))); } catch (e) { rej(e); }
    });
    // Печать опущена на DOWN и рисуется поверх (relativePosition), поэтому у самого низа листа она могла бы
    // зайти на линию девиза или за край листа. После первого прохода смотрим (pdf.js), где реально нарисована
    // картинка печати на последнем листе; если не влезает — второй проход поднимает только её
    // (раскладка текста и число листов не меняются).
    const bytes = await make(build(spec, mode));
    if (!hasSign(spec)) return bytes;
    let bottom = null;
    try { bottom = await signBottom(bytes); } catch (e) { bottom = null; }
    if (bottom == null) return bytes;
    const motto = spec.motto === false ? "" : (spec.motto || C.motto || "");
    const limit = motto ? 841.89 - 62 + 14 - 4 : 841.89 - 14; // линия девиза (−4 pt) или край листа
    if (bottom <= limit) return bytes;
    return make(build(spec, mode, { down: DOWN - (bottom - limit) }));
  }
  const hasSign = spec => (spec.blocks || []).some(b => b && b.sign && b.sign.image);
  // нижний край круга печати (pt от верха листа) на последнем листе: ищем картинку SIGN_IMG×SIGN_IMG в потоке рисования
  async function signBottom(bytes) {
    const L = pdfjs();
    const doc = await L.getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false }).promise;
    try {
      const page = await doc.getPage(doc.numPages), ops = await page.getOperatorList(), H = page.view[3];
      const O = L.OPS, stack = [];
      let m = [1, 0, 0, 1, 0, 0], found = null;
      const mul = (a, b) => [a[0] * b[0] + a[2] * b[1], a[1] * b[0] + a[3] * b[1], a[0] * b[2] + a[2] * b[3], a[1] * b[2] + a[3] * b[3], a[0] * b[4] + a[2] * b[5] + a[4], a[1] * b[4] + a[3] * b[5] + a[5]];
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i], args = ops.argsArray[i];
        if (fn === O.save) stack.push(m); else if (fn === O.restore) m = stack.pop() || [1, 0, 0, 1, 0, 0];
        else if (fn === O.transform) m = mul(m, args);
        else if ((fn === O.paintImageXObject || fn === O.paintJpegXObject) && Math.abs(m[0] - SIGN_IMG) < 0.5 && Math.abs(m[3] - SIGN_IMG) < 0.5) found = m;
      }
      return found ? H - found[5] - SIGN_IMG * 0.06 : null;
    } finally { doc.destroy(); }
  }
  let pdfjsOk = false;
  function pdfjs() {
    const L = window.pdfjsLib || window["pdfjs-dist/build/pdf"];
    if (!L) throw new Error("pdf.js не загрузился");
    if (!pdfjsOk) { if (!window.pdfjsWorker) L.GlobalWorkerOptions.workerSrc = (window.VP_REPORT_BASE || "") + "vendor/pdf.worker.min.js"; pdfjsOk = true; }
    return L;
  }
  async function renderPages(bytes, scale) {
    const L = pdfjs();
    const doc = await L.getDocument({ data: bytes, isEvalSupported: false, useSystemFonts: false }).promise;
    const out = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i), vp = page.getViewport({ scale });
      const cv = document.createElement("canvas"); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      out.push(cv);
    }
    doc.destroy();
    return out;
  }
  function save(blob, name) {
    const a = document.createElement("a"); const url = URL.createObjectURL(blob);
    a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
  const safe = s => String(s || "doc").replace(/[^\wА-яЁё.-]+/g, "_").replace(/^_+|_+$/g, "") || "doc";
  async function downloadPDF(spec, base) {
    const b = await pdfBytes(spec, "pdf");
    save(new Blob([b], { type: "application/pdf" }), safe(base) + ".pdf");
    return b;
  }
  const PNG_SCALE = 1588 / 595.28; // ширина листа 1588 px (~192 dpi)
  async function downloadPNG(spec, base) {
    const pages = await renderPages(await pdfBytes(spec, "png"), PNG_SCALE);
    for (let i = 0; i < pages.length; i++) {
      const blob = await new Promise(r => pages[i].toBlob(r, "image/png"));
      save(blob, safe(base) + (pages.length > 1 ? `_стр${i + 1}` : "") + ".png");
      if (pages.length > 1) await new Promise(r => setTimeout(r, 250));
    }
    return pages.length;
  }

  // ---------------- живой предпросмотр ----------------
  function preview(box, getSpec, opt) {
    opt = opt || {};
    let timer = 0, seq = 0, mode = "preview";
    async function draw() {
      const my = ++seq;
      if (!box.isConnected) return;
      try {
        if (window.VP_PDF_READY) await window.VP_PDF_READY;
        if (my !== seq || !box.isConnected) return;
        const spec = await getSpec();
        if (!spec) return;
        const bytes = await pdfBytes(spec, mode === "png" ? "png" : "preview");
        if (my !== seq) return;
        const w = Math.max(320, box.clientWidth || 700);
        const pages = await renderPages(bytes, (w / 595.28) * Math.min(2, window.devicePixelRatio || 1));
        if (my !== seq) return;
        box.innerHTML = "";
        pages.forEach((c, i) => { c.className = "pv-page"; c.setAttribute("aria-label", "Лист " + (i + 1)); box.appendChild(c); });
        if (opt.onPages) opt.onPages(pages.length);
      } catch (e) { if (opt.onError) opt.onError(e); else console.error(e); }
    }
    const api = {
      refresh(now) { clearTimeout(timer); timer = setTimeout(draw, now ? 0 : 350); },
      setMode(m) { mode = m; api.refresh(true); }
    };
    window.addEventListener("resize", () => api.refresh());
    return api;
  }

  // ---------------- номер документа: локальный счётчик ----------------
  function incNum(s) {
    s = String(s || "").trim();
    if (!s) return "1";
    const m = /^(.*?)(\d+)(\D*)$/.exec(s);
    if (!m) return s + "-1";
    const n = String(+m[2] + 1).padStart(m[2].length, "0");
    return m[1] + n + m[3];
  }
  function counter(kind, el) {
    const key = "vp_num_" + kind;
    const next = () => incNum(localStorage.getItem(key) || "0");
    const draft = localStorage.getItem(key + "_draft");
    el.value = draft || next();
    el.addEventListener("input", () => localStorage.setItem(key + "_draft", el.value.trim()));
    return {
      commit() { const v = el.value.trim(); if (v) { localStorage.setItem(key, v); localStorage.setItem(key + "_draft", v); } },
      next() { el.value = next(); localStorage.removeItem(key + "_draft"); el.dispatchEvent(new Event("input", { bubbles: true })); localStorage.removeItem(key + "_draft"); },
      last() { return localStorage.getItem(key) || ""; }
    };
  }

  // ---------------- сохранение полей формы ----------------
  function persist(key, ids) {
    let st = {}; try { st = JSON.parse(localStorage.getItem(key) || "{}"); } catch (e) {}
    ids.forEach(id => {
      const el = document.getElementById(id); if (!el) return;
      if (st[id] !== undefined) { if (el.type === "checkbox") el.checked = !!st[id]; else el.value = st[id]; }
      el.addEventListener(el.type === "checkbox" ? "change" : "input", () => { st[id] = el.type === "checkbox" ? el.checked : el.value; localStorage.setItem(key, JSON.stringify(st)); });
    });
    return { clear(list) { (list || ids).forEach(id => delete st[id]); localStorage.setItem(key, JSON.stringify(st)); } };
  }

  // ---------------- кнопки страницы: «Скачать PDF» / «Скачать PNG» + предпросмотр ----------------
  function check(ids) {
    let first = null;
    ids.forEach(id => {
      const el = typeof id === "string" ? document.getElementById(id) : id;
      if (!el) return;
      const bad = el.type === "checkbox" ? false : !String(el.value || "").trim();
      el.classList.toggle("bad", bad);
      if (bad && !first) first = el;
    });
    if (first) { first.focus(); first.scrollIntoView && first.scrollIntoView({ block: "center" }); }
    return !first;
  }
  document.addEventListener("input", e => { if (e.target.classList && e.target.classList.contains("bad")) e.target.classList.remove("bad"); });
  function wire(o) {
    const $ = id => document.getElementById(id);
    const st = $(o.statusId || "status");
    const status = (t, cls) => { if (st) { st.textContent = t; st.className = "status " + (cls || ""); } };
    const btns = [o.pdfId || "pdf", o.pngId || "png"].map($).filter(Boolean);
    const busy = b => btns.forEach(x => x.disabled = b);
    let pv = null;
    if (o.preview) {
      const pages = $(o.pagesId || "pvPages");
      pv = preview(o.preview, o.spec, {
        onPages: n => { if (pages) pages.textContent = n === 1 ? "1 лист A4" : `${n} листа(ов) A4`; },
        onError: e => status("Ошибка предпросмотра: " + e.message, "err")
      });
      document.querySelectorAll("input[name=pvMode]").forEach(r => r.addEventListener("change", () => { if (r.checked) pv.setMode(r.value); }));
      pv.refresh(true);
    }
    async function run(kind) {
      if (o.validate && !o.validate()) { status(o.invalidText || "Заполни подсвеченные красным поля.", "err"); return; }
      busy(true); status(kind === "pdf" ? "Собираю PDF…" : "Рисую PNG…");
      try {
        if (window.VP_PDF_READY) await window.VP_PDF_READY;
        const spec = await o.spec();
        const base = o.base();
        if (kind === "pdf") { await downloadPDF(spec, base); status("PDF скачан: " + safe(base) + ".pdf", "ok"); }
        else { const n = await downloadPNG(spec, base); status(n > 1 ? `Скачано листов PNG: ${n}.` : "PNG скачан: " + safe(base) + ".png", "ok"); }
        if (o.counter) o.counter.commit();
        if (o.onExport) o.onExport(kind, spec);
      } catch (e) { console.error(e); status("Ошибка: " + e.message, "err"); } finally { busy(false); }
    }
    btns.forEach(b => b.addEventListener("click", () => run(b.id === (o.pdfId || "pdf") ? "pdf" : "png")));
    return { status, refresh: now => pv && pv.refresh(now), run };
  }

  window.VPDOC = { check, wire, safe, ready, build, pdfBytes, renderPages, downloadPDF, downloadPNG, preview, counter, persist, signImage, emblemData,
    parseName, lcFirst, human, longDate, iso, cap, esc, isLink, normUrl, htmlBlocks, htmlLines, incNum, MONTHS };
})();
