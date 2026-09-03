(() => {
  const navItems = [...document.querySelectorAll('.nav[data-page]')];
  const pages = [...document.querySelectorAll('.page')];

  function openPage(name) {
    navItems.forEach((item) => item.classList.toggle('active', item.dataset.page === name));
    pages.forEach((page) => page.classList.toggle('active', page.id === `page-${name}`));
    history.replaceState(null, '', `#${name}`);
  }

  navItems.forEach((item) => item.addEventListener('click', () => openPage(item.dataset.page)));

  const initial = location.hash.replace(/^#/, '');
  if (initial && document.getElementById(`page-${initial}`)) openPage(initial);
})();