// Конвертер банка вопросов по уставам (markdown) → JSON для импорта (POST /api/admin/bank/import или tools/gen-law-sql.js).
// Запуск: node tools/ustav-md2json.js <file.md|dir> [<out_dir>]   (по умолчанию JSON кладётся рядом с .md: du.md → du.json)
//
// Формат входа: блоки «### DU-001» (вопросы) и «### DU-К01» (кейсы), поля строками «- **Поле:** значение» (значение может
// продолжаться на следующих строках). Поля вопроса: Устав, Пункт, Формат, Сложность, Теги, Вопрос, Варианты (подсписок
// «  - A) …» / «  - 1) …» / «  - а) …»), Правильный ответ, Цитата (может повторяться). Поля кейса: Ситуация, Вопрос,
// Эталонный ответ, Ссылки, Критерии оценки («полный — X + Y + Z; частично — …; 0 — …»).
//
// Соответствие форматов: один ответ → single (буква → индекс), несколько ответов → multi («A, C»), ввод числа → number,
// порядок действий → order («C → A → B» → индексы), соответствие → match (левые «1)…», правые «а)…»; «1 — в; 2 — б»;
// неиспользованные правые → лишние варианты; если правых вариантов нет в списке, берутся из текста вопроса: «смягчающим (С)»).
// Тег «не душный» → easy. Пункт → article; цитаты → quote; «Устав, п. …: «цитата»» → explanation; Сложность → difficulty.
// Кейс: критерии «полный» разбиваются по « + » (или по запятым, если частей ≥ 3) на пункты с баллами (сумма = 10);
// если разбить нельзя — два уровня: «Полный ответ: …» (10) и «Частично: …» (5). Полная шкала дописывается к эталону.
const fs = require('fs'), path = require('path');
const CAT = { DU: 'ДУ', VU: 'ВУ', SU: 'СУ', KPS: 'КПС' };
const MAX_CASE = 10;
const LAT = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', CYR = 'абвгдежзиклмнопрст';

