const STARMAP_URL = 'http://127.0.0.1:5173/';

export function createGlobalController({ onToast }) {
  const stage = document.getElementById('globalStage');
  const frame = document.getElementById('globalStarmapFrame');
  const placeholder = document.getElementById('globalStageContent');
  const status = document.getElementById('globalStatus');
  const launchButtons = [document.getElementById('launchGlobalMapButton'), document.getElementById('launchGlobalMapInlineButton')].filter(Boolean);
  const openFolderButton = document.getElementById('openGlobalFolderButton');
  if (!stage || !frame || !placeholder || !status) return;

  let loaded = false;
  let launching = false;
  const setLoaded = (value) => {
    loaded = Boolean(value);
    frame.hidden = !loaded;
    placeholder.hidden = loaded;
    status.textContent = loaded ? 'StarMap 已连接' : 'StarMap 尚未启动';
    launchButtons.forEach((button) => { button.textContent = loaded ? '重新加载 StarMap' : '启动 StarMap'; button.disabled = false; });
  };
  const loadFrame = () => {
    frame.src = `${STARMAP_URL}?lmark=${Date.now()}`;
    status.textContent = '正在连接 StarMap…';
  };
  const launch = async () => {
    if (launching) return;
    launching = true;
    launchButtons.forEach((button) => { button.disabled = true; button.textContent = '正在启动…'; });
    status.textContent = '正在启动 StarMap…';
    try {
      const result = await window.desktopAPI?.startGlobalStarMap();
      if (!result?.ok) throw new Error(result?.error || 'StarMap 启动失败');
      loadFrame();
    } catch (error) {
      setLoaded(false);
      onToast(error.message);
    } finally {
      launching = false;
    }
  };
  frame.addEventListener('load', () => setLoaded(true));
  frame.addEventListener('error', () => { setLoaded(false); onToast('StarMap 页面加载失败，请先启动本地服务'); });
  launchButtons.forEach((button) => button.addEventListener('click', launch));
  openFolderButton?.addEventListener('click', async () => {
    const result = await window.desktopAPI?.openGlobalFolder();
    if (!result?.ok) onToast(result?.error || '环球区文件夹尚未准备好');
  });
  document.addEventListener('workspace:mode-changed', (event) => {
    const global = event.detail?.mode === 'global';
    stage.hidden = !global;
    if (global && !loaded && !frame.src) {
      window.desktopAPI?.globalStarMapStatus?.().then((result) => {
        if (result?.ok && result.available) loadFrame();
      }).catch(() => {});
    }
  });
  if (document.body.dataset.workspaceMode === 'global') stage.hidden = false;
}
