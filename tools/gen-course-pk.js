// Курс «По задержанию и процессуальному кодексу»: материалы бота-законника (каталог с lectures/*.md и questions.json, формат — FORMAT.md)
// → SQL для D1 (идемпотентно: курс и лекции — по названию, вопросы — upsert по ext_id, экзамен — по названию).
// Нормализация вопросов — те же importItems()/questionInput(), что и в API импорта (типы single→single, multiple→multi, number, match, order).
// Запуск: python3 <dir>/validate.py && node tools/gen-course-pk.js <dir> <out.json> [--json <questions.out.json>]
// Результат: JSON { batches: [sql…], summary }. Резерв (tools/reserve_questions.json) не импортируется.
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '../worker/worker.js'), 'utf8').replace(/export default \{[\s\S]*?\n\};\n/, '');
const W = new Function(src + '\nreturn { questionInput, importItems };')();
const dir = process.argv[2], out = process.argv[3];
if (!dir || !out) { console.error('usage: node tools/gen-course-pk.js <dir> <out.json>'); process.exit(1); }

const COURSE = 'По задержанию и процессуальному кодексу';
const CATEGORY = 'ПК — задержание (ВП)';
const EXAM = {
  title: 'По задержанию и процессуальному кодексу',
  description: 'Итоговый экзамен курса. 25 случайных вопросов из банка курса (в одной попытке — не больше одного варианта каждого вопроса), варианты перемешаны.\nТипы: один ответ, несколько ответов (засчитывается только точное совпадение), число, соответствие, последовательность.\nОткрывается после всех пяти лекций курса.',
  time_limit_min: 40, max_attempts: 0, cooldown_min: 60, pass_pct: 70, bank_count: 25,
};
const COURSE_DESC = 'Процессуальный кодекс и смежные нормы (УК, УПК, КоАП, 86-ФЗ, 52-ФЗ, 34-ФЗ, Внутренний устав 1-й мсбр) в части задержания и юрисдикции ВП: статус ВП, основания и порядок задержания, права задержанного и адвокат, обыск и доказательства, особые категории, передача, освобождение и ответственность сотрудника.\n5 текстовых лекций по порядку и итоговый экзамен из 25 вопросов.';
const WPM = 200;   // время чтения: 200 слов в минуту

