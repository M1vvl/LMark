import { getLocale } from './i18n.js';

const MENUS = {
  file: [['open', '打开文件', 'Open file', 'Ctrl O']],
  edit: [['undo', '撤销', 'Undo', 'Ctrl Z'], ['redo', '重做', 'Redo', 'Ctrl Y']],
  view: [['toggle-sidebar', '显示/隐藏工作区', 'Show/hide sidebar', 'Ctrl B'], ['theme', '主题设置', 'Theme settings', '']],
  help: [['shortcuts', '快捷键', 'Keyboard shortcuts', ''], ['about', '关于 LMark', 'About LMark', ''], ['feedback', '问题反馈', 'Feedback', '']]
};

export function createMenuController({ onAction }) {
  const popover = document.getElementById('menuPopover');
  let activeMenu = null;
  function close() { popover.hidden = true; activeMenu = null; document.querySelectorAll('.menu-trigger').forEach((button) => button.removeAttribute('aria-expanded')); }
  function open(name, trigger) {
    close();
    activeMenu = name; popover.innerHTML = '';
    MENUS[name].forEach(([id, zh, en, shortcut]) => { const label = getLocale() === 'en' ? en : zh; const item = document.createElement('button'); item.className = `menu-item${id === 'feedback' ? ' feedback-menu-item' : ''}`; item.setAttribute('role', 'menuitem'); item.setAttribute('data-feedback', id === 'feedback' ? 'Email: 1070764333@qq.com  ·  QQ: 1070764333  ·  WeChat: _9C2cyo' : ''); item.setAttribute('role', 'menuitem'); item.innerHTML = `<span>${label}</span><span class="menu-shortcut">${shortcut}</span>`; item.onclick = () => { onAction(id); close(); }; popover.append(item); });
    const rect = trigger.getBoundingClientRect(); popover.style.left = `${rect.left}px`; popover.style.top = `${rect.bottom + 4}px`; popover.hidden = false; trigger.setAttribute('aria-expanded', 'true');
  }
  document.querySelectorAll('.menu-trigger').forEach((trigger) => trigger.addEventListener('click', () => activeMenu === trigger.dataset.menu ? close() : open(trigger.dataset.menu, trigger)));
  document.addEventListener('click', (event) => { if (!event.target.closest('.menu-bar') && !event.target.closest('.menu-popover')) close(); });
}
