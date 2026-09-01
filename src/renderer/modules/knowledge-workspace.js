import { renderLatexFormula } from './knowledge/formula-renderer.js';
import { normalizeNote, noteTitle, serializeFrontmatter, splitFrontmatter, updateNote } from './knowledge/frontmatter.js';
import { createSelectionToolbar } from './knowledge/selection-toolbar.js';
import { createRichEditor, markdownToRichHtml, renderMarkdownInline, richHtmlToMarkdown } from './knowledge/rich-editor.js';

const AUTOSAVE_DELAY_MS = 700;

function fileNameWithoutExtension(filePath) {
  return (filePath.split(/[\\/]/).pop() || '').replace(/\.(md|markdown|txt)$/i, '');
}

function createModal({ eyebrow, title, description, confirmLabel = '保存', danger = false, inputValue = '', onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'project-modal-overlay';
  overlay.innerHTML = `<section class="project-modal" role="dialog" aria-modal="true"><div class="project-modal-header"><p class="eyebrow"></p><h3></h3><p class="project-modal-description"></p></div><div class="project-modal-body"><label class="project-name-field"><span>名称</span><input type="text" maxlength="80" autocomplete="off" /></label></div><div class="project-modal-actions"><button class="jelly-cancel-button" data-cancel>取消</button><button class="${danger ? 'jelly-danger-button' : 'jelly-confirm-button'}" data-confirm></button></div></section>`;
  overlay.querySelector('.eyebrow').textContent = eyebrow;
  overlay.querySelector('h3').textContent = title;
  overlay.querySelector('.project-modal-description').textContent = description;
  const input = overlay.querySelector('input');
  input.value = inputValue;
  const close = () => overlay.remove();
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.querySelector('[data-confirm]').textContent = confirmLabel;
  overlay.querySelector('[data-confirm]').addEventListener('click', async () => {
    const value = input.value.trim();
    if (!value) { input.setAttribute('aria-invalid', 'true'); input.focus(); return; }
    const button = overlay.querySelector('[data-confirm]');
    button.disabled = true;
    const done = await onConfirm(value);
    button.disabled = false;
    if (done !== false) close();
  });
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  input.addEventListener('keydown', (event) => { if (event.key === 'Enter') overlay.querySelector('[data-confirm]').click(); });
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) close(); });
  document.body.append(overlay);
  requestAnimationFrame(() => { input.focus(); input.select(); });
}

function createDeleteModal(filePath, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'project-modal-overlay';
  overlay.innerHTML = '<section class="project-modal" role="dialog" aria-modal="true"><div class="project-modal-header"><p class="eyebrow">知识文件</p><h3>删除知识文件</h3><p class="project-modal-description">文件将移入 Windows 回收站。</p></div><div class="project-modal-body"><div class="delete-project-detail"><strong></strong><p>项目中的图片资源不会自动删除，避免影响其他知识文件。</p></div></div><div class="project-modal-actions"><button class="jelly-cancel-button" data-cancel>取消</button><button class="jelly-danger-button waiting" data-confirm disabled>删除 (3)</button></div></section>';
  overlay.querySelector('.delete-project-detail strong').textContent = filePath;
  document.body.append(overlay);
  let seconds = 3;
  let countdown;
  const close = () => { clearInterval(countdown); overlay.remove(); };
  overlay.querySelector('[data-cancel]').addEventListener('click', close);
  overlay.querySelector('[data-confirm]').addEventListener('click', async () => {
    const button = overlay.querySelector('[data-confirm]');
    if (button.disabled) return;
    button.disabled = true;
    button.textContent = '正在删除...';
    if (await onConfirm()) close();
    else { button.disabled = false; button.textContent = '删除'; }
  });
  overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) close(); });
  countdown = setInterval(() => {
    seconds -= 1;
    const button = overlay.querySelector('[data-confirm]');
    button.textContent = seconds > 0 ? `删除 (${seconds})` : '删除';
    if (seconds === 0) {
      clearInterval(countdown);
      button.disabled = false;
      button.classList.remove('waiting');
      button.classList.add('ready');
    }
  }, 1000);
}

