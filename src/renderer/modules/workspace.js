const MIN_WIDTH = 210;
const MAX_RATIO = 0.45;
const MODE_KEY = 'codex-workspace-mode-v1';
const SIDEBAR_HIDDEN_KEY = 'codex-workspace-sidebar-hidden-v1';

export function createWorkspaceController({ onToast }) {
  const panel = document.getElementById('workspacePanel');
  const handle = document.getElementById('resizeHandle');
  const hideButton = document.getElementById('sidebarHideButton');
  const showButton = document.getElementById('sidebarShowButton');
  let dragging = false;

  const setWidth = (width) => {
    const maxWidth = Math.floor(window.innerWidth * MAX_RATIO);
    const next = Math.max(MIN_WIDTH, Math.min(maxWidth, width));
    document.documentElement.style.setProperty('--sidebar-width', `${next}px`);
  };
  handle.addEventListener('pointerdown', (event) => { dragging = true; handle.setPointerCapture(event.pointerId); document.body.style.cursor = 'col-resize'; });
  handle.addEventListener('pointermove', (event) => { if (dragging) setWidth(event.clientX); });
  const finishDrag = () => { if (!dragging) return; dragging = false; document.body.style.cursor = ''; onToast('工作区宽度已调整'); };
  handle.addEventListener('pointerup', finishDrag);
  handle.addEventListener('pointercancel', finishDrag);
  handle.addEventListener('keydown', (event) => { if (event.key === 'ArrowLeft') setWidth(panel.offsetWidth - 12); if (event.key === 'ArrowRight') setWidth(panel.offsetWidth + 12); });
  window.addEventListener('resize', () => setWidth(panel.offsetWidth));

  const setSidebarHidden = (hidden) => {
    panel.classList.toggle('is-hidden', hidden);
    handle.hidden = hidden;
    hideButton.hidden = hidden;
    showButton.hidden = !hidden;
    localStorage.setItem(SIDEBAR_HIDDEN_KEY, String(hidden));
  };
  const toggleSidebar = () => setSidebarHidden(!panel.classList.contains('is-hidden'));
  hideButton?.addEventListener('click', toggleSidebar);
  showButton?.addEventListener('click', toggleSidebar);
  document.addEventListener('workspace:toggle', toggleSidebar);
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 'b') { event.preventDefault(); toggleSidebar(); }
  });
  setSidebarHidden(localStorage.getItem(SIDEBAR_HIDDEN_KEY) === 'true');

  const modeButton = document.getElementById('workspaceModeButton');
  const modeLabel = document.getElementById('workspaceModeLabel');
  const modes = [
    { id: 'work', label: '工作区', description: '项目、文件和专注任务' },
    { id: 'leisure', label: '休闲区', description: '轻量浏览和灵感整理' },
    { id: 'global', label: '环球区', description: '全球工具、地图与外部项目' }
  ];
  let modeMenu;
  // Always open in the focused work area. The user's last mode remains
  // available through the switcher but must not strand startup in Global.
  let currentMode = 'work';

  const closeModeMenu = () => {
    modeMenu?.remove();
    modeMenu = null;
    modeButton?.setAttribute('aria-expanded', 'false');
  };
  const applyMode = (modeId, notify = false) => {
    const mode = modes.find((candidate) => candidate.id === modeId) || modes[0];
    currentMode = mode.id;
    localStorage.setItem(MODE_KEY, currentMode);
    if (modeLabel) modeLabel.textContent = mode.label;
    document.body.dataset.workspaceMode = currentMode;
    document.dispatchEvent(new CustomEvent('workspace:mode-changed', { detail: { mode: currentMode } }));
    modeButton?.setAttribute('aria-label', `当前${mode.label}，切换工作区类型`);
    modeMenu?.querySelectorAll('[data-workspace-mode]').forEach((item) => item.setAttribute('aria-selected', String(item.dataset.workspaceMode === currentMode)));
    if (notify) onToast(`已切换到${mode.label}`);
  };
  const openModeMenu = () => {
    closeModeMenu();
    modeMenu = document.createElement('div');
    modeMenu.className = 'workspace-mode-menu';
    modeMenu.setAttribute('role', 'menu');
    modeMenu.innerHTML = modes.map((mode) => `<button class="workspace-mode-option" type="button" role="menuitemradio" data-workspace-mode="${mode.id}" aria-selected="${mode.id === currentMode}"><span><strong>${mode.label}</strong><small>${mode.description}</small></span></button>`).join('');
    document.body.append(modeMenu);
    const rect = modeButton.getBoundingClientRect();
    modeMenu.style.left = `${Math.max(10, rect.left)}px`;
    modeMenu.style.top = `${Math.min(window.innerHeight - modeMenu.offsetHeight - 12, rect.bottom + 7)}px`;
    modeButton.setAttribute('aria-expanded', 'true');
    modeMenu.querySelectorAll('[data-workspace-mode]').forEach((item) => item.addEventListener('click', () => { applyMode(item.dataset.workspaceMode, true); closeModeMenu(); }));
  };
  modeButton?.addEventListener('click', () => (modeMenu ? closeModeMenu() : openModeMenu()));
  document.addEventListener('pointerdown', (event) => { if (modeMenu && !event.target.closest('#workspaceModeButton') && !event.target.closest('.workspace-mode-menu')) closeModeMenu(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeModeMenu(); });
  applyMode(currentMode);
}
