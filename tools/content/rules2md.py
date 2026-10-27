# Генератор выгрузки и лекций для тем «OOC-правила проекта» из официального текста правил (форум RMRP, локальная копия rmrp_laws).
# Пункты правил приводятся дословно; пояснения «Что важно для ВП» — методические, помечены отдельно.
# python3 rules2md.py <spec.json>  → content/<slug>/{vygruzka.md, meta.json}
import json, re, sys, os
spec = json.load(open(sys.argv[1]))
src = open(spec['source']).read()
url = re.search(r'^- URL: (.*)$', src, re.M).group(1)
edited = re.search(r'^- (?:Последнее редактирование|Опубликовано): (.*?) \(', src, re.M)
body = src.split('\n---\n', 1)[1] if '\n---\n' in src else src
lines = [l.rstrip() for l in body.split('\n') if l.strip() and l.strip() != '---']
points, order, cur, chapters = {}, [], None, {}
for l in lines:
    m = re.match(r'^(\d+\.\d+)\.?\s', l)
    if re.match(r'^(Глава|ГЛАВА) [\dIVXLC]+', l): cur = None; chapters[l] = len(order); continue
    if m: cur = m.group(1); points[cur] = [l]; order.append(cur); continue
    if cur: points[cur].append(l)
def fmt(p):
    ls = points[p]; out = ['**' + ls[0].split(' ', 1)[0] + '** ' + ls[0].split(' ', 1)[1]]
    for x in ls[1:]: out.append('> ' + x if re.match(r'^(Примечание|Исключение|Пояснение)', x) else ('- ' + x.lstrip('•▸ ') if x[:1] in '•▸' else x))
    return '\n\n'.join(out)
used = set()
md = [f"> **Полная выгрузка темы «{spec['title']}».** Официальный текст правил проекта (дословно, по форуму RMRP: {url}{'; редакция от ' + edited.group(1) if edited else ''}) и методические пояснения для сотрудников ГУ ВП. Наказания в квадратных скобках — как в источнике.\n"]
for i, L in enumerate(spec['lectures'], 1):
    md.append(f'<!-- lec: {i} -->\n# {L["h"]}\n\n' + (L.get('intro', '') + '\n\n' if L.get('intro') else '') + '\n\n'.join(fmt(p) for p in L['points']))
    used.update(L['points'])
    if L.get('vp'): md.append(f'<!-- lec: {i} -->\n## Что важно для сотрудника ВП\n\n' + '\n'.join('- ' + x for x in L['vp']))
rest = [p for p in order if p not in used and (not spec.get('rest_chapters') or p.split('.')[0] in spec['rest_chapters'])]
if rest: md.append('<!-- lec: - -->\n# ' + spec.get('rest_title', 'Остальные пункты правил') + '\n\n' + '\n\n'.join(fmt(p) for p in rest))
if spec.get('extra'): md.append('<!-- lec: - -->\n' + spec['extra'])
md.append(f'<!-- lec: - -->\n# Источник\n\n- {spec["title"]}: {url}\n- Текст сверен с локальной копией форума; при изменении правил на форуме выгрузку нужно обновить.')
d = os.path.join(os.path.dirname(__file__), '../../content', spec['slug']); os.makedirs(d, exist_ok=True)
open(os.path.join(d, 'vygruzka.md'), 'w').write('\n\n'.join(md) + '\n')
meta = {'slug': spec['slug'], 'status': 'draft', 'doc': {'category': 'Курсы: полные выгрузки', 'title': spec['title'] + ' — полная выгрузка'},
        'lectures': [{'n': i, 'title': f'Лекция {i}. ' + L['h']} for i, L in enumerate(spec['lectures'], 1)]}
if spec.get('publish_exams'): meta['publish_exams'] = spec['publish_exams']
json.dump(meta, open(os.path.join(d, 'meta.json'), 'w'), ensure_ascii=False, indent=1)
print(spec['slug'], 'пунктов', len(order), 'в лекциях', len(used), 'только в выгрузке', rest)
