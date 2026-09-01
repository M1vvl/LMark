import { createProjectController } from './sidebar-visual/project-actions.js';

const BARS_KEY = 'codex-workspace-bars-v1';
const DEFAULT_HIDDEN_KEY = 'codex-workspace-default-bar-hidden-v1';

function readBars() {
  try {
    const value = JSON.parse(localStorage.getItem(BARS_KEY) || '[]');
    return Array.isArray(value) ? value.filter((bar) => bar?.id && bar?.name) : [];
  } catch { return []; }
}

function writeBars(bars) {
  localStorage.setItem(BARS_KEY, JSON.stringify(bars));
}

function isSubsequence(query, text) {
  let index = 0;
  for (const character of text) {
    if (character === query[index]) index += 1;
    if (index === query.length) return true;
  }
  return query.length === 0;
}

function setupWorkspaceSearch(panel, container) {
  const input = document.getElementById('workspaceSearchInput');
  if (!input) return;
  let empty = document.getElementById('projectSearchEmpty');
  if (!empty) {
    empty = document.createElement('div');
    empty.id = 'projectSearchEmpty';
    empty.className = 'project-search-empty';
    empty.hidden = true;
    empty.textContent = '没有找到匹配的项目';
    container.append(empty);
  }
  input.addEventListener('focus', () => panel.classList.add('search-focused'));
  input.addEventListener('blur', () => panel.classList.remove('search-focused'));
  input.addEventListener('input', () => {
    const query = input.value.trim().toLocaleLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    let visibleCount = 0;
    container.querySelectorAll('.tree-item').forEach((item) => {
      const searchableText = `${item.querySelector('.tree-item-copy strong')?.textContent || ''} ${item.querySelector('.tree-item-copy small')?.textContent || ''} ${item.dataset.projectPath || ''}`.toLocaleLowerCase();
      const matched = !terms.length || terms.every((term) => searchableText.includes(term) || isSubsequence(term, searchableText));
      item.classList.toggle('search-hidden', !matched);
      if (matched) visibleCount += 1;
    });
    if (query) container.querySelectorAll('.workspace-section').forEach((section) => {
      section.querySelector('.project-list')?.classList.remove('is-collapsed');
      section.querySelector('.project-section-toggle')?.setAttribute('aria-expanded', 'true');
    });
    empty.hidden = !query || visibleCount > 0;
  });
}

function createWorkspaceSection(bar) {
  const section = document.createElement('div');
  section.className = 'tree-section workspace-section';
  section.dataset.workspaceId = bar.id;
  section.dataset.workspaceName = bar.name;
  if (bar.path) section.dataset.workspacePath = bar.path;
  section.innerHTML = `<div class="section-label"><button class="project-section-toggle" type="button" aria-expanded="true"><span></span><span class="project-chevron" aria-hidden="true">›</span></button><div class="section-actions"><button class="section-add-button" type="button" title="新建项目" aria-label="新建项目">+</button></div></div><div class="project-list"></div><div class="project-search-empty" hidden>没有找到匹配的项目</div>`;
  section.querySelector('.project-section-toggle > span').textContent = bar.name;
  return section;
}

