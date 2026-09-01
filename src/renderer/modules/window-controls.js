export function createWindowController() {
  let closeOverlay;

  function closeChoiceModal() {
    closeOverlay?.remove();
    closeOverlay = null;
  }

  function openCloseChoiceModal() {
    if (closeOverlay) return;
    closeOverlay = document.createElement('div');
    closeOverlay.className = 'project-modal-overlay close-choice-overlay';
    closeOverlay.innerHTML = `<section class="project-modal close-choice-modal" role="dialog" aria-modal="true" aria-labelledby="closeChoiceTitle"><div class="project-modal-header"><p class="eyebrow">窗口操作</p><h3 id="closeChoiceTitle">关闭 LMark</h3><p class="project-modal-description">隐藏后软件会继续运行，可以从 Windows 通知区域重新打开。</p></div><div class="close-choice-grid"><button class="close-choice-button" type="button" data-close-choice="hide"><span class="close-choice-icon tray-choice-icon" aria-hidden="true"></span><span><strong>隐藏到托盘</strong><small>保留工作状态</small></span></button><button class="close-choice-button danger" type="button" data-close-choice="quit"><span class="close-choice-icon quit-choice-icon" aria-hidden="true"></span><span><strong>完全退出</strong><small>结束软件的全部进程</small></span></button></div><div class="project-modal-actions"><button class="jelly-cancel-button" type="button" data-close-cancel>取消</button></div></section>`;
    document.body.append(closeOverlay);
    closeOverlay.querySelector('[data-close-cancel]').addEventListener('click', closeChoiceModal);
    closeOverlay.querySelectorAll('[data-close-choice]').forEach((button) => button.addEventListener('click', async () => {
      closeOverlay.querySelectorAll('button').forEach((item) => { item.disabled = true; });
      await window.desktopAPI?.chooseCloseAction(button.dataset.closeChoice);
      closeChoiceModal();
    }));
    closeOverlay.addEventListener('pointerdown', (event) => { if (event.target === closeOverlay) closeChoiceModal(); });
    requestAnimationFrame(() => closeOverlay?.querySelector('[data-close-choice="hide"]')?.focus());
  }

  document.querySelectorAll('[data-window-action]').forEach((button) => {
    button.addEventListener('click', async () => {
      const action = button.dataset.windowAction;
      if (action === 'minimize') await window.desktopAPI?.minimize();
      if (action === 'maximize') await window.desktopAPI?.toggleMaximize();
      if (action === 'close') await window.desktopAPI?.close();
    });
  });
  window.desktopAPI?.onCloseRequested(openCloseChoiceModal);
  window.desktopAPI?.isMaximized?.().then((maximized) => document.body.classList.toggle('window-maximized', maximized));
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && closeOverlay) closeChoiceModal(); });
}
