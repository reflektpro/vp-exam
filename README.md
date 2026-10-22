# ГУ ВП — Учебный центр (лекции и экзамены)

Отдельный сайт для кандидатов в ГУ ВП (RMRP, «Патрики»): вход через Discord → просмотр лекций без перемотки → экзамен → проверка экзаменатором.
Не связан с сайтом рапортов (vp-raport / curly-disk-ebd7) — свой Worker, своя база, своё Discord-приложение (или общее, см. ниже).

| Что | Где |
|---|---|
| Сайт (GitHub Pages) | https://reflektpro.github.io/vp-exam/ |
| API (Cloudflare Worker) | https://vp-exam-api.reflektpro8.workers.dev |
| База (Cloudflare D1) | `vp-exam-db`, id `ce68b5b2-5aa7-4b69-9f7a-edb1b1744cb9` |
| Discord Redirect URI | `https://vp-exam-api.reflektpro8.workers.dev/auth/callback` |
| Главные администраторы | Discord ID `417660389723996170`, `711459160268734505` (переменная `ADMIN_IDS`) |

## Как включить вход через Discord (обязательно, сейчас вход выключен)

Пока не заданы ключи, API отвечает «OAuth не настроен», а кнопка входа на сайте неактивна.

1. Откройте https://discord.com/developers/applications.
   - **Вариант А (рекомендуется):** «New Application» → назовите, например, «ГУ ВП Учебный центр».
   - **Вариант Б:** взять существующее приложение сайта рапортов. Тогда нужен его *текущий* Client Secret.
     ⚠️ Не нажимайте «Reset Secret» в существующем приложении — иначе сломается вход на сайте рапортов.
2. В приложении: **OAuth2 → Redirects → Add Redirect** и вставьте ровно:
   `https://vp-exam-api.reflektpro8.workers.dev/auth/callback` → **Save Changes**.
3. Там же скопируйте **Client ID** и **Client Secret** (для нового приложения — «Reset Secret», чтобы показать его).
4. Cloudflare Dashboard → **Workers & Pages → vp-exam-api → Settings → Variables and Secrets → Add**:
   - `DISCORD_CLIENT_ID` — тип **Secret** (можно Text, но Secret сохраняется при повторных деплоях через API);
   - `DISCORD_CLIENT_SECRET` — тип **Secret**.
   → **Deploy**. Или из консоли: `npx wrangler secret put DISCORD_CLIENT_ID` и `npx wrangler secret put DISCORD_CLIENT_SECRET` в папке `worker/`.
5. Проверка: https://vp-exam-api.reflektpro8.workers.dev/health должно показать `"oauth_configured":true`, а на сайте кнопка «Войти через Discord» станет активной.

Запрашиваемый scope — только `identify` (ID, ник, аватар).

## Архитектура

```
GitHub Pages (статический HTML/JS/CSS, без сборки)        Cloudflare Worker vp-exam-api            D1 vp-exam-db
index.html, app.js, player.js, admin.js, style.css  ──►  worker/worker.js (один ES-модуль)  ──►  users, sessions, lectures,
config.js (адрес API)        Authorization: Bearer        CORS только https://reflektpro.github.io     lecture_progress, exams, questions,
                                                                                                    attempts, answers, settings, audit_log
```

**Вход:** сайт → `GET /auth/login?return=<url сайта>` → Discord → `GET /auth/callback` (worker меняет code на токен Discord, читает `/users/@me`,
создаёт/обновляет пользователя, выдаёт одноразовый `login_code` на 2 минуты) → редирект на сайт `?login_code=…` → сайт делает
`POST /auth/exchange` и получает сессионный токен (хранится в `localStorage`, в базе — только SHA-256 хеш; срок 7 дней).
Cookie не используются (разные домены github.io / workers.dev), поэтому CSRF неактуален. `state` OAuth хранится в D1 (10 минут).

**Роли:** `candidate` (по умолчанию), `examiner` (проверка попыток, просмотр кандидатов), `admin` (всё).
ID из `ADMIN_IDS` всегда `admin` и не могут быть понижены/заблокированы через сайт. Назначать/снимать админов может только главный админ;
обычный админ может назначать проверяющих. Права проверяются на сервере в каждом запросе `/api/admin/*`.

**Защита от перемотки лекций:**
- Клиент: свой плеер без полосы перемотки (пуск/пауза, «назад 10 с», громкость, полный экран; скорость зафиксирована 1×),
  попытка перемотать вперёд дальше уже просмотренного откатывается, назад — можно. Продолжение с последней позиции.
  Видео ставится на паузу при скрытии вкладки (`PAUSE_ON_HIDDEN` в `config.js`).