export function createKnowledgeWorkspace({ onToast }) {
  const panel = document.getElementById('knowledgePanel');
  const title = document.getElementById('knowledgeProjectTitle');
  const fileList = document.getElementById('knowledgeFileList');
  const reader = document.getElementById('knowledgeReader');
  const documentBar = document.getElementById('knowledgeDocumentBar');
  const documentTitle = document.getElementById('knowledgeDocumentTitle');
  const editor = document.getElementById('knowledgeEditor');
  const richSurface = document.getElementById('knowledgeRichEditor');
  const preview = document.getElementById('knowledgePreview');
  const empty = document.getElementById('knowledgeEmpty');
  const saveStatus = document.getElementById('knowledgeSaveStatus');
  const editModeButton = document.getElementById('knowledgeEditModeButton');
  const previewModeButton = document.getElementById('knowledgePreviewModeButton');
  const layout = document.getElementById('knowledgeLayout');
  const explainPane = document.getElementById('knowledgeExplainPane');
  const quote = document.getElementById('knowledgeSelectionQuote');
  const explanation = document.getElementById('knowledgeExplainContent');
  const formatToolbar = document.getElementById('knowledgeFormatToolbar');
  const notesPanel = document.getElementById('knowledgeNotesPanel');
  const notesEditor = document.getElementById('knowledgeNotesEditor');
  const annotationList = document.getElementById('knowledgeAnnotationList');
  const welcome = document.querySelector('.welcome-view');
  const aiPanel = document.getElementById('aiChatPanel');
  if (!panel || !editor || !richSurface) return;

  let activeProject = null;
  let activeFile = '';
  let selectedText = '';
  let dirty = false;
  let editVersion = 0;
  let saveTimer;
  let contextMenu;
  let renderToken = 0;
  let selectionRange = null;
  const rich = createRichEditor(richSurface, () => { editor.value = richHtmlToMarkdown(richSurface); markDirty(); });
  function syncColorInputs(format, value, source = null) {
    const external = document.getElementById(format === 'color' ? 'knowledgeColorInput' : 'knowledgeHighlightInput');
    if (external && external !== source) external.value = value;
    selectionToolbar?.setColor(format, value, source);
  }
  function beginSharedColor(format, value, source = null) {
    rich.saveSelection();
    rich.beginLiveFormat(format, value);
    syncColorInputs(format, value, source);
  }
  function updateSharedColor(format, value, source = null) {
    if (!rich.updateLiveFormat(format, value)) {
      rich.beginLiveFormat(format, value);
      rich.updateLiveFormat(format, value);
    }
    syncColorInputs(format, value, source);
  }
  function endSharedColor() {
    rich.endLiveFormat();
    syncFormatControls?.();
  }
  const selectionToolbar = createSelectionToolbar({
    onFormat: applyFloatingFormat,
    onBeginLive: beginSharedColor,
    onUpdateLive: updateSharedColor,
    onEndLive: endSharedColor,
    onAnnotate: openAnnotationModal,
    onAsk: explainSelection
  });

  function publishKnowledgeContext() {
    window.desktopAPI?.setKnowledgeContext({ project: activeProject, filePath: activeFile, dirty });
  }

  function setEditorVisible(visible) {
    editor.hidden = true;
    richSurface.hidden = !visible || !activeFile;
    preview.hidden = visible || !activeFile;
    editModeButton.classList.toggle('active', visible);
    previewModeButton.classList.toggle('active', !visible);
    if (!visible && activeFile) renderPreview();
  }

  function resetDocument() {
    clearTimeout(saveTimer);
    activeFile = '';
    dirty = false;
    editor.value = '';
    richSurface.replaceChildren();
    documentTitle.value = '';
    editor.hidden = true;
    preview.hidden = true;
    documentBar.hidden = true;
    formatToolbar.hidden = true;
    notesPanel.hidden = true;
    layout.classList.remove('annotation-visible');
    empty.hidden = false;
    saveStatus.textContent = '';
    publishKnowledgeContext();
  }

  function showPanel(project, preferredPath = '', options = {}) {
    activeProject = project;
    const documentViewer = document.getElementById('documentViewer');
    if (documentViewer) documentViewer.hidden = true;
    title.textContent = project.name;
    welcome.hidden = true;
    panel.hidden = false;
    publishKnowledgeContext();
    return loadFiles(preferredPath, options);
  }

  async function hidePanel() {
    await saveActiveFile({ silent: true });
    panel.hidden = true;
    selectionToolbar.hide();
    welcome.hidden = false;
  }

  function markDirty() {
    if (!activeFile) return;
    dirty = true;
    editVersion += 1;
    saveStatus.textContent = '尚未保存';
    saveStatus.classList.add('unsaved');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveActiveFile({ silent: true }), AUTOSAVE_DELAY_MS);
    publishKnowledgeContext();
  }

  function syncTitleIntoContent() {
    const nextTitle = documentTitle.value.trim() || fileNameWithoutExtension(activeFile) || '未命名知识';
    documentTitle.value = nextTitle;
    const parsed = splitFrontmatter(editor.value);
    const heading = new RegExp('^#\\s+.*$', 'm');
    const body = heading.test(parsed.body) ? parsed.body.replace(heading, () => `# ${nextTitle}`) : `# ${nextTitle}\n\n${parsed.body}`;
    return serializeFrontmatter({ ...parsed.metadata, title: nextTitle, updated: new Date().toISOString(), annotations: parsed.metadata.annotations || [] }, body);
  }

  async function saveActiveFile({ silent = false } = {}) {
    clearTimeout(saveTimer);
    if (!dirty || !activeProject?.path || !activeFile) return true;
    const projectPath = activeProject.path;
    const filePath = activeFile;
    const parsedEditor = splitFrontmatter(editor.value);
    const richBody = richHtmlToMarkdown(richSurface);
    editor.value = serializeFrontmatter({ ...parsedEditor.metadata, title: documentTitle.value.trim() || fileNameWithoutExtension(activeFile), updated: new Date().toISOString(), annotations: parsedEditor.metadata.annotations || [] }, richBody);
    const content = editor.value;
    const version = editVersion;
    saveStatus.textContent = '正在保存...';
    const result = await window.desktopAPI?.saveKnowledgeFile(projectPath, filePath, content);
    if (!result?.ok) {
      saveStatus.textContent = '保存失败';
      saveStatus.classList.add('unsaved');
      if (!silent) onToast(`保存失败：${result?.error || '未知错误'}`);
      return false;
    }
    if (activeProject?.path === projectPath && activeFile === filePath && editVersion === version) {
      dirty = false;
      saveStatus.textContent = '已保存';
      saveStatus.classList.remove('unsaved');
      publishKnowledgeContext();
    } else if (dirty) {
      saveTimer = setTimeout(() => saveActiveFile({ silent: true }), AUTOSAVE_DELAY_MS);
    }
    if (!silent) onToast('知识文件已保存');
    return true;
  }

  async function loadFiles(preferredPath = activeFile, { force = false } = {}) {
    if (!activeProject?.path) return;
    const projectAtStart = activeProject.path;
    fileList.innerHTML = '<div class="knowledge-list-status">正在读取...</div>';
    const result = await window.desktopAPI?.listKnowledgeFiles(projectAtStart);
    if (activeProject?.path !== projectAtStart) return;
    if (!result?.ok) { fileList.innerHTML = ''; resetDocument(); onToast(`无法读取知识文件：${result?.error || '未知错误'}`); return; }
    fileList.replaceChildren();
    if (!result.files.length) {
      const status = document.createElement('div');
      status.className = 'knowledge-list-status';
      status.textContent = '暂无 Markdown 或文本文件';
      fileList.append(status);
      resetDocument();
      return;
    }
    result.files.forEach((file) => {
      const button = document.createElement('button');
      button.className = 'knowledge-file-button';
      button.type = 'button';
      button.dataset.filePath = file.path;
      button.innerHTML = '<span class="file-glyph"></span><span></span>';
      button.querySelector('span:last-child').textContent = file.path;
      button.classList.toggle('active', file.path === preferredPath);
      button.addEventListener('click', () => openFile(file.path));
      button.addEventListener('contextmenu', (event) => { event.preventDefault(); openFileContextMenu(file.path, event.clientX, event.clientY); });
      fileList.append(button);
    });
    const target = result.files.find((file) => file.path === preferredPath) || result.files[0];
    await openFile(target.path, { force });
  }

  async function openFile(relativePath, { force = false } = {}) {
    if (!activeProject?.path || !force && relativePath === activeFile && documentBar.hidden === false) return;
    if (!(await saveActiveFile({ silent: true }))) return;
    const projectPath = activeProject.path;
    const result = await window.desktopAPI?.readKnowledgeFile(projectPath, relativePath);
    if (activeProject?.path !== projectPath) return;
    if (!result?.ok) { onToast(`无法打开知识文件：${result?.error || '未知错误'}`); return; }
    activeFile = relativePath;
    dirty = false;
    editVersion += 1;
    fileList.querySelectorAll('.knowledge-file-button').forEach((button) => button.classList.toggle('active', button.dataset.filePath === relativePath));
    const normalized = normalizeNote(result.content, fileNameWithoutExtension(relativePath));
    documentTitle.value = noteTitle(normalized, fileNameWithoutExtension(relativePath));
    const activeButtonLabel = fileList.querySelector(`.knowledge-file-button[data-file-path="${CSS.escape(relativePath)}"] span:last-child`);
    if (activeButtonLabel) activeButtonLabel.textContent = documentTitle.value;
    editor.value = normalized;
    await markdownToRichHtml(richSurface, splitFrontmatter(normalized).body, (relativePath) => window.desktopAPI?.readKnowledgeImage(activeProject.path, relativePath));
    rich.normalize();
    documentBar.hidden = false;
    formatToolbar.hidden = false;
    notesPanel.hidden = true;
    empty.hidden = true;
    saveStatus.textContent = '已保存';
    saveStatus.classList.remove('unsaved');
    setEditorVisible(true);
    editor.scrollTop = 0;
    if (normalized !== result.content) { dirty = true; saveTimer = setTimeout(() => saveActiveFile({ silent: true }), AUTOSAVE_DELAY_MS); }
    publishKnowledgeContext();
  }

  async function renderInline(container, text, token) {
    await renderMarkdownInline(container, text, (relativePath) => window.desktopAPI?.readKnowledgeImage(activeProject.path, relativePath));
    if (token !== renderToken) return;
    container.querySelectorAll('.rich-formula').forEach((formula) => {
      formula.replaceWith(renderLatexFormula(formula.dataset.latex || formula.textContent || '', { display: formula.dataset.display === 'true' }));
    });
    container.querySelectorAll('mark[data-annotation]').forEach((mark) => {
      mark.title = '查看备注';
      mark.addEventListener('click', () => openNotes(mark.dataset.annotation));
    });
  }

  async function renderPreview() {
    const token = ++renderToken;
    preview.replaceChildren();
    for (const line of splitFrontmatter(editor.value).body.split(/\r?\n/)) {
      const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
      const element = document.createElement(headingMatch ? `h${Math.min(headingMatch[1].length + 1, 6)}` : 'p');
      const text = headingMatch ? headingMatch[2] : line;
      if (!text) element.className = 'knowledge-preview-spacer';
      else await renderInline(element, text, token);
      if (token !== renderToken) return;
      preview.append(element);
    }
  }

  function insertText(text) {
    rich.insertText(text);
  }

  function wrapSelection(before, after = before, fallback = '文本') {
    if (!activeFile) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end) || fallback;
    editor.setRangeText(`${before}${selected}${after}`, start, end, 'select');
    editor.selectionStart = start + before.length;
    editor.selectionEnd = start + before.length + selected.length;
    editor.focus();
    markDirty();
  }

  function openFormulaModal() {
    createModal({
      eyebrow: '数学公式', title: '插入 LaTeX 公式', description: '输入公式主体，例如 E = mc^2。公式以可编辑文本保存在知识文件中。', confirmLabel: '插入',
      onConfirm: async (formula) => { insertText(`\n$$${formula}$$\n`); return true; }
    });
  }

  function renderAnnotations(focusId = '') {
    const annotations = splitFrontmatter(editor.value).metadata.annotations || [];
    annotationList.replaceChildren();
    if (!annotations.length) {
      const emptyMessage = document.createElement('p');
      emptyMessage.className = 'knowledge-annotation-empty';
      emptyMessage.textContent = '选中文字后右键选择“添加备注”。';
      annotationList.append(emptyMessage);
      return;
    }
    for (const annotation of annotations) {
      const item = document.createElement('article');
      item.className = 'knowledge-annotation-item';
      item.dataset.annotationId = annotation.id;
      item.innerHTML = '<div><span class="annotation-swatch"></span><button type="button" aria-label="删除备注">×</button></div><blockquote></blockquote><textarea aria-label="备注内容"></textarea>';
      item.querySelector('.annotation-swatch').style.backgroundColor = annotation.color || '#ffe082';
      item.querySelector('blockquote').textContent = annotation.quote || '';
      const noteInput = item.querySelector('textarea');
      noteInput.value = annotation.note || '';
      noteInput.addEventListener('change', () => {
        annotation.note = noteInput.value.trim();
        editor.value = updateNote(editor.value, { annotations });
        markDirty();
      });
      item.querySelector('button').addEventListener('click', () => {
        editor.value = editor.value.replace(new RegExp(`<mark data-annotation="${annotation.id}" style="background-color:#[0-9a-fA-F]{6}">([^<]*)<\\/mark>`, 'g'), '$1');
        editor.value = updateNote(editor.value, { annotations: annotations.filter((entry) => entry.id !== annotation.id) });
        markDirty();
        renderAnnotations();
      });
      annotationList.append(item);
    }
    if (focusId) annotationList.querySelector(`[data-annotation-id="${CSS.escape(focusId)}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  async function openNotes(focusId = '') {
    if (!activeProject?.path || !activeFile) return;
    const metadata = splitFrontmatter(editor.value).metadata;
    notesEditor.value = metadata.documentNote || '';
    renderAnnotations(focusId);
    notesPanel.hidden = false;
    layout.classList.add('annotation-visible');
    if (!focusId) notesEditor.focus();
  }

  async function saveNotes() {
    if (!activeProject?.path || !activeFile) return;
    editor.value = updateNote(editor.value, { documentNote: notesEditor.value.trim() });
    markDirty();
    await saveActiveFile({ silent: true });
    onToast('文档备注已保存');
  }

  async function saveImageFile(file) {
    if (!activeProject?.path || !activeFile) return;
    const bytes = await file.arrayBuffer();
    const extension = file.type === 'image/png' ? '.png' : file.type === 'image/gif' ? '.gif' : file.type === 'image/webp' ? '.webp' : '.jpg';
    const name = file.name || `pasted-${Date.now()}${extension}`;
    const result = await window.desktopAPI?.saveKnowledgeImage(activeProject.path, { name, bytes });
    if (!result?.ok) { onToast(`图片插入失败：${result?.error || '未知错误'}`); return; }
    const binary = String.fromCharCode(...new Uint8Array(bytes));
    rich.insertImage({ ...result.image, dataUrl: `data:${file.type || 'image/jpeg'};base64,${btoa(binary)}` });
    onToast(`图片已复制到项目：${result.image.path}`);
  }

  async function chooseImage() {
    if (!activeProject?.path || !activeFile) return;
    const result = await window.desktopAPI?.chooseKnowledgeImage(activeProject.path);
    if (!result?.ok) { onToast(`图片插入失败：${result?.error || '未知错误'}`); return; }
    if (result.canceled) return;
    const imageData = await window.desktopAPI?.readKnowledgeImage(activeProject.path, result.image.path);
    rich.insertImage({ ...result.image, dataUrl: imageData?.dataUrl });
    onToast(`图片已复制到项目：${result.image.path}`);
  }

  function closeContextMenu() {
    contextMenu?.remove();
    contextMenu = null;
  }

  function openFileContextMenu(relativePath, x, y) {
    closeContextMenu();
    contextMenu = document.createElement('div');
    contextMenu.className = 'knowledge-context-menu';
    contextMenu.setAttribute('role', 'menu');
    contextMenu.innerHTML = '<button type="button" data-action="open"><span class="knowledge-menu-glyph file"></span><span>打开</span></button><button type="button" data-action="reveal"><span class="knowledge-menu-glyph folder"></span><span>在资源管理器中显示</span></button><button type="button" data-action="rename"><span class="knowledge-menu-glyph edit"></span><span>编辑名称</span></button><div class="project-menu-separator"></div><button class="danger-menu-item" type="button" data-action="delete"><span class="knowledge-menu-glyph delete"></span><span>删除文件</span></button>';
    document.body.append(contextMenu);
    contextMenu.style.left = `${Math.min(x, window.innerWidth - contextMenu.offsetWidth - 10)}px`;
    contextMenu.style.top = `${Math.min(y, window.innerHeight - contextMenu.offsetHeight - 10)}px`;
    contextMenu.addEventListener('click', async (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      closeContextMenu();
      if (action === 'open') openFile(relativePath);
      if (action === 'reveal') {
        const result = await window.desktopAPI?.revealKnowledgeFile(activeProject.path, relativePath);
        if (!result?.ok) onToast(`无法定位文件：${result?.error || '未知错误'}`);
      }
      if (action === 'rename') openRenameModal(relativePath);
      if (action === 'delete') openDeleteModal(relativePath);
    });
  }

  function openSelectionContextMenu(x, y) {
    closeContextMenu();
    contextMenu = document.createElement('div');
    contextMenu.className = 'knowledge-context-menu compact';
    contextMenu.innerHTML = '<button type="button" data-action="annotate"><span class="knowledge-menu-glyph note"></span><span>添加备注</span></button><button type="button" data-action="ask"><span class="knowledge-menu-glyph ask"></span><span>询问 AI</span></button>';
    document.body.append(contextMenu);
    contextMenu.style.left = `${Math.min(x, window.innerWidth - contextMenu.offsetWidth - 10)}px`;
    contextMenu.style.top = `${Math.min(y, window.innerHeight - contextMenu.offsetHeight - 10)}px`;
    contextMenu.addEventListener('click', (event) => {
      const action = event.target.closest('[data-action]')?.dataset.action;
      closeContextMenu();
      if (action === 'annotate') openAnnotationModal();
      if (action === 'ask') explainSelection();
    });
  }

  function openCreateModal() {
    if (!activeProject?.path) return;
    createModal({
      eyebrow: '本地知识', title: '新建知识文件', description: `文件会创建在“${activeProject.name}”项目内。`, confirmLabel: '创建',
      onConfirm: async (name) => {
        const result = await window.desktopAPI?.createKnowledgeFile(activeProject.path, name);
        if (!result?.ok) { onToast(`创建失败：${result?.error || '未知错误'}`); return false; }
        await loadFiles(result.file.path);
        onToast(`已创建：${result.file.name}`);
        return true;
      }
    });
  }

  function openRenameModal(relativePath) {
    createModal({
      eyebrow: '知识文件', title: '编辑名称', description: '名称会同步修改磁盘中的实际文件。', inputValue: fileNameWithoutExtension(relativePath),
      onConfirm: async (name) => {
        if (relativePath === activeFile && !(await saveActiveFile({ silent: true }))) return false;
        const result = await window.desktopAPI?.renameKnowledgeFile(activeProject.path, relativePath, name);
        if (!result?.ok) { onToast(`重命名失败：${result?.error || '未知错误'}`); return false; }
        if (relativePath === activeFile) activeFile = result.file.path;
        await loadFiles(result.file.path);
        onToast(`已重命名为：${result.file.name}`);
        return true;
      }
    });
  }

  function openDeleteModal(relativePath) {
    createDeleteModal(relativePath, async () => {
      const result = await window.desktopAPI?.trashKnowledgeFile(activeProject.path, relativePath);
      if (!result?.ok) { onToast(`删除失败：${result?.error || '未知错误'}`); return false; }
      if (relativePath === activeFile) resetDocument();
      await loadFiles();
      onToast('知识文件已移入回收站');
      return true;
    });
  }

  function restoreEditorSelection() {
    return rich.restoreSelection();
  }

  function applyFloatingFormat(format, value) {
    rich.format(format, value);
    selectionToolbar.hide();
  }

  function openAnnotationModal() {
    if (!restoreEditorSelection()) { onToast('请在编辑模式中选择需要备注的文字'); return; }
    const selected = rich.selectedText();
    if (!selected) return;
    const overlay = document.createElement('div');
    overlay.className = 'project-modal-overlay';
    overlay.innerHTML = '<section class="project-modal knowledge-annotation-modal" role="dialog" aria-modal="true"><div class="project-modal-header"><p class="eyebrow">本地知识</p><h3>添加注释 / 备注</h3><p class="project-modal-description"></p></div><div class="project-modal-body"><label class="annotation-note-field"><span>备注内容</span><textarea maxlength="4000" placeholder="写下解释、疑问或后续线索"></textarea></label><label class="annotation-color-field"><span>记号笔颜色</span><input type="color" value="#ffe082"></label></div><div class="project-modal-actions"><button class="jelly-cancel-button" data-cancel>取消</button><button class="jelly-confirm-button" data-confirm>保存备注</button></div></section>';
    overlay.querySelector('.project-modal-description').textContent = selected.length > 100 ? `${selected.slice(0, 100)}...` : selected;
    const close = () => overlay.remove();
    overlay.querySelector('[data-cancel]').addEventListener('click', close);
    overlay.querySelector('[data-confirm]').addEventListener('click', () => {
      const note = overlay.querySelector('textarea').value.trim();
      const color = overlay.querySelector('input[type="color"]').value;
      const id = `ann-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
      const annotation = { id, quote: selected, note, color, created: new Date().toISOString() };
      rich.annotate(id, color);
      editor.value = richHtmlToMarkdown(richSurface);
      const parsed = splitFrontmatter(editor.value);
      editor.value = updateNote(editor.value, { annotations: [...(parsed.metadata.annotations || []), annotation] });
      markDirty();
      openNotes(id);
      close();
    });
    overlay.addEventListener('pointerdown', (event) => { if (event.target === overlay) close(); });
    document.body.append(overlay);
    requestAnimationFrame(() => overlay.querySelector('textarea').focus());
  }

  function textareaSelectionRect() {
    const bounds = editor.getBoundingClientRect();
    const before = editor.value.slice(0, editor.selectionStart).split(/\r?\n/);
    const lineHeight = 24;
    const visibleLine = Math.max(0, before.length - 1 - Math.floor(editor.scrollTop / lineHeight));
    return { left: bounds.left + 42, right: bounds.left + Math.min(bounds.width - 30, 260), width: 190, top: bounds.top + 28 + visibleLine * lineHeight, bottom: bounds.top + 50 + visibleLine * lineHeight };
  }

  function updateSelectionAction() {
    let text = '';
    let rect;
    if (!richSurface.hidden && (document.activeElement === richSurface || richSurface.contains(document.activeElement))) {
      text = rich.selectedText();
      selectionRange = { source: 'rich' };
      rect = rich.selectionRect() || richSurface.getBoundingClientRect();
    } else {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) { selectionToolbar.hide(); return; }
      const range = selection.getRangeAt(0);
      const ancestor = range.commonAncestorContainer.nodeType === Node.TEXT_NODE ? range.commonAncestorContainer.parentElement : range.commonAncestorContainer;
      if (!preview.contains(ancestor)) { selectionToolbar.hide(); return; }
      text = selection.toString().trim();
      rect = range.getBoundingClientRect();
      selectionRange = { source: 'preview' };
    }
    if (text.length < 2 || text.length > 5000) { selectionToolbar.hide(); return; }
    selectedText = text;
    selectionToolbar.show(rect, selectionRange.source === 'rich' ? rich.formattingState() : {});
  }

  async function explainSelection() {
    if (!selectedText) return;
    selectionToolbar.hide();
    const context = editor.value.slice(0, 18000);
    const prompt = `请解释下面选中的本地知识。结合上下文说明含义，拆解关键概念，必要时给出清晰的数学公式（使用 Markdown LaTeX，如 $$...$$），并指出它在当前知识文件中的作用。\n\n选中内容：\n${selectedText}\n\n本地知识上下文：\n${context}`;
    const result = await window.desktopAPI?.openAISidecar('api', 'chatgpt', prompt, true);
    if (result?.ok) onToast('问题已发送到外部 AI 侧栏');
    else onToast(`无法打开外部 AI 侧栏：${result?.error || '未知错误'}`);
  }

  document.addEventListener('project:selected', async (event) => {
    await saveActiveFile({ silent: true });
    if (event.detail?.path) showPanel(event.detail);
    else { activeProject = event.detail || null; hidePanel(); }
  });
  document.addEventListener('knowledge:open', (event) => { if (event.detail?.path) showPanel(event.detail); });
  document.addEventListener('knowledge:refresh', () => { if (!panel.hidden) loadFiles(); });
  window.desktopAPI?.onAIKnowledgeSaved(async (update) => {
    if (!update?.project?.path || !update?.file?.path) return;
    clearTimeout(saveTimer);
    dirty = false;
    await showPanel(update.project, update.file.path, { force: true });
    onToast(`AI 内容已写入：${update.file.name}`);
  });
  document.getElementById('knowledgeFileAddButton').addEventListener('click', openCreateModal);
  document.getElementById('saveKnowledgeButton').addEventListener('click', () => saveActiveFile());
  documentTitle.addEventListener('input', () => {
    const activeButtonLabel = fileList.querySelector(`.knowledge-file-button[data-file-path="${CSS.escape(activeFile)}"] span:last-child`);
    if (activeButtonLabel) activeButtonLabel.textContent = documentTitle.value.trim() || fileNameWithoutExtension(activeFile);
    markDirty();
  });
  documentTitle.addEventListener('keydown', (event) => { if (event.key === 'Enter') { event.preventDefault(); documentTitle.blur(); } });
  document.getElementById('insertKnowledgeImageButton').addEventListener('click', chooseImage);
  const boldButton = document.getElementById('knowledgeBoldButton');
  const underlineButton = document.getElementById('knowledgeUnderlineButton');
  boldButton.addEventListener('click', () => { rich.format('bold'); syncFormatControls(); });
  underlineButton.addEventListener('click', () => { rich.format('underline'); syncFormatControls(); });
  const fontSelect = document.getElementById('knowledgeFontSelect');
  const fontSizeSelect = document.getElementById('knowledgeFontSizeSelect');
  const syncFormatControls = () => {
    const state = rich.formattingState();
    fontSelect.value = [...fontSelect.options].some((option) => option.value === state.font) ? state.font : '';
    fontSizeSelect.value = [...fontSizeSelect.options].some((option) => option.value === state.size) ? state.size : '';
    boldButton.setAttribute('aria-pressed', String(Boolean(state.bold)));
    underlineButton.setAttribute('aria-pressed', String(Boolean(state.underline)));
  };
  fontSelect.addEventListener('change', (event) => {
    if (event.target.value) rich.format('font', event.target.value);
    syncFormatControls();
  });
  fontSizeSelect.addEventListener('change', (event) => {
    if (event.target.value) rich.format('size', event.target.value);
    syncFormatControls();
  });
  const bindLiveColor = (input, format) => {
    let lastApplied = '';
    let active = false;
    input.addEventListener('pointerdown', () => {
      lastApplied = '';
      active = true;
      beginSharedColor(format, input.value, input);
    });
    const apply = () => {
      if (!input.value || input.value === lastApplied) return;
      if (!active) { beginSharedColor(format, input.value, input); active = true; }
      lastApplied = input.value;
      updateSharedColor(format, input.value, input);
    };
    input.addEventListener('input', apply);
    input.addEventListener('change', () => { apply(); endSharedColor(); active = false; });
    input.addEventListener('cancel', () => { endSharedColor(); active = false; });
  };
  bindLiveColor(document.getElementById('knowledgeColorInput'), 'color');
  bindLiveColor(document.getElementById('knowledgeHighlightInput'), 'highlight');
  document.getElementById('knowledgeClearColorButton').addEventListener('click', () => { rich.format('color', ''); syncFormatControls(); });
  document.getElementById('knowledgeClearHighlightButton').addEventListener('click', () => rich.format('clearHighlight'));
  document.querySelectorAll('[data-highlight-color]').forEach((button) => button.addEventListener('click', () => rich.format('highlight', button.dataset.highlightColor)));
  document.getElementById('knowledgeFormulaButton').addEventListener('click', openFormulaModal);
  document.getElementById('knowledgeMathTypeButton').addEventListener('click', async () => {
    const selected = rich.selectedText();
    const formula = selected || editor.value.match(/\$\$([\s\S]*?)\$\$/)?.[1]?.trim() || '';
    const result = await window.desktopAPI?.openMathType(formula);
    if (!result?.ok) { onToast(`MathType 启动失败：${result?.error || '未找到软件'}`); return; }
    if (formula) await navigator.clipboard?.writeText(formula);
    onToast(formula ? 'MathType 已打开，公式文本已复制，可直接粘贴编辑' : 'MathType 已打开');
  });
  document.getElementById('knowledgeNotesButton').addEventListener('click', openNotes);
  document.getElementById('closeKnowledgeNotesButton').addEventListener('click', () => { notesPanel.hidden = true; layout.classList.remove('annotation-visible'); });
  document.getElementById('saveKnowledgeNotesButton').addEventListener('click', saveNotes);
  document.getElementById('exportKnowledgePdfButton').addEventListener('click', async () => {
    if (!activeProject?.path || !activeFile || !(await saveActiveFile({ silent: true }))) return;
    const result = await window.desktopAPI?.exportKnowledgePdf(activeProject.path, activeFile);
    if (!result?.ok) onToast(`PDF 导出失败：${result?.error || '未知错误'}`);
    else if (!result.canceled) onToast(`PDF 已导出：${result.name}`);
  });
  document.getElementById('refreshKnowledgeButton').addEventListener('click', () => loadFiles());
  document.getElementById('closeKnowledgeButton').addEventListener('click', hidePanel);
  editModeButton.addEventListener('click', () => setEditorVisible(true));
  previewModeButton.addEventListener('click', () => setEditorVisible(false));
  editor.addEventListener('input', markDirty);
  richSurface.addEventListener('paste', async (event) => {
    const images = [...event.clipboardData.items].filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter(Boolean);
    if (!images.length) return;
    event.preventDefault();
    for (const image of images) await saveImageFile(image);
  });
  editor.addEventListener('pointerup', () => setTimeout(updateSelectionAction));
  editor.addEventListener('keyup', updateSelectionAction);
  richSurface.addEventListener('mouseup', () => setTimeout(() => { updateSelectionAction(); syncFormatControls(); }));
  richSurface.addEventListener('keyup', () => { updateSelectionAction(); syncFormatControls(); });
  richSurface.addEventListener('contextmenu', (event) => { updateSelectionAction(); if (selectedText) { event.preventDefault(); openSelectionContextMenu(event.clientX, event.clientY); } });
  editor.addEventListener('contextmenu', (event) => {
    updateSelectionAction();
    if (selectionRange?.source === 'rich' && selectedText) { event.preventDefault(); openSelectionContextMenu(event.clientX, event.clientY); }
  });
  preview.addEventListener('pointerup', () => setTimeout(updateSelectionAction));
  preview.addEventListener('keyup', updateSelectionAction);
  document.getElementById('closeKnowledgeExplainButton').addEventListener('click', () => { explainPane.hidden = true; layout.classList.remove('explain-visible'); });
  fileList.addEventListener('contextmenu', (event) => { if (!event.target.closest('.knowledge-file-button')) { event.preventDefault(); openCreateModal(); } });
  document.addEventListener('pointerdown', (event) => {
    if (contextMenu && !event.target.closest('.knowledge-context-menu')) closeContextMenu();
    if (!event.target.closest('.knowledge-selection-toolbar') && !event.target.closest('#knowledgeReader')) selectionToolbar.hide();
  });
  document.addEventListener('keydown', (event) => {
    if (event.ctrlKey && event.key.toLowerCase() === 's' && !panel.hidden) { event.preventDefault(); saveActiveFile(); }
    if (event.key === 'Escape') closeContextMenu();
  });
  window.addEventListener('resize', () => { selectionToolbar.hide(); closeContextMenu(); });
}