const q = (v) => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : "'" + String(v).replace(/'/g, "''") + "'";
const now = Date.now();
const bank = JSON.parse(fs.readFileSync(path.join(dir, 'questions.json'), 'utf8'));
const stm = [];
// курс
stm.push(`INSERT INTO courses (title, description, position, published, created_at, updated_at) SELECT ${q(COURSE)}, ${q(COURSE_DESC)}, 20, 1, ${now}, ${now} WHERE NOT EXISTS (SELECT 1 FROM courses WHERE title = ${q(COURSE)});`);
const CID = `(SELECT id FROM courses WHERE title = ${q(COURSE)} ORDER BY id LIMIT 1)`;
// лекции
const lectures = [];
for (const [n, L] of Object.entries(bank.lectures).sort((a, b) => Number(a[0]) - Number(b[0]))) {
  const raw = fs.readFileSync(path.join(dir, L.file), 'utf8').replace(/\r\n/g, '\n');
  const m = /^#\s+(Лекция\s+\d+\..*)$/m.exec(raw);
  if (!m) throw new Error('нет заголовка «# Лекция N.» в ' + L.file);
  const title = m[1].trim();
  const body = raw.replace(m[0], '').replace(/^\s+/, '').trimEnd() + '\n';
  const words = (body.replace(/\]\([^)]*\)/g, ']').match(/[\p{L}\p{N}]+/gu) || []).length;
  const dur = Math.max(60, Math.round(words / WPM * 60 / 10) * 10);
  const pos = 1000 + Number(n) * 10;
  lectures.push({ n: Number(n), title, words, duration_sec: dur, bytes: body.length });
  stm.push(`UPDATE lectures SET body = ${q(body)}, duration_sec = ${dur}, video_url = '', required = 1, published = 1, position = ${pos}, course_id = ${CID}, updated_at = ${now} WHERE title = ${q(title)};`);
  stm.push(`INSERT INTO lectures (title, description, video_url, duration_sec, position, required, published, course_id, created_at, updated_at, body) SELECT ${q(title)}, '', '', ${dur}, ${pos}, 1, 1, ${CID}, ${now}, ${now}, ${q(body)} WHERE NOT EXISTS (SELECT 1 FROM lectures WHERE title = ${q(title)});`);
}
// вопросы банка
const byType = {}, topics = new Set();
let pos = 5000;
const items = W.importItems({ questions: bank.questions.map(x => ({ ...x, category: CATEGORY, source: (bank.sources[x.law] || {}).law || x.law })) });
const normalized = [];
for (const it of items) {
  if (!it.topic) throw new Error('нет topic: ' + it.id);
  const o = W.questionInput(it, null); pos += 10;
  if (!o.ext_id || !o.topic) throw new Error('нет ext_id/topic: ' + it.id);
  byType[o.type] = (byType[o.type] || 0) + 1; topics.add(o.topic);
  normalized.push(o);
  stm.push(`UPDATE questions SET type=${q(o.type)}, text=${q(o.text)}, options=${q(JSON.stringify(o.options))}, correct=${q(JSON.stringify(o.correct))}, reference=${q(o.reference)}, points=${o.points}, data=${q(JSON.stringify(o.data))}, category=${q(o.category)}, kind=${q(o.kind)}, easy=0, active=1, topic=${q(o.topic)}, updated_at=${now} WHERE exam_id=0 AND ext_id=${q(o.ext_id)};\n` +
    `INSERT INTO questions (exam_id, type, text, options, correct, reference, points, position, data, category, kind, easy, active, ext_id, created_at, updated_at, topic) SELECT 0, ${q(o.type)}, ${q(o.text)}, ${q(JSON.stringify(o.options))}, ${q(JSON.stringify(o.correct))}, ${q(o.reference)}, ${o.points}, ${pos}, ${q(JSON.stringify(o.data))}, ${q(o.category)}, ${q(o.kind)}, 0, 1, ${q(o.ext_id)}, ${now}, ${now}, ${q(o.topic)} WHERE NOT EXISTS (SELECT 1 FROM questions WHERE exam_id=0 AND ext_id=${q(o.ext_id)});`);
}
// экзамен курса: из банка, после всех обязательных лекций курса (lecture_mode 'all' + course_id)
stm.push(`INSERT INTO exams (title, description, time_limit_min, max_attempts, cooldown_min, pass_pct, shuffle_questions, shuffle_options, requires_lectures, lecture_mode, position, published, course_id, bank_category, bank_count, created_at, updated_at) SELECT ${q(EXAM.title)}, ${q(EXAM.description)}, ${EXAM.time_limit_min}, ${EXAM.max_attempts}, ${EXAM.cooldown_min}, ${EXAM.pass_pct}, 1, 1, 1, 'all', 1000, 1, ${CID}, ${q(CATEGORY)}, ${EXAM.bank_count}, ${now}, ${now} WHERE NOT EXISTS (SELECT 1 FROM exams WHERE title = ${q(EXAM.title)});`);
const batches = []; let cur = '';
for (const s of stm) { if (cur.length + s.length > 90000) { batches.push(cur); cur = ''; } cur += s + '\n'; }
if (cur) batches.push(cur);
const summary = { course: COURSE, category: CATEGORY, lectures, questions: normalized.length, by_type: byType, topics: topics.size, exam: EXAM,
  batches: batches.length, bytes: batches.reduce((a, b) => a + b.length, 0) };
fs.writeFileSync(out, JSON.stringify({ batches, summary }));
const ji = process.argv.indexOf('--json'); if (ji > 0) fs.writeFileSync(process.argv[ji + 1], JSON.stringify(normalized));
console.log(JSON.stringify(summary, null, 1));
