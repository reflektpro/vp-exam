# Прототип консольной главной

Отдельная страница: `prototype/console/`. Боевой портал, Worker и D1 здесь не меняются. Адрес на GitHub Pages: `/vp-exam/prototype/console/`. Заголовок документа: «Прототип — ГУ ВП».

Это макет режимов, не проверка прав. Переключатель «Сотрудник» / «Администратор» подменяет набор разделов. Кнопки ничего не сохраняют и не отправляют.

## Бланки

Сайт бланков берётся из `config.js`: `REPORTS_URL` без `otchet.html`.

- Сайт бланков: https://reflektpro.github.io/vp-raport-offline/ (проверено `HEAD`, HTTP 200, 8 ноября 2026).
- Еженедельный отчёт, отдельно от каталога бланков: https://reflektpro.github.io/vp-raport-offline/otchet.html (тот же ответ 200).

Ссылка открывается в новой вкладке (`target="_blank"`, `rel="noopener noreferrer"`). Репозиторий бланков этот прототип не правит. Запросов к API портала страница не делает.

## Фон

Тёмная тема только. Один кадр выбирается при загрузке документа и не меняется при выборе раздела или режима. Остальные файлы заранее не запрашиваются. В репозитории нет кадров RMRP / GTA: ниже документальные фото военной полиции, общественное достояние, затемнены локально в WebP. Это не скриншоты сервера.

| Файл | Источник | Лицензия |
| --- | --- | --- |
| `bg/mp-nv-check.webp` | [164th Military Police presence patrol, кадр 016](https://commons.wikimedia.org/wiki/File:164th_Military_Police_presence_patrol_120101-A-XU607-016.jpg), Sgt. 1st Class Lawree Washington, U.S. Army, DVIDS [505520](https://www.dvidshub.net/image/505520) | Public domain |
| `bg/mp-nv-vehicle.webp` | [тот же патруль, кадр 023](https://commons.wikimedia.org/wiki/File:164th_Military_Police_presence_patrol_120101-A-XU607-023.jpg), DVIDS [505521](https://www.dvidshub.net/image/505521) | Public domain |
| `bg/mp-mrzr.webp` | [759th Military Police Battalion, патруль на Polaris MRZR](https://commons.wikimedia.org/wiki/File:759th_Military_Police_Battalion_conduct_a_patrol_using_Polaris_MRZR_vehicles_to_support_southern_border_mission_(9120114).jpg), U.S. Army, 2nd Lt. Erica Esterly, ID 250617-A-EE188-1011 | Public domain |
| `bg/mp-sinai.webp` | [MFO Sinai, 1983, military police speed patrol](https://commons.wikimedia.org/wiki/File:%E2%80%A2_MFO-Sinai-1983-Military-Police-Speedgun-Patrol-Dutch-and-Colombian.jpg), официальный фотограф MFO | Public domain |

## Эмблема

`emblem.svg` — копия `assets/emblem.svg`, тот знак, который уже стоит в шапке боевого портала. На нём эмблема Вооружённых Сил (двуглавый орёл, всадник на щите). Отдельного герба только военной полиции в репозитории нет, и для прототипа он не рисовался.

## Проверка

`node tests/e2e-console-proto.js` поднимает только эту папку. Страница не ходит в Worker, Discord и D1.
