const PROJECTS_KEY = 'codex-workspace-projects-v1';
const META_KEY = 'codex-workspace-project-meta-v1';
const COLLAPSED_KEY = 'codex-workspace-projects-collapsed';

function scopedKey(base, workspaceId) {
  return workspaceId === 'default' ? base : `${base}-${workspaceId}`;
}

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || '') || fallback; }
  catch { return fallback; }
}

function folderName(folderPath) {
  return folderPath.split(/[\\/]/).filter(Boolean).pop() || '新项目';
}

function normalizedPath(folderPath) {
  return (folderPath || '').replace(/[\\/]+$/, '').toLocaleLowerCase();
}

function stableProjectId(folderPath) {
  let hash = 2166136261;
  for (const character of normalizedPath(folderPath)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `managed-${(hash >>> 0).toString(16)}`;
}

function createProjectItem(project) {
  const item = document.createElement('div');
  item.className = 'tree-item';
  item.dataset.projectId = project.id;
  item.dataset.projectPath = project.path;
  item.dataset.managedProject = String(Boolean(project.managed));
  item.innerHTML = '<button class="tree-item-main"><span class="file-glyph folder"></span><span class="tree-item-copy"><strong></strong><small></small></span></button><button class="project-more-button" aria-haspopup="menu">···</button>';
  item.querySelector('strong').textContent = project.name;
  item.querySelector('small').textContent = project.managed ? '托管项目' : '外部工作区';
  item.querySelector('.project-more-button').setAttribute('aria-label', `${project.name}项目操作`);
  return item;
}

function setProjectName(item, name) {
  item.querySelector('strong').textContent = name;
  item.querySelector('.project-more-button').setAttribute('aria-label', `${name}项目操作`);
}

function createActionMenu(workspaceId) {
  const menu = document.createElement('div');
  menu.className = 'project-action-menu';
  menu.dataset.workspaceId = workspaceId;
  menu.setAttribute('role', 'menu');
  menu.hidden = true;
  document.body.append(menu);
  return menu;
}

function createModal({ title, description, body, confirmLabel, confirmClass = 'jelly-confirm-button', onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'project-modal-overlay';
  overlay.innerHTML = `<section class="project-modal" role="dialog" aria-modal="true" aria-labelledby="projectModalTitle"><div class="project-modal-header"><p class="eyebrow">项目操作</p><h3 id="projectModalTitle"></h3><p class="project-modal-description"></p></div><div class="project-modal-body"></div><div class="project-modal-actions"><button class="jelly-cancel-button" data-modal-cancel>取消</button><button class="${confirmClass}" data-modal-confirm>${confirmLabel}</button></div></section>`;
  overlay.querySelector('h3').textContent = title;
  overlay.querySelector('.project-modal-description').textContent = description;
  if (body) overlay.querySelector('.project-modal-body').append(body);
  const close = () => overlay.remove();
  overlay.querySelector('[data-modal-cancel]').addEventListener('click', close);
  overlay.querySelector('[data-modal-confirm]').addEventListener('click', () => onConfirm({ overlay, close }));
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) close(); });
  overlay.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.querySelector('[data-modal-cancel]').focus());
  return { overlay, close, confirmButton: overlay.querySelector('[data-modal-confirm]') };
}

