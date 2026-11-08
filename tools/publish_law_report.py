#!/usr/bin/env python3
"""Публикует машиночитаемый отчёт tools/update_laws.py в портал (D1).

Скрипт не деплоит Worker, не вызывает API Cloudflare и не меняет вопросы.
Боевой адрес без отдельного подтверждения отклоняется, чтобы случайный запуск не писал в боевую D1.

Переменные окружения (не аргументы командной строки — токен не должен оставаться в истории оболочки):
  VP_LAW_PUBLISH_URL      базовый URL API, например http://127.0.0.1:8787
  VP_LAW_PUBLISH_TOKEN    Bearer-сессия администратора портала
  VP_LAW_PUBLISH_CONFIRM  значение yes — только если URL указывает на боевой vp-exam-api
  LAW_REPORT_PATH         файл отчёта, по умолчанию content/reatt6/laws_report.json

Код выхода: 0 — опубликовано или тот же отчёт уже был принят; 1 — отказано, сеть или ответ сервера.
"""
import json, os, sys, urllib.error, urllib.request
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROD_HOST = 'vp-exam-api.reflektpro8.workers.dev'

def main():
    path = os.environ.get('LAW_REPORT_PATH') or os.path.join(ROOT, 'content/reatt6/laws_report.json')
    url = (os.environ.get('VP_LAW_PUBLISH_URL') or '').strip().rstrip('/')
    token = os.environ.get('VP_LAW_PUBLISH_TOKEN') or ''
    if not url or not token:
        print('Публикация не выполнена: задайте VP_LAW_PUBLISH_URL и VP_LAW_PUBLISH_TOKEN. Отчёт остаётся локальным файлом и в D1 сам не попадает.', file=sys.stderr)
        return 1
    host = urllib.request.urlparse(url).hostname or ''
    if host == PROD_HOST and os.environ.get('VP_LAW_PUBLISH_CONFIRM') != 'yes':
        print('Отказ: это боевой API. В D1 ничего не отправлено. Для боевой публикации задайте VP_LAW_PUBLISH_CONFIRM=yes.', file=sys.stderr)
        return 1
    if not os.path.exists(path):
        print(f'Нет отчёта {path}. Сначала выполните python3 tools/update_laws.py', file=sys.stderr)
        return 1
    with open(path, encoding='utf8') as f:
        payload = json.load(f)
    payload.pop('_note', None)
    if payload.get('mode') != 'check':
        print('В файле нет отчёта режима check. Публикация остановлена.', file=sys.stderr)
        return 1
    body = json.dumps(payload, ensure_ascii=False).encode('utf-8')
    req = urllib.request.Request(url + '/api/admin/laws/reports', data=body, method='POST', headers={
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
    })
    try:
        with urllib.request.urlopen(req, timeout=60) as res:
            raw = res.read().decode('utf-8', 'replace')
            code = res.status
    except urllib.error.HTTPError as e:
        raw = e.read().decode('utf-8', 'replace')
        code = e.code
    except urllib.error.URLError as e:
        print(f'Сеть: {e.reason}', file=sys.stderr)
        return 1
    try:
        data = json.loads(raw) if raw else {}
    except json.JSONDecodeError:
        data = {}
    if code not in (200, 201):
        print(f'Сервер отклонил отчёт ({code}): {data.get("error") or "без пояснения"}', file=sys.stderr)
        return 1
    check = data.get('check') or {}
    dup = 'повтор того же отчёта, новая карточка не создавалась' if data.get('duplicate') else 'отчёт записан'
    print(f'{dup}: проверка #{check.get("id")} статус {check.get("status")}; offline={check.get("offline")}; вопросы не изменялись')
    return 0
if __name__ == '__main__':
    sys.exit(main())
