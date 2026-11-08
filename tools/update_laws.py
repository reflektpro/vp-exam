#!/usr/bin/env python3
"""Автообновление текстов документов переаттестаций (content/reatt6/docs) с forum.rmrp.ru (сервер «Патрики»).

  python3 tools/update_laws.py            # проверить: скачать актуальные тексты, сравнить, проверить цитаты вопросов (ничего не меняет)
  python3 tools/update_laws.py --apply    # то же + записать новые тексты в content/reatt6/docs (затем: node tools/reatt6/build.js)
  python3 tools/update_laws.py --only pk,vu   # только указанные документы
  python3 tools/update_laws.py --offline  # без сети: сравнить с локальной базой /workspace/rmrp_laws/text (для тестов)

Что делает:
  1. Для каждого документа из tools/reatt6/sources.json (раздел "forum") скачивает тему форума (1-е сообщение и сообщения автора,
     приложенные Google-документы) тем же разбором, что и база /workspace/rmrp_laws (rmrp_lib.py).
  2. Сравнивает с текущей копией content/reatt6/docs/<id>.md (без шапки, без учёта регистра/пробелов/кавычек) и по статьям/пунктам
     показывает добавленные / удалённые / изменённые.
  3. Проверяет КАЖДЫЙ вопрос баз (content/reatt6/quotes.json, пишется build.js): находится ли его цитата в НОВОМ тексте;
     если цитата нашлась под другим номером пункта — сообщает о сдвиге нумерации.
  4. Пишет отчёт в content/reatt6/LAWS_UPDATE.md.
Вывод: если изменений нет и все цитаты на месте — ровно строка NO_CHANGES (код выхода 0).
       Иначе — сводка (код выхода 2). Ошибки сети/форума — код 1 (с текстом ошибки), документы с ошибкой пропускаются.
"""
import os, sys, re, json, time, argparse, difflib, socket
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CFG = json.load(open(os.path.join(ROOT, 'tools/reatt6/sources.json'), encoding='utf8'))
DOCS = os.path.join(ROOT, 'content/reatt6/docs')
LAWS_DIR = os.environ.get('RMRP_LAWS_DIR', '/workspace/rmrp_laws')

def norm(s):
    s = str(s or '').lower().replace('ё', 'е')
    s = re.sub(r'[«»"“”„\'’`*_#>|•]', '', s); s = re.sub(r'[–—−‑]', '-', s)
    s = re.sub(r'[\u00a0\s]+', ' ', s); s = re.sub(r'\s*-\s*', '-', s)
    return s.strip()
def body_of(md):
    p = md.split('\n---\n', 1)
    return p[1] if len(p) > 1 and md.lstrip().startswith('# ') else md
def header_field(md, name):
    m = re.search(r'^- ' + re.escape(name) + r': (.*)$', md, re.M); return m.group(1).strip() if m else ''

UNIT = re.compile(r'^\s*(?:•\s*)?((?:Статья|Глава|Раздел|Часть)\s+[\dIVXLC][\w.\-]*|\d+(?:[.\-]\d+)+\.?(?=\s))', re.I)
def units(text):
    out = {}; key = '(вступление)'; buf = []; seen = {}
    def flush():
        if buf: out[key] = (out.get(key, '') + '\n' + '\n'.join(buf)).strip()
    for line in text.split('\n'):
        m = UNIT.match(line)
        if m:
            flush(); buf = []
            k = re.sub(r'\s+', ' ', m.group(1)).strip().rstrip('.')
            if re.match(r'\d', k): k = 'п. ' + k
            seen[k] = seen.get(k, 0) + 1
            key = k if seen[k] == 1 else f'{k} [{seen[k]}]'
        buf.append(line)
    flush(); return out
PT = re.compile(r'(?:^|[\s.;:!?])(\d{1,3}(?:\.\d{1,3}){0,3})\.\s+(?=[а-яa-z(«])')
def point_before(text, quote):
    """номер пункта/части, под которым стоит цитата (ближайший предшествующий «N.N.»), или None"""
    pos = text.find(quote)
    if pos < 0: return None
    found = PT.findall(text[max(0, pos - 3000):pos + 8])
    return found[-1] if found else None
