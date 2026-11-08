// Мониторинг законодательства: приём отчёта tools/update_laws.py, разбор diff и решения администратора.
// Модуль не ходит в форум, не запускает команды и не меняет правильные ответы вопросов.

export const LAW_PIPELINE = {
  fetches_forum: false,
  rewrites_answers: false,
  updates_repository: false,
  routine: 'Портал сам форум не скачивает и tools/update_laws.py не запускает. По будням около 10:00 МСК эта команда по-прежнему выполняется на машине проверки без --apply.',
  publish: 'Сводка появляется в базе портала только после POST /api/admin/laws/reports: скрипт tools/publish_law_report.py или загрузка JSON администратором. Файл LAWS_UPDATE.md на машине проверки сам по себе D1 не обновляет.',
  approval: 'Одобрение записывает решение человека. Текст вопросов, правильные ответы и файлы content/reatt6/docs не меняются. Сломанные цитаты остаются открытыми, пока их отдельно не отметят просмотренными.',
  production_migration: 'Перед боевым использованием нужно применить миграцию worker/migrations/0021_law_monitor.sql к D1. Этот код миграцию на боевую базу сам не накатывает.',
};

// Совпадает с tools/reatt6/sources.json (forum). ДУ только вручную: на форуме презентация Яндекс.Диска.
export const LAW_CATALOG = [
  { id: 'vu', short: 'ВУ', title: 'Внутренний устав', url: 'https://forum.rmrp.ru/threads/vooruzhjonnye-sily-rossijskoj-federacii-vs-rf-vnutrennij-ustav-1-j-motostrelkovoj-brigady-moskovskoj-oblasti.267901/', mode: 'auto' },
  { id: 'du', short: 'ДУ', title: 'Дисциплинарный устав', url: 'https://forum.rmrp.ru/threads/vooruzhjonnye-sily-rossijskoj-federacii-vs-rf-disciplinarnyj-ustav-vooruzhennyx-sil-rossijskoj-federacii.292503/', mode: 'manual', manual_reason: 'На форуме (тема 292503) текст выложен презентацией на Яндекс.Диске (редакция 06.10.2026), скачивание запрещено владельцем. Автопроверка невозможна. В проекте лежит более ранняя редакция 27.09.2026 — её нужно сверять вручную.' },
  { id: 'kps', short: 'КПС', title: 'Устав караульно-постовой службы', url: 'https://forum.rmrp.ru/threads/vooruzhjonnye-sily-rossijskoj-federacii-vs-rf-ustav-karaulno-postovoj-sluzhby-1-oj-motostrelkovoj-brigady-moskovskoj-oblasti.267914/', mode: 'auto' },
  { id: 'su', short: 'СУ', title: 'Строевой устав', url: 'https://forum.rmrp.ru/threads/vooruzhjonnye-sily-rossijskoj-federacii-vs-rf-stroevoj-ustav-1-j-motostrelkovoj-brigady-moskovskoj-oblasti.267911/', mode: 'auto' },
  { id: 'pk', short: 'ПК', title: 'Процессуальный кодекс', url: 'https://forum.rmrp.ru/threads/processualnyj-kodeks-rossijskoj-federacii.58424/', mode: 'auto' },
  { id: 'uk', short: 'УК', title: 'Уголовный кодекс', url: 'https://forum.rmrp.ru/threads/ugolovnyj-kodeks-rossijskoj-federacii.58209/', mode: 'auto' },
  { id: 'koap', short: 'КоАП', title: 'Кодекс об административных правонарушениях', url: 'https://forum.rmrp.ru/threads/kodeks-ob-administrativnyx-pravonarushenijax-rossijskoj-federacii.58229/', mode: 'auto' },
  { id: 'tk', short: 'ТК', title: 'Трудовой кодекс', url: 'https://forum.rmrp.ru/threads/trudovoj-kodeks-rossijskoj-federacii.25050/', mode: 'auto' },
  { id: 'fz_oborona', short: 'ФЗ «Об обороне»', title: 'Федеральный закон «Об обороне»', url: 'https://forum.rmrp.ru/threads/federalnyj-zakon-ob-oborone-no52-fz.25072/', mode: 'auto' },
  { id: 'fz_oruzhie', short: 'ФЗ «Об оружии»', title: 'Федеральный закон «Об оружии»', url: 'https://forum.rmrp.ru/threads/federalnyj-zakon-ob-oruzhii-no-34-fz.25068/', mode: 'auto' },
  { id: 'fz_territorii', short: 'ФЗ о территориях', title: 'Федеральный закон о закрытых и охраняемых территориях', url: 'https://forum.rmrp.ru/threads/federalnyj-zakon-o-gosudarstvennoj-sobstvennosti-zakrytyx-i-oxranjaemyx-territorijax-no-86-fz.26625/', mode: 'auto' },
  { id: 'fz_gostayna', short: 'ФЗ «О государственной тайне»', title: 'Федеральный закон «О государственной тайне»', url: 'https://forum.rmrp.ru/threads/federalnyj-zakon-o-gosudarstvennoj-tajne-no10-fz.25062/', mode: 'auto' },
  { id: 'fz_gossluzhba', short: 'ФЗ о госслужбе', title: 'Федеральный закон о государственной службе', url: 'https://forum.rmrp.ru/threads/federalnyj-zakon-o-gosudarstvennoj-sluzhbe-no-54-fz.25075/', mode: 'auto' },
  { id: 'fz_vozduh', short: 'ФЗ о воздухе', title: 'Федеральный закон о воздушном пространстве', url: 'https://forum.rmrp.ru/threads/federalnyj-zakon-o-vozdushnom-prostranstve-no-95-fz-poslednjaja-redakcija.25057/', mode: 'auto' },
  { id: 'fkz_rezhimy', short: 'ФКЗ о режимах', title: 'Федеральный конституционный закон об особых правовых режимах', url: 'https://forum.rmrp.ru/threads/federalnyj-konstitucionnyj-zakon-ob-osobyx-pravovyx-rezhimax-no-28-fkz.25066/', mode: 'auto' },
  { id: 'upk', short: 'УПК', title: 'Уголовно-процессуальный кодекс', url: 'https://forum.rmrp.ru/threads/ugolovno-processualnyj-kodeks-rossijskoj-federacii.90218/', mode: 'auto' },
];

