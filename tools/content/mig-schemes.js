// Миграция «схемы в лекциях и выгрузках»: для каждой вставленной схемы — UPDATE … SET body = replace(body, <строка перед схемой>, <строка> + блок схемы).
// Короткие операторы (лимит D1 на размер оператора), повторное применение ничего не меняет (проверка instr по строке подписи).
// Запуск после node tools/content/build.js: node tools/content/mig-schemes.js 0026_lecture_schemes.sql
const fs = require('fs'), path = require('path');
const C = JSON.parse(fs.readFileSync(path.join(__dirname, '../../content/build/content.json'), 'utf8'));
const name = process.argv[2]; if (!name) throw new Error('имя файла миграции');
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const FENCE = /\n\n(```схема [^\n]*)\n<svg[^\n]*<\/svg>\n```(?=\n|$)/g;
const strip = (s) => s.replace(FENCE, '');
const TS = Date.now();
const out = [`-- Схемы (SVG, нарисованы кодом: tools/content/schemes.py) в лекциях и полных выгрузках тем. Сгенерировано tools/content/mig-schemes.js.`,
  `-- Тексты лекций не меняются: только вставка блоков «\`\`\`схема» после нужных абзацев. Повторное применение ничего не меняет.`];
const stat = { lectures: [], docs: [] };
function rowStatements(table, where, body, label) {
  const old = strip(body); let cur = old; const parts = [];
  for (const m of body.matchAll(FENCE)) {
    const blk = m[0];                                   // "\n\n```схема …\n<svg…>\n```"
    const at = body.indexOf(blk); const before = body.slice(0, at); const anchor = before.slice(before.lastIndexOf('\n') + 1);
    if (!anchor || cur.split(anchor).length !== 2) throw new Error(`${label}: строка перед схемой не уникальна: ${anchor.slice(0, 60)}`);
    cur = cur.replace(anchor, () => anchor + blk);
    parts.push(`UPDATE ${table} SET body = replace(body, ${q(anchor)}, ${q(anchor + blk)}) WHERE ${where} AND instr(body, ${q(m[1])}) = 0;`);
  }
  if (cur !== body) throw new Error(`${label}: последовательная вставка не даёт итоговый текст`);
  if (parts.length) { out.push(`-- ${label}: схем ${parts.length}`, ...parts, `UPDATE ${table} SET updated_at = ${TS} WHERE ${where} AND instr(body, '\`\`\`схема') > 0 AND updated_at < ${TS};`); }
  return parts.length;
}
for (const t of C) {
  if (t.keep_lectures) continue;
  const nd = rowStatements('docs', `title = ${q(t.doc.title)}`, t.doc.body, `${t.slug} — выгрузка`); if (nd) stat.docs.push([t.slug, nd]);
  for (const l of t.lectures) {
    const n = rowStatements('lectures', `title = ${q(l.title)} AND topic_id = (SELECT id FROM topics WHERE slug = ${q(t.slug)})`, l.body, `${t.slug} — ${l.title}`);
    if (n) stat.lectures.push([t.slug, l.title, n]);
  }
}
const sql = out.join('\n') + '\n';
fs.writeFileSync(path.join(__dirname, '../../worker/migrations', name), sql);
const longest = Math.max(...sql.split('\n').map(l => Buffer.byteLength(l)));
console.log(JSON.stringify({ file: name, statements: sql.split('\n').filter(l => /^UPDATE/.test(l)).length, bytes: Buffer.byteLength(sql), longest, stat }, null, 1));