- Сервер: плеер шлёт heartbeat каждые 10 с и при play/pause/ended. Прирост позиции принимается, только если он
  ≤ `реальное время с прошлого heartbeat × 1.1 + 2 с` и ≤ 40 с за раз. Иначе — отказ и откат (счётчик отказов виден админу).
  Лекция засчитана, когда `max_pos ≥ длительность − 3 с` **и** засчитанное время просмотра ≥ 95 % длительности.
- Длительность задаёт админ (кнопка «Определить по видео» читает её из файла). Если длительность указана больше реальной, лекцию нельзя будет досмотреть — проверяйте.

**Экзамен:** вопросы 4 типов: один ответ, несколько ответов, краткий текст, развёрнутый текст. Параметры: лимит времени, лимит попыток,
пауза между попытками, проходной %, перемешивание вопросов/вариантов, «только после всех обязательных лекций», публикация.
Правильные ответы и эталоны никогда не отправляются кандидату. Варианты проверяются автоматически (multi — только точное совпадение),
текстовые идут на ручную проверку. Таймер проверяется на сервере: после дедлайна (+30 с запаса) попытка завершается автоматически
с сохранёнными ответами (ответы автосохраняются каждые 15 с). Пока попытка на проверке или экзамен сдан — новая попытка не начинается.
Кандидат видит итог (СДАН / НЕ СДАН / НА ПРОВЕРКЕ), процент и комментарий проверяющего, но не разбор по вопросам.

## Как наполнить сайт (через «Управление»)

1. **Видео.** Нужна прямая ссылка на файл `.mp4` (H.264/AAC) или `.webm`. Варианты:
   - положить файл в папку `videos/` этого репозитория (до ~90 МБ на файл) и указать `videos/lecture1.mp4`;
   - любой хостинг с прямой ссылкой https (сервер должен поддерживать Range-запросы).
   YouTube/ВК не подходят (нужен именно файл). Ссылки Discord CDN со временем истекают — не используйте их.
   R2 на аккаунте Cloudflare сейчас не включён, поэтому загрузки видео через сайт нет (см. «Ограничения»).
2. **Лекции:** «Лекции» → «Добавить лекцию»: название, описание, ссылка, «Определить по видео» → длительность, «Обязательная», «Опубликована».
   Порядок — стрелками ↑↓. Лекции открываются строго по порядку (выключается в «Настройках»).
3. **Экзамен:** «Экзамены» → «Создать экзамен» → сохранить → добавить вопросы (для вариантов — отметить правильные; для текстовых — эталон для проверяющего) → «Опубликован».
4. **Проверка:** «Проверка» → попытка → баллы за текстовые ответы (можно переопределить и автобаллы) → решение «По баллам» / «Сдан» / «Не сдан» + комментарий.
5. **Кандидаты:** поиск, прогресс по лекциям, сброс прогресса (одной лекции или всех), удаление попыток, роль, блокировка.
6. **Настройки:** название сайта, приветствие, последовательное открытие лекций. **Журнал** — все действия админов.

## API

Все `/api/*` требуют `Authorization: Bearer <token>`. Ответы JSON, ошибки — `{ "error": "текст" }`.

