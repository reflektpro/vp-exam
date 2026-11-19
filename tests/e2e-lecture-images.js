// Картинки форума в лекциях и выгрузках (t56): строки-ссылки на вложения форума заменены на «![…](assets/lectures/…)»,
// файлы лежат в репозитории, на сайте видны внутри текста (лениво, без подписей и без ссылок), на 390 px без прокрутки вбок.
// Запуск: bash /tmp/reset.sh; node tools/content/build.js; node tools/content/apply-local.js; node tests/e2e-lecture-images.js
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const API = 'http://localhost:8787', SITE = 'http://localhost:8080/';
const ROOT = path.join(__dirname, '..');
const results = [];
const check = (name, cond, extra) => { results.push({ name, ok: !!cond }); console.log((cond ? 'PASS ' : 'FAIL ') + name + (!cond && extra !== undefined ? ' :: ' + JSON.stringify(extra).slice(0, 600) : '')); };
const login = async (id, name, roles) => (await (await fetch(`${API}/__test/login?id=${id}&name=${encodeURIComponent(name)}${roles !== undefined ? '&roles=' + roles : ''}`)).json()).token;
const sql = async (q, args) => (await (await fetch(API + '/__test/sql', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sql: q, args }) })).json()).results;
const IMG = /^!\[([^\]]*)\]\((assets\/lectures\/[a-z0-9_\/-]+\.webp)\)$/mg;
(async () => {
  // 1. исходники и файлы
  const per = {}; let links = 0; const paths = new Set();
  for (const slug of fs.readdirSync(ROOT + '/content')) { const f = ROOT + `/content/${slug}/vygruzka.md`; if (!fs.existsSync(f)) continue;
    const s = fs.readFileSync(f, 'utf8'); links += (s.match(/^\[https:\/\/forum\.rmrp\.ru\/attachments\/[^\]]+\]$/mg) || []).length;
    const m = [...s.matchAll(IMG)]; if (m.length) per[slug] = m.length; m.forEach(x => paths.add(x[2])); }
  check('в выгрузках не осталось строк-ссылок на вложения форума', links === 0, links);
  check('картинок в выгрузках: ФЗ территории 26, ПОиП 4, ФЗ воздух 2', JSON.stringify(per) === JSON.stringify({ 'fz-territorii': 26, 'fz-vozduh': 2, 'ooc-poip': 4 }), per);
  const sizes = [...paths].map(p => fs.existsSync(ROOT + '/' + p) ? fs.statSync(ROOT + '/' + p).size : -1);
  check(`файлы на месте, webp, каждый ≤ 100 КБ, всего ≤ 400 КБ (${paths.size} шт., ${sizes.reduce((a, b) => a + b, 0)} Б)`, sizes.every(n => n > 500 && n <= 102400) && sizes.reduce((a, b) => a + b, 0) <= 409600
    && [...paths].every(p => fs.readFileSync(ROOT + '/' + p).subarray(8, 12).toString() === 'WEBP'), sizes);
  const mig = fs.readFileSync(ROOT + '/worker/migrations/0034_lecture_images.sql', 'utf8');
  const map = JSON.parse(fs.readFileSync(ROOT + '/tools/content/images.json', 'utf8'));
  check('миграция 0034: по UPDATE на ссылку в lectures и docs, только replace строки ссылки, повторное применение — без изменений',
    Object.keys(map).length === 31 && mig.split('\n').filter(l => /^UPDATE (lectures|docs) SET body = replace\(body, '\[https:\/\/forum\.rmrp\.ru\/attachments\/[^']+\]', '!\[[^']*\]\(assets\/lectures\/[^']+\)'\), updated_at = \d+ WHERE instr\(body, '\[https[^']+\]'\) > 0;$/.test(l)).length === 62);
  // 2. база (после apply-local)
  const B = JSON.parse(fs.readFileSync(ROOT + '/content/build/content.json', 'utf8'));
  const blec = B.flatMap(t => t.lectures.filter(l => l.body.includes('](assets/lectures/')).map(l => l.title));
  const lec = await sql("SELECT l.id, l.title, l.body FROM lectures l JOIN topics t ON t.id = l.topic_id WHERE l.body LIKE '%](assets/lectures/%' ORDER BY l.id");
  const docs = await sql("SELECT id, title, body FROM docs WHERE body LIKE '%](assets/lectures/%' ORDER BY id");
  check('в базе: лекции с картинками как в сборке (на проде — только «Взлёт и посадка»), 3 выгрузки, ссылок на вложения форума нет', lec.length === blec.length && lec.every(l => blec.includes(l.title)) && docs.length === 3
    && !(await sql("SELECT COUNT(*) AS n FROM lectures WHERE body LIKE '%forum.rmrp.ru/attachments/%'"))[0].n && !(await sql("SELECT COUNT(*) AS n FROM docs WHERE body LIKE '%forum.rmrp.ru/attachments/%'"))[0].n, { lec: lec.length, docs: docs.map(d => d.title) });
  // 3. сайт
  const uid = '840000000000000078'; const T = await login(uid, 'vp_images', 'vp');
  for (const l of await sql('SELECT id, duration_sec FROM lectures')) await sql('INSERT OR REPLACE INTO lecture_progress (user_id, lecture_id, max_pos, last_pos, watched_sec, last_hb_at, started_at, completed_at) VALUES (?1, ?2, ?3, ?3, ?3, 0, 0, 1)', [uid, l.id, l.duration_sec || 600]);
  const b = await chromium.launch({ args: ['--no-sandbox'] }); const errs = [], bad404 = [], forum = [];
  for (const vp of [{ width: 1300, height: 900 }, { width: 390, height: 800 }]) {
    const ctx = await b.newContext({ viewport: vp, locale: 'ru-RU' }); await ctx.addInitScript(t => localStorage.setItem('vpexam_token', t), T);
    const page = await ctx.newPage(); page.on('pageerror', e => errs.push(e.message));
    page.on('response', r => { if (/\/assets\/lectures\//.test(r.url()) && r.status() !== 200) bad404.push(r.url() + ' ' + r.status()); });
    page.on('request', r => { if (/forum\.rmrp\.ru/.test(r.url())) forum.push(r.url()); });
    const look = async () => page.evaluate(async () => {
      const box = document.querySelector('.lecture-text').getBoundingClientRect(); const imgs = [...document.querySelectorAll('.lecture-text figure.lec-img img')];
      for (const i of imgs) { i.loading = 'eager'; if (!i.complete) await new Promise(r => { i.onload = i.onerror = r; setTimeout(r, 4000); }); }
      return { n: imgs.length, only: [...document.querySelectorAll('.lecture-text img')].length === imgs.length,
        ok: imgs.every(i => i.naturalWidth > 0 && i.getBoundingClientRect().width > 20 && i.getBoundingClientRect().left >= box.left - 1 && i.getBoundingClientRect().right <= box.right + 1),
        noCap: !document.querySelector('.lecture-text figure.lec-img figcaption') && !document.querySelector('.lecture-text figure.lec-img a') && !document.querySelector('.lecture-text a[href*="forum.rmrp.ru/attachments"]'),
        text: !/forum\.rmrp\.ru\/attachments|assets\/lectures|!\[/.test(document.querySelector('.lecture-text').textContent), ow: document.documentElement.scrollWidth - innerWidth };
    });
    const L = lec.find(l => l.title === 'Лекция 1. Взлёт и посадка воздушных судов');
    await page.goto(SITE + '#/lecture/' + L.id); await page.waitForSelector('.lecture-text'); await page.waitForTimeout(600);
    const lazyAttr = await page.$$eval('.lecture-text figure.lec-img img', x => x.map(i => i.getAttribute('loading') + '/' + i.getAttribute('decoding')));
    check(`лекция: картинка лениво (loading=lazy, decoding=async) (${vp.width})`, lazyAttr.length === 1 && lazyAttr.every(a => a === 'lazy/async'), lazyAttr);
    let st = await look();
    check(`лекция ФЗ воздух: 1 картинка видна, внутри текста, без подписи и ссылок, без прокрутки вбок (${vp.width})`, st.n === 1 && st.only && st.ok && st.noCap && st.text && st.ow <= 1, st);
    for (const d of docs) {
      await page.goto(SITE + '#/doc/' + d.id); await page.waitForSelector('.lecture-text'); await page.waitForTimeout(600); st = await look();
      const n = (d.body.match(IMG) || []).length;
      check(`выгрузка «${d.title.slice(0, 50)}»: ${n} картинок видны, без подписей и ссылок, без прокрутки вбок (${vp.width})`, n > 0 && st.n === n && st.only && st.ok && st.noCap && st.text && st.ow <= 1, st);
    }
    if (vp.width === 390) { fs.mkdirSync('/tmp/limg', { recursive: true }); await page.screenshot({ path: '/tmp/limg/doc-390.png', fullPage: false }); }
    // разметка: только картинки из assets/lectures, без выхода из папки и внешних адресов
    const r = await page.evaluate(() => ({ ext: md('![x](https://evil.example/a.webp)'), up: md('![x](assets/lectures/../../a.webp)'), q: md('![a"><script>1</script>](assets/lectures/x/1.webp)'), inl: md('текст ![x](assets/lectures/x/1.webp)') }));
    check(`md(): внешние адреса и «..» не становятся картинкой, alt экранируется (${vp.width})`, !/<img/.test(r.ext) && !/<img/.test(r.up) && !/<script/.test(r.q) && /<img src="assets\/lectures\/x\/1.webp" alt="a&quot;&gt;&lt;script&gt;/.test(r.q) && !/<img/.test(r.inl), r);
    await ctx.close();
  }
  check('все картинки отдаются (200), к форуму запросов нет', !bad404.length && !forum.length, { bad404, forum });
  check('без JS-ошибок', !errs.length, errs); await b.close();
  const ok = results.filter(x => x.ok).length; console.log(`\nИТОГО: ${ok}/${results.length} PASS`);
  process.exit(ok === results.length ? 0 : 1);
})().catch(e => { console.error(e); process.exit(1); });