def clip(s, n):
    s = str(s or '')
    if len(s) <= n: return s
    return (s[:n - 1] + '…') if n else ''
def save_report(payload):
    path = os.environ.get('LAW_REPORT_PATH') or os.path.join(ROOT, 'content/reatt6/laws_report.json')
    try:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + '.tmp'
        with open(tmp, 'w', encoding='utf8') as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write('\n')
        os.replace(tmp, path)
    except OSError as e:
        print(f'не удалось записать машиночитаемый отчёт {path}: {e}', file=sys.stderr)
def fail_status(err):
    if err.startswith('нет библиотеки') or err.startswith('раздел форума'): return 'error'
    return 'unavailable'
def short_diff(a, b, n=10):
    A = [x for x in (l.strip() for l in a.split('\n')) if x]; B = [x for x in (l.strip() for l in b.split('\n')) if x]
    d = [l for l in difflib.unified_diff(A, B, lineterm='', n=0) if not l.startswith(('---', '+++', '@@'))]
    if len(d) > n: d = d[:n] + [f'… ещё {len(d) - n} строк изменений']
    return '\n'.join('      ' + l[:300] for l in d)

def fetch_forum(doc_id, f):
    """-> (md, error)"""
    sys.path.insert(0, LAWS_DIR)
    try:
        import rmrp_lib as L
    except Exception as e:
        return None, f'нет библиотеки разбора форума {LAWS_DIR}/rmrp_lib.py ({e})'
    sec = next((s for s in L.all_sections() if s['folder'] == f['section']), None)
    if not sec: return None, 'раздел форума не найден: ' + f['section']
    url = f['url']
    h = L.get(url)
    if h is None: return None, f'форум не отдал страницу {url} (код/ошибка: {L.FAILS[-1][1] if L.FAILS else "?"})'
    posts, h1, pages = L.parse_page(h)
    if not posts: return None, f'на странице {url} нет сообщений (разметка форума изменилась или нужна авторизация)'
    for p in range(2, pages + 1):
        hp = L.get(url + f'page-{p}')
        if hp is None: return None, f'не скачалась страница {p} темы {url}'
        posts += L.parse_page(hp)[0]
    th = {'title': h1 or f.get('title', doc_id), 'url': url, 'tid': f['thread'], 'slug': doc_id, 'prefix': ''}
    e = L.build_doc(sec, th, {'h1': h1, 'posts': posts, 'pages': pages}, 'doc', write=False)
    return e['_md'], None