export function createProjectController({ onToast, root = document.querySelector('.workspace-section') }) {
  if (!root) return { reconcileManagedProjects: () => {}, getProjectPaths: () => [] };
  const workspaceId = root.dataset.workspaceId || 'default';
  const list = root.querySelector('.project-list');
  const toggle = root.querySelector('.project-section-toggle');
  const addButton = root.querySelector('.section-add-button');
  const actionMenu = createActionMenu(workspaceId);
  const projectsKey = scopedKey(PROJECTS_KEY, workspaceId);
  const metadataKey = scopedKey(META_KEY, workspaceId);
  const collapsedKey = scopedKey(COLLAPSED_KEY, workspaceId);
  let activeMenuItem = null;
  let listTransitionTimer;
  let metadata = readJson(metadataKey, {});

  readJson(projectsKey, [])
    .filter((project) => project?.id && project?.path)
    .forEach((project) => list.append(createProjectItem(project)));

  list.querySelectorAll('.tree-item').forEach((item) => {
    const meta = metadata[item.dataset.projectId];
    if (meta?.removed) { item.remove(); return; }
    if (meta?.name) setProjectName(item, meta.name);
    item.dataset.pinned = meta?.pinned ? 'true' : 'false';
    item.classList.toggle('pinned', Boolean(meta?.pinned));
  });

  function projectName(item) { return item.querySelector('strong')?.textContent || '项目'; }

  function persist() {
    const projects = [];
    list.querySelectorAll('.tree-item').forEach((item) => {
      const id = item.dataset.projectId;
      const name = projectName(item);
      const pinned = item.dataset.pinned === 'true';
      metadata[id] = { ...metadata[id], name, pinned, removed: false };
      if (item.dataset.systemProject !== 'true') {
        projects.push({ id, name, path: item.dataset.projectPath, managed: item.dataset.managedProject === 'true' });
      }
    });
    localStorage.setItem(projectsKey, JSON.stringify(projects));
    localStorage.setItem(metadataKey, JSON.stringify(metadata));
  }

  function sortPinned() {
    const items = [...list.querySelectorAll('.tree-item')];
    items.sort((left, right) => Number(right.dataset.pinned === 'true') - Number(left.dataset.pinned === 'true'));
    items.forEach((item) => list.append(item));
  }

  function selectProject(item) {
    list.querySelectorAll('.tree-item').forEach((candidate) => candidate.classList.remove('active'));
    item.classList.add('active');
    document.dispatchEvent(new CustomEvent('project:selected', { detail: { id: item.dataset.projectId, name: projectName(item), path: item.dataset.projectPath || null, workspaceId } }));
    onToast(`${projectName(item)} 已打开`);
  }

  function setCollapsed(collapsed) {
    clearTimeout(listTransitionTimer);
    toggle.setAttribute('aria-expanded', String(!collapsed));
    root.classList.toggle('is-collapsed', collapsed);
    list.classList.toggle('is-collapsed', collapsed);
    list.classList.toggle('is-expanding', !collapsed);
    if (!collapsed) listTransitionTimer = setTimeout(() => list.classList.remove('is-expanding'), 420);
    localStorage.setItem(collapsedKey, String(collapsed));
  }

  function findByPath(folderPath) {
    const target = normalizedPath(folderPath);
    return [...list.querySelectorAll('[data-project-path]')].find((item) => normalizedPath(item.dataset.projectPath) === target);
  }

  function addProject(project, { select = false } = {}) {
    const duplicate = findByPath(project.path);
    if (duplicate) {
      if (project.managed) {
        duplicate.dataset.managedProject = 'true';
        duplicate.querySelector('small').textContent = '托管项目';
      }
      if (select) { setCollapsed(false); selectProject(duplicate); }
      return duplicate;
    }
    const completeProject = { ...project, id: project.id || (project.managed ? stableProjectId(project.path) : crypto.randomUUID()) };
    const item = createProjectItem(completeProject);
    item.classList.add('tree-item-entering');
    list.append(item);
    item.addEventListener('animationend', () => item.classList.remove('tree-item-entering'), { once: true });
    if (select) { setCollapsed(false); selectProject(item); }
    persist();
    return item;
  }

  function reconcileManagedProjects(projects, { addMissing = true, prune = true } = {}) {
    if (!Array.isArray(projects)) return;
    const paths = new Set(projects.map((project) => normalizedPath(project.path)));
    if (prune) {
      list.querySelectorAll('[data-managed-project="true"]').forEach((item) => {
        if (!paths.has(normalizedPath(item.dataset.projectPath))) {
          delete metadata[item.dataset.projectId];
          item.remove();
        }
      });
    }
    projects.forEach((project) => {
      const existing = findByPath(project.path);
      if (!existing && !addMissing) return;
      const item = existing || addProject({ ...project, managed: true });
      item.dataset.managedProject = 'true';
      item.querySelector('small').textContent = '托管项目';
      setProjectName(item, project.name);
      item.dataset.projectPath = project.path;
    });
    sortPinned();
    persist();
  }

  async function importExistingFolder(close) {
    const selected = await window.desktopAPI?.chooseFolder();
    if (!selected) return;
    const duplicate = findByPath(selected);
    if (duplicate) { setCollapsed(false); selectProject(duplicate); onToast('该文件夹已经在项目列表中'); close?.(); return; }
    addProject({ name: folderName(selected), path: selected, managed: false }, { select: true });
    close?.();
    onToast(`已导入项目：${folderName(selected)}`);
  }

  function openCreateProjectModal() {
    const body = document.createElement('div');
    body.className = 'create-project-fields';
    body.innerHTML = '<label class="project-name-field"><span>项目名称</span><input type="text" maxlength="80" autocomplete="off" placeholder="例如：学习资料" /></label><button class="project-import-button" type="button">导入已有文件夹</button>';
    const input = body.querySelector('input');
    const modal = createModal({
      title: '新建项目',
      description: '将在设置的默认项目保存位置下创建同名文件夹。',
      body,
      confirmLabel: '创建',
      onConfirm: async ({ overlay, close }) => {
        const name = input.value.trim();
        if (!name) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
        const confirmButton = overlay.querySelector('[data-modal-confirm]');
        confirmButton.disabled = true;
        const result = await window.desktopAPI?.createManagedProject(name, root.dataset.workspacePath || null);
        confirmButton.disabled = false;
        if (!result?.ok) { input.setAttribute('aria-invalid', 'true'); onToast(`创建失败：${result?.error || '未知错误'}`); return; }
        addProject(result.project, { select: true });
        close();
        onToast(`已创建项目和文件夹：${result.project.name}`);
      }
    });
    body.querySelector('.project-import-button').addEventListener('click', () => importExistingFolder(modal.close));
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') modal.confirmButton.click(); });
    requestAnimationFrame(() => input.focus());
  }

  setCollapsed(localStorage.getItem(collapsedKey) === 'true');
  sortPinned();
  toggle.addEventListener('click', () => setCollapsed(toggle.getAttribute('aria-expanded') === 'true'));
  addButton?.addEventListener('click', openCreateProjectModal);
  list.addEventListener('click', (event) => {
    const item = event.target.closest('.tree-item');
    if (!item) return;
    if (event.target.closest('.project-more-button')) { openActionMenu(item, event.target.closest('.project-more-button')); return; }
    if (event.target.closest('.tree-item-main')) selectProject(item);
  });

  function closeActionMenu() {
    actionMenu.hidden = true;
    activeMenuItem?.querySelector('.project-more-button')?.removeAttribute('aria-expanded');
    activeMenuItem = null;
  }

  function openActionMenu(item, trigger) {
    activeMenuItem = item;
    const pinned = item.dataset.pinned === 'true';
    actionMenu.innerHTML = `<button role="menuitem" data-project-action="pin"><span class="action-icon action-icon-pin" aria-hidden="true"></span><span>${pinned ? '取消置顶' : '置顶'}</span></button><button role="menuitem" data-project-action="explorer"><span class="action-icon action-icon-folder" aria-hidden="true"></span><span>在资源管理器中打开</span></button><button role="menuitem" data-project-action="rename"><span class="action-icon action-icon-edit" aria-hidden="true"></span><span>编辑名称</span></button><div class="project-menu-separator"></div><button class="danger-menu-item" role="menuitem" data-project-action="delete"><span class="action-icon action-icon-delete" aria-hidden="true"></span><span>删除项目</span></button>`;
    const rect = trigger.getBoundingClientRect();
    actionMenu.hidden = false;
    actionMenu.style.left = `${Math.min(rect.left, window.innerWidth - actionMenu.offsetWidth - 12)}px`;
    actionMenu.style.top = `${Math.min(rect.bottom + 5, window.innerHeight - actionMenu.offsetHeight - 12)}px`;
    trigger.setAttribute('aria-expanded', 'true');
  }

  actionMenu.addEventListener('click', async (event) => {
    const action = event.target.closest('[data-project-action]')?.dataset.projectAction;
    const item = activeMenuItem;
    if (!action || !item) return;
    closeActionMenu();
    if (action === 'pin') {
      const nextPinned = item.dataset.pinned !== 'true';
      item.dataset.pinned = String(nextPinned);
      item.classList.toggle('pinned', nextPinned);
      sortPinned();
      persist();
      onToast(nextPinned ? `${projectName(item)} 已置顶` : `${projectName(item)} 已取消置顶`);
    }
    if (action === 'explorer') await openInExplorer(item);
    if (action === 'rename') openRenameModal(item);
    if (action === 'delete') openDeleteModal(item);
  });

  async function openInExplorer(item) {
    if (!item.dataset.projectPath) { onToast('该示例项目没有关联本地目录'); return; }
    const result = await window.desktopAPI?.openProjectInExplorer(item.dataset.projectPath);
    onToast(result?.ok ? '已在资源管理器中打开' : `无法打开：${result?.error || '未知错误'}`);
  }

  function openRenameModal(item) {
    const field = document.createElement('label');
    field.className = 'project-name-field';
    field.innerHTML = '<span>项目名称</span><input type="text" maxlength="80" autocomplete="off" />';
    const input = field.querySelector('input');
    input.value = projectName(item);
    const modal = createModal({
      title: '编辑项目名称',
      description: item.dataset.projectPath ? '保存后会同步修改本地磁盘文件夹名称。' : '示例项目没有关联本地目录，只会修改工作区中的显示名称。',
      body: field,
      confirmLabel: '保存',
      onConfirm: async ({ close }) => {
        const nextName = input.value.trim();
        if (!nextName) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
        const oldName = projectName(item);
        if (item.dataset.projectPath && folderName(item.dataset.projectPath).toLocaleLowerCase() !== nextName.toLocaleLowerCase()) {
          const result = await window.desktopAPI?.renameProject(item.dataset.projectPath, nextName);
          if (!result?.ok) { input.setAttribute('aria-invalid', 'true'); onToast(`无法重命名：${result?.error || '未知错误'}`); return; }
          item.dataset.projectPath = result.path;
        }
        setProjectName(item, nextName);
        persist();
        close();
        onToast(oldName === nextName ? '项目名称未改变' : '项目名称和文件夹名称已保存');
      }
    });
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') modal.confirmButton.click(); });
    requestAnimationFrame(() => { input.focus(); input.select(); });
  }

  function openDeleteModal(item) {
    const name = projectName(item);
    const hasPath = Boolean(item.dataset.projectPath);
    const detail = document.createElement('div');
    detail.className = 'delete-project-detail';
    detail.innerHTML = `<strong></strong><p></p>${hasPath ? '<code></code>' : ''}`;
    detail.querySelector('strong').textContent = name;
    detail.querySelector('p').textContent = hasPath ? '项目文件夹将移入 Windows 回收站，并从工作区移除。' : '这是未关联本地目录的示例项目，只会从工作区列表移除。';
    if (hasPath) detail.querySelector('code').textContent = item.dataset.projectPath;
    const modal = createModal({
      title: '删除项目',
      description: '请确认要删除的项目。此操作完成后，软件不会保留该项目记录。',
      body: detail,
      confirmLabel: '删除 (3)',
      confirmClass: 'jelly-danger-button waiting',
      onConfirm: async ({ overlay, close }) => {
        const button = overlay.querySelector('[data-modal-confirm]');
        if (button.disabled) return;
        button.disabled = true;
        overlay.querySelector('[data-modal-cancel]').disabled = true;
        button.textContent = '正在删除...';
        if (hasPath) {
          const result = await window.desktopAPI?.trashProject(item.dataset.projectPath);
          if (!result?.ok) {
            button.disabled = false;
            overlay.querySelector('[data-modal-cancel]').disabled = false;
            button.textContent = '删除';
            onToast(`删除失败：${result?.error || '未知错误'}`);
            return;
          }
        }
        const id = item.dataset.projectId;
        if (item.dataset.systemProject === 'true') metadata[id] = { ...metadata[id], removed: true };
        else delete metadata[id];
        const wasActive = item.classList.contains('active');
        item.remove();
        persist();
        if (wasActive) list.querySelector('.tree-item')?.classList.add('active');
        close();
        onToast(hasPath ? '项目已移入回收站' : '项目已从工作区移除');
      }
    });
    let seconds = 3;
    modal.confirmButton.disabled = true;
    const countdown = setInterval(() => {
      if (!modal.overlay.isConnected) { clearInterval(countdown); return; }
      seconds -= 1;
      modal.confirmButton.textContent = seconds > 0 ? `删除 (${seconds})` : '删除';
      if (seconds === 0) {
        clearInterval(countdown);
        modal.confirmButton.disabled = false;
        modal.confirmButton.classList.remove('waiting');
        modal.confirmButton.classList.add('ready');
      }
    }, 1000);
  }

  document.addEventListener('pointerdown', (event) => {
    if (!event.target.closest('.project-action-menu') && !event.target.closest('.project-more-button')) closeActionMenu();
  });
  document.addEventListener('keydown', (event) => { if (event.key === 'Escape') closeActionMenu(); });
  root.addEventListener('scroll', closeActionMenu, { passive: true });
  return {
    reconcileManagedProjects,
    getProjectPaths: () => [...list.querySelectorAll('[data-project-path]')].map((item) => item.dataset.projectPath).filter(Boolean),
    refresh: persist
  };
}
