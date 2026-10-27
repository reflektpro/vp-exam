# Генератор выгрузки и лекций для законов (по статьям): тексты статей — дословно по форуму RMRP (локальная копия rmrp_laws),
# номера статей берутся только из источника. python3 art2md.py <spec.json> [--list]
import json, re, sys, os
spec = json.load(open(sys.argv[1]))
src = open(spec['source']).read()
url = re.search(r'^- URL: (.*)$', src, re.M).group(1)
ed = re.search(r'^- Последнее редактирование: (.*?) \(', src, re.M)
body = src.split('\n---\n', 1)[1]
A = re.compile(r'^Статья\s+(\d+(?:[.\-]\d+)*)\.?\s*(.*)$')
arts, order, cur, chap = {}, [], None, {}
lastchap = ''
for l in body.split('\n'):
    l = l.rstrip(); s = l.strip()
    if not s or s == '---' or s.startswith('[изображение') or s.startswith('[Спойлер'): continue
    m = A.match(s)
    if m:
        cur = m.group(1)
        if cur in arts: cur = cur + '#' + str(len(order))
        arts[cur] = {'n': m.group(1), 'h': s, 'ls': [], 'ch': lastchap}; order.append(cur); continue
    if re.match(r'^(Глава|ГЛАВА|Раздел|РАЗДЕЛ)\s', s): lastchap = s; cur = None; continue
    if cur: arts[cur]['ls'].append(s)
if '--list' in sys.argv:
    pc = None
    for k in order:
        a = arts[k]
        if a['ch'] != pc: print('  ##', a['ch'][:70]); pc = a['ch']
        print(k, len(' '.join(a['ls'])), a['h'][len('Статья '):][:70])
    sys.exit()
def fmt(k):
    a = arts[k]; out = ['### ' + a['h']]
    for x in a['ls']:
        x = re.sub(r'^(•\s*)+', '• ', x)
        if x.startswith('•') or x.startswith('- '): out.append('- ' + x.lstrip('•- ').strip())
        elif re.match(r'^(Примечание|Исключение|Пояснение)', x): out.append('> ' + x)
        else: out.append(x)
    t = out[0]
    for i, x in enumerate(out[1:], 1):
        t += ('\n' if x.startswith('- ') and out[i-1].startswith('- ') else '\n\n') + x
    return t
miss = [k for L in spec['lectures'] for k in L['arts'] if k not in arts] + [k for k in spec.get('rest', []) if k not in arts]
if miss: sys.exit('нет статей в источнике: ' + ', '.join(miss))
md = [f"> **Полная выгрузка темы «{spec['title']}».** Отобраны статьи, связанные со службой ВП или обязательные для любого госслужащего. Тексты статей — дословно по форуму RMRP ({url}{'; редакция от ' + ed.group(1) if ed else ''}); остальные статьи — в источнике.\n"]
for i, L in enumerate(spec['lectures'], 1):
    md.append(f'<!-- lec: {i} -->\n# {L["h"]}\n\n' + (L.get('intro', '') + '\n\n' if L.get('intro') else '') + '\n\n'.join(fmt(k) for k in L['arts']))
    if L.get('vp'): md.append(f'<!-- lec: {i} -->\n## Что важно для сотрудника ВП\n\n' + '\n'.join('- ' + x for x in L['vp']))
if spec.get('rest'): md.append('<!-- lec: - -->\n# ' + spec.get('rest_title', 'Дополнительные статьи') + '\n\n' + '\n\n'.join(fmt(k) for k in spec['rest']))
if spec.get('extra'): md.append('<!-- lec: - -->\n' + spec['extra'])
md.append(f'<!-- lec: - -->\n# Источник\n\n- {spec["title"]}: {url}\n- При изменении закона на форуме выгрузку нужно обновить.')
d = os.path.join(os.path.dirname(os.path.abspath(__file__)), '../../content', spec['slug']); os.makedirs(d, exist_ok=True)
open(os.path.join(d, 'vygruzka.md'), 'w').write('\n\n'.join(md) + '\n')
meta = {'slug': spec['slug'], 'status': 'draft', 'doc': {'category': 'Курсы: полные выгрузки', 'title': spec['title'] + ' — полная выгрузка'},
        'lectures': [{'n': i, 'title': f'Лекция {i}. ' + L['h']} for i, L in enumerate(spec['lectures'], 1)]}
if spec.get('publish_exams'): meta['publish_exams'] = spec['publish_exams']
if spec.get('keep_lectures'): meta['keep_lectures'] = True
json.dump(meta, open(os.path.join(d, 'meta.json'), 'w'), ensure_ascii=False, indent=1)
print(spec['slug'], 'статей в лекциях', sum(len(L['arts']) for L in spec['lectures']), 'только в выгрузке', len(spec.get('rest', [])))
