// E2E «Переаттестации v2» (миграции 0016+): 6 видов и иерархия, базы, доли сложности, темы и типы без перекоса,
// все механики (в т. ч. допустимые варианты текста, форматы чисел, 4 варианта в пропуске, вопросы по изображению),
// частичные баллы с потолком, баллы/процент/итог, проходной балл в баллах, изображения (загрузка/замена/удаление/SVG),
// каждый параметр админки и сохранение после перезагрузки, разнообразие попыток, доступ (🔑) для всех 6 видов, UI.
// Headless, вход — /__test/login, без Discord. Запуск: bash /tmp/reset.sh, node serve.js (:8080).
const { chromium } = require('playwright');
const fs = require('fs');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const SHOTS = process.env.SHOTS || (__dirname + '/shots/'); fs.mkdirSync(SHOTS, { recursive: true });
const SUPER = '417660389723996170';
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 700) : '')); };
async function call(method, path, token, body) {
  const h = {}; if (token) h.Authorization = 'Bearer ' + token; if (body !== undefined) h['Content-Type'] = 'application/json';
  const r = await fetch(API + path, { method, headers: h, body: body !== undefined ? JSON.stringify(body) : undefined });
  const t = await r.text(); let d = null; try { d = JSON.parse(t); } catch (_) {}
  return { status: r.status, d, raw: t, headers: r.headers };
}
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, args) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args }) })).json()).results;
const U = { c1: '860000000000000001', c2: '860000000000000002' };
const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PNG2 = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEjDAGNzYAAC0AAf8Wd3sAAAAASUVORK5CYII=';
const DOCS = ['vu', 'du', 'kps', 'su', 'pk', 'uk', 'koap', 'tk', 'fz_oborona', 'fkz_rezhimy'];
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect x="0" y="0" width="100" height="100" fill="#cde"/><rect x="100" y="0" width="100" height="100" fill="#edc"/><text x="50" y="55" text-anchor="middle">A</text><text x="150" y="55" text-anchor="middle">B</text></svg>';

// синтетические вопросы базы: разные типы, сложности, документы и пункты
function synth(base, n, tag) {
  const out = []; const types = ['single', 'multi', 'number', 'text', 'blanks_select'];
  for (let i = 0; i < n; i++) {
    const d = (i % 3) + 1, doc = DOCS[i % DOCS.length], t = types[Math.floor(i / 3) % types.length];
    const q = { ext_id: `t6-${tag}-${base}-${i}`, base, difficulty: d, source_doc: doc, source_ref: `п. ${i + 1}.${d}`, quote: 'цитата ' + i, category: 'Тест v2 — ' + base,
      text: `Синтетический вопрос ${tag} ${base} номер ${i} про норму ${['караул', 'смотр', 'присяга', 'оружие', 'отпуск', 'приказ', 'обыск', 'штраф', 'дежурство', 'режим'][i % 10]} метка${i}a метка${i}b метка${i}c`, type: t };
    if (t === 'single') Object.assign(q, { options: [{ text: 'Вариант один ' + i, correct: true }, { text: 'Вариант два ' + i }, { text: 'Вариант три ' + i }, { text: 'Вариант четыре ' + i }] });
    if (t === 'multi') Object.assign(q, { options: [{ text: 'Да ' + i, correct: true }, { text: 'Тоже да ' + i, correct: true }, { text: 'Нет ' + i }, { text: 'Тоже нет ' + i }] });
    if (t === 'number') Object.assign(q, { answer: i + 1 });
    if (t === 'text') Object.assign(q, { accepted: ['ответ' + i] });
    if (t === 'blanks_select') Object.assign(q, { content: `Пропуск [[*верно${i}|неверно${i}|мимо${i}|ложно${i}]] в тексте` });
    out.push(q);
  }
  return out;
}

