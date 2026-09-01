const MAX_PDF_BYTES = 100_000_000;

function isPdf(file) {
  return file?.type === 'application/pdf' || /\.pdf$/i.test(file?.name || '');
}

export function createDocumentViewer({ onToast }) {
  const panel = document.getElementById('documentViewer');
  const frame = document.getElementById('documentViewerFrame');
  const title = document.getElementById('documentViewerTitle');
  const overlay = document.getElementById('documentDropOverlay');
  const contentPanel = document.getElementById('contentPanel');
  const welcome = document.querySelector('.welcome-view');
  const breadcrumbTitle = document.querySelector('.breadcrumb strong');
  if (!panel || !frame || !overlay || !contentPanel) return { current: () => null };

  let activeDocument = null;
  let dragDepth = 0;

  function setOverlay(visible) {
    overlay.hidden = !visible;
    contentPanel.classList.toggle('document-drag-active', visible);
  }

  function hideOtherViews() {
    welcome.hidden = true;
    document.getElementById('knowledgePanel').hidden = true;
    document.getElementById('leisureStage').hidden = true;
  }

  function showCurrent() {
    if (!activeDocument) return false;
    hideOtherViews();
    panel.hidden = false;
    if (breadcrumbTitle) breadcrumbTitle.textContent = activeDocument.name;
    return true;
  }

  function close({ clear = true } = {}) {
    panel.hidden = true;
    if (clear) {
      frame.removeAttribute('src');
      activeDocument = null;
      title.textContent = '';
    }
    if (document.body.dataset.workspaceMode !== 'leisure') welcome.hidden = false;
    if (breadcrumbTitle) breadcrumbTitle.textContent = '欢迎使用';
  }

  async function openPath(filePath) {
    const result = await window.desktopAPI?.previewPdf(filePath);
    if (!result?.ok) { onToast(result?.error || 'PDF 打开失败'); return false; }
    activeDocument = { path: result.path, name: result.name };
    title.textContent = result.name;
    frame.src = `${result.url}#toolbar=1&navpanes=1&view=FitH`;
    showCurrent();
    onToast(`已打开：${result.name}`);
    return true;
  }

  async function openDroppedPdf(file) {
    if (!isPdf(file)) { onToast('当前仅支持拖入 PDF 文档'); return; }
    if (file.size > MAX_PDF_BYTES) { onToast('PDF 超过 100 MB，无法打开'); return; }
    const filePath = await window.desktopAPI?.getDroppedFilePath(file);
    if (!filePath) { onToast('无法读取该 PDF 的本地路径'); return; }
    await openPath(filePath);
  }

  function hasFiles(event) {
    return [...(event.dataTransfer?.types || [])].includes('Files');
  }

  contentPanel.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth += 1;
    setOverlay(true);
  });
  contentPanel.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });
  contentPanel.addEventListener('dragleave', (event) => {
    if (!dragDepth) return;
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) setOverlay(false);
  });
  contentPanel.addEventListener('drop', async (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    dragDepth = 0;
    setOverlay(false);
    const files = [...(event.dataTransfer?.files || [])];
    const pdf = files.find(isPdf);
    if (!pdf) { onToast('请拖入 PDF 文档'); return; }
    await openDroppedPdf(pdf);
  });

  document.getElementById('closeDocumentViewerButton').addEventListener('click', () => close());
  document.addEventListener('document:generated', (event) => { if (event.detail?.path) openPath(event.detail.path); });
  document.addEventListener('project:selected', () => close());
  document.addEventListener('workspace:mode-changed', (event) => {
    if (event.detail?.mode === 'leisure') panel.hidden = true;
    else if (activeDocument) showCurrent();
  });
  return {
    current: () => activeDocument ? { ...activeDocument } : null,
    openPath
  };
}