const CATALOG = new Map(LAW_CATALOG.map(d => [d.id, d]));
const AUTO_STATUSES = new Set(['unchanged', 'changed', 'error', 'unavailable']);
const EXT_RE = /^[A-Za-z0-9_~.-]{1,80}$/;
const FORBIDDEN_KEYS = new Set(['new_text', 'full_text', 'body', 'correct', 'answers', 'html', 'script', 'markdown']);

function fail(status, error) { return { ok: false, status, error }; }
function clip(v, max) {
  let s = typeof v === 'string' ? v : v == null ? '' : null;
  if (s == null) return null;
  s = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (s.length > max) s = s.slice(0, max);
  return s;
}
function requireClip(v, max, name) {
  if (typeof v !== 'string') return { error: `Некорректное значение: ${name}` };
  const s = clip(v, max + 1);
  if (s.length > max) return { error: `Слишком длинное значение: ${name}` };
  return { value: s };
}
function walkForbidden(value, depth) {
  if (depth > 8 || value == null) return null;
  if (Array.isArray(value)) {
    if (value.length > 500) return 'Слишком длинный список в отчёте';
    for (const item of value) { const e = walkForbidden(item, depth + 1); if (e) return e; }
    return null;
  }
  if (typeof value === 'object') {
    for (const k of Object.keys(value)) {
      if (FORBIDDEN_KEYS.has(k)) return `Поле «${k}» в отчёт класть нельзя: портал не принимает полный текст закона и не подставляет ответы`;
      const e = walkForbidden(value[k], depth + 1);
      if (e) return e;
    }
  }
  return null;
}
function boolField(v, name) {
  if (typeof v !== 'boolean') return { error: `Поле ${name} должно быть true или false` };
  return { value: v };
}
function strList(arr, maxItems, maxLen, name) {
  if (arr === undefined || arr === null) return { value: [] };
  if (!Array.isArray(arr)) return { error: `${name}: ожидается список` };
  if (arr.length > maxItems) return { error: `${name}: не больше ${maxItems}` };
  const out = [];
  for (const item of arr) {
    const r = requireClip(item, maxLen, name);
    if (r.error) return r;
    if (r.value) out.push(r.value);
  }
  return { value: out };
}

export function assertLawWrite(request, allowedOrigins, requestOrigin) {
  const site = (request.headers.get('Sec-Fetch-Site') || '').toLowerCase();
  if (site === 'cross-site') return fail(403, 'Запрос отклонён: чужой сайт');
  const origin = request.headers.get('Origin');
  if (origin === 'null') return fail(403, 'Запрос отклонён');
  if (origin) {
    const allowed = new Set((allowedOrigins || []).map(s => String(s).trim()).filter(Boolean));
    if (requestOrigin) allowed.add(requestOrigin);
    if (!allowed.has(origin)) return fail(403, 'Источник запроса не разрешён');
  }
  const ct = request.headers.get('Content-Type') || '';
  if (!/^\s*application\/json\b/i.test(ct)) return fail(415, 'Нужен заголовок Content-Type: application/json');
  return { ok: true };
}

function parseQuestion(raw, docId) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Вопрос в отчёте задан неверно' };
  const ext = requireClip(raw.ext_id, 80, 'ext_id');
  if (ext.error) return ext;
  if (!EXT_RE.test(ext.value)) return { error: 'Некорректный ext_id' };
  const issue = raw.issue;
  if (issue !== 'missing' && issue !== 'moved' && issue !== 'ok') return { error: 'Тип расхождения цитаты: missing, moved или ok' };
  const base = raw.base == null || raw.base === '' ? '' : requireClip(raw.base, 40, 'база');
  if (base.error) return base;
  const ref = raw.ref == null ? '' : requireClip(raw.ref, 160, 'пункт');
  if (ref.error) return ref;
  const excerpt = raw.excerpt == null ? '' : requireClip(raw.excerpt, 240, 'цитата');
  if (excerpt.error) return excerpt;
  const oldRef = raw.old_ref == null ? '' : requireClip(String(raw.old_ref), 40, 'старый пункт');
  if (oldRef.error) return oldRef;
  const newRef = raw.new_ref == null ? '' : requireClip(String(raw.new_ref), 40, 'новый пункт');
  if (newRef.error) return newRef;
  if (issue === 'moved' && (!oldRef.value || !newRef.value || oldRef.value === newRef.value)) return { error: `Сдвиг нумерации у ${ext.value} без двух разных пунктов` };
  if (issue === 'missing' && !excerpt.value) return { error: `У ${ext.value} нет фрагмента цитаты, который не нашёлся` };
  return {
    value: {
      ext_id: ext.value, doc_id: docId, base: base.value || '', ref: ref.value || '', issue,
      old_ref: oldRef.value || '', new_ref: newRef.value || '', excerpt: excerpt.value || '',
    },
  };
}

