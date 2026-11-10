// Разделы, видные пользователю в ленте главной: адреса всех действий каждой плитки (сотрудник, затем администратор).
// Плитка сразу открывает свою рабочую страницу; остальные действия раздела — строка ссылок над страницей. Список берём
// из того же описания разделов, из которого строится лента, и сверяем, что набор плиток совпадает с лентой.
async function shellMenu(p) {
  await p.waitForSelector('#rail .rail-item, .login', { timeout: 15000 });
  if (!(await p.evaluate(() => location.hash === '' || location.hash === '#/'))) { await p.goto(p.url().split('#')[0] + '#/'); await p.waitForSelector('#rail .rail-item'); }
  return p.evaluate(() => {
    if (!document.querySelector('#rail .rail-item')) return [];
    const modes = document.getElementById('modes');
    const tiles = (m) => { if (!modes.hidden) document.querySelector(`.mode[data-mode="${m}"]`).click(); return [...document.querySelectorAll('#rail .rail-item')].length; };
    const n = tiles('staff') + (modes.hidden ? 0 : tiles('admin'));
    if (!modes.hidden) document.querySelector('.mode[data-mode="staff"]').click();
    const out = window.vpMenu();
    if (out.length < n) throw new Error('меню короче ленты');
    return out;
  });
}
module.exports = { shellMenu };
