-- 0015: адресат еженедельного отчёта (блок «Кому»): gu — военный комендант гарнизона, начальник ГУ ВП (прежний адресат),
-- zam_kombrig_rls — заместитель командира бригады по РЛС, kombrig — командир бригады.
-- Только новый столбец: все существующие отчёты получают прежнего адресата (gu), данные не меняются.
ALTER TABLE reports ADD COLUMN addressee TEXT NOT NULL DEFAULT 'gu';
CREATE INDEX IF NOT EXISTS idx_reports_week_addressee ON reports(week, addressee);