function parseDocument(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { error: 'Документ в отчёте задан неверно' };
  const id = typeof raw.id === 'string' ? raw.id : '';
  const meta = CATALOG.get(id);
  if (!meta) return { error: `Неизвестный документ: ${id || '?'}` };
  const status = raw.status;
  if (meta.mode === 'manual') {
    if (status !== 'manual') return { error: `${meta.short}: этот документ нельзя пометить автоматической проверкой. Допустим только статус manual` };
    const units = raw.changed_units;
    if (Array.isArray(units) && units.length) return { error: `${meta.short}: для ручного документа diff не принимается` };
    const qs = raw.questions;
    if (Array.isArray(qs) && qs.some(q => q && q.issue && q.issue !== 'ok')) return { error: `${meta.short}: автопроверка цитат недоступна` };
    return {
      value: {
        id, status: 'manual', text_changed: false, edition_old: '', edition_new: '',
        added: [], removed: [], units: [], questions: [], summary: meta.manual_reason,
        added_count: 0, removed_count: 0, changed_count: 0, quotes_checked: 0, quotes_broken: 0, quotes_moved: 0,
      },
    };
  }
  if (!AUTO_STATUSES.has(status)) return { error: `${id}: статус проверки должен быть unchanged, changed, error или unavailable` };
  const editionOld = raw.edition_old == null ? '' : requireClip(String(raw.edition_old), 200, 'прежняя редакция');
  if (editionOld.error) return editionOld;
  const editionNew = raw.edition_new == null ? '' : requireClip(String(raw.edition_new), 200, 'новая редакция');
  if (editionNew.error) return editionNew;
  if (status === 'error' || status === 'unavailable') {
    const err = requireClip(raw.error, 500, 'ошибка');
    if (err.error) return err;
    if (!err.value.trim()) return { error: `${id}: для сбоя нужна причина, пустой успех не принимается` };
    return {
      value: {
        id, status, error: err.value.trim(), text_changed: false,
        edition_old: editionOld.value, edition_new: editionNew.value,
        added: [], removed: [], units: [], questions: [], summary: err.value.trim(),
        added_count: 0, removed_count: 0, changed_count: 0, quotes_checked: 0, quotes_broken: 0, quotes_moved: 0,
      },
    };
  }
  if (typeof raw.text_changed !== 'boolean') return { error: `${id}: укажите text_changed` };
  const added = strList(raw.added, 80, 120, 'добавленные пункты');
  if (added.error) return added;
  const removed = strList(raw.removed, 80, 120, 'удалённые пункты');
  if (removed.error) return removed;
  const addedCount = Number.isInteger(raw.added_count) ? raw.added_count : added.value.length;
  const removedCount = Number.isInteger(raw.removed_count) ? raw.removed_count : removed.value.length;
  const changedCountIn = Number.isInteger(raw.changed_count) ? raw.changed_count : null;
  if (addedCount < added.value.length || addedCount > 5000 || removedCount < removed.value.length || removedCount > 5000) return { error: `${id}: некорректный счётчик пунктов` };
  let units = [];
  if (raw.changed_units != null) {
    if (!Array.isArray(raw.changed_units)) return { error: `${id}: changed_units — список` };
    if (raw.changed_units.length > 30) return { error: `${id}: в отчёте не больше 30 пунктов diff; передайте changed_count и первые 30` };
    for (const unit of raw.changed_units) {
      if (!unit || typeof unit !== 'object') return { error: `${id}: пункт diff задан неверно` };
      const name = requireClip(unit.unit, 120, 'пункт');
      if (name.error) return name;
      const diff = unit.diff == null ? '' : requireClip(String(unit.diff), 2000, 'diff');
      if (diff.error) return diff;
      const oldT = unit.old == null ? '' : requireClip(String(unit.old), 1800, 'старый текст пункта');
      if (oldT.error) return oldT;
      const newT = unit.new == null ? '' : requireClip(String(unit.new), 1800, 'новый текст пункта');
      if (newT.error) return newT;
      if (!name.value) return { error: `${id}: у пункта diff нет названия` };
      units.push({ unit: name.value, diff: diff.value, old: oldT.value, new: newT.value });
    }
  }
  const changedCount = changedCountIn == null ? units.length : changedCountIn;
  if (changedCount < units.length || changedCount > 5000) return { error: `${id}: некорректный changed_count` };
  let questions = [];
  if (raw.questions != null) {
    if (!Array.isArray(raw.questions)) return { error: `${id}: questions — список` };
    if (raw.questions.length > 200) return { error: `${id}: не больше 200 затронутых вопросов в одном отчёте` };
    const seen = new Set();
    for (const q of raw.questions) {
      const parsed = parseQuestion(q, id);
      if (parsed.error) return parsed;
      if (seen.has(parsed.value.ext_id)) return { error: `${id}: вопрос ${parsed.value.ext_id} указан дважды` };
      seen.add(parsed.value.ext_id);
      questions.push(parsed.value);
    }
  }
  const problems = questions.filter(q => q.issue !== 'ok');
  const quotesChecked = Number.isInteger(raw.quotes_checked) ? raw.quotes_checked : null;
  if (quotesChecked != null && (quotesChecked < 0 || quotesChecked > 20000)) return { error: `${id}: некорректный quotes_checked` };
  if (status === 'unchanged') {
    if (raw.text_changed || added.value.length || removed.value.length || units.length || problems.length || addedCount || removedCount || changedCount) {
      return { error: `${id}: статус unchanged не сочетается с текстом правок или сломанными цитатами` };
    }
  }
  if (status === 'changed' && !raw.text_changed && !problems.length) return { error: `${id}: статус changed без текста правок и без затронутых вопросов` };
  const broken = problems.filter(q => q.issue === 'missing').length;
  const moved = problems.filter(q => q.issue === 'moved').length;
  const summary = status === 'unchanged'
    ? 'Расхождений с копией скрипта проверки нет'
    : `Текст: ${raw.text_changed ? 'изменился' : 'без правок пункта'}; добавлено ${addedCount}, удалено ${removedCount}, изменено ${changedCount}; цитата не найдена: ${broken}; сдвиг нумерации: ${moved}`;
  return {
    value: {
      id, status, text_changed: raw.text_changed, error: '',
      edition_old: editionOld.value, edition_new: editionNew.value,
      added: added.value, removed: removed.value, units, questions,
      added_count: addedCount, removed_count: removedCount, changed_count: changedCount,
      quotes_checked: quotesChecked, quotes_broken: broken, quotes_moved: moved, summary,
    },
  };
}