function openWorkspaceDeleteModal(section, { projectCount, deletesFolder, onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'project-modal-overlay';
  overlay.innerHTML = '<section class="project-modal" role="dialog" aria-modal="true"><div class="project-modal-header"><p class="eyebrow">工作栏操作</p><h3>删除工作栏</h3><p class="project-modal-description"></p></div><div class="project-modal-body"><div class="delete-project-detail"><strong></strong><p></p><code></code></div></div><div class="project-modal-actions"><button class="jelly-cancel-button" data-cancel>取消</button><button class="jelly-danger-button waiting" data-confirm disabled>删除 (3)</button></div></section>';
  overlay.querySelector('.project-modal-description').textContent = deletesFolder
    ? '工作栏文件夹及其中所有从属项目将一并移入 Windows 回收站。'
    : '默认工作栏记录将移除，关联项目文件夹会移入 Windows 回收站。';
  overlay.querySelector('.delete-project-detail strong').textContent = section.dataset.workspaceName;
  overlay.querySelector('.delete-project-detail p').textContent = `当前包含 ${projectCount} 个关联项目。`;
  overlay.querySelector('code').textContent = section.dataset.workspacePath || '默认项目保存位置';
  document.body.append(overlay);
  const close = () => { clearInterval(countdown); overlay.remove(); };
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.querySelector('[data-confirm]').addEventListener('click', async () => {
    const confirmButton = overlay.querySelector('[data-confirm]');
    if (confirmButton.disabled) return;
    confirmButton.disabled = true;
    confirmButton.textContent = '正在删除...';
    const ok = await onConfirm();
    if (ok) close();
    else { confirmButton.disabled = false; confirmButton.textContent = '删除'; }
  });
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) close(); });
  let seconds = 3;
  const countdown = setInterval(() => {
    if (!overlay.isConnected) { clearInterval(countdown); return; }
    seconds -= 1;
    const confirmButton = overlay.querySelector('[data-confirm]');
    confirmButton.textContent = seconds > 0 ? `删除 (${seconds})` : '删除';
    if (seconds === 0) {
      clearInterval(countdown);
      confirmButton.disabled = false;
      confirmButton.classList.remove('waiting');
      confirmButton.classList.add('ready');
    }
  }, 1000);
  requestAnimationFrame(() => overlay.querySelector('[data-cancel]').focus());
}

function openWorkspaceNameModal({ onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'project-modal-overlay';
  overlay.innerHTML = '<section class="project-modal" role="dialog" aria-modal="true"><div class="project-modal-header"><p class="eyebrow">新建工作栏</p><h3>创建工作栏和文件夹</h3><p class="project-modal-description">从属项目将保存在这个工作栏的同名文件夹内。</p></div><div class="project-modal-body"><label class="project-name-field"><span>工作栏名称</span><input type="text" maxlength="40" autocomplete="off" placeholder="例如：学习计划" /></label></div><div class="project-modal-actions"><button class="jelly-cancel-button" data-cancel>取消</button><button class="jelly-confirm-button" data-confirm>创建</button></div></section>';
  document.body.append(overlay);
  const input = overlay.querySelector('input');
  const confirmButton = overlay.querySelector('[data-confirm]');
  const close = () => overlay.remove();
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  confirmButton.addEventListener('click', async () => {
    const name = input.value.trim();
    if (!name) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    confirmButton.disabled = true;
    const ok = await onConfirm(name);
    confirmButton.disabled = false;
    if (ok) close();
  });
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') confirmButton.click(); if (event.key === 'Escape') close(); });
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) close(); });
  requestAnimationFrame(() => input.focus());
}

