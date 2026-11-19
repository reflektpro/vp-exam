#!/usr/bin/env python3
# Картинки форума в выгрузках: строки «[https://forum.rmrp.ru/attachments/<имя>.<id>/]» → файл assets/lectures/<тема>/<id>.webp
# и строка «![](assets/lectures/<тема>/<id>.webp)» (portal.js md() показывает её картинкой в тексте).
# Ссылки /attachments/… гостю отдают 403 (вход); полноразмерный файл берётся из <img src="…/data/attachments/…"> страницы темы форума (видна без входа).
# Гостю форум отдаёт только превью (высота до 150px; узкие баннеры — целиком), оригиналы — после входа.
# Без входа и cookies. Не скачалось — строка остаётся ссылкой. Запуск: python3 tools/content/fetch-images.py [--dry] [--mig NNNN_name.sql]
# Соответствие «ссылка → строка картинки» копится в tools/content/images.json; --mig пишет миграцию для прода
# (UPDATE … replace(body, '[ссылка]', '![…](…)') в lectures и docs; повторное применение ничего не меняет).
import html as htmlmod, re, sys, os, io, json, glob, hashlib, urllib.request
from PIL import Image
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '../..'))
UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36'
LINK = re.compile(r'^\[(https://forum\.rmrp\.ru/attachments/[a-z0-9_.-]+\.(\d+)/)\]$')
MAXW = 1600
dry = '--dry' in sys.argv
def get(url):
    r = urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'ru-RU,ru;q=0.9'}), timeout=60)
    return r.status, r.headers.get('content-type', ''), r.read()
MAP = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'images.json')
imap = json.load(open(MAP, encoding='utf8')) if os.path.exists(MAP) else {}
report = {'found': 0, 'replaced': 0, 'failed': [], 'files': {}, 'bytes': 0}
for f in sorted(glob.glob(os.path.join(ROOT, 'content/*/vygruzka.md'))):
    slug = os.path.basename(os.path.dirname(f)); text = open(f, encoding='utf8').read(); lines = text.split('\n')
    hits = [(i, LINK.match(l.strip())) for i, l in enumerate(lines) if LINK.match(l.strip())]
    if not hits: continue
    report['found'] += len(hits)
    thread = re.search(r'https://forum\.rmrp\.ru/threads/[A-Za-z0-9._-]+/', text).group(0)
    srcmap = {}; page = 1
    while True:
        st, ct, html = get(thread + (f'page-{page}' if page > 1 else '')); html = html.decode('utf8', 'replace')
        for m2 in re.finditer(r'<a href="(https://forum\.rmrp\.ru/attachments/[^"]+)"\s+target="_blank"><img src="(https://forum\.rmrp\.ru/data/attachments/[^"]+)"', html):
            pre = html[max(0, m2.start() - 3000):m2.start()]; k = pre.rfind('bbCodeSpoiler-button-title">'); alt = ''
            if k >= 0 and not re.search(r'</div>\s*</div>\s*</div>', pre[k:]):   # картинка внутри спойлера: его подпись на форуме — только alt
                alt = re.sub(r'\s+', ' ', htmlmod.unescape(pre[k:].split('>', 1)[1].split('<', 1)[0])).strip().replace('[', '(').replace(']', ')')
            srcmap.setdefault(m2.group(1), (m2.group(2), alt))
        if f'page-{page + 1}"' not in html or page >= 10: break
        page += 1
    outdir = os.path.join(ROOT, 'assets/lectures', slug); os.makedirs(outdir, exist_ok=True)
    for i, m in hits:
        url, aid = m.group(1), m.group(2); rel = f'assets/lectures/{slug}/{aid}.webp'; path = os.path.join(ROOT, rel)
        if not os.path.exists(path):
            src = (srcmap.get(url) or (None, ''))[0]
            try:
                if not src: raise RuntimeError('нет <img> на странице темы')
                st, ct, data = get(src)
                if st != 200 or not ct.startswith('image/'): raise RuntimeError(f'{st} {ct}')
                im = Image.open(io.BytesIO(data)); im.load()
                if im.mode not in ('RGB', 'RGBA'): im = im.convert('RGBA' if 'A' in im.mode or 'transparency' in im.info else 'RGB')
                if im.width > MAXW: im = im.resize((MAXW, round(im.height * MAXW / im.width)), Image.LANCZOS)
                if not dry: im.save(path, 'WEBP', quality=80, method=6)
            except Exception as e:
                report['failed'].append({'slug': slug, 'line': i + 1, 'url': url, 'error': str(e)}); continue
        alt = (srcmap.get(url) or (None, ''))[1]
        lines[i] = f'![{alt}]({rel})'; imap[f'[{url}]'] = lines[i]; report['replaced'] += 1
        if os.path.exists(path): report['files'][rel] = os.path.getsize(path)
    if not dry: open(f, 'w', encoding='utf8').write('\n'.join(lines))
if not dry: json.dump(imap, open(MAP, 'w', encoding='utf8'), ensure_ascii=False, indent=1, sort_keys=True)
if '--mig' in sys.argv:
    import time
    name = sys.argv[sys.argv.index('--mig') + 1]; ts = int(time.time() * 1000); q = lambda v: "'" + v.replace("'", "''") + "'"
    sql = ['-- Картинки форума в лекциях и полных выгрузках: строка-ссылка «[https://forum.rmrp.ru/attachments/…]» → «![…](assets/lectures/…)» (файл в репозитории).',
           '-- Сгенерировано tools/content/fetch-images.py --mig. Меняются только строки ссылок; повторное применение ничего не меняет.']
    for k, v in sorted(imap.items()):
        for t in ('lectures', 'docs'): sql.append(f'UPDATE {t} SET body = replace(body, {q(k)}, {q(v)}), updated_at = {ts} WHERE instr(body, {q(k)}) > 0;')
    open(os.path.join(ROOT, 'worker/migrations', name), 'w', encoding='utf8').write('\n'.join(sql) + '\n'); report['mig'] = {'file': name, 'statements': len(sql) - 2}
report['bytes'] = sum(report['files'].values())
print(json.dumps(report, ensure_ascii=False, indent=1))
