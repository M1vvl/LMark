const STARMAP_URL = 'http://127.0.0.1:5173/';
const MAP_SOURCE_KEY = 'lmark.global-map-source';

export function createGlobalController({ onToast }) {
  const stage = document.getElementById('globalStage');
  const frame = document.getElementById('globalStarmapFrame');
  const placeholder = document.getElementById('globalStageContent');
  const status = document.getElementById('globalStatus');
  const launchButtons = [document.getElementById('launchGlobalMapButton'), document.getElementById('launchGlobalMapInlineButton')].filter(Boolean);
  const openFolderButton = document.getElementById('openGlobalFolderButton');
  const mapSettingsButton = document.getElementById('globalMapSettingsButton');
  const mapSettings = document.getElementById('globalMapSettings');
  const cesiumToken = document.getElementById('globalCesiumToken');
  const tiandituToken = document.getElementById('globalTiandituToken');
  const sourceButtons = [...document.querySelectorAll('[data-global-map-source]')];
  if (!stage || !frame || !placeholder) return;
  if (cesiumToken) cesiumToken.value = localStorage.getItem('lmark.cesium-token') || '';
  if (tiandituToken) tiandituToken.value = localStorage.getItem('lmark.tianditu-token') || '';
  let mapSource = ['cesium', 'tianditu'].includes(localStorage.getItem(MAP_SOURCE_KEY)) ? localStorage.getItem(MAP_SOURCE_KEY) : 'cesium';
  const updateSourceButtons = () => sourceButtons.forEach((button) => {
    const active = button.dataset.globalMapSource === mapSource;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  updateSourceButtons();
  const closeMapSettings = () => {
    mapSettingsButton?.setAttribute('aria-expanded', 'false');
    if (mapSettings) mapSettings.hidden = true;
  };
  mapSettingsButton?.addEventListener('click', () => {
    const open = mapSettingsButton.getAttribute('aria-expanded') !== 'true';
    mapSettingsButton.setAttribute('aria-expanded', String(open));
    if (mapSettings) mapSettings.hidden = !open;
  });
  document.addEventListener('pointerdown', (event) => {
    if (mapSettings?.hidden !== false) return;
    if (event.target instanceof Node && (mapSettings.contains(event.target) || mapSettingsButton?.contains(event.target))) return;
    closeMapSettings();
  });
  let loaded = false;
  let launching = false;
  const frameUrl = (url) => {
    try {
      const target = new URL(url || STARMAP_URL);
      target.search = '';
      const locale = localStorage.getItem('lmark.locale') === 'en' ? 'en' : 'zh-CN';
      const runtime = new URLSearchParams({ lmark: String(Date.now()), mapSource, locale });
      const cesium = cesiumToken?.value.trim() || '';
      const tianditu = tiandituToken?.value.trim() || '';
      if (cesium) runtime.set('cesiumToken', cesium);
      if (tianditu) runtime.set('tiandituToken', tianditu);
      // Keep credentials in the URL fragment so they are never sent to the
      // local static server or exposed in request logs.
      target.hash = runtime.toString();
      return target.toString();
    } catch { return url || STARMAP_URL; }
  };
  const reloadMap = () => {
    if (!loaded && !frame.src) return;
    loaded = false;
    frame.hidden = true;
    placeholder.hidden = false;
    frame.src = frameUrl(frame.src || STARMAP_URL);
    if (status) status.textContent = '正在连接 StarMap…';
  };
  let tokenReloadTimer;
  const handleTokenInput = (provider, event) => {
    const value = event.target.value.trim();
    localStorage.setItem(provider === 'cesium' ? 'lmark.cesium-token' : 'lmark.tianditu-token', value);
    // Entering a token implicitly selects its provider. A short debounce keeps
    // typing responsive while still applying the new credential promptly.
    if (value) {
      mapSource = provider;
      localStorage.setItem(MAP_SOURCE_KEY, mapSource);
      updateSourceButtons();
    }
    clearTimeout(tokenReloadTimer);
    tokenReloadTimer = setTimeout(() => {
      if (frame.src) reloadMap();
    }, 420);
  };
  cesiumToken?.addEventListener('input', (event) => handleTokenInput('cesium', event));
  tiandituToken?.addEventListener('input', (event) => handleTokenInput('tianditu', event));
  sourceButtons.forEach((button) => button.addEventListener('click', () => {
    const next = button.dataset.globalMapSource;
    if (!['cesium', 'tianditu'].includes(next) || next === mapSource) return;
    mapSource = next;
    localStorage.setItem(MAP_SOURCE_KEY, mapSource);
    updateSourceButtons();
    reloadMap();
  }));
  document.querySelectorAll('.global-token-link').forEach((link) => link.addEventListener('click', async (event) => {
    event.preventDefault();
    const url = link.getAttribute('href');
    const result = await window.desktopAPI?.openExternal?.(url);
    if (!result?.ok) onToast(result?.error || '无法打开申请页面');
  }));

  const setLoaded = (value) => {
    loaded = Boolean(value);
    frame.hidden = !loaded;
    placeholder.hidden = loaded;
    if (status) status.textContent = loaded ? 'StarMap 已连接' : 'StarMap 尚未启动';
    launchButtons.forEach((button) => { button.textContent = loaded ? '重新加载 StarMap' : '启动 StarMap'; button.disabled = false; });
  };
  const loadFrame = (url = STARMAP_URL) => {
    frame.hidden = true;
    placeholder.hidden = false;
    frame.src = frameUrl(url);
    if (status) status.textContent = '正在连接 StarMap…';
  };
  const launch = async () => {
    if (launching) return;
    launching = true;
    launchButtons.forEach((button) => { button.disabled = true; button.textContent = '正在启动…'; });
    if (status) status.textContent = '正在启动 StarMap…';
    try {
      const result = await window.desktopAPI?.startGlobalStarMap();
      if (!result?.ok) throw new Error(result?.error || 'StarMap 启动失败');
      loadFrame(result.url || STARMAP_URL);
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
    if (global && !loaded && !launching) launch();
  });
  if (document.body.dataset.workspaceMode === 'global') { stage.hidden = false; launch(); }
}
