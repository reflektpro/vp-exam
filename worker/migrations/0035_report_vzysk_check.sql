-- 0035: еженедельный отчёт — новый пункт «Проверка рапортов на взыскание» (vzysk_check, раздел «Работа ГУ ВП»).
-- Сам пункт и выплата (8000, как у рассмотрения рапортов на отработку/обжалование) — в PREM_DEFAULT.items воркера:
-- сохранённые в prem_config пункты дополняются недостающими по умолчанию, отдельная запись не нужна.
-- Здесь: если руководство уже сохраняло план (prem_config 'plan'), добавляем пункт в строку «Действия ГУ ВП»,
-- чтобы он считался в план, как вся «Работа ГУ ВП». Повторный запуск ничего не меняет.
UPDATE prem_config SET v = json_insert(v, '$[1].items[#]', 'vzysk_check')
WHERE k = 'plan' AND json_valid(v) AND json_extract(v, '$[1].key') = 'gu'
  AND NOT EXISTS (SELECT 1 FROM json_each(prem_config.v, '$[1].items') je WHERE je.value = 'vzysk_check');
