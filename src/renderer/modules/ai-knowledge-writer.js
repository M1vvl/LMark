function suggestedFileName(content, prompt) {
  const heading = content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  const topic = heading || prompt.match(/(?:生成|学习|掌握|介绍|讲解)([^，。！？\n]{2,36})/)?.[1]?.trim() || 'AI 学习笔记';
  return topic.replace(/[<>:"/\\|?*]/g, '').replace(/[. ]+$/g, '').slice(0, 60) || 'AI 学习笔记';
}

function option(value, label) {
  const item = document.createElement('option');
  item.value = value;
  item.textContent = label;
  return item;
}

async function availableProjects(api) {
  const [directResult, workspaceResult] = await Promise.all([
    api.listManagedProjects(),
    api.listManagedWorkspaces()
  ]);
  if (!directResult?.ok) throw new Error(directResult?.error || '无法读取项目');
  const projects = [...(directResult.projects || [])];
  if (workspaceResult?.ok) {
    for (const workspace of workspaceResult.workspaces || []) {
      for (const project of workspace.projects || []) projects.push({ ...project, workspaceName: workspace.name });
    }
  }
  const unique = new Map(projects.filter((project) => project?.path).map((project) => [project.path.toLowerCase(), project]));
  return [...unique.values()];
}

export function createAIKnowledgeWriter(api) {
  let overlay;

  function close() {
    overlay?.remove();
    overlay = null;
  }

  async function open(content, prompt = '') {
    close();
    overlay = document.createElement('div');
    overlay.className = 'knowledge-write-overlay';
    overlay.innerHTML = `
      <section class="knowledge-write-dialog" role="dialog" aria-modal="true" aria-labelledby="knowledgeWriteTitle">
        <header><span>本地知识</span><h2 id="knowledgeWriteTitle">写入 Markdown</h2><p>把这条回答保存到项目知识文件，已有文件默认安全追加。</p></header>
        <div class="knowledge-write-fields">
          <label><span>项目</span><select data-project></select></label>
          <label><span>目标文件</span><select data-file></select></label>
          <label data-name-row><span>新文件名称</span><input data-name maxlength="80" autocomplete="off" /></label>
          <fieldset data-mode-row><legend>写入方式</legend><label><input type="radio" name="writeMode" value="append" checked /><span>追加</span></label><label><input type="radio" name="writeMode" value="overwrite" /><span>覆盖</span></label></fieldset>
          <p class="knowledge-write-warning" data-warning></p>
        </div>
        <footer><button type="button" class="knowledge-write-cancel" data-cancel>取消</button><button type="button" class="knowledge-write-save" data-save>写入</button></footer>
        <p class="knowledge-write-status" data-status role="status" aria-live="polite"></p>
      </section>`;
    document.body.append(overlay);

    const projectSelect = overlay.querySelector('[data-project]');
    const fileSelect = overlay.querySelector('[data-file]');
    const nameRow = overlay.querySelector('[data-name-row]');
    const nameInput = overlay.querySelector('[data-name]');
    const modeRow = overlay.querySelector('[data-mode-row]');
    const warning = overlay.querySelector('[data-warning]');
    const status = overlay.querySelector('[data-status]');
    const saveButton = overlay.querySelector('[data-save]');
    const context = await api.getKnowledgeContext().catch(() => null);

    const refreshMode = () => {
      const existing = Boolean(fileSelect.value);
      nameRow.hidden = existing;
      modeRow.hidden = !existing;
      const overwrite = overlay.querySelector('input[name="writeMode"]:checked')?.value === 'overwrite';
      warning.textContent = existing && overwrite ? '覆盖会替换目标文件的全部正文，请确认文件选择正确。' : '';
    };

    const loadFiles = async (preferredPath = '') => {
      fileSelect.disabled = true;
      fileSelect.replaceChildren(option('', '新建 Markdown 文件'));
      const result = await api.listKnowledgeFiles(projectSelect.value);
      if (!result?.ok) throw new Error(result?.error || '无法读取知识文件');
      fileSelect.append(...result.files.map((file) => option(file.path, file.path)));
      if (preferredPath && result.files.some((file) => file.path === preferredPath)) fileSelect.value = preferredPath;
      fileSelect.disabled = false;
      refreshMode();
    };

    try {
      const projects = await availableProjects(api);
      if (!projects.length) throw new Error('还没有可写入的项目，请先在左侧创建项目');
      projectSelect.replaceChildren(...projects.map((project) => option(project.path, project.workspaceName ? `${project.workspaceName} / ${project.name}` : project.name)));
      if (context?.project?.path && projects.some((project) => project.path.toLowerCase() === context.project.path.toLowerCase())) projectSelect.value = context.project.path;
      nameInput.value = suggestedFileName(content, prompt);
      await loadFiles(context?.project?.path?.toLowerCase() === projectSelect.value.toLowerCase() ? context.filePath : '');
    } catch (error) {
      status.textContent = error.message;
      status.dataset.state = 'error';
      saveButton.disabled = true;
    }

    projectSelect.addEventListener('change', async () => {
      status.textContent = '';
      try { await loadFiles(); }
      catch (error) { status.textContent = error.message; status.dataset.state = 'error'; }
    });
    fileSelect.addEventListener('change', refreshMode);
    overlay.querySelectorAll('input[name="writeMode"]').forEach((input) => input.addEventListener('change', refreshMode));
    overlay.querySelector('[data-cancel]').addEventListener('click', close);
    overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) close(); });
    saveButton.addEventListener('click', async () => {
      const relativePath = fileSelect.value;
      const fileName = nameInput.value.trim();
      if (!relativePath && !fileName) { nameInput.focus(); return; }
      saveButton.disabled = true;
      saveButton.textContent = '正在写入...';
      status.textContent = '';
      delete status.dataset.state;
      const result = await api.saveAIKnowledge({
        projectPath: projectSelect.value,
        relativePath,
        fileName,
        content,
        mode: overlay.querySelector('input[name="writeMode"]:checked')?.value || 'append'
      });
      if (!result?.ok) {
        status.textContent = result?.error || '写入失败';
        status.dataset.state = 'error';
        saveButton.disabled = false;
        saveButton.textContent = '写入';
        return;
      }
      status.textContent = `已写入 ${result.file.name}`;
      status.dataset.state = 'success';
      saveButton.textContent = '已完成';
      setTimeout(close, 700);
    });
  }

  function decorateMessage(messageElement, content, prompt) {
    const actions = document.createElement('div');
    actions.className = 'message-actions';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'write-knowledge-button';
    button.innerHTML = '<span aria-hidden="true">↧</span><span>写入本地知识</span>';
    button.addEventListener('click', () => open(content, prompt));
    actions.append(button);
    messageElement.append(actions);
  }

  return Object.freeze({ decorateMessage, close });
}