(async () => {
  const A = await login(SUPER, 'super-admin');
  const C1 = await login(U.c1, 'cand_one', 'reatt'), C2 = await login(U.c2, 'cand_two', 'reatt');
  await sql("UPDATE reattestations SET cooldown_min = 0, max_attempts = 0");

  // ---------- 1. шесть видов, иерархия, сопоставление старых ----------
  let r = await call('GET', '/api/admin/reatt', A);
  const items = r.d.items; const K = (k) => items.find(x => x.key === k);
  check('есть все 6 видов: simple, medium, full, full_vp, cases_int, cases', ['simple', 'medium', 'full', 'full_vp', 'cases_int', 'cases'].every(k => K(k)), items.map(x => x.key));
  check('основная линия: Упрощённая 1 → Средняя 2 → Полная общая 3 → Полная ВП 4', K('simple').track === 'line' && K('simple').level === 1 && K('medium').level === 2 && K('full').level === 3 && K('full_vp').level === 4 && K('full_vp').track === 'line', items.map(x => [x.key, x.track, x.level]));
  check('кейсы — отдельная категория (внутренние и общие)', K('cases_int').track === 'cases' && K('cases').track === 'cases');
  check('новые виды — выборка из своих баз', K('medium').mode === 'bank' && K('medium').cfg.base === 'medium' && K('full_vp').cfg.base === 'vp' && K('cases_int').cfg.base === 'cases_int');
  check('доли сложности по умолчанию: средняя 30/50/20, ВП 10/35/55, внутр. кейсы 25/50/25', K('medium').cfg.mix.join() === '30,50,20' && K('full_vp').cfg.mix.join() === '10,35,55' && K('cases_int').cfg.mix.join() === '25,50,25');
  check('базы: сводка по 6 базам в ответе', Object.keys(r.d.bases).length === 6 && r.d.docs.length >= 15, Object.keys(r.d.bases));

  // ---------- 2. изображения ----------
  r = await call('POST', '/api/admin/media', A, { name: 'a.png', mime: 'image/png', data: PNG1 });
  check('загрузка изображения (201)', r.status === 201 && r.d.media && /^[A-Za-z0-9_-]{16,}$/.test(r.d.media.key), r.d); const M1 = r.d.media;
  r = await call('POST', '/api/admin/media', A, { name: 'x.svg', mime: 'image/svg+xml', data: btoa('<svg/>') }); check('SVG-файлом нельзя (только PNG/JPEG/WEBP/GIF)', r.status === 400, r.d);
  r = await call('POST', '/api/admin/media', C1, { name: 'a.png', mime: 'image/png', data: PNG1 }); check('кандидат не загружает изображения (403)', r.status === 403);
  let raw = await fetch(API + '/media/' + M1.key); let buf = Buffer.from(await raw.arrayBuffer());
  check('GET /media/<ключ>: image/png, байты совпадают', raw.status === 200 && raw.headers.get('content-type') === 'image/png' && buf.equals(Buffer.from(PNG1, 'base64')), raw.status);
  r = await call('PUT', '/api/admin/media/' + M1.id, A, { name: 'b.png', mime: 'image/png', data: PNG2 });
  raw = await fetch(API + '/media/' + M1.key); buf = Buffer.from(await raw.arrayBuffer());
  check('замена изображения: тот же ключ, новый файл', r.status === 200 && buf.equals(Buffer.from(PNG2, 'base64')));
  check('неизвестный ключ → 404', (await fetch(API + '/media/AAAAAAAAAAAAAAAAAAAAAA')).status === 404);

  // ---------- 3. механики (через «Проверить как кандидат») ----------
  const mk = async (body) => { const x = await call('POST', '/api/admin/bank', A, { category: 'Тест механик', base: 'vp', difficulty: 2, source_doc: 'pk', source_ref: 'ст. 1', ...body }); return x; };
  const tryQ = async (id, answer, prev) => { const s = prev ? { state: prev.st, question: prev.pub } : (await call('POST', `/api/admin/questions/${id}/try`, A, {})).d; const g = await call('POST', `/api/admin/questions/${id}/try`, A, { state: s.state, answer }); return { pub: s.question, st: s.state, g: g.d && g.d.grade, d: g.d, status: g.status }; };
  // текст: одно слово в нужном падеже, несколько написаний, без нечёткого принятия
  r = await mk({ type: 'text', text: 'Кому подчиняется часовой? (одно слово, дательный падеж)', accepted: ['разводящему', 'разводящему караула'] }); const QT = r.d.question;
  check('text: создан, баллы по умолчанию = сложность (2)', r.status === 200 && QT.points === 2, r.d);
  let t = await tryQ(QT.id, 'Разводящему'); check('text: регистр не важен', t.g.ap === 2, t.g);
  t = await tryQ(QT.id, '  разводящему. '); check('text: пробелы и точка по краям не важны', t.g.ap === 2, t.g);
  t = await tryQ(QT.id, 'разводящему караула'); check('text: второе допустимое написание принимается', t.g.ap === 2, t.g);
  t = await tryQ(QT.id, 'разводящий'); check('text: другой падеж не принимается', t.g.ap === 0, t.g);
  t = await tryQ(QT.id, 'разводящиму'); check('text: опечатка не принимается (нет нечёткого сравнения)', t.g.ap === 0, t.g);
  r = await mk({ type: 'text', text: 'ё/е', accepted: ['ещё'] }); t = await tryQ(r.d.question.id, 'еще'); check('text: ё = е', t.g.ap === 2, t.g);
  // число: форматы и диапазон
  r = await mk({ type: 'number', text: 'Сколько суток?', answer: 1500, unit: 'руб.' }); const QN = r.d.question;
  for (const [a, ok] of [['1500', 1], ['1 500', 1], ['1500 руб.', 1], ['1 500,0', 1], [1500, 1], ['1501', 0]]) { t = await tryQ(QN.id, a); check(`number: «${a}» → ${ok ? 'верно' : 'неверно'}`, t.g && t.g.ap === (ok ? 2 : 0), t); }
  t = await tryQ(QN.id, 'полторы тысячи'); check('number: слово вместо числа → 400', t.status === 400, t.d);
  r = await mk({ type: 'number', text: 'Диапазон', answer: 10, answer_max: 15 }); check('number: диапазон сохранён', r.d.question.native.answer_max === 15, r.d);
  for (const [a, ok] of [['10', 1], ['12,5', 1], ['15', 1], ['9', 0], ['16', 0]]) { t = await tryQ(r.d.question.id, a); check(`number-диапазон 10–15: ${a} → ${ok ? 'верно' : 'неверно'}`, t.g.ap === (ok ? 2 : 0), t.g); }
  r = await mk({ type: 'number', text: 'Плохой диапазон', answer: 10, answer_max: 5 }); check('number: «до» меньше «от» → 400', r.status === 400);
  // пропуски из списка — ровно 4 варианта (проверка привязки), выбор
  r = await mk({ type: 'blanks_select', text: 'Заполните', content: 'Часовой — [[*лицо|предмет|орган|место]], [[*неприкосновенен|подотчётен|свободен|временный]].', partial: true }); const QB = r.d.question;
  t = await tryQ(QB.id, null); check('blanks_select: кандидат видит 4 варианта в каждом пропуске, без правильного ответа', t.pub.blanks.every(b => b.length === 4) && !JSON.stringify(t.pub).includes('correct'), t.pub);
  const nat = QB.native; // правильные: первые со * — по тексту
  const pickIdx = (bl, txt) => bl.find(o => o.text === txt).id;
  t = await tryQ(QB.id, [pickIdx(t.pub.blanks[0], 'лицо'), pickIdx(t.pub.blanks[1], 'неприкосновенен')], t); check('blanks_select: всё верно → 2 из 2', t.g.ap === 2, t.g);
  t = await tryQ(QB.id, [pickIdx(t.pub.blanks[0], 'лицо'), pickIdx(t.pub.blanks[1], 'свободен')], t); check('blanks_select: частично (1 из 2) → 1', t.g.ap === 1, t.g);
  // потолок частичного балла
  r = await call('PUT', `/api/admin/questions/${QB.id}`, A, { ...nat, partial: true, partial_cap: 30 }); check('partial_cap сохранён', r.status === 200 && r.d.question.native.partial_cap === 30, r.d);
  t = await tryQ(QB.id, [pickIdx(t.pub.blanks[0], 'лицо'), pickIdx(t.pub.blanks[1], 'свободен')], t); check('частичный балл не выше потолка 30% (0,6 из 2)', t.g.ap === 0.6, t.g);
  t = await tryQ(QB.id, [pickIdx(t.pub.blanks[0], 'лицо'), pickIdx(t.pub.blanks[1], 'неприкосновенен')], t); check('полный ответ — полный балл, потолок не мешает', t.g.ap === 2, t.g);
  // поиск в тексте по фрагменту документа
  r = await mk({ type: 'find', text: 'Найдите в статье слово, определяющее срок', material: 'Статья 14. Задержание — до 48 часов.', content: 'Задержание производится на срок [[не более]] 48 часов.' });
  t = await tryQ(r.d.question.id, null); check('find + фрагмент документа: кандидат видит фрагмент', t.pub.material === 'Статья 14. Задержание — до 48 часов.' && t.pub.tokens.length > 3, t.pub);
  // вопрос по изображению (SVG-схема) — одна верная область
  r = await mk({ type: 'hotspot', text: 'Где пост?', media: [{ svg: SVG, alt: 'схема' }], zones: '0, 0, 50, 100 | Левый квадрат | *\n50, 0, 50, 100 | Правый квадрат' }); const QH = r.d.question;
  check('hotspot: создан, 2 области', r.status === 200 && QH.native.zones.length === 2, r.d);
  t = await tryQ(QH.id, null); check('hotspot: кандидат видит схему и номера областей без подписей и без правильной', t.pub.media[0].svg.startsWith('<svg') && t.pub.zones.map(z => z.label).join() === '1,2' && !JSON.stringify(t.pub).includes('correct') && t.pub.multi === false, t.pub);
  const zid = (lab) => QH.native.zones.find(z => z.label === lab).id;
  t = await tryQ(QH.id, [zid('Левый квадрат')], t); check('hotspot: верная область → 2', t.g.ap === 2, t.g);
  t = await tryQ(QH.id, [zid('Правый квадрат')], t); check('hotspot: неверная область → 0', t.g.ap === 0, t.g);
  t = await tryQ(QH.id, ['zzz'], t); check('hotspot: чужой id области → 400', t.status === 400);
  // hotspot по загруженному изображению, несколько верных областей, частичные баллы
  r = await mk({ type: 'hotspot', text: 'Найдите нарушения', media: [{ m: M1.key }], partial: true, show_labels: true, zones: [{ x: 0, y: 0, w: 30, h: 30, label: 'A', correct: true }, { x: 40, y: 40, w: 20, h: 20, label: 'B', correct: true }, { x: 70, y: 70, w: 20, h: 20, label: 'C' }] });
  const QH2 = r.d.question; const z2 = (l) => QH2.native.zones.find(z => z.label === l).id;
  t = await tryQ(QH2.id, null); check('hotspot (изображение): подписи показаны, несколько верных', t.pub.multi === true && t.pub.zones.map(z => z.label).join() === 'A,B,C' && t.pub.media[0].m === M1.key, t.pub);
  t = await tryQ(QH2.id, [z2('A'), z2('B')], t); check('hotspot: обе верные → 2', t.g.ap === 2, t.g);
  t = await tryQ(QH2.id, [z2('A')], t); check('hotspot: одна из двух → 1 (частично)', t.g.ap === 1, t.g);
  t = await tryQ(QH2.id, [z2('A'), z2('C')], t); check('hotspot: верная + неверная → 0', t.g.ap === 0, t.g);
  r = await mk({ type: 'hotspot', text: 'без картинки', zones: '0,0,10,10|a|*\n20,20,10,10|b' }); check('hotspot без изображения → 400', r.status === 400);
  r = await mk({ type: 'hotspot', text: 'зона за краем', media: [{ svg: SVG }], zones: '95,0,10,10|a|*\n0,0,10,10|b' }); check('hotspot: область за краем → 400', r.status === 400);
  // выбор изображения (варианты-картинки)
  r = await mk({ type: 'single', text: 'Какая схема правильная?', options: [{ text: 'Схема 1', correct: true, media: { m: M1.key } }, { text: 'Схема 2', media: { svg: SVG } }, { text: 'Схема 3', media: { svg: SVG.replace('#cde', '#ddd') } }] });
  t = await tryQ(r.d.question.id, null); check('варианты-изображения: у вариантов есть картинки', r.status === 200 && t.pub.options.every(o => o.media), t.pub);
  // соответствие изображение ↔ описание (через match + изображения в вопросе) и последовательность
  r = await mk({ type: 'match', text: 'Сопоставьте схемы (рис. 1, 2) и описания', media: [{ svg: SVG, alt: 'Рис. 1' }, { m: M1.key, alt: 'Рис. 2' }], pairs: [{ left: 'Рис. 1', right: 'Два квадрата' }, { left: 'Рис. 2', right: 'Точка' }] });
  check('соответствие изображение ↔ описание: 2 изображения сохранены', r.status === 200 && r.d.question.native.media.length === 2, r.d);
  r = await mk({ type: 'order', text: 'Последовательность по схеме', media: [{ svg: SVG }], items: ['Первое', 'Второе', 'Третье'] }); check('последовательность по схеме: создан', r.status === 200);
  // безопасность SVG
  for (const [bad, nm] of [['<svg onload="alert(1)"></svg>', 'обработчик'], ['<svg><script>alert(1)</script></svg>', 'script'], ['<svg><image href="https://evil/x.png"/></svg>', 'внешняя картинка'], ['<svg><a href="javascript:alert(1)">x</a></svg>', 'javascript:'], ['<div>не svg</div>', 'не svg'], ['<svg><foreignObject></foreignObject></svg>', 'foreignObject'], ['<svg style="background:url(https://x)"></svg>', 'url()']]) {
    r = await mk({ type: 'single', text: 'svg ' + nm, media: [{ svg: bad }], options: [{ text: 'a', correct: true }, { text: 'b' }] }); check('SVG отклонён: ' + nm, r.status === 400, r.d);
  }
  r = await call('DELETE', '/api/admin/media/' + M1.id, A); check('нельзя удалить изображение, которое используется (409)', r.status === 409, r.d);
  // поля вопроса: документ из проекта, сложность
  r = await mk({ type: 'single', text: 'чужой документ', source_doc: 'forum_post', options: [{ text: 'a', correct: true }, { text: 'b' }] }); check('документ не из проекта → 400', r.status === 400, r.d);
  r = await mk({ type: 'single', text: 'сложность 5', difficulty: 5, options: [{ text: 'a', correct: true }, { text: 'b' }] }); check('сложность вне 1–3 → 400', r.status === 400, r.d);
  r = await mk({ type: 'single', text: 'неизвестная база', base: 'zzz', options: [{ text: 'a', correct: true }, { text: 'b' }] }); check('неизвестная база → 400', r.status === 400, r.d);
  r = await mk({ type: 'single', text: 'Поля сохраняются', difficulty: 3, source_doc: 'uk', source_ref: 'ст. 37 ч. 1', quote: 'Не является преступлением…', material: 'Фрагмент', explanation: 'Пояснение', options: [{ text: 'a', correct: true }, { text: 'b' }, { text: 'c' }] });
  const QF = r.d.question; let q2 = (await call('GET', '/api/admin/bank?q=' + encodeURIComponent('Поля сохраняются'), A)).d.questions[0];
  check('поля вопроса сохранены: база, сложность, документ, пункт, цитата, фрагмент, баллы = 3', q2.base === 'vp' && q2.difficulty === 3 && q2.source_doc === 'uk' && q2.source_ref === 'ст. 37 ч. 1' && q2.quote && q2.material === 'Фрагмент' && q2.points === 3, q2);
  r = await call('PUT', `/api/admin/questions/${QF.id}`, A, { type: 'single', text: 'Поля сохраняются (правка без полей v2)', options: q2.options });
  q2 = (await call('GET', '/api/admin/bank?q=' + encodeURIComponent('правка без полей v2'), A)).d.questions[0];
  check('правка без полей v2 их не стирает', q2.base === 'vp' && q2.difficulty === 3 && q2.source_doc === 'uk', q2);
  r = await call('PUT', `/api/admin/questions/${QF.id}`, A, { ...q2, active: false }); q2 = (await call('GET', '/api/admin/bank?q=' + encodeURIComponent('правка без полей v2'), A)).d.questions[0];
  check('выключение вопроса', q2.active === false);
  r = await call('GET', '/api/admin/bank?base=vp&difficulty=3&source_doc=uk', A); check('фильтры банка: база + сложность + документ', r.d.total >= 1 && r.d.questions.every(q => q.base === 'vp' && q.difficulty === 3 && q.source_doc === 'uk'), r.d.total);
  r = await call('GET', '/api/admin/bank/check?base=vp', A);
  check('проверка привязки: находит длину-подсказку / нет цитаты / пропуски', r.status === 200 && r.d.items.some(x => x.issues.some(i => i.code === 'no_quote')), r.d && r.d.items.slice(0, 3));
  r = await call('POST', '/api/admin/bank/import', A, { data: { questions: [{ type: 'blanks_select', text: '3 варианта', content: 'Пропуск [[*а|б|в]]', base: 'vp', difficulty: 1, source_doc: 'du', source_ref: 'п. 1', category: 'Тест' }] } });
  r = await call('GET', '/api/admin/bank/check?base=vp', A); check('проверка привязки: «пропуск не из 4 вариантов» — ошибка', r.d.items.some(x => x.issues.some(i => i.code === 'blank_opts')), r.d.items.map(x => x.issues.map(i => i.code)));
  await sql("DELETE FROM questions WHERE category IN ('Тест механик', 'Тест')");

  // ---------- 4. базы и выборка ----------
  for (const [b, n] of [['simple', 30], ['medium', 45], ['full', 60], ['vp', 75], ['cases_int', 24], ['cases_gen', 36]]) {
    r = await call('POST', '/api/admin/bank/import', A, { data: { questions: synth(b, n, 'S') } });
    if (r.status !== 200) console.log(JSON.stringify(r.d).slice(0, 500));
  }
  r = await call('GET', '/api/admin/bank/stats', A);
  check('сводка базы: количество, сложность, типы, документы', r.d.bases.vp.active >= 75 && r.d.bases.vp.by_difficulty[1] >= 25 && r.d.bases.vp.by_type.single > 0 && r.d.bases.vp.by_doc.pk > 0 && r.d.bases.vp.by_topic.fz > 0, r.d.bases.vp);
  // режим по базе для старых видов (как после миграции контента)
  for (const [k, base, count, mix] of [['simple', 'simple', 12, [50, 50, 0]], ['full', 'full', 28, [20, 45, 35]], ['cases', 'cases_gen', 16, [15, 40, 45]]]) {
    r = await call('PUT', `/api/admin/reatt/${K(k).id}`, A, { mode: 'bank', cfg: { base, count, mix } }); check(`«${k}» переключён на базу ${base}`, r.status === 200 && r.d.item.mode === 'bank' && r.d.item.cfg.base === base, r.d);
  }
  const sameTopic = (rows) => { const m = {}; for (const q of rows) m[q] = (m[q] || 0) + 1; return m; };
  const VP = K('full_vp');
  r = await call('POST', `/api/admin/reatt/${VP.id}/preview`, A, {});
  check('пробная выборка ВП: 30 вопросов, 3/10/17 по сложности (10/35/55 % методом наибольших остатков)', r.d.total === 30 && r.d.comp.got[1] === 3 && r.d.comp.got[2] === 10 && r.d.comp.got[3] === 17, r.d.comp);
  check('ВП: ни одна тема не больше 30% (9 из 30)', Object.values(r.d.comp.by_topic).every(n => n <= 9), r.d.comp.by_topic);
  check('ВП: ни один тип не больше 40% (12 из 30)', Object.values(r.d.comp.by_type).every(n => n <= 12), r.d.comp.by_type);
  const prevIds = r.d.groups.flatMap(g => g.q.map(x => x.id));
  check('выборка: без повторов вопросов и пунктов документа', new Set(prevIds).size === prevIds.length && new Set(r.d.groups.flatMap(g => g.q.map(x => x.source_doc + x.source_ref))).size === prevIds.length);
  for (const [k, n, want] of [['simple', 12, [6, 6, 0]], ['medium', 20, [6, 10, 4]], ['full', 28, [5, 13, 10]], ['cases_int', 8, [2, 4, 2]], ['cases', 16, [2, 7, 7]]]) {
    r = await call('POST', `/api/admin/reatt/${K(k).id}/preview`, A, {});
    check(`пробная выборка «${k}»: ${n} вопросов, сложность ${want.join('/')}`, r.d.total === n && [1, 2, 3].every(d => r.d.comp.got[d] === want[d - 1]), r.d.comp);
  }
  // каждый параметр: сохранение и проверка
  const cfgAll = { base: 'vp', count: 15, mix: [20, 40, 40], pts: [1, 2.5, 4], topics: { pk: 3, uk: 1, vu: 0 }, types: ['single', 'multi', 'number'], max_topic_pct: 60, max_type_pct: 50, partial: 'off', pass_points: 20, unique_ref: false, avoid_repeat: false };
  r = await call('PUT', `/api/admin/reatt/${VP.id}`, A, { mode: 'bank', cfg: cfgAll, pass_pct: 65, time_limit_min: 45, cooldown_min: 5, max_attempts: 7, level: 4, track: 'line', title: 'Полная ВП (тест)', description: 'опис', enabled: true, visible: true, position: 41 });
  let one = (await call('GET', `/api/admin/reatt/${VP.id}`, A)).d.item;
  check('все параметры вида сохранены и читаются после перезагрузки', one.cfg.count === 15 && one.cfg.mix.join() === '20,40,40' && one.cfg.pts.join() === '1,2.5,4' && one.cfg.topics.pk === 3 && one.cfg.topics.vu === 0 && one.cfg.types.join() === 'single,multi,number'
    && one.cfg.max_topic_pct === 60 && one.cfg.max_type_pct === 50 && one.cfg.partial === 'off' && one.cfg.pass_points === 20 && one.cfg.unique_ref === false && one.cfg.avoid_repeat === false
    && one.pass_pct === 65 && one.time_limit_min === 45 && one.cooldown_min === 5 && one.max_attempts === 7 && one.title === 'Полная ВП (тест)' && one.position === 41, one);
  r = await call('POST', `/api/admin/reatt/${VP.id}/preview`, A, {});
  const pv = r.d.groups.flatMap(g => g.q);
  check('веса тем: ВУ (вес 0) и темы без веса исключены, только ПК и УК', pv.length > 0 && pv.every(x => ['pk', 'uk'].includes(x.source_doc)) && pv.some(x => x.source_doc === 'pk') && pv.some(x => x.source_doc === 'uk'), sameTopic(pv.map(x => x.source_doc)));
  check('типы: только выбранные', pv.every(x => ['single', 'multi', 'number'].includes(x.type)), sameTopic(pv.map(x => x.type)));
  check('баллы по сложности 1 / 2,5 / 4', pv.every(x => x.points === [1, 2.5, 4][x.difficulty - 1]), pv.map(x => [x.difficulty, x.points]));
  for (const [bad, nm] of [[{ ...cfgAll, mix: [50, 50, 10] }, 'сумма долей ≠ 100'], [{ ...cfgAll, base: 'nope' }, 'неизвестная база'], [{ ...cfgAll, topics: { zz: 1 } }, 'неизвестная тема'], [{ ...cfgAll, types: ['nope'] }, 'неизвестный тип'], [{ ...cfgAll, count: 0 }, 'количество 0'], [{ ...cfgAll, pts: [1, -1, 2] }, 'отрицательные баллы']]) {
    r = await call('PUT', `/api/admin/reatt/${VP.id}`, A, { mode: 'bank', cfg: bad }); check('валидация настроек: ' + nm + ' → 400', r.status === 400, r.d);
  }
  // проходной балл в баллах + режим частичных баллов «никогда»: 25 лёгких вопросов «несколько ответов»
  await call('POST', '/api/admin/bank/import', A, { data: { questions: Array.from({ length: 25 }, (_, i) => ({ ext_id: 't6-multi-' + i, base: 'vp', difficulty: 1, source_doc: DOCS[i % DOCS.length], source_ref: 'ст. ' + (100 + i), quote: 'ц', category: 'Тест multi',
    type: 'multi', text: `Отметьте верные утверждения набор${i}x вариант${i}y группа${i}z`, options: [{ text: 'Верно А' + i, correct: true }, { text: 'Верно Б' + i, correct: true }, { text: 'Неверно В' + i }, { text: 'Неверно Г' + i }] })) } });
  await call('PUT', `/api/admin/reatt/${VP.id}`, A, { mode: 'bank', cfg: { base: 'vp', count: 10, mix: [100, 0, 0], pts: [1, 2, 3], types: ['multi'], max_topic_pct: 0, max_type_pct: 0, partial: 'off', pass_points: 10 }, pass_pct: 50, cooldown_min: 0, max_attempts: 0 });
  r = await call('POST', `/api/admin/reatt/${VP.id}/access`, A, { user_id: U.c1, attempts: 5 }); check('доступ к Полной ВП выдан', r.status < 300, r.d);
  r = await call('POST', '/api/reatt/full_vp/start', C1); const AT1 = r.d.attempt_id; check('кандидат начал Полную ВП', r.status === 200 && AT1, r.d);
  let at = (await call('GET', '/api/attempts/' + AT1, C1)).d.attempt;
  check('при прохождении у вопроса виден документ-источник, но без номера пункта', at.questions.every(q => q.source && q.source.title && !q.source.ref), at.questions.map(q => q.source));
  check('попытка: 10 вопросов, баллы снимком по сложности', at.questions.length === 10 && at.questions.every(q => q.points === 1 && q.difficulty === 1), at.questions.map(q => [q.points, q.difficulty]));
  // отвечаем: 9 полностью верно, 1 — половина (частично не засчитывается в режиме «никогда»)
  const rows = await sql(`SELECT id, options, correct, data FROM questions WHERE id IN (${at.questions.map(q => q.id).join(',')})`);
  const ans = {}; rows.forEach((q, i) => { const c = JSON.parse(q.correct); ans[q.id] = i === 0 ? [c[0]] : c; });
  r = await call('POST', `/api/attempts/${AT1}/submit`, C1, { answers: ans });
  at = (await call('GET', '/api/attempts/' + AT1, C1)).d.attempt;
  check('итог: 9 из 10 баллов, 90%, но проходной 10 баллов → НЕ СДАН', at.status === 'failed' && at.score === 9 && at.max_score === 10 && at.score_pct === 90, at);
  check('кандидат видит баллы и проходной в баллах', at.exam.pass_points === 10, at.exam);
  check('разбор после отправки: по каждому вопросу итог и источник (документ + пункт)', Array.isArray(at.review) && at.review.length === 10 && at.review.every(x => x.source && x.source.title && x.source.ref && ['correct', 'wrong'].includes(x.result)), at.review && at.review.slice(0, 2));
  check('разбор: множественный выбор — засчитывается только полностью верный набор (9 верно, 1 неверно)', at.review && at.review.filter(x => x.result === 'correct').length === 9 && at.review.filter(x => x.result === 'wrong').length === 1, at.review && at.review.map(x => x.result));
  check('разбор не раскрывает правильные варианты', at.review && !/"correct":\[|"options"/.test(JSON.stringify(at.review)), at.review && at.review[0]);
  await call('PUT', `/api/admin/reatt/${VP.id}`, A, { mode: 'bank', cfg: { base: 'vp', count: 10, mix: [100, 0, 0], types: ['multi'], max_topic_pct: 0, max_type_pct: 0, partial: 'on', pass_points: 9 } });
  r = await call('POST', '/api/reatt/full_vp/start', C1); const AT2 = r.d.attempt_id; at = (await call('GET', '/api/attempts/' + AT2, C1)).d.attempt;
  const rows2 = await sql(`SELECT id, correct FROM questions WHERE id IN (${at.questions.map(q => q.id).join(',')})`);
  const ans2 = {}; rows2.forEach((q, i) => { const c = JSON.parse(q.correct); ans2[q.id] = i === 0 ? [c[0]] : c; });
  await call('POST', `/api/attempts/${AT2}/submit`, C1, { answers: ans2 }); at = (await call('GET', '/api/attempts/' + AT2, C1)).d.attempt;
  // в выборку могут попасть и вопросы базы (не только синтетические с двумя верными) — доля частичного балла = 1 / число верных вариантов первого вопроса
  const part = Math.round((9 + 1 / JSON.parse(rows2[0].correct).length) * 100) / 100;
  check(`частичные «всегда»: ${part} из 10, проходной 9 б. → СДАН`, at.status === 'passed' && Math.abs(at.score - part) < 0.011 && Math.abs(at.score_pct - part * 10) < 0.11, at);
  const ov = at.id && (await sql(`SELECT q_order FROM attempts WHERE id IN (${AT1}, ${AT2})`)).map(x => JSON.parse(x.q_order));
  const inter = ov[0].filter(x => ov[1].includes(x)).length;
  check('разнообразие: во второй попытке вопросы первой — в последнюю очередь (пересечение ≤ 2 из 10)', inter <= 2, inter);
  // попытка не меняется при изменении настроек после старта (снимок)
  const meta = JSON.parse((await sql(`SELECT meta FROM attempts WHERE id = ${AT2}`))[0].meta);
  check('снимок попытки: база, состав по сложности, группы по темам', meta.mode === 'bank' && meta.base === 'vp' && meta.comp && meta.groups.length >= 1, meta);
  r = await call('GET', '/api/admin/attempts/' + AT2, A); check('админ видит попытку со сводкой по темам', r.status === 200 && r.d.groups && r.d.groups.length >= 1, r.d && r.d.groups);

  // ---------- 5. доступ (🔑) для всех 6 видов ----------
  r = await call('GET', '/api/reatt', C2); check('без доступа кандидат не видит ни одного вида', r.d.versions.length === 0, r.d.versions.map(v => v.key));
  for (const k of ['simple', 'medium', 'full', 'full_vp', 'cases_int', 'cases']) {
    r = await call('POST', `/api/admin/reatt/${K(k).id}/access`, A, { user_id: U.c2, attempts: 1, expires_at: Date.now() + 3600e3 }); check(`🔑 доступ к «${k}» выдан (срок, 1 попытка)`, r.status < 300 && r.d.grant, r.d);
  }
  r = await call('GET', '/api/reatt', C2);
  check('кандидат видит все 6, с иерархией (track/level)', r.d.versions.length === 6 && r.d.versions.find(v => v.key === 'medium').level === 2 && r.d.versions.find(v => v.key === 'cases_int').track === 'cases', r.d.versions.map(v => [v.key, v.track, v.level]));
  for (const k of ['simple', 'medium', 'full', 'cases_int', 'cases']) {
    r = await call('POST', `/api/reatt/${k}/start`, C2); const id = r.d && r.d.attempt_id; at = id && (await call('GET', '/api/attempts/' + id, C2)).d.attempt;
    const need = { simple: 12, medium: 20, full: 28, cases_int: 8, cases: 16 }[k];
    check(`«${k}»: попытка из своей базы, ${need} вопросов`, at && at.questions.length === need, at && at.questions.length);
    const bases = id && await sql(`SELECT DISTINCT base FROM questions WHERE id IN (${at.questions.map(q => q.id).join(',')})`);
    check(`«${k}»: все вопросы — из базы ${K(k).cfg ? K(k).cfg.base : '(после переключения)'}`, bases && bases.length === 1 && bases[0].base === ({ simple: 'simple', medium: 'medium', full: 'full', cases_int: 'cases_int', cases: 'cases_gen' })[k], bases);
    await call('POST', `/api/attempts/${id}/submit`, C2, { answers: {} });
    r = await call('POST', `/api/reatt/${k}/start`, C2); check(`«${k}»: вторая попытка сверх лимита выдачи → 403`, r.status === 403, r.d);
  }

  // ---------- 6. прежний режим «по блокам» сохранён ----------
  r = await call('POST', '/api/admin/reatt', A, { title: 'Блочная (тест)', mode: 'groups', groups: [{ label: 'ВУ', categories: ['Тест v2 — simple'], questions: 3, cases: 0 }] });
  check('создание переаттестации по блокам (прежний режим) работает', r.status === 201 && r.d.item.mode === 'groups', r.d);
  r = await call('POST', `/api/admin/reatt/${r.d.item.id}/preview`, A, {}); check('пробная выборка по блокам: 3 вопроса', r.d.total === 3, r.d);

  // ---------- 7. UI ----------
  const b = await chromium.launch(); const errs = [];
  async function page(tok) { const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } }); if (tok) await ctx.addInitScript(t => { localStorage.setItem('vpexam_token', t); }, tok); const p = await ctx.newPage();
    p.on('pageerror', e => errs.push(e.message)); p.on('dialog', d => d.accept()); return p; }
  const go = async (p, h, sel) => { await p.goto(SITE + '#' + h); await p.waitForSelector(sel, { timeout: 15000 }); await p.waitForTimeout(250); };
  const PA = await page(A);
  await go(PA, '/admin/reatt', '.reatt-admin-list');
  let txt = await PA.textContent('.reatt-admin-list');
  check('UI: список — «Основная линия» и «Кейсы», уровни', /Основная линия/.test(txt) && /Кейсы \(отдельная категория\)/.test(txt) && /уровень 4/.test(txt), txt.slice(0, 300));
  check('UI: у всех видов есть кнопка «🔑 Доступ»', (await PA.$$eval('.ritem', els => els.filter(e => /🔑 Доступ/.test(e.textContent)).length)) === (await PA.$$('.ritem')).length);
  await PA.screenshot({ path: SHOTS + 'reatt6-admin-list.png', fullPage: true });
  await go(PA, '/admin/reatt/' + K('medium').id, '#rf');
  await PA.fill('.c-count', '18'); await PA.fill('.c-mix[data-i="0"]', '40'); await PA.fill('.c-mix[data-i="1"]', '40'); await PA.fill('.c-mix[data-i="2"]', '20');
  await PA.fill('.c-pts[data-i="2"]', '5'); await PA.fill('.c-mtp', '33'); await PA.fill('.c-myp', '44'); await PA.selectOption('.c-partial', 'on'); await PA.fill('.c-pp', '12');
  await PA.click('.c-topics-w summary'); const tw = await PA.$('.c-tw[data-k="vu"]'); if (tw) await tw.fill('2');
  await PA.fill('input[name=pass_pct]', '72');
  await PA.click('#rf button.gold'); await PA.waitForTimeout(800);
  await PA.reload(); await PA.waitForSelector('#rf'); await PA.waitForTimeout(300);
  const ui = await PA.evaluate(() => ({ count: document.querySelector('.c-count').value, mix: [...document.querySelectorAll('.c-mix')].map(x => x.value).join(), p3: document.querySelector('.c-pts[data-i="2"]').value, mtp: document.querySelector('.c-mtp').value, myp: document.querySelector('.c-myp').value, partial: document.querySelector('.c-partial').value, pp: document.querySelector('.c-pp').value, pass: document.querySelector('input[name=pass_pct]').value, vu: (document.querySelector('.c-tw[data-k="vu"]') || {}).value }));
  check('UI: настройки вида сохраняются и видны после перезагрузки', ui.count === '18' && ui.mix === '40,40,20' && ui.p3 === '5' && ui.mtp === '33' && ui.myp === '44' && ui.partial === 'on' && ui.pp === '12' && ui.pass === '72' && ui.vu === '2', ui);
  await PA.click('.g-prev'); await PA.waitForSelector('.r6-prev', { timeout: 10000 }); txt = await PA.textContent('.r6-prev');
  check('UI: пробная выборка из базы показывает сложность и темы', /выбрано/.test(txt) && /По темам/.test(txt), txt.slice(0, 200));
  await PA.screenshot({ path: SHOTS + 'reatt6-admin-edit.png', fullPage: true });
  await go(PA, '/admin/bases', '.r6-stats'); txt = await PA.textContent('body');
  check('UI: «Базы и источники» — 6 баз и документы', ['Внутренние кейсы', 'Общие кейсы', 'Упрощённая', 'Средняя', 'Полная общая', 'Полная ВП'].every(x => txt.includes(x)) && /ФКЗ об особых правовых режимах/.test(txt));
  await PA.click('#chkGo'); await PA.waitForFunction(() => /Проверено вопросов/.test(document.querySelector('#chkOut').textContent), null, { timeout: 15000 });
  check('UI: проверка привязки запускается', /Проверено вопросов/.test(await PA.textContent('#chkOut')));
  await go(PA, '/admin/media', '.r6-stats'); check('UI: страница изображений — список с превью', (await PA.$$('.r6-stats img')).length >= 1);
  // редактор вопроса: поля базы, загрузка изображения, hotspot
  await go(PA, '/admin/bank?base=vp', '#blist');
  await PA.selectOption('#newTypeB', 'hotspot'); await PA.click('#addB'); await PA.waitForSelector('#newBox .qform');
  const nb = await PA.$('#newBox');
  check('UI: новый вопрос в фильтре базы — база и сложность подставлены', (await nb.$eval('.e-base', x => x.value)) === 'vp' && (await nb.$eval('.e-diff', x => x.value)) === '2');
  await (await nb.$('.e-text')).fill('UI: где левая область?');
  await nb.$eval('.e-doc', x => { x.value = 'su'; }); await (await nb.$('.e-ref6')).fill('п. 5'); await (await nb.$('.e-quote')).fill('цитата');
  const fileInput = await nb.$('.e-mfile'); await fileInput.setInputFiles({ name: 'p.png', mimeType: 'image/png', buffer: Buffer.from(PNG2, 'base64') });
  await PA.waitForFunction(() => document.querySelector('#newBox .e-mitem img'), null, { timeout: 10000 });
  await nb.$eval('.e-type', x => { x.dispatchEvent(new Event('change')); });
  await PA.waitForTimeout(200);
  await (await nb.$('.e-zones')).fill('0, 0, 50, 100 | Левая | *\n50, 0, 50, 100 | Правая');
  await (await nb.$('.save')).click(); await PA.waitForTimeout(800);
  const made = await sql("SELECT id, base, source_doc, source_ref, data FROM questions WHERE text = 'UI: где левая область?'");
  check('UI: вопрос по изображению создан из редактора (загрузка изображения + области)', made.length === 1 && made[0].base === 'vp' && made[0].source_doc === 'su' && JSON.parse(made[0].data).zones.length === 2 && JSON.parse(made[0].data).media[0].m, made);
  // кандидат: попытка с вопросом по изображению и фрагментом документа
  await sql("UPDATE questions SET active = 0 WHERE base = 'cases_int'");
  await sql(`UPDATE questions SET active = 1, base = 'cases_int', difficulty = 2 WHERE id = ${made[0].id}`);
  await call('POST', '/api/admin/bank', A, { category: 'UI', base: 'cases_int', difficulty: 1, source_doc: 'kps', source_ref: 'ст. 2', type: 'single', text: 'UI: фрагмент', material: 'Часовой есть лицо неприкосновенное.', options: [{ text: 'Неприкосновенное', correct: true }, { text: 'Подотчётное' }, { text: 'Временное' }] });
  await call('PUT', `/api/admin/reatt/${K('cases_int').id}`, A, { mode: 'bank', cfg: { base: 'cases_int', count: 2, mix: [50, 50, 0] } });
  await call('POST', `/api/admin/reatt/${K('cases_int').id}/access`, A, { user_id: U.c1, attempts: 2 });
  const PC = await page(C1); await go(PC, '/reatt', '.reatt-card');
  txt = await PC.textContent('#view, body'); check('UI кандидата: линия и кейсы с заголовками', /Основная линия/.test(txt) && /Кейсы/.test(txt), txt.slice(0, 200));
  await PC.screenshot({ path: SHOTS + 'reatt6-cand-list.png', fullPage: true });
  await PC.click('.startR[data-v="cases_int"]'); await PC.waitForSelector('#examForm', { timeout: 15000 }); await PC.waitForTimeout(500);
  check('UI кандидата: фрагмент документа показан', /Часовой есть лицо неприкосновенное/.test(await PC.textContent('#examForm')));
  const imgOk = await PC.$eval('.hs-wrap img', im => im.complete && im.naturalWidth > 0).catch(() => false);
  check('UI кандидата: изображение загружено с /media/', imgOk);
  await PC.click('.hs-zone >> nth=0'); await PC.waitForTimeout(100);
  check('UI кандидата: клик по области отмечает её', (await PC.$$('.hs-zone.on')).length === 1);
  await PC.check('.opt input >> nth=0').catch(() => {});
  await PC.screenshot({ path: SHOTS + 'reatt6-cand-attempt.png', fullPage: true });
  await PC.click('#submitBtn'); await PC.waitForSelector('.result', { timeout: 15000 });
  txt = await PC.textContent('.result'); check('UI кандидата: результат с баллами «N из M балл(ов)»', /из \d+ балл/.test(txt), txt);
  check('UI без ошибок JS', !errs.length, errs);
  await b.close();
  const ok = results.filter(x => x.ok).length;
  console.log(`\nИТОГО: ${ok}/${results.length} PASS`);
  fs.writeFileSync(__dirname + '/e2e-reatt6-results.json', JSON.stringify(results, null, 1));
  process.exit(ok === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(2); });
