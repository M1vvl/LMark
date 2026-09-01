export function createGelSidebar() {
  const panel = document.getElementById('workspacePanel');
  const list = document.getElementById('workspaceSections');

  let lastScrollTop = list.scrollTop;
  let scrollTimer;
  list.addEventListener('scroll', () => {
    const direction = list.scrollTop > lastScrollTop ? 'down' : 'up';
    lastScrollTop = list.scrollTop;
    list.dataset.scrollDirection = direction;
    list.classList.add('is-scrolling');
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => list.classList.remove('is-scrolling'), 450);
  }, { passive: true });

  panel.addEventListener('pointermove', (event) => {
    const item = event.target.closest('.tree-item');
    if (!item) return;
    const rect = item.getBoundingClientRect();
    item.style.setProperty('--pointer-y', `${event.clientY - rect.top}px`);
  });
}
