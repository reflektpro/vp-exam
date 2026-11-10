// Разделы, видные пользователю в ленте главной: адреса всех действий каждой плитки (сотрудник, затем администратор).
async function shellMenu(p) {
  await p.waitForSelector('#rail .rail-item, .login', { timeout: 15000 });
  if (!(await p.evaluate(() => location.hash === '' || location.hash === '#/'))) { await p.goto(p.url().split('#')[0] + '#/'); await p.waitForSelector('#rail .rail-item'); }
  return p.evaluate(() => {
    const out = [];
    const take = () => { for (const t of [...document.querySelectorAll('#rail .rail-item')]) { t.click(); for (const a of document.querySelectorAll('#stage .act')) out.push(a.getAttribute('href')); } };
    const modes = document.getElementById('modes');
    if (!modes.hidden) document.querySelector('.mode[data-mode="staff"]').click();
    take();
    if (!modes.hidden) { document.querySelector('.mode[data-mode="admin"]').click(); take(); document.querySelector('.mode[data-mode="staff"]').click(); }
    return out;
  });
}
module.exports = { shellMenu };
