import { parseLawReport, assertLawWrite, LAW_CATALOG } from '../worker/laws.js';
import assert from 'node:assert/strict';

function req(headers) {
  return { headers: { get: (k) => headers[k] ?? headers[k.toLowerCase()] ?? null } };
}
const ids = LAW_CATALOG.map(d => d.id);
function doc(id, extra = {}) {
  const manual = id === 'du';
  if (manual) return { id, status: 'manual', ...extra };
  return { id, status: 'unchanged', text_changed: false, edition_old: '', edition_new: '', quotes_checked: 0, ...extra };
}
function full(over = {}) {
  const map = Object.fromEntries(ids.map(id => [id, doc(id)]));
  Object.assign(map, over);
  return {
    mode: 'check', offline: false, partial: false, applied_locally: false, source: 'publish',
    runner: 'unit', generated_at: Date.now(), documents: ids.map(id => map[id]),
  };
}

const ok = parseLawReport(full());
assert.equal(ok.ok, true, ok.error);
assert.equal(ok.report.summary.documents, ids.length);

const du = parseLawReport(full({ du: { id: 'du', status: 'unchanged', text_changed: false } }));
assert.equal(du.ok, false);
assert.match(du.error, /manual/);

const forged = parseLawReport(full({ pk: { id: 'pk', status: 'changed', text_changed: true, new_text: 'выдуманный закон' } }));
assert.equal(forged.ok, false);
assert.match(forged.error, /полный текст/);

const emptyErr = parseLawReport({ ...full(), documents: full().documents.map(d => d.id === 'uk' ? { id: 'uk', status: 'unavailable', error: '   ', text_changed: false } : d) });
assert.equal(emptyErr.ok, false);

const changed = parseLawReport({
  mode: 'check', offline: true, partial: true, source: 'upload', runner: 'fixture', generated_at: Date.now(),
  documents: [{
    id: 'pk', status: 'changed', text_changed: true, edition_old: '01.01.2026', edition_new: '08.11.2026',
    added: ['п. 9'], removed: [], added_count: 1, removed_count: 0, changed_count: 1,
    changed_units: [{ unit: 'п. 1', diff: '- было\n+ <img src=x onerror=alert(1)>', old: 'было', new: '<img src=x onerror=alert(1)>' }],
    questions: [{ ext_id: 'r6-pk-001', base: 'simple', ref: 'ПК, ст. 1', issue: 'missing', excerpt: 'цитата которой нет' }],
    quotes_checked: 3,
  }],
});
assert.equal(changed.ok, true, changed.error);
assert.equal(changed.report.documents[0].units[0].new.includes('onerror'), true);
assert.equal(changed.report.offline, true);

const badGen = parseLawReport({ ...full(), generated_at: 'вчера' });
assert.equal(badGen.ok, false);

const evil = assertLawWrite(req({ Origin: 'https://evil.example', 'Content-Type': 'application/json' }), ['http://localhost:8080'], 'http://127.0.0.1:8787');
assert.equal(evil.ok, false);
assert.equal(evil.status, 403);
const local = assertLawWrite(req({ Origin: 'http://localhost:8080', 'Content-Type': 'application/json; charset=utf-8' }), ['http://localhost:8080'], 'http://127.0.0.1:8787');
assert.equal(local.ok, true);
const script = assertLawWrite(req({ 'Content-Type': 'application/json' }), ['http://localhost:8080'], 'http://127.0.0.1:8787');
assert.equal(script.ok, true);
const html = assertLawWrite(req({ 'Content-Type': 'text/plain' }), [], 'http://127.0.0.1:8787');
assert.equal(html.status, 415);
const site = assertLawWrite(req({ 'Sec-Fetch-Site': 'cross-site', 'Content-Type': 'application/json' }), ['https://reflektpro.github.io'], 'https://vp-exam-api.reflektpro8.workers.dev');
assert.equal(site.status, 403);

console.log('laws-unit: ok', ids.length, 'documents');