| Метод | Путь | Кто | Описание |
|---|---|---|---|
| GET | `/health` | все | статус, `oauth_configured` |
| GET | `/api/config` | все | настройки сайта, `oauth_configured`, `redirect_uri` |
| GET | `/auth/login?return=URL` | все | редирект в Discord (или «OAuth не настроен») |
| GET | `/auth/callback` | Discord | обработка OAuth |
| POST | `/auth/exchange` `{code}` | все | обмен одноразового кода на токен |
| POST | `/api/logout` | вошедший | завершить сессию |
| GET/PUT | `/api/me` | вошедший | профиль (`ic_name`, `static_id`, `rank`) |
| GET | `/api/lectures` | вошедший | лекции со статусами |
| GET | `/api/lectures/:id` | вошедший | лекция + ссылка на видео (если открыта) |
| POST | `/api/lectures/:id/heartbeat` `{position,event}` | вошедший | прогресс просмотра |
| GET | `/api/exams`, `/api/exams/:id` | вошедший | экзамены и доступность |
| POST | `/api/exams/:id/start` | вошедший | начать/продолжить попытку |
| GET | `/api/attempts/:id` | владелец | вопросы (без ответов) или итог |
| PUT | `/api/attempts/:id/answers` `{answers}` | владелец | автосохранение |
| POST | `/api/attempts/:id/submit` `{answers}` | владелец | отправить |
| GET | `/api/my/attempts` | вошедший | мои попытки |
| GET | `/api/admin/stats` | examiner+ | сводка |
| GET/POST | `/api/admin/lectures` ; PUT/DELETE `/api/admin/lectures/:id` ; POST `/api/admin/lectures/reorder {ids}` | admin | лекции |
| GET/POST | `/api/admin/exams` ; GET/PUT/DELETE `/api/admin/exams/:id` | admin | экзамены |
| POST | `/api/admin/exams/:id/questions` ; `/api/admin/exams/:id/questions/reorder` ; PUT/DELETE `/api/admin/questions/:id` | admin | вопросы |
| GET | `/api/admin/users?q=` ; `/api/admin/users/:discordId` | examiner+ | кандидаты и прогресс |
| PUT | `/api/admin/users/:discordId` `{role, blocked}` | admin | роль, блокировка |
| POST | `/api/admin/users/:id/reset-progress {lecture_id?}` ; `/reset-attempts {exam_id?}` | admin | сбросы |
| GET | `/api/admin/attempts?status=` ; `/api/admin/attempts/:id` | examiner+ | попытки с ответами |
| POST | `/api/admin/attempts/:id/review` `{points:{qid:n}, verdict:auto|passed|failed, comment}` | examiner+ | проверка |
| DELETE | `/api/admin/attempts/:id` | admin | удалить попытку |
| GET/PUT | `/api/admin/settings` | admin | настройки |
| GET | `/api/admin/audit` | admin | журнал |

Безопасность: CORS только для `ALLOWED_ORIGINS`; все SQL-запросы параметризованы; валидация длины/типов; лимиты запросов
(вход 30/10 мин с IP, heartbeat 40/мин, автосохранение 60/мин, старт экзамена 10/мин); сессии 7 дней; при блокировке сессии удаляются.

## Переменные Worker

| Имя | Тип | Значение |
|---|---|---|
| `DB` | D1 | `vp-exam-db` |
| `ADMIN_IDS` | text | `417660389723996170,711459160268734505` |
| `ALLOWED_ORIGINS` | text | `https://reflektpro.github.io` |
| `FRONTEND_URL` | text | `https://reflektpro.github.io/vp-exam/` |
| `DISCORD_CLIENT_ID` | secret | задаёт владелец |
| `DISCORD_CLIENT_SECRET` | secret | задаёт владелец |
| `DISCORD_REDIRECT_URI` | text, необязательно | по умолчанию `<адрес worker>/auth/callback` |

Тестового входа в боевом Worker нет: заглушка `/__test/login` живёт только в `tests/test-worker.js` и работает лишь при `TEST_MODE=1` и хосте localhost.

## Деплой и миграции

- Схема: `worker/migrations/0001_init.sql` (идемпотентна, `CREATE TABLE IF NOT EXISTS`). Новые изменения схемы — новыми файлами `0002_…sql`.
  Применить: `cd worker && npx wrangler d1 migrations apply vp-exam-db --remote` (или выполнить SQL в консоли D1).
- Worker: `cd worker && npx wrangler deploy` (конфиг `worker/wrangler.toml`). Секреты при деплое сохраняются.
- Сайт: push в `main` → GitHub Pages публикует из корня. Адрес API — в `config.js`.

## Локальный тест

```bash
cd tests
npm i wrangler@4 playwright@1 && npx playwright install chromium
npx wrangler d1 execute vp-exam-db-local --local --file=../worker/migrations/0001_init.sql
ffmpeg -f lavfi -i testsrc=size=640x360:rate=25:duration=20 -f lavfi -i sine=frequency=440:duration=20 -c:v libvpx-vp9 -c:a libopus -shortest test20.webm
node serve.js &            # сайт на http://localhost:8080 (с Range), видео — /__media/test20.webm
npx wrangler dev --port 8787 --ip 127.0.0.1 &
node e2e.js                # сквозной тест + скриншоты в tests/shots/
```

## Ограничения

- Защита от перемотки не абсолютна: пользователь с навыками может слать heartbeat скриптом, но не быстрее реального времени —
  то есть «пропустить» лекцию можно, лишь потратив то же время (видео при этом может не смотреть). Смотреть, слушает ли человек, сервер не может.
- Прямая ссылка на видео доступна вошедшему кандидату (её можно скачать). Для закрытой раздачи нужен R2 (включить в Cloudflare Dashboard)
  с выдачей видео через Worker — заготовки нет, можно добавить позже.
- Если кандидат пересматривает уже засчитанную лекцию, прогресс не сбрасывается.
- Лимиты запросов реализованы через D1 (не через Cloudflare Rate Limiting) — для небольшой фракции этого достаточно.
