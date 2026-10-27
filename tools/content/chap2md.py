# Генератор выгрузки и лекций для уставов (по главам): текст глав приводится дословно по форуму RMRP (локальная копия rmrp_laws),
# пояснения «Что важно для ВП» — методические. python3 chap2md.py <spec.json> [--list]
import json, re, sys, os
spec = json.load(open(sys.argv[1]))
src = open(spec['source']).read()
url = re.search(r'^- URL: (.*)$', src, re.M).group(1)
ed = re.search(r'^- Последнее редактирование: (.*?) \(', src, re.M)
body = src.split('\n---\n', 1)[1]
H = re.compile(spec.get('heading', r'^(ГЛАВА|Глава|РАЗДЕЛ|Раздел|ОБЩИЕ ПОЛОЖЕНИЯ|Общие положения)\b'))
secs = []
for l in body.split('\n'):
    l = l.rstrip()
    if not l.strip() or l.strip() == '---' or l.startswith('[изображение') or l.startswith('[Спойлер'): continue
    if H.match(l.strip()): secs.append({'h': l.strip(), 'ls': []}); continue
    sp = next((v for k, v in spec.get('split', {}).items() if l.strip().startswith(k)), None)
    if sp and secs: secs.append({'h': sp, 'ls': [l.strip()]}); continue
    if secs: secs[-1]['ls'].append(l.strip())
if '--list' in sys.argv:
    for i, s in enumerate(secs): print(i, len(' '.join(s['ls'])), s['h'][:90])
    sys.exit()
def fmt(s):
    out = []
    for x in s['ls']:
        x = re.sub(r'^(•\s*)+', '• ', x)
        if x.startswith('•'): out.append('- ' + x[1:].strip())
        elif re.match(r'^(Примечание|Исключение|Пояснение)', x): out.append('> ' + x)
        else:
            m = re.match(r'^(\d+(?:\.\d+)*\.?)\s+(.*)', x)
            out.append(('**' + m.group(1) + '** ' + m.group(2)) if m else x)
    t = []
    for i, x in enumerate(out):  # пункты списка — подряд, абзацы — через пустую строку
        t.append(('\n' if x.startswith('- ') and i and out[i-1].startswith('- ') else '\n\n') + x)
    return ''.join(t).strip()
used = set()
md = [f"> **Полная выгрузка темы «{spec['title']}».** Текст устава приводится дословно по форуму RMRP ({url}{'; редакция от ' + ed.group(1) if ed else ''}); добавлены методические пояснения для сотрудников ГУ ВП.\n"]
for i, L in enumerate(spec['lectures'], 1):
    md.append(f'<!-- lec: {i} -->\n# {L["h"]}\n\n' + (L.get('intro', '') + '\n\n' if L.get('intro') else '') + '\n\n'.join(f'## {secs[j]["h"]}\n\n' + fmt(secs[j]) for j in L['sections']))
    used.update(L['sections'])
    if L.get('vp'): md.append(f'<!-- lec: {i} -->\n## Что важно для сотрудника ВП\n\n' + '\n'.join('- ' + x for x in L['vp']))
rest = [j for j in range(len(secs)) if j not in used and j not in spec.get('skip', [])]
if rest: md.append('<!-- lec: - -->\n# ' + spec.get('rest_title', 'Остальные главы устава') + '\n\n' + '\n\n'.join(f'## {secs[j]["h"]}\n\n' + fmt(secs[j]) for j in rest))
if spec.get('extra'): md.append('<!-- lec: - -->\n' + spec['extra'])
md.append(f'<!-- lec: - -->\n# Источник\n\n- {spec["title"]}: {url}\n- При изменении устава на форуме выгрузку нужно обновить.')
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../content', spec['slug']); os.makedirs(d, exist_ok=True)
open(os.path.join(d, 'vygruzka.md'), 'w').write('\n\n'.join(md) + '\n')
meta = {'slug': spec['slug'], 'status': 'draft', 'doc': {'category': 'Курсы: полные выгрузки', 'title': spec['title'] + ' — полная выгрузка'},
        'lectures': [{'n': i, 'title': f'Лекция {i}. ' + L['h']} for i, L in enumerate(spec['lectures'], 1)]}
if spec.get('publish_exams'): meta['publish_exams'] = spec['publish_exams']
json.dump(meta, open(os.path.join(d, 'meta.json'), 'w'), ensure_ascii=False, indent=1)
print(spec['slug'], 'глав', len(secs), 'в лекциях', sorted(used), 'только в выгрузке', rest)