function parseBlocks(md) {
  const blocks = md.split(/^### /m).slice(1);
  return blocks.map(b => {
    const [head, ...rest] = b.split('\n');
    const id = head.trim(); const fields = {}; let cur = null;
    for (const line of rest) {
      if (/^---\s*$/.test(line) || /^## /.test(line)) { cur = null; continue; }
      const m = /^- \*\*(.+?):\*\*\s?(.*)$/.exec(line);
      if (m) { cur = m[1]; (fields[cur] = fields[cur] || []).push(m[2]); continue; }
      if (cur && fields[cur]) fields[cur][fields[cur].length - 1] += '\n' + line;
    }
    for (const k in fields) fields[k] = fields[k].map(v => v.replace(/\s+$/, ''));
    return { id, fields };
  });
}
const one = (f, k) => (f[k] && f[k][0] || '').trim();
function optionLines(raw) {
  return raw.split('\n').map(l => /^\s*-\s+(\S{1,3})\)\s+(.*)$/.exec(l)).filter(Boolean).map(m => ({ label: m[1], text: m[2].trim() }));
}
function splitTop(s, sep) {   // разбиение вне скобок и кавычек
  const out = []; let depth = 0, cur = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if ('(«'.includes(c)) depth++; else if (')»'.includes(c)) depth = Math.max(0, depth - 1);
    if (!depth && s.startsWith(sep, i)) { out.push(cur); cur = ''; i += sep.length - 1; continue; }
    cur += c;
  }
  out.push(cur); return out.map(x => x.trim()).filter(Boolean);
}
function caseCriteria(raw) {
  const t = raw.replace(/\s+/g, ' ').trim().replace(/\.$/, '');
  const m = /^полн\S*(?: балл)?\s*[—-]\s*(.*?)(?:;\s*частично\s*[—-]\s*(.*?))?(?:;\s*0\s*[—-]\s*(.*))?$/i.exec(t);
  if (!m) return null;
  const full = m[1].trim(), partial = (m[2] || '').trim();
  let parts = splitTop(full, ' + ');
  if (parts.length < 2) { const c = splitTop(full, ', '); if (c.length >= 3) parts = c; }
  if (parts.length >= 2) {
    const base = Math.floor(MAX_CASE / parts.length); let rem = MAX_CASE - base * parts.length;
    return parts.map(p => ({ text: p.charAt(0).toUpperCase() + p.slice(1), points: base + (rem-- > 0 ? 1 : 0) }));
  }
  const crit = [{ text: 'Полный ответ: ' + full, points: MAX_CASE }];
  if (partial) crit.push({ text: 'Частично (вместо полного): ' + partial, points: MAX_CASE / 2 });
  return crit;
}
function convertQuestion(id, f, cat) {
  const fmt = one(f, 'Формат').toLowerCase(), ans = one(f, 'Правильный ответ');
  const tags = (f['Теги'] || []).join(' ');
  const quotes = (f['Цитата'] || []).map(x => x.trim());
  const ustav = one(f, 'Устав') || cat, punkt = one(f, 'Пункт');
  const q = { ext_id: id.toLowerCase().replace(/к/gi, 'k'), category: cat, kind: 'question', points: 1,
    easy: /не душный/i.test(tags), text: (f['Вопрос'] || []).join('\n').trim(),
    article: `${ustav}, п. ${punkt}`, quote: quotes.join('\n'), difficulty: one(f, 'Сложность'),
    explanation: `${ustav}, п. ${punkt}: ${quotes.join(' ')}` };
  const opts = optionLines((f['Варианты'] || []).join('\n'));
  const letIdx = (L) => { const i = LAT.indexOf(L.toUpperCase()); if (i < 0 || i >= opts.length) throw new Error('неизвестная буква ответа ' + L); return i; };
  if (!q.text) throw new Error('нет текста вопроса');
  switch (fmt) {
    case 'один ответ': { const L = ans.split(/[,\s]+/).filter(Boolean); if (L.length !== 1) throw new Error('один ответ: ожидается одна буква, получено «' + ans + '»'); q.type = 'single'; q.options = opts.map(o => o.text); q.correct = letIdx(L[0]); break; }
    case 'несколько ответов': { const L = ans.split(/[,\s]+/).filter(Boolean); if (!L.length) throw new Error('нет ответа'); q.type = 'multi'; q.options = opts.map(o => o.text); q.correct = L.map(letIdx); break; }
    case 'ввод числа': { const n = Number(ans.replace(',', '.').replace(/\s/g, '')); if (!Number.isFinite(n)) throw new Error('ввод числа: ответ не число «' + ans + '»'); q.type = 'number'; q.answer = n; q.tolerance = 0; break; }
    case 'порядок действий': { const L = ans.split(/\s*(?:→|->|,)\s*/).filter(Boolean); if (L.length !== opts.length) throw new Error('порядок: число элементов ответа ≠ числу вариантов'); q.type = 'order'; q.items = L.map(x => opts[letIdx(x)].text); break; }
    case 'соответствие': {
      const left = opts.filter(o => /^\d+$/.test(o.label)), right = opts.filter(o => !/^\d+$/.test(o.label));
      const rmap = new Map(right.map(o => [o.label.toLowerCase(), o.text]));
      const pairs = []; const used = new Set();
      for (const part of ans.split(';').map(x => x.trim()).filter(Boolean)) {
        const m = /^(\d+)\s*[—-]\s*(\S+)$/.exec(part); if (!m) throw new Error('соответствие: не разобран фрагмент «' + part + '»');
        const l = left.find(o => o.label === m[1]); if (!l) throw new Error('соответствие: нет левого элемента ' + m[1]);
        const lab = m[2].toLowerCase(); let rt = rmap.get(lab);
        if (!rt) {   // правые варианты не перечислены — ищем «слово (X)» в тексте вопроса
          const mm = new RegExp('([А-Яа-яЁё-]+)\\s*\\(' + m[2] + '\\)').exec(q.text);
          if (!mm) throw new Error('соответствие: нет правого варианта ' + m[2]);
          rt = mm[1].charAt(0).toUpperCase() + mm[1].slice(1) + ' (' + m[2] + ')'; rmap.set(lab, rt);
        }
        used.add(lab); pairs.push({ left: l.text, right: rt });
      }
      if (pairs.length !== left.length) throw new Error('соответствие: не для всех левых элементов задан ответ');
      q.type = 'match'; q.pairs = pairs; q.distractors = right.filter(o => !used.has(o.label.toLowerCase())).map(o => o.text);
      break;
    }
    default: throw new Error('неизвестный формат «' + fmt + '»');
  }
  if (['single', 'multi'].includes(q.type) && opts.length < 2) throw new Error('мало вариантов');
  return q;
}
function convertCase(id, f, cat) {
  const sit = (f['Ситуация'] || []).join('\n').trim(), qq = (f['Вопрос'] || []).join('\n').trim();
  const ref = (f['Эталонный ответ'] || []).join('\n').trim(), crit = (f['Критерии оценки'] || []).join(' ').trim();
  if (!sit || !qq || !ref) throw new Error('кейс: нет ситуации/вопроса/эталона');
  const criteria = caseCriteria(crit); if (!criteria) throw new Error('кейс: не разобраны критерии «' + crit.slice(0, 80) + '»');
  const refs = one(f, 'Ссылки');
  return { ext_id: id.toLowerCase().replace(/к/gi, 'k'), category: cat, kind: 'case', type: 'case', easy: false,
    text: `Ситуация: ${sit}\n\nВопрос: ${qq}`, reference: ref + (crit ? `\n\nШкала оценки: ${crit}` : ''), criteria, max_score: MAX_CASE, points: MAX_CASE,
    article: refs ? `${cat}, п. ${refs}` : '', explanation: crit };
}
function convertFile(file) {
  const md = fs.readFileSync(file, 'utf8');
  const code = path.basename(file, '.md').toLowerCase();
  const prefix = code.toUpperCase();
  const cat = CAT[prefix]; if (!cat) throw new Error('неизвестный устав: ' + code);
  const questions = [], skipped = [];
  for (const { id, fields } of parseBlocks(md)) {
    if (!id.startsWith(prefix + '-')) continue;
    try { questions.push(/-К\d+/i.test(id) ? convertCase(id, fields, cat) : convertQuestion(id, fields, cat)); }
    catch (e) { skipped.push({ id, reason: e.message }); }
  }
  return { format: 'vp-exam-questions/1', code, category: cat, source: path.basename(file), questions, skipped };
}
if (require.main === module) {
  const inp = process.argv[2], outDir = process.argv[3];
  if (!inp) { console.error('usage: node tools/ustav-md2json.js <file.md|dir> [out_dir]'); process.exit(2); }
  const files = fs.statSync(inp).isDirectory() ? fs.readdirSync(inp).filter(f => f.endsWith('.md')).map(f => path.join(inp, f)) : [inp];
  for (const f of files.sort()) {
    const r = convertFile(f); const out = path.join(outDir || path.dirname(f), r.code + '.json');
    fs.writeFileSync(out, JSON.stringify(r, null, 1));
    const nq = r.questions.filter(x => x.kind === 'question'), nc = r.questions.filter(x => x.kind === 'case');
    console.log(`${r.category}: вопросов ${nq.length} (easy ${nq.filter(x => x.easy).length}), кейсов ${nc.length}, пропущено ${r.skipped.length} → ${out}`);
    for (const s of r.skipped) console.log('   пропущен', s.id, '—', s.reason);
  }
}
module.exports = { convertFile, parseBlocks, caseCriteria };
