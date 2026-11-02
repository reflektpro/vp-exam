// Хэш содержимого вопроса базы переаттестации — без случайных id вариантов/элементов (они заменяются порядковыми метками),
// чтобы пересборка без изменений не создавала новых версий. Принимает и объект questionInput, и строку таблицы questions.
const crypto = require('crypto');
const J = (v) => { if (typeof v !== 'string') return v; try { return JSON.parse(v); } catch (_) { return v; } };
function hashOf(o) {
  let s = JSON.stringify([o.type, o.text, J(o.options), J(o.correct), J(o.data), o.reference || null, o.points, o.difficulty, o.source_doc, o.source_ref, o.base, o.category, o.kind, o.topic || null]);
  const ids = []; s.replace(/"id":"([^"]+)"/g, (m, id) => { if (!ids.includes(id)) ids.push(id); return m; });
  ids.forEach((id, k) => { s = s.split('"' + id + '"').join('"#' + k + '"'); });
  return crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
}
module.exports = { hashOf };
