// Генерирует SQL для загрузки файлов законов (laws/<code>.json) в банк переаттестации напрямую в D1 (upsert по ext_id).
// Нормализация — те же importItems()/questionInput(), что и в API импорта. Запуск: node tools/gen-law-sql.js <laws_dir> <out.json>
// Результат: JSON-массив SQL-пакетов (каждый — набор UPDATE+INSERT … WHERE NOT EXISTS).
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../worker/worker.js'), 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '');
const W = new Function(src + '\nreturn { questionInput, importItems };')();
const dir = process.argv[2], out = process.argv[3];
const q = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const now = Date.now();
const stm = [], counts = {};
let pos = 1000;
for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.json')).sort()) {
  const items = W.importItems(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
  for (const it of items) {
    const o = W.questionInput(it, null); pos += 10;
    if (!o.category || !o.ext_id) throw new Error('нет category/ext_id: ' + f);
    const k = o.category + ' / ' + (o.kind === 'case' ? 'кейсы' : 'вопросы'); counts[k] = (counts[k] || 0) + 1;
    stm.push(`UPDATE questions SET type=${q(o.type)}, text=${q(o.text)}, options=${q(JSON.stringify(o.options))}, correct=${q(JSON.stringify(o.correct))}, reference=${q(o.reference)}, points=${o.points}, data=${q(JSON.stringify(o.data))}, category=${q(o.category)}, kind=${q(o.kind)}, easy=${o.easy}, active=1, updated_at=${now} WHERE exam_id=0 AND ext_id=${q(o.ext_id)};\n` +
      `INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at) SELECT 0, ${q(o.type)}, ${q(o.text)}, ${q(JSON.stringify(o.options))}, ${q(JSON.stringify(o.correct))}, ${q(o.reference)}, ${o.points}, ${pos}, ${q(JSON.stringify(o.data))}, ${q(o.category)}, ${q(o.kind)}, ${o.easy}, 1, ${q(o.ext_id)}, ${now}, ${now} WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id=0 AND ext_id=${q(o.ext_id)});`);
  }
}
const batches = []; let cur = '';
for (const s of stm) { if (cur.length + s.length > 90000) { batches.push(cur); cur = ''; } cur += s + '\n'; }
if (cur) batches.push(cur);
fs.writeFileSync(out, JSON.stringify(batches));
console.log(JSON.stringify({ items: stm.length, batches: batches.length, bytes: batches.reduce((a, b) => a + b.length, 0), counts }, null, 1));
