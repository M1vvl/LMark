import { getLocale } from './i18n.js';

const MENUS = {
  file: [['open', '打开文件', 'Open file', 'Ctrl O']],
  edit: [['undo', '撤销', 'Undo', 'Ctrl Z'], ['redo', '重做', 'Redo', 'Ctrl Y']],
  view: [['toggle-sidebar', '显示/隐藏工作区', 'Show/hide sidebar', 'Ctrl B'], ['theme', '主题设置', 'Theme settings', '']],
  help: [['shortcuts', '快捷键', 'Keyboard shortcuts', ''], ['onboarding', '功能引导', 'Feature guide', ''], ['about', '关于 LMark', 'About LMark', ''], ['feedback', '问题反馈', 'Feedback', '']]
};

export function createMenuController({ onAction }) {
  const popover = document.getElementById('menuPopover');
  let activeMenu = null;
  let feedbackTip = null;
  let feedbackTimer = 0;
  function closeFeedbackTip() { clearTimeout(feedbackTimer); feedbackTip?.remove(); feedbackTip = null; }
  function showFeedbackTip(anchor) {
    closeFeedbackTip();
    feedbackTip = document.createElement('div');
    feedbackTip.className = 'feedback-tooltip';
    feedbackTip.setAttribute('role', 'tooltip');
    feedbackTip.textContent = '作者联系方式\nEmail: 1070764333@qq.com\nQQ: 1070764333\nWeChat: _9C2cyo';
    document.body.append(feedbackTip);
    const rect = anchor.getBoundingClientRect();
    feedbackTip.style.left = `${Math.min(window.innerWidth - feedbackTip.offsetWidth - 10, rect.right + 8)}px`;
    feedbackTip.style.top = `${Math.max(8, Math.min(window.innerHeight - feedbackTip.offsetHeight - 8, rect.top))}px`;
    feedbackTip.addEventListener('mouseenter', () => clearTimeout(feedbackTimer));
    feedbackTip.addEventListener('mouseleave', () => closeFeedbackTip());
  }
  function close() { closeFeedbackTip(); popover.hidden = true; activeMenu = null; document.querySelectorAll('.menu-trigger').forEach((button) => button.removeAttribute('aria-expanded')); }
  function open(name, trigger) {
    close();
    activeMenu = name; popover.innerHTML = '';
    MENUS[name].forEach(([id, zh, en, shortcut]) => { const label = getLocale() === 'en' ? en : zh; const item = document.createElement('button'); item.className = `menu-item${id === 'feedback' ? ' feedback-menu-item' : ''}`; item.setAttribute('role', 'menuitem'); item.innerHTML = `<span>${label}</span><span class="menu-shortcut">${shortcut}</span>`; if (id === 'feedback') { item.addEventListener('mouseenter', () => showFeedbackTip(item)); item.addEventListener('mouseleave', () => { feedbackTimer = setTimeout(closeFeedbackTip, 180); }); } item.onclick = () => { onAction(id); close(); }; popover.append(item); });
    const rect = trigger.getBoundingClientRect(); popover.style.left = `${rect.left}px`; popover.style.top = `${rect.bottom + 4}px`; popover.hidden = false; trigger.setAttribute('aria-expanded', 'true');
  }
  document.querySelectorAll('.menu-trigger').forEach((trigger) => trigger.addEventListener('click', () => activeMenu === trigger.dataset.menu ? close() : open(trigger.dataset.menu, trigger)));
  document.addEventListener('click', (event) => { if (!event.target.closest('.menu-bar') && !event.target.closest('.menu-popover')) close(); });
}