def offline_md(f):
    p = os.path.join(LAWS_DIR, f['offline']) if f.get('offline') else None
    if not p or not os.path.exists(p): return None, 'нет локальной копии ' + str(p)
    return open(p, encoding='utf8').read(), None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apply', action='store_true'); ap.add_argument('--only'); ap.add_argument('--offline', action='store_true')
    ap.add_argument('--quiet', action='store_true', help='не печатать подробный diff (только сводку)')
    a = ap.parse_args()
    only = set(a.only.split(',')) if a.only else None
    qpath = os.path.join(ROOT, 'content/reatt6/quotes.json')
    quotes = json.load(open(qpath, encoding='utf8'))['items'] if os.path.exists(qpath) else []
    stamp = time.strftime('%Y-%m-%d %H:%M %Z')
    rep, errors, skipped = [], [], []
    changed_docs, broken_all, moved_all = [], [], []
    new_texts = {}
    records = []
    def q_item(q, issue, **extra):
        return {'ext_id': q.get('ext_id') or '', 'base': q.get('base') or '', 'ref': q.get('ref') or '', 'issue': issue,
                'old_ref': extra.get('old_ref') or '', 'new_ref': extra.get('new_ref') or '', 'excerpt': clip(extra.get('excerpt') or '', 240)}
    for doc_id, f in CFG['forum'].items():
        if only and doc_id not in only: continue
        if f.get('manual'):
            skipped.append(f"{doc_id}: {f['manual']}")
            records.append({'id': doc_id, 'status': 'manual', 'text_changed': False, 'quotes_checked': 0})
            continue
        md, err = (offline_md(f) if a.offline else fetch_forum(doc_id, f))
        if err:
            errors.append(f'{doc_id}: {err}')
            records.append({'id': doc_id, 'status': fail_status(err), 'error': err, 'text_changed': False, 'edition_old': '', 'edition_new': '', 'quotes_checked': 0})
            continue
        cur_path = os.path.join(DOCS, doc_id + '.md')
        cur = open(cur_path, encoding='utf8').read() if os.path.exists(cur_path) else ''
        b_old, b_new = body_of(cur), body_of(md)
        ed_o, ed_n = header_field(cur, 'Последнее редактирование'), header_field(md, 'Последнее редактирование')
        if len(norm(b_new)) < 0.5 * len(norm(b_old)):
            msg = f'новый текст подозрительно короткий ({len(b_new)} симв. против {len(b_old)}) — не применяю, проверьте тему {f["url"]}'
            errors.append(f'{doc_id}: {msg}')
            records.append({'id': doc_id, 'status': 'unavailable', 'error': msg, 'text_changed': False, 'edition_old': ed_o, 'edition_new': ed_n, 'quotes_checked': 0})
            continue
        new_texts[doc_id] = md
        nn = norm(b_new); no_ = norm(b_old)
        doc_quotes = [x for x in quotes if x['doc'] == doc_id]
        # цитаты вопросов
        broken, moved = [], []
        for q in doc_quotes:
            parts = [p for p in q.get('parts', []) if len(norm(p)) >= 8]
            miss = [p for p in parts if norm(p) not in nn]
            if miss: broken.append({**q, 'missing': miss[0][:200]}); continue
            if parts and no_ != nn:
                po, pn = point_before(no_, norm(parts[0])), point_before(nn, norm(parts[0]))
                refnums = re.findall(r'\d+(?:\.\d+)*', q.get('ref') or '')
                if po and pn and po != pn and pn not in refnums: moved.append({**q, 'old_ref': po, 'new_ref': pn})
        broken_all += broken; moved_all += moved
        same = norm(b_old) == nn
        add, rem, chg, uo, un = [], [], [], {}, {}
        if not same:
            uo, un = units(b_old), units(b_new)
            HEAD = re.compile(r'^\s*(?:•\s*)?(?:глава|часть|раздел)\s+[ivxlc\d]+\b|^\s*===|^\s*#|^\s*\[', re.I)
            nk = lambda d: {k: norm('\n'.join(l for l in v.split('\n') if not HEAD.match(l))) for k, v in d.items()}
            no, nw = nk(uo), nk(un)
            isH = lambda k: re.match(r'(?i)(глава|часть|раздел)\b', k)
            add = [k for k in un if k not in uo and not isH(k)]; rem = [k for k in uo if k not in un and not isH(k)]
            chg = [k for k in un if k in uo and no[k] != nw[k] and not isH(k) and k != '(вступление)']
        q_rows = [q_item(q, 'missing', excerpt=q.get('missing') or '') for q in broken]
        q_rows += [q_item(q, 'moved', old_ref=q.get('old_ref') or '', new_ref=q.get('new_ref') or '') for q in moved]
        records.append({
            'id': doc_id, 'status': 'unchanged' if same and not broken and not moved else 'changed',
            'text_changed': not same, 'edition_old': ed_o, 'edition_new': ed_n,
            'added': add[:80], 'removed': rem[:80], 'added_count': len(add), 'removed_count': len(rem), 'changed_count': len(chg),
            'changed_units': [{'unit': k, 'diff': clip('\n'.join((line[6:] if line.startswith('      ') else line) for line in short_diff(uo[k], un[k]).split('\n')), 2000), 'old': clip(uo.get(k), 1800), 'new': clip(un.get(k), 1800)} for k in chg[:30]],
            'questions': q_rows[:200], 'quotes_checked': len(doc_quotes),
        })
        if same and not broken and not moved: continue
        lines = [f"### {doc_id}: {f.get('title', '')}", f"- {f['url']}"]
        if ed_o != ed_n and (ed_o or ed_n): lines.append(f'- Редакция на форуме: было {ed_o or "—"} → стало {ed_n or "—"}')
        if not same:
            changed_docs.append(doc_id)
            lines.append(f'- Текст изменился: добавлено {len(add)}, удалено {len(rem)}, изменено {len(chg)} статей/пунктов')
            if add: lines.append('- Добавлены: ' + '; '.join(add[:80]) + (' …' if len(add) > 80 else ''))
            if rem: lines.append('- Удалены: ' + '; '.join(rem[:80]) + (' …' if len(rem) > 80 else ''))
            if chg:
                lines.append('- Изменены: ' + '; '.join(chg[:80]) + (' …' if len(chg) > 80 else ''))
                if not a.quiet:
                    for k in chg[:25]: lines.append(f'  - {k}\n{short_diff(uo[k], un[k])}')
        else: lines.append('- Текст не изменился')
        if broken:
            lines.append(f'- ⚠ Цитаты НЕ найдены в новом тексте ({len(broken)} вопр.) — вопрос нужно проверить/переписать:')
            for q in broken[:60]: lines.append(f"  - {q['ext_id']} [{q['base']}] {q.get('ref', '')}: «{q['missing'][:140]}»")
        if moved:
            lines.append(f'- Сдвиг нумерации ({len(moved)} вопр.): цитата на месте, но под другим номером пункта:')
            for q in moved[:60]: lines.append(f"  - {q['ext_id']} [{q['base']}] источник «{q.get('ref', '')}»: было под п. {q['old_ref']}, теперь п. {q['new_ref']}")
        rep.append('\n'.join(lines))
    if a.apply:
        for doc_id, md in new_texts.items():
            p = os.path.join(DOCS, doc_id + '.md')
            old = open(p, encoding='utf8').read() if os.path.exists(p) else ''
            if norm(body_of(old)) != norm(body_of(md)): open(p, 'w', encoding='utf8').write(md)
    total_q = len(quotes)
    payload = {
        'mode': 'check', 'offline': bool(a.offline), 'partial': bool(only), 'applied_locally': bool(a.apply and changed_docs),
        'source': 'publish', 'runner': clip(socket.gethostname() or 'update-laws', 80), 'generated_at': int(time.time() * 1000),
        'documents': records,
        '_note': 'Файл описывает сверку на машине проверки. В D1 он попадает только через tools/publish_law_report.py. Одобрение в портале не переписывает ответы вопросов.',
    }
    save_report(payload)
    if not rep and not errors:
        print('NO_CHANGES'); return 0
    out = [f'# Проверка законодательства переаттестаций — {stamp}', '',
           f'Документов проверено: {len(new_texts)}; изменились: {len(changed_docs)} ({", ".join(changed_docs) or "—"}); '
           f'вопросов проверено: {total_q}; цитата не найдена: {len(broken_all)}; сдвиг нумерации: {len(moved_all)}.']
    if a.apply and changed_docs: out.append(f'Новые тексты ЗАПИСАНЫ в content/reatt6/docs ({", ".join(changed_docs)}). Дальше: node tools/reatt6/build.js, тесты, миграция, деплой.')
    elif changed_docs: out.append('Ничего не записано в документы (режим проверки). Машиночитаемая копия — content/reatt6/laws_report.json; в базу портала она попадает только через tools/publish_law_report.py. Локальная запись md: python3 tools/update_laws.py --apply (это всё ещё не D1 и не вопросы).')
    if skipped: out += ['', 'Не проверяются автоматически:'] + ['- ' + s for s in skipped]
    if errors: out += ['', 'Ошибки:'] + ['- ' + e for e in errors]
    out += [''] + rep
    text = '\n'.join(out) + '\n'
    open(os.path.join(ROOT, 'content/reatt6/LAWS_UPDATE.md'), 'w', encoding='utf8').write(text)
    print(text)
    return 1 if errors and not rep else 2
if __name__ == '__main__': sys.exit(main())