export function parseLawReport(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(400, 'Некорректный отчёт');
  const forbidden = walkForbidden(body, 0);
  if (forbidden) return fail(400, forbidden);
  if (body.mode !== 'check') return fail(400, 'Отчёт должен быть режимом check. Применение текста этим запросом не выполняется');
  const offline = boolField(body.offline, 'offline');
  if (offline.error) return fail(400, offline.error);
  const partial = body.partial === undefined ? { value: false } : boolField(body.partial, 'partial');
  if (partial.error) return fail(400, partial.error);
  const applied = body.applied_locally === undefined ? { value: false } : boolField(body.applied_locally, 'applied_locally');
  if (applied.error) return fail(400, applied.error);
  const source = body.source === undefined ? 'publish' : body.source;
  if (source !== 'publish' && source !== 'upload') return fail(400, 'source: publish или upload');
  const runner = requireClip(body.runner == null ? '' : String(body.runner), 80, 'runner');
  if (runner.error) return fail(400, runner.error);
  if (!runner.value.trim()) return fail(400, 'Укажите runner — откуда пришёл отчёт');
  if (typeof body.generated_at !== 'number' || !Number.isFinite(body.generated_at)) return fail(400, 'generated_at: время проверки в миллисекундах');
  const now = Date.now();
  if (body.generated_at < Date.UTC(2024, 0, 1) || body.generated_at > now + 24 * 3600 * 1000) return fail(400, 'generated_at вне допустимого диапазона');
  if (!Array.isArray(body.documents) || !body.documents.length || body.documents.length > LAW_CATALOG.length) return fail(400, 'В отчёте нужен список documents');
  const documents = [];
  const seen = new Set();
  for (const raw of body.documents) {
    const parsed = parseDocument(raw);
    if (parsed.error) return fail(400, parsed.error);
    if (seen.has(parsed.value.id)) return fail(400, 'Документ указан дважды: ' + parsed.value.id);
    seen.add(parsed.value.id);
    documents.push(parsed.value);
  }
  if (!partial.value) {
    for (const doc of LAW_CATALOG) if (!seen.has(doc.id)) return fail(400, `В полном отчёте нет документа ${doc.id}. Для частичной проверки передайте partial: true`);
  }
  const changed = documents.filter(d => d.status === 'changed').length;
  const failed = documents.filter(d => d.status === 'error' || d.status === 'unavailable').length;
  const manual = documents.filter(d => d.status === 'manual').length;
  let status = 'ok';
  if (failed && changed) status = 'partial';
  else if (failed) status = 'errors';
  else if (changed) status = 'changes';
  return {
    ok: true,
    report: {
      source, offline: offline.value, partial: partial.value, applied_locally: applied.value,
      generated_at: Math.floor(body.generated_at), runner: runner.value.trim(), documents, status,
      summary: { documents: documents.length, changed, failed, manual, unchanged: documents.filter(d => d.status === 'unchanged').length },
    },
  };
}