export function createWorkspaceBars({ onToast }) {
  const panel = document.getElementById('workspacePanel');
  const container = document.getElementById('workspaceSections');
  if (!panel || !container) return;
  const controllers = new Map();
  let managedReady = false;
  let pendingWorkspaces = [];

  const defaultSection = container.querySelector('[data-workspace-id="default"]');
  if (localStorage.getItem(DEFAULT_HIDDEN_KEY) === 'true') defaultSection?.remove();
  else controllers.set('default', createProjectController({ onToast, root: defaultSection }));

  function mountBar(bar) {
    let section = container.querySelector(`[data-workspace-id="${CSS.escape(bar.id)}"]`);
    if (!section) {
      section = createWorkspaceSection(bar);
      section.classList.add('workspace-section-entering');
      container.append(section);
      section.addEventListener('animationend', () => section.classList.remove('workspace-section-entering'), { once: true });
      controllers.set(bar.id, createProjectController({ onToast, root: section }));
    }
    section.dataset.workspaceName = bar.name;
    if (bar.path) section.dataset.workspacePath = bar.path;
    section.querySelector('.project-section-toggle > span').textContent = bar.name;
    return section;
  }

  readBars().forEach(mountBar);
  setupWorkspaceSearch(panel, container);

  function clearWorkspaceStorage(id) {
    const suffix = id === 'default' ? '' : `-${id}`;
    localStorage.removeItem(`codex-workspace-projects-v1${suffix}`);
    localStorage.removeItem(`codex-workspace-project-meta-v1${suffix}`);
    localStorage.removeItem(`codex-workspace-projects-collapsed${suffix}`);
  }

  function removeWorkspaceBar(section) {
    const id = section.dataset.workspaceId;
    const controller = controllers.get(id);
    const projectPaths = controller?.getProjectPaths() || [];
    const deletesFolder = id !== 'default' && Boolean(section.dataset.workspacePath);
    openWorkspaceDeleteModal(section, {
      projectCount: projectPaths.length,
      deletesFolder,
      onConfirm: async () => {
        const result = deletesFolder
          ? await window.desktopAPI?.trashWorkspace(section.dataset.workspacePath)
          : await window.desktopAPI?.trashProjects(projectPaths);
        if (!result?.ok) { onToast(`删除工作栏失败：${result?.error || '未知错误'}`); return false; }
        section.remove();
        controllers.delete(id);
        clearWorkspaceStorage(id);
        if (id === 'default') localStorage.setItem(DEFAULT_HIDDEN_KEY, 'true');
        else writeBars(readBars().filter((bar) => bar.id !== id));
        onToast(deletesFolder ? '工作栏文件夹已移入回收站' : '默认工作栏已删除');
        return true;
      }
    });
  }

  const createMenu = document.createElement('div');
  createMenu.className = 'workspace-context-menu';
  createMenu.hidden = true;
  createMenu.innerHTML = '<button type="button" data-create-workspace>新建工作栏</button>';
  document.body.append(createMenu);

  const barMenu = document.createElement('div');
  barMenu.className = 'workspace-context-menu workspace-bar-menu';
  barMenu.hidden = true;
  barMenu.innerHTML = '<button type="button" data-manage-workspace><span class="action-icon action-icon-folder" aria-hidden="true"></span><span>文件夹管理</span></button><button class="danger-menu-item" type="button" data-delete-workspace><span class="action-icon action-icon-delete" aria-hidden="true"></span><span>删除工作栏</span></button>';
  document.body.append(barMenu);
  let activeSection = null;

  function closeMenus() {
    createMenu.hidden = true;
    barMenu.hidden = true;
    activeSection = null;
  }

  panel.addEventListener('contextmenu', (event) => {
    const sectionLabel = event.target.closest('.section-label');
    if (sectionLabel) {
      event.preventDefault();
      activeSection = sectionLabel.closest('.workspace-section');
      createMenu.hidden = true;
      barMenu.hidden = false;
      barMenu.style.left = `${Math.min(event.clientX, window.innerWidth - barMenu.offsetWidth - 10)}px`;
      barMenu.style.top = `${Math.min(event.clientY, window.innerHeight - barMenu.offsetHeight - 10)}px`;
      return;
    }
    if (event.target.closest('input, textarea, button, .tree-item')) return;
    event.preventDefault();
    activeSection = null;
    barMenu.hidden = true;
    createMenu.hidden = false;
    createMenu.style.left = `${Math.min(event.clientX, window.innerWidth - createMenu.offsetWidth - 10)}px`;
    createMenu.style.top = `${Math.min(event.clientY, window.innerHeight - createMenu.offsetHeight - 10)}px`;
  });

  createMenu.querySelector('[data-create-workspace]').addEventListener('click', () => {
    closeMenus();
    openWorkspaceNameModal({
      onConfirm: async (name) => {
        const duplicate = [...container.querySelectorAll('.workspace-section')].some((section) => section.dataset.workspaceName.toLocaleLowerCase() === name.toLocaleLowerCase());
        if (duplicate) { onToast('已经存在同名工作栏'); return false; }
        const id = `workspace-${crypto.randomUUID()}`;
        const result = await window.desktopAPI?.createManagedWorkspace({ id, name });
        if (!result?.ok) { onToast(`创建工作栏失败：${result?.error || '未知错误'}`); return false; }
        mountBar(result.workspace);
        writeBars([...readBars(), result.workspace]);
        onToast(`已创建工作栏文件夹：${name}`);
        return true;
      }
    });
  });

  barMenu.querySelector('[data-manage-workspace]').addEventListener('click', async () => {
    const section = activeSection;
    closeMenus();
    if (!section?.dataset.workspacePath) { onToast('工作栏文件夹尚未准备好'); return; }
    const result = await window.desktopAPI?.openManagedFolder(section.dataset.workspacePath);
    onToast(result?.ok ? '已在资源管理器中打开工作栏文件夹' : `无法打开：${result?.error || '未知错误'}`);
  });
  barMenu.querySelector('[data-delete-workspace]').addEventListener('click', () => {
    const section = activeSection;
    closeMenus();
    if (section) removeWorkspaceBar(section);
  });

  document.addEventListener('pointerdown', (event) => { if (!event.target.closest('.workspace-context-menu')) closeMenus(); });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeMenus(); });

  function reconcileDefaultProjects(projects) {
    controllers.get('default')?.reconcileManagedProjects(projects, { addMissing: true, prune: true });
  }

  function reconcileManagedWorkspaces(workspaces) {
    if (!managedReady) { pendingWorkspaces = workspaces; return; }
    const diskIds = new Set(workspaces.map((workspace) => workspace.id));
    workspaces.forEach((workspace) => {
      mountBar(workspace);
      controllers.get(workspace.id)?.reconcileManagedProjects(workspace.projects, { addMissing: true, prune: true });
    });
    container.querySelectorAll('.workspace-section:not([data-workspace-id="default"])').forEach((section) => {
      if (!diskIds.has(section.dataset.workspaceId)) {
        controllers.delete(section.dataset.workspaceId);
        clearWorkspaceStorage(section.dataset.workspaceId);
        section.remove();
      }
    });
    writeBars(workspaces.map(({ id, name, path: folderPath }) => ({ id, name, path: folderPath })));
  }

  async function initializeDiskWorkspaces() {
    const ensured = [];
    for (const bar of readBars()) {
      const result = await window.desktopAPI?.ensureManagedWorkspace({ id: bar.id, name: bar.name, folderPath: bar.path });
      if (result?.ok) {
        ensured.push(result.workspace);
        const section = mountBar(result.workspace);
        section.dataset.workspacePath = result.workspace.path;
      } else onToast(`工作栏 ${bar.name} 的文件夹创建失败：${result?.error || '未知错误'}`);
    }
    writeBars(ensured);
    const [projectResult, workspaceResult] = await Promise.all([
      window.desktopAPI?.listManagedProjects(),
      window.desktopAPI?.listManagedWorkspaces()
    ]);
    if (projectResult?.ok) {
      if (defaultSection) defaultSection.dataset.workspacePath = projectResult.root;
      reconcileDefaultProjects(projectResult.projects);
    }
    managedReady = true;
    if (workspaceResult?.ok) reconcileManagedWorkspaces(workspaceResult.workspaces);
    else if (pendingWorkspaces.length) reconcileManagedWorkspaces(pendingWorkspaces);
    else onToast(`无法读取工作栏文件夹：${workspaceResult?.error || '未知错误'}`);
  }

  window.desktopAPI?.onManagedProjectsChanged(reconcileDefaultProjects);
  window.desktopAPI?.onManagedWorkspacesChanged(reconcileManagedWorkspaces);
  initializeDiskWorkspaces().catch((error) => onToast(`工作栏初始化失败：${error.message}`));
}
