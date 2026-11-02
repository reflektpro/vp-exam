// Пересчёт хэшей реестра по строкам БД (однократно, при смене функции хэша): node tools/reatt6/rehash.js rows.json
// rows.json — SELECT * FROM questions WHERE ext_id LIKE 'r6-%' (например, из локальной D1 после миграций).
const fs = require('fs'), path = require('path');
const { hashOf } = require('./hash');
const REG_PATH = path.join(__dirname, '../../content/reatt6/registry.json');
const reg = JSON.parse(fs.readFileSync(REG_PATH, 'utf8'));
const rows = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const byExt = new Map(rows.map(r => [r.ext_id, r]));
let n = 0, miss = 0;
for (const [orig, it] of Object.entries(reg.items)) { const r = byExt.get(it.ext_id); if (!r) { miss++; continue; } it.hash = hashOf(r); n++; }
fs.writeFileSync(REG_PATH, JSON.stringify(reg, null, 0).replace(/\},"/g, '},\n"'));
console.log('rehashed', n, 'missing', miss);
