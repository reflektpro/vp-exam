#!/usr/bin/env python3
"""Скачивает заранее выбранные кадры Wikimedia Commons и собирает WebP/AVIF.

Список файлов фиксирован. Лицензия читается из метаданных Commons и пишется в assets/bg/catalog.json.
Скрипт не генерирует изображения.
"""
import json, os, re, subprocess, urllib.parse, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, 'assets', 'bg')
THUMB = os.path.join(OUT, 'thumbs')
UA = 'vp-exam-theme/1.0 (educational portal; contact student@example.com)'
ALLOWED = {'CC0', 'CC BY 2.0', 'CC BY 2.5', 'CC BY 3.0', 'CC BY 4.0', 'CC BY-SA 2.0', 'CC BY-SA 2.5', 'CC BY-SA 3.0', 'CC BY-SA 4.0', 'Public domain'}
PICKS = [
    ('quebec-night', 'Ночной город', 'Квебек', 'File:Chateau Frontenac illuminated at night in Quebec City.jpg'),
    ('kolkata-rain', 'Дождь на улице', 'Калькутта', 'File:Rainy night in Kolkata 02.jpg'),
    ('mekong-dusk', 'Река на закате', 'Луангпхабанг', 'File:Mountains Mekong river and dwellings seen from Mount Phou Si at dusk in Luang Prabang Laos.jpg'),
    ('nz-fog', 'Туман в лесу', 'Новая Зеландия', 'File:Sun getting through fog in the New Zealand bush, Bryant Range.jpg'),
    ('albert-bridge', 'Мост ночью', 'Лондон', 'File:Albert Bridge at night, London, UK - Diliff.jpg'),
    ('quebec-snow', 'Снежная улица', 'Квебек', 'File:Bike on a snowy street in Quebec City at night.jpg'),
    ('mojave', 'Пустыня в сумерках', 'Мохаве', 'File:Astronomical dusk over the Mojave Desert.jpg'),
    ('sea-rocks', 'Берег в сумерках', 'Лазарет', 'File:Rocks at dusk - Lazaret 01.jpg'),
    ('moscow-night', 'Город ночью', 'Москва', 'File:GES-2 at night - Moscow.jpg'),
    ('bay-bridge', 'Мост над заливом', 'Сан-Франциско', 'File:San Francisco Bay Bridge Western Span at night.jpg'),
    ('rooftop', 'Крыша ночью', 'Панорама', 'File:Rooftop night – Panorama (Greg Zaal via Poly Haven).jpg'),
    ('utah-dunes', 'Дюны', 'Юта', 'File:Utah Dunes Landscape - West Desert District.jpg'),
    ('highway', 'Ночная дорога', 'Рангпур', 'File:Rangpur city highway at night 1.jpg'),
]

def api(titles):
    url = 'https://commons.wikimedia.org/w/api.php?' + urllib.parse.urlencode({
        'action': 'query', 'format': 'json', 'titles': '|'.join(titles), 'prop': 'imageinfo',
        'iiprop': 'url|mime|extmetadata|size', 'iiurlwidth': '1600',
    })
    req = urllib.request.Request(url, headers={'User-Agent': UA})
    return json.load(urllib.request.urlopen(req, timeout=60))

def strip(html):
    text = re.sub(r'<[^>]+>', '', html or '')
    return re.sub(r'\s+', ' ', text).strip()

def main():
    os.makedirs(THUMB, exist_ok=True)
    pages = {}
    for i in range(0, len(PICKS), 6):
        data = api([p[3] for p in PICKS[i:i + 6]])
        for page in ((data.get('query') or {}).get('pages') or {}).values():
            pages[page.get('title')] = page
    items = []
    for pid, title, place, fname in PICKS:
        page = pages.get(fname) or pages.get(fname.replace('–', '-'))
        if not page or page.get('missing') is not None and 'imageinfo' not in page:
            # повтор с точным title из ответа не нужен: ищем по нормализации
            hit = next((p for t, p in pages.items() if t.lower().replace('–', '-') == fname.lower().replace('–', '-')), None)
            page = hit
        if not page or 'imageinfo' not in page:
            raise SystemExit('нет файла на Commons: ' + fname)
        info = page['imageinfo'][0]
        meta = info.get('extmetadata') or {}
        lic = strip((meta.get('LicenseShortName') or {}).get('value'))
        if lic not in ALLOWED:
            raise SystemExit(f'{fname}: лицензия {lic!r} не из разрешённого списка')
        author = strip((meta.get('Artist') or {}).get('value'))[:120]
        desc = info.get('descriptionurl') or ('https://commons.wikimedia.org/wiki/' + urllib.parse.quote(page['title'].replace(' ', '_')))
        lic_url = strip((meta.get('LicenseUrl') or {}).get('value')) or 'https://commons.wikimedia.org/wiki/Commons:Licensing'
        src = info.get('thumburl') or info.get('url')
        raw = os.path.join('/tmp', pid + os.path.splitext(src.split('?')[0])[1][:5])
        req = urllib.request.Request(src, headers={'User-Agent': UA})
        with urllib.request.urlopen(req, timeout=120) as res, open(raw, 'wb') as out:
            out.write(res.read())
        webp = os.path.join(OUT, pid + '.webp')
        avif = os.path.join(OUT, pid + '.avif')
        thumb = os.path.join(THUMB, pid + '.webp')
        subprocess.check_call(['ffmpeg', '-y', '-i', raw, '-vf', 'scale=1600:-2', '-c:v', 'libwebp', '-quality', '68', webp], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.check_call(['ffmpeg', '-y', '-i', raw, '-vf', 'scale=1600:-2', '-c:v', 'libaom-av1', '-still-picture', '1', '-cpu-used', '8', '-crf', '36', '-an', avif], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        subprocess.check_call(['ffmpeg', '-y', '-i', raw, '-vf', 'scale=480:-2', '-c:v', 'libwebp', '-quality', '58', thumb], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        os.remove(raw)
        items.append({
            'id': pid, 'title': title, 'place': place,
            'webp': f'assets/bg/{pid}.webp', 'avif': f'assets/bg/{pid}.avif', 'thumb': f'assets/bg/thumbs/{pid}.webp',
            'author': author, 'license': lic, 'license_url': lic_url, 'source': desc, 'commons_title': page['title'],
        })
        print(pid, lic, os.path.getsize(webp), os.path.getsize(avif))
    catalog = {'default': 'quebec-night', 'items': items}
    with open(os.path.join(OUT, 'catalog.json'), 'w', encoding='utf8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print('catalog', len(items))
if __name__ == '__main__':
    main()