function publicDoc(meta, row, openFlags) {
  const known = row && row.status;
  let monitor_status = meta.mode === 'manual' ? 'manual' : 'unchecked';
  if (known === 'unchanged' || known === 'changed' || known === 'error' || known === 'unavailable' || known === 'manual') monitor_status = known;
  return {
    id: meta.id, short: meta.short, title: meta.title, url: meta.url, mode: meta.mode,
    manual_reason: meta.manual_reason || '',
    monitor_status,
    checked: !!known && known !== 'manual' ? monitor_status !== 'unchecked' : known === 'manual' && !!row,
    last_check_id: row ? row.last_check_id : null,
    last_ok_at: row ? row.last_ok_at : null,
    last_error_at: row ? row.last_error_at : null,
    last_error: row && row.last_error ? row.last_error : '',
    edition_old: row && row.edition_old || '',
    edition_new: row && row.edition_new || '',
    accepted_edition: row && row.accepted_edition || '',
    pending_proposal_id: row ? row.pending_proposal_id : null,
    open_flags: openFlags || 0,
  };
}

async function actorNames(env, ids) {
  const uniq = [...new Set(ids.filter(Boolean))];
  const map = new Map();
  if (!uniq.length) return map;
  const { results } = await env.DB.prepare(
    `SELECT id, ic_name, global_name, username FROM users WHERE id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(uniq)).all();
  for (const u of results || []) map.set(u.id, u.ic_name || u.global_name || u.username || u.id);
  return map;
}

function checkView(row, names) {
  if (!row) return null;
  return {
    id: row.id, source: row.source, status: row.status, offline: !!row.offline, partial: !!row.partial,
    applied_locally: !!row.applied_locally, generated_at: row.generated_at, finished_at: row.finished_at,
    runner: row.runner, actor_id: row.actor_id, actor_name: names.get(row.actor_id) || '',
    summary: JSON.parse(row.summary_json),
  };
}

export async function lawOverview(env) {
  const [{ results: states }, { results: flags }, latest, total] = await Promise.all([
    env.DB.prepare('SELECT * FROM law_doc_state').all(),
    env.DB.prepare("SELECT doc_id, COUNT(*) AS c FROM law_question_flags WHERE status = 'open' GROUP BY doc_id").all(),
    env.DB.prepare('SELECT * FROM law_checks ORDER BY id DESC LIMIT 1').first(),
    env.DB.prepare('SELECT COUNT(*) AS c FROM law_checks').first(),
  ]);
  const byId = new Map((states || []).map(r => [r.doc_id, r]));
  const flagMap = new Map((flags || []).map(r => [r.doc_id, r.c]));
  const names = await actorNames(env, latest ? [latest.actor_id] : []);
  const documents = LAW_CATALOG.map(meta => publicDoc(meta, byId.get(meta.id), flagMap.get(meta.id) || 0));
  const pending = documents.filter(d => d.pending_proposal_id).length;
  const openFlags = documents.reduce((s, d) => s + d.open_flags, 0);
  return {
    pipeline: LAW_PIPELINE,
    checks_total: total ? total.c : 0,
    latest_check: checkView(latest, names),
    pending_count: pending,
    open_flags: openFlags,
    documents,
  };
}

export async function lawHistory(env, url) {
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit')) || 40));
  const { results } = await env.DB.prepare('SELECT * FROM law_events ORDER BY id DESC LIMIT ?1').bind(limit).all();
  const names = await actorNames(env, (results || []).map(r => r.actor_id));
  return {
    events: (results || []).map(r => ({
      id: r.id, at: r.at, action: r.action, doc_id: r.doc_id, proposal_id: r.proposal_id, check_id: r.check_id,
      actor_id: r.actor_id, actor_name: names.get(r.actor_id) || '',
      details: r.details ? JSON.parse(r.details) : null,
    })),
  };
}

async function loadProposal(env, id) {
  const row = await env.DB.prepare('SELECT * FROM law_proposals WHERE id = ?1').bind(id).first();
  if (!row) return null;
  const check = await env.DB.prepare('SELECT * FROM law_checks WHERE id = ?1').bind(row.check_id).first();
  const names = await actorNames(env, [row.reviewed_by, check && check.actor_id]);
  const meta = CATALOG.get(row.doc_id);
  return {
    proposal: {
      id: row.id, doc_id: row.doc_id, doc_title: meta ? meta.title : row.doc_id, doc_short: meta ? meta.short : row.doc_id,
      url: meta ? meta.url : '', status: row.status, generation: row.review_generation,
      summary: row.summary, edition_old: row.edition_old || '', edition_new: row.edition_new || '',
      created_at: row.created_at, reviewed_by: row.reviewed_by, reviewed_by_name: names.get(row.reviewed_by) || '',
      reviewed_at: row.reviewed_at, review_note: row.review_note || '',
      check: checkView(check, names),
    },
    diff: JSON.parse(row.diff_json),
    questions: JSON.parse(row.questions_json),
    limits: { rewrites_answers: false, updates_repository: false },
  };
}

export async function lawProposal(env, id) {
  const item = await loadProposal(env, id);
  if (!item) return null;
  return item;
}

export async function lawDocument(env, docId) {
  const meta = CATALOG.get(docId);
  if (!meta) return null;
  const state = await env.DB.prepare('SELECT * FROM law_doc_state WHERE doc_id = ?1').bind(docId).first();
  const open = await env.DB.prepare("SELECT COUNT(*) AS c FROM law_question_flags WHERE doc_id = ?1 AND status = 'open'").bind(docId).first();
  const { results: proposals } = await env.DB.prepare(
    'SELECT id, status, summary, edition_old, edition_new, review_generation, created_at, reviewed_at, review_note FROM law_proposals WHERE doc_id = ?1 ORDER BY id DESC LIMIT 20').bind(docId).all();
  const { results: events } = await env.DB.prepare(
    'SELECT * FROM law_events WHERE doc_id = ?1 ORDER BY id DESC LIMIT 20').bind(docId).all();
  const names = await actorNames(env, (events || []).map(e => e.actor_id));
  let pending = null;
  if (state && state.pending_proposal_id) pending = await loadProposal(env, state.pending_proposal_id);
  const latest = pending || (proposals && proposals[0] ? await loadProposal(env, proposals[0].id) : null);
  return {
    document: publicDoc(meta, state, open ? open.c : 0),
    proposals: proposals || [],
    pending,
    latest,
    events: (events || []).map(r => ({
      id: r.id, at: r.at, action: r.action, proposal_id: r.proposal_id, check_id: r.check_id,
      actor_id: r.actor_id, actor_name: names.get(r.actor_id) || '',
      details: r.details ? JSON.parse(r.details) : null,
    })),
  };
}

async function resolveQuestions(env, questions) {
  const ids = [...new Set(questions.map(q => q.ext_id))];
  const found = new Map();
  for (let i = 0; i < ids.length; i += 40) {
    const slice = ids.slice(i, i + 40);
    const { results } = await env.DB.prepare(
      `SELECT id, ext_id, text, source_ref, source_doc, base, active FROM questions WHERE ext_id IN (SELECT value FROM json_each(?1))`).bind(JSON.stringify(slice)).all();
    for (const row of results || []) {
      const list = found.get(row.ext_id) || [];
      list.push(row);
      found.set(row.ext_id, list);
    }
  }
  return questions.map(q => {
    const rows = found.get(q.ext_id) || [];
    const active = rows.find(r => r.active) || null;
    const any = active || rows[0] || null;
    const prompt = any && any.text ? String(any.text).replace(/\s+/g, ' ').slice(0, 180) : '';
    return {
      ...q,
      in_portal: !!any,
      active: !!(active),
      question_id: any ? any.id : null,
      portal_ref: any ? (any.source_ref || '') : '',
      portal_base: any ? (any.base || '') : '',
      prompt,
    };
  });
}

function diffPayload(doc) {
  return {
    added: doc.added, removed: doc.removed, units: doc.units,
    added_count: doc.added_count, removed_count: doc.removed_count, changed_count: doc.changed_count,
    shown_units: doc.units.length,
  };
}

export async function ingestLawReport(env, actor, report, sha256) {
  const canonical = JSON.stringify(report);
  const payloadHash = await sha256(canonical);
  const recent = await env.DB.prepare(
    "SELECT * FROM law_checks WHERE payload_hash = ?1 AND actor_id = ?2 AND created_at > ?3 AND status NOT IN ('failed', 'recording') ORDER BY id DESC LIMIT 1")
    .bind(payloadHash, actor.id, Date.now() - 120000).first();
  if (recent) {
    const names = await actorNames(env, [recent.actor_id]);
    return { duplicate: true, check: checkView(recent, names), questions_unchanged: true };
  }
  const now = Date.now();
  const inserted = await env.DB.prepare(
    `INSERT INTO law_checks (source, status, offline, partial, applied_locally, payload_hash, generated_at, finished_at, runner, summary_json, actor_id, created_at)
     VALUES (?1, 'recording', ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?7) RETURNING id`)
    .bind(report.source, report.offline ? 1 : 0, report.partial ? 1 : 0, report.applied_locally ? 1 : 0, payloadHash, report.generated_at, now, report.runner, JSON.stringify(report.summary), actor.id).first();
  const checkId = inserted.id;
  try {
    for (const doc of report.documents) {
      if (doc.status === 'error' || doc.status === 'unavailable') {
        await env.DB.prepare(
          `INSERT INTO law_doc_state (doc_id, status, last_check_id, last_ok_at, last_error_at, last_error, edition_old, edition_new, accepted_edition, accepted_proposal_id, pending_proposal_id, updated_at)
           VALUES (?1, ?2, ?3, NULL, ?4, ?5, ?6, ?7, NULL, NULL, NULL, ?4)
           ON CONFLICT(doc_id) DO UPDATE SET status = excluded.status, last_check_id = excluded.last_check_id, last_error_at = excluded.last_error_at, last_error = excluded.last_error,
             edition_old = excluded.edition_old, edition_new = excluded.edition_new, updated_at = excluded.updated_at`)
          .bind(doc.id, doc.status, checkId, now, doc.error, doc.edition_old, doc.edition_new).run();
        continue;
      }
      if (doc.status === 'manual') {
        await env.DB.prepare(
          `INSERT INTO law_doc_state (doc_id, status, last_check_id, last_ok_at, last_error_at, last_error, edition_old, edition_new, accepted_edition, accepted_proposal_id, pending_proposal_id, updated_at)
           VALUES (?1, 'manual', ?2, NULL, NULL, '', '', '', NULL, NULL, NULL, ?3)
           ON CONFLICT(doc_id) DO UPDATE SET status = 'manual', last_check_id = excluded.last_check_id, last_error = '', pending_proposal_id = NULL, updated_at = excluded.updated_at`)
          .bind(doc.id, checkId, now).run();
        await env.DB.prepare("UPDATE law_proposals SET status = 'superseded' WHERE doc_id = ?1 AND status = 'pending'").bind(doc.id).run();
        continue;
      }
      const linked = await resolveQuestions(env, doc.questions);
      const problems = linked.filter(q => q.issue !== 'ok');
      await env.DB.prepare("UPDATE law_proposals SET status = 'superseded' WHERE doc_id = ?1 AND status = 'pending'").bind(doc.id).run();
      let proposalId = null;
      if (doc.status === 'changed') {
        const row = await env.DB.prepare(
          `INSERT INTO law_proposals (doc_id, check_id, status, edition_old, edition_new, summary, diff_json, questions_json, review_generation, created_at)
           VALUES (?1, ?2, 'pending', ?3, ?4, ?5, ?6, ?7, 1, ?8) RETURNING id`)
          .bind(doc.id, checkId, doc.edition_old, doc.edition_new, doc.summary, JSON.stringify(diffPayload(doc)), JSON.stringify(linked), now).first();
        proposalId = row.id;
        await env.DB.prepare(
          'INSERT INTO law_events (check_id, proposal_id, doc_id, action, actor_id, details, at) VALUES (?1, ?2, ?3, \'proposal.open\', ?4, ?5, ?6)')
          .bind(checkId, proposalId, doc.id, actor.id, JSON.stringify({ summary: doc.summary }).slice(0, 4000), now).run();
      }
      const problemIds = new Set(problems.map(q => q.ext_id));
      for (const q of problems) {
        if (!q.question_id) continue;
        const detail = q.issue === 'moved'
          ? `Цитата на месте, пункт был ${q.old_ref}, стал ${q.new_ref}. Ответ вопроса не изменён.`
          : `Цитата не найдена в новом тексте. Ответ вопроса не изменён. ${q.excerpt}`.slice(0, 500);
        await env.DB.prepare(
          `INSERT INTO law_question_flags (question_id, ext_id, doc_id, proposal_id, issue, detail, status, updated_at, ack_by, ack_at, ack_note)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'open', ?7, NULL, NULL, NULL)
           ON CONFLICT(question_id) DO UPDATE SET ext_id = excluded.ext_id, doc_id = excluded.doc_id, proposal_id = excluded.proposal_id,
             issue = excluded.issue, detail = excluded.detail, status = 'open', updated_at = excluded.updated_at, ack_by = NULL, ack_at = NULL, ack_note = NULL`)
          .bind(q.question_id, q.ext_id, doc.id, proposalId, q.issue, detail, now).run();
      }
      const { results: openFlags } = await env.DB.prepare(
        "SELECT question_id, ext_id FROM law_question_flags WHERE doc_id = ?1 AND status = 'open'").bind(doc.id).all();
      for (const flag of openFlags || []) {
        if (problemIds.has(flag.ext_id)) continue;
        const upd = await env.DB.prepare(
          "UPDATE law_question_flags SET status = 'cleared', updated_at = ?1, ack_at = ?1, ack_note = ?2 WHERE question_id = ?3 AND status = 'open'")
          .bind(now, 'Повторная проверка больше не видит это расхождение. Ответ вопроса не менялся.', flag.question_id).run();
        if (upd.meta && upd.meta.changes) {
          await env.DB.prepare(
            'INSERT INTO law_events (check_id, proposal_id, doc_id, action, actor_id, details, at) VALUES (?1, ?2, ?3, \'flag.cleared_by_check\', ?4, ?5, ?6)')
            .bind(checkId, proposalId, doc.id, actor.id, JSON.stringify({ ext_id: flag.ext_id, question_id: flag.question_id }), now).run();
        }
      }
      await env.DB.prepare(
        `INSERT INTO law_doc_state (doc_id, status, last_check_id, last_ok_at, last_error_at, last_error, edition_old, edition_new, accepted_edition, accepted_proposal_id, pending_proposal_id, updated_at)
         VALUES (?1, ?2, ?3, ?4, NULL, '', ?5, ?6, NULL, NULL, ?7, ?4)
         ON CONFLICT(doc_id) DO UPDATE SET status = excluded.status, last_check_id = excluded.last_check_id, last_ok_at = excluded.last_ok_at, last_error_at = NULL, last_error = '',
           edition_old = excluded.edition_old, edition_new = excluded.edition_new, pending_proposal_id = excluded.pending_proposal_id, updated_at = excluded.updated_at`)
        .bind(doc.id, doc.status, checkId, now, doc.edition_old, doc.edition_new, proposalId).run();
    }
    await env.DB.prepare('UPDATE law_checks SET status = ?1, finished_at = ?2 WHERE id = ?3').bind(report.status, Date.now(), checkId).run();
    await env.DB.prepare(
      'INSERT INTO law_events (check_id, proposal_id, doc_id, action, actor_id, details, at) VALUES (?1, NULL, NULL, \'report.ingest\', ?2, ?3, ?4)')
      .bind(checkId, actor.id, JSON.stringify({ status: report.status, summary: report.summary, offline: report.offline, partial: report.partial, applied_locally: report.applied_locally, source: report.source }), Date.now()).run();
  } catch (e) {
    await env.DB.prepare("UPDATE law_checks SET status = 'failed', finished_at = ?1 WHERE id = ?2").bind(Date.now(), checkId).run();
    throw e;
  }
  const stored = await env.DB.prepare('SELECT * FROM law_checks WHERE id = ?1').bind(checkId).first();
  const names = await actorNames(env, [actor.id]);
  return { duplicate: false, check: checkView(stored, names), questions_unchanged: true };
}

export async function decideProposal(env, actor, id, action, generation, note) {
  if (action !== 'approve' && action !== 'reject') return fail(400, 'Решение: approve или reject');
  const clean = clip(note, 1000);
  if (clean == null || clean.trim().length < 8) return fail(400, 'Нужен комментарий к решению (хотя бы 8 символов): что именно проверили');
  if (!Number.isInteger(generation) || generation < 1) return fail(400, 'Некорректное поколение решения');
  const cur = await env.DB.prepare('SELECT * FROM law_proposals WHERE id = ?1').bind(id).first();
  if (!cur) return fail(404, 'Предложение не найдено');
  if (cur.status !== 'pending') return fail(409, 'Это предложение уже решено или заменено новой проверкой');
  if (cur.review_generation !== generation) return fail(409, 'Карточка уже изменилась. Обновите страницу и решите ещё раз');
  const now = Date.now();
  const status = action === 'approve' ? 'approved' : 'rejected';
  const upd = await env.DB.prepare(
    `UPDATE law_proposals SET status = ?1, review_generation = review_generation + 1, reviewed_by = ?2, reviewed_at = ?3, review_note = ?4
     WHERE id = ?5 AND status = 'pending' AND review_generation = ?6`).bind(status, actor.id, now, clean.trim(), id, generation).run();
  if (!upd.meta || !upd.meta.changes) return fail(409, 'Решение не записано: его уже принял другой запрос');
  if (action === 'approve') {
    await env.DB.prepare(
      `UPDATE law_doc_state SET accepted_edition = ?1, accepted_proposal_id = ?2, pending_proposal_id = NULL, updated_at = ?3
       WHERE doc_id = ?4 AND pending_proposal_id = ?2`).bind(cur.edition_new || '', id, now, cur.doc_id).run();
  } else {
    await env.DB.prepare(
      `UPDATE law_doc_state SET pending_proposal_id = NULL, updated_at = ?1 WHERE doc_id = ?2 AND pending_proposal_id = ?3`)
      .bind(now, cur.doc_id, id).run();
  }
  await env.DB.prepare(
    'INSERT INTO law_events (check_id, proposal_id, doc_id, action, actor_id, details, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)')
    .bind(cur.check_id, id, cur.doc_id, action === 'approve' ? 'proposal.approve' : 'proposal.reject', actor.id, JSON.stringify({ note: clean.trim().slice(0, 500) }), now).run();
  const open = await env.DB.prepare("SELECT COUNT(*) AS c FROM law_question_flags WHERE doc_id = ?1 AND status = 'open'").bind(cur.doc_id).first();
  return {
    ok: true,
    proposal: { id, status, generation: generation + 1 },
    questions_unchanged: true,
    open_flags: open ? open.c : 0,
    message: action === 'approve'
      ? 'Решение «принять редакцию» записано. Правильные ответы и текст вопросов не изменялись. Открытые цитаты нужно разобрать отдельно.'
      : 'Отказ записан. Правильные ответы и текст вопросов не изменялись.',
  };
}

export async function acknowledgeFlag(env, actor, questionId, note) {
  const clean = clip(note, 1000);
  if (clean == null || clean.trim().length < 8) return fail(400, 'Нужен комментарий (хотя бы 8 символов): почему текущий вопрос оставлен как есть');
  const flag = await env.DB.prepare('SELECT * FROM law_question_flags WHERE question_id = ?1').bind(questionId).first();
  if (!flag) return fail(404, 'Пометки по этому вопросу нет');
  if (flag.status !== 'open') return fail(409, 'Пометка уже закрыта');
  const now = Date.now();
  const upd = await env.DB.prepare(
    "UPDATE law_question_flags SET status = 'acknowledged', ack_by = ?1, ack_at = ?2, ack_note = ?3, updated_at = ?2 WHERE question_id = ?4 AND status = 'open'")
    .bind(actor.id, now, clean.trim(), questionId).run();
  if (!upd.meta || !upd.meta.changes) return fail(409, 'Пометку уже закрыл другой запрос');
  await env.DB.prepare(
    'INSERT INTO law_events (check_id, proposal_id, doc_id, action, actor_id, details, at) VALUES (NULL, ?1, ?2, \'flag.ack\', ?3, ?4, ?5)')
    .bind(flag.proposal_id, flag.doc_id, actor.id, JSON.stringify({ question_id: questionId, ext_id: flag.ext_id, note: clean.trim().slice(0, 500) }), now).run();
  return {
    ok: true,
    questions_unchanged: true,
    flag: { question_id: questionId, status: 'acknowledged' },
    message: 'Вопрос отмечен просмотренным. Его формулировка и правильный ответ не менялись.',
  };
}
