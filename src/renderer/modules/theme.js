const STORAGE_KEY = 'codex-desktop-theme';

const DEFAULT_THEME = Object.freeze({
  mode: 'dark',
  accent: '#9ecbff',
  wallpaper: '',
  wallpaperType: 'none',
  wallpaperSourceUrl: '',
  overlay: 0.92
});

function readTheme() {
  try {
    return { ...DEFAULT_THEME, ...JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') };
  } catch {
    return { ...DEFAULT_THEME };
  }
}

function persistTheme(theme) { localStorage.setItem(STORAGE_KEY, JSON.stringify(theme)); }

function applyTheme(theme) {
  document.body.classList.toggle('light-theme', theme.mode === 'light');
  document.documentElement.style.setProperty('--accent', theme.accent);
  document.documentElement.style.setProperty('--accent-strong', theme.accent);
  const shell = document.getElementById('appShell');
  shell.style.backgroundImage = theme.wallpaper ? `url("${theme.wallpaper.replaceAll('"', '\\"')}")` : '';
  shell.style.setProperty('--wallpaper-overlay', theme.overlay);
  let layer = document.getElementById('wallpaperEngineLayer');
  if (!layer) { layer = document.createElement('div'); layer.id = 'wallpaperEngineLayer'; layer.className = 'wallpaper-engine-layer'; shell.prepend(layer); }
  layer.replaceChildren();
  layer.hidden = !theme.wallpaper || theme.wallpaperType !== 'video';
  if (!layer.hidden) {
    const video = document.createElement('video');
    video.src = theme.wallpaper;
    video.autoplay = true;
    video.loop = true;
    video.muted = true;
    video.playsInline = true;
    layer.append(video);
    video.play().catch(() => {});
  }
  document.getElementById('themeStatus').textContent = `${theme.mode === 'light' ? '浅色' : '深色'} · ${theme.wallpaper ? '自定义壁纸' : '默认'}`;
}

export function createThemeController({ onToast }) {
  let theme = readTheme();
  let closeActivePanel = null;
  applyTheme(theme);

  function update(partial) {
    theme = { ...theme, ...partial };
    persistTheme(theme);
    applyTheme(theme);
  }

  async function openPanel({ expandTheme = false, themeOnly = false, anchor = null, placement = 'above' } = {}) {
    const existing = document.getElementById('themePanel');
    if (existing) { closeActivePanel?.(); return; }
    const panel = document.createElement('section');
    panel.id = 'themePanel';
    panel.className = 'theme-panel settings-panel';
    panel.style.visibility = 'hidden';
    const themeControls = `<div class="theme-settings-body" data-theme-body>
        <label class="setting-row"><span>界面模式</span><select data-mode><option value="dark">深色</option><option value="light">浅色</option></select></label>
        <label class="setting-row"><span>强调色</span><input type="color" data-accent /></label>
        <div class="setting-row wallpaper-row"><div><span>自定义壁纸</span><small>支持本地图片、视频和 Wallpaper Engine 预览</small></div><div class="wallpaper-actions"><button class="ghost-button" data-choose-wallpaper>选择图片</button><button class="ghost-button" data-use-wallpaper-engine>读取当前</button><button class="ghost-button" data-choose-wallpaper-engine>选择项目</button></div></div>
        <label class="setting-row"><span>壁纸地址</span><input class="url-input" type="url" data-wallpaper-url placeholder="https://..." /></label>
        <div class="theme-panel-footer"><button class="text-button" data-reset-theme>恢复默认</button><span>设置自动保存</span></div>
      </div>`;
    const fullSettings = `<button class="settings-section-toggle jelly-settings-button" type="button" data-theme-toggle aria-expanded="${expandTheme}"><span class="settings-section-glyph" aria-hidden="true">◐</span><span>主题设置</span><span class="settings-section-chevron" aria-hidden="true">⌄</span></button><div data-theme-collapsible ${expandTheme ? '' : 'hidden'}>${themeControls}</div>
      <div class="setting-row project-location-row"><div><span>默认项目保存位置</span><small data-project-root>正在读取位置...</small></div><button class="jelly-settings-button compact" data-change-project-root>文件位置修改</button></div>
      <div class="setting-row language-setting-row"><div><span>语言</span><small>切换软件界面语言</small></div><div class="language-choice" role="group"><button type="button" data-language="zh-CN">简体中文</button><button type="button" data-language="en">English</button></div></div>
      <div class="setting-row update-setting-row"><div><span>软件更新</span><small data-update-status>正在读取版本...</small></div><div class="update-actions"><select data-update-channel aria-label="更新通道"><option value="stable">稳定版</option><option value="beta">测试版</option></select><label class="update-toggle"><input type="checkbox" data-auto-update /><span>自动更新</span></label><button class="jelly-settings-button compact" data-check-update>检查更新</button><button class="jelly-settings-button compact" data-download-update hidden>下载</button><button class="jelly-settings-button compact" data-install-update hidden>重启安装</button></div></div>
      <div class="setting-row release-choice-row"><div><span>选择版本</span><small>查看 GitHub Releases，下载指定版本</small></div><div class="update-actions"><select data-release-version aria-label="选择版本"><option value="">读取版本...</option></select><button class="jelly-settings-button compact" data-open-release disabled>打开下载页</button></div></div>
      <button class="settings-section-toggle jelly-settings-button" type="button" data-mcp-toggle aria-expanded="false"><span class="settings-section-glyph" aria-hidden="true">⌘</span><span>MCP 本地知识服务</span><span class="settings-section-chevron" aria-hidden="true">⌄</span></button>
      <div class="mcp-settings-body" data-mcp-body hidden><p class="settings-help">外部 MCP 客户端可以通过只读搜索、读取、创建、更新和追加工具访问当前项目。更新操作支持文件修改时间冲突保护。</p><code data-mcp-command>正在读取命令...</code><button class="jelly-settings-button compact" data-copy-mcp>复制 MCP 启动命令</button></div>`;
    panel.innerHTML = `<div class="theme-panel-heading"><div><p class="eyebrow">${themeOnly ? '界面主题' : '工作区设置'}</p><h3>${themeOnly ? '主题' : '设置'}</h3></div><button class="icon-button subtle" data-close-theme aria-label="关闭${themeOnly ? '主题' : '设置'}">×</button></div>${themeOnly ? themeControls : fullSettings}`;
    document.body.append(panel);
    const close = () => {
      window.removeEventListener('resize', positionPanel);
      panel.remove();
      closeActivePanel = null;
    };
    const positionPanel = () => {
      if (!anchor?.isConnected) { panel.style.visibility = ''; return; }
      panel.classList.add('is-anchored');
      const rect = anchor.getBoundingClientRect();
      const margin = 8;
      const left = placement === 'below'
        ? Math.min(window.innerWidth - panel.offsetWidth - 10, Math.max(10, rect.left))
        : Math.min(window.innerWidth - panel.offsetWidth - 10, Math.max(10, rect.right - panel.offsetWidth));
      const desiredTop = placement === 'below' ? rect.bottom + margin : rect.top - panel.offsetHeight - margin;
      panel.style.left = `${left}px`;
      panel.style.top = `${Math.min(window.innerHeight - panel.offsetHeight - 10, Math.max(10, desiredTop))}px`;
      panel.style.visibility = '';
    };
    window.addEventListener('resize', positionPanel);
    closeActivePanel = close;
    panel.querySelector('[data-mode]').value = theme.mode;
    panel.querySelector('[data-accent]').value = theme.accent;
    panel.querySelector('[data-wallpaper-url]').value = theme.wallpaperSourceUrl || (theme.wallpaperType === 'url' ? theme.wallpaper : '');
    panel.querySelector('[data-close-theme]').onclick = close;
    const themeToggle = panel.querySelector('[data-theme-toggle]');
    if (themeToggle) themeToggle.onclick = () => {
      const toggle = panel.querySelector('[data-theme-toggle]');
      const body = panel.querySelector('[data-theme-collapsible]');
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      body.hidden = !open;
      requestAnimationFrame(positionPanel);
    };
    panel.querySelector('[data-mode]').onchange = (event) => update({ mode: event.target.value });
    panel.querySelector('[data-accent]').oninput = (event) => update({ accent: event.target.value });
    panel.querySelector('[data-wallpaper-url]').onchange = async (event) => {
      const value = event.target.value.trim();
      if (!value) { update({ wallpaper: '', wallpaperType: 'none', wallpaperSourceUrl: '' }); return; }
      const result = await window.desktopAPI?.resolveWallpaperUrl(value);
      if (!result?.ok || !result.wallpaper?.url) { onToast(result?.error || '壁纸地址不可用'); return; }
      const wallpaper = result.wallpaper;
      update({ wallpaper: wallpaper.url, wallpaperType: wallpaper.type === 'video' ? 'video' : 'image', wallpaperSourceUrl: value, wallpaperSource: wallpaper.title });
      onToast(wallpaper.type === 'scene' ? 'Steam 壁纸已解析，使用本地预览图作为主题' : `已应用壁纸：${wallpaper.title}`);
    };
    panel.querySelector('[data-choose-wallpaper]').onclick = async () => {
      const selected = await window.desktopAPI?.chooseWallpaper();
      if (selected) { update({ wallpaper: `file://${selected.replaceAll('\\', '/')}`, wallpaperType: 'file' }); onToast('壁纸已应用'); }
    };
    panel.querySelector('[data-choose-wallpaper-engine]').onclick = async () => {
      const result = await window.desktopAPI?.chooseWallpaperProject();
      if (result?.canceled) return;
      if (!result?.ok || !result.wallpaper?.url) { onToast(result?.error || '未找到可用的 Wallpaper Engine 媒体'); return; }
      const wallpaper = result.wallpaper;
      const type = wallpaper.type === 'video' ? 'video' : 'image';
      update({ wallpaper: wallpaper.url, wallpaperType: type, wallpaperSource: wallpaper.title });
      onToast(wallpaper.type === 'scene' ? '场景壁纸已使用预览图作为软件主题' : `已应用：${wallpaper.title}`);
    };
    panel.querySelector('[data-use-wallpaper-engine]').onclick = async () => {
      const result = await window.desktopAPI?.getCurrentWallpaper();
      if (!result?.ok || !result.wallpaper?.url) { onToast(result?.error || '无法读取 Wallpaper Engine 当前壁纸'); return; }
      const wallpaper = result.wallpaper;
      update({ wallpaper: wallpaper.url, wallpaperType: wallpaper.type === 'video' ? 'video' : 'image', wallpaperSource: wallpaper.title });
      onToast(result.fallback ? '当前场景壁纸已使用预览图作为软件主题' : `已应用当前壁纸：${wallpaper.title}`);
    };
    panel.querySelector('[data-reset-theme]').onclick = () => { theme = { ...DEFAULT_THEME }; persistTheme(theme); applyTheme(theme); close(); onToast('已恢复默认主题'); };
    panel.querySelectorAll('[data-language]').forEach((button) => button.addEventListener('click', () => { localStorage.setItem('lmark.locale', button.dataset.language); location.reload(); }));
    if (themeOnly) { requestAnimationFrame(positionPanel); return; }
    const projectRootLabel = panel.querySelector('[data-project-root]');
    window.desktopAPI?.getProjectRoot().then((result) => { if (result?.ok) projectRootLabel.textContent = result.path; }).catch(() => { projectRootLabel.textContent = '读取失败'; });
    panel.querySelector('[data-change-project-root]').onclick = async () => {
      const selected = await window.desktopAPI?.chooseFolder();
      if (!selected) return;
      const result = await window.desktopAPI?.setProjectRoot(selected);
      if (!result?.ok) { onToast(`保存位置修改失败：${result?.error || '未知错误'}`); return; }
      projectRootLabel.textContent = result.path;
      onToast('默认项目保存位置已修改');
    };
    const updateStatus = panel.querySelector('[data-update-status]');
    const updateChannel = panel.querySelector('[data-update-channel]');
    const checkUpdate = panel.querySelector('[data-check-update]');
    const downloadUpdate = panel.querySelector('[data-download-update]');
    const installUpdate = panel.querySelector('[data-install-update]');
    const autoUpdateToggle = panel.querySelector('[data-auto-update]');
    const releaseSelect = panel.querySelector('[data-release-version]');
    const openRelease = panel.querySelector('[data-open-release]');
    const updateInfo = await window.desktopAPI?.getUpdateStatus();
    updateChannel.value = updateInfo?.channel || 'stable';
    updateStatus.textContent = `当前版本 ${updateInfo?.version || '未知'}${updateInfo?.packaged ? '' : ' · 开发模式'}`;
    autoUpdateToggle.checked = Boolean(updateInfo?.autoUpdate);
    autoUpdateToggle.onchange = async () => {
      const next = await window.desktopAPI?.setAutoUpdate(autoUpdateToggle.checked);
      autoUpdateToggle.checked = Boolean(next?.autoUpdate);
      updateStatus.textContent = autoUpdateToggle.checked ? '自动更新已开启' : '自动更新已关闭';
    };
    updateChannel.onchange = async () => {
      const next = await window.desktopAPI?.setUpdateChannel(updateChannel.value);
      updateStatus.textContent = `当前版本 ${next?.version || updateInfo?.version || '未知'} · ${next?.channel === 'beta' ? '测试版' : '稳定版'}通道`;
    };
    checkUpdate.onclick = async () => {
      updateStatus.textContent = '正在检查更新...';
      const result = await window.desktopAPI?.checkForUpdates();
      if (!result?.ok) updateStatus.textContent = result?.reason || result?.error || '检查更新失败';
    };
    downloadUpdate.onclick = async () => { updateStatus.textContent = '正在下载更新...'; await window.desktopAPI?.downloadUpdate(); };
    installUpdate.onclick = () => window.desktopAPI?.installUpdate();
    const releaseResult = await window.desktopAPI?.listReleases();
    if (releaseResult?.ok) {
      releaseSelect.replaceChildren(...releaseResult.releases.map((release) => { const option = document.createElement('option'); option.value = release.url; option.textContent = `${release.version}${release.prerelease ? ' · 测试版' : ' · 稳定版'}`; return option; }));
      if (!releaseResult.releases.length) releaseSelect.replaceChildren(Object.assign(document.createElement('option'), { textContent: '暂无可用版本' }));
      openRelease.disabled = !releaseSelect.value;
      releaseSelect.onchange = () => { openRelease.disabled = !releaseSelect.value; };
      openRelease.onclick = async () => { if (releaseSelect.value) await window.desktopAPI?.openRelease(releaseSelect.value); };
    } else {
      releaseSelect.replaceChildren(Object.assign(document.createElement('option'), { textContent: '版本列表读取失败' }));
    }
    const stopUpdateEvents = window.desktopAPI?.onUpdateEvent((name, payload) => {
      if (!panel.isConnected) { stopUpdateEvents?.(); return; }
      if (name === 'available') { updateStatus.textContent = `发现新版本 ${payload.version}`; downloadUpdate.hidden = false; }
      if (name === 'none') updateStatus.textContent = `已是最新版本 ${payload.version || ''}`;
      if (name === 'progress') updateStatus.textContent = `正在下载 ${Math.round(payload.percent || 0)}%`;
      if (name === 'downloaded') { updateStatus.textContent = `版本 ${payload.version} 已下载`; downloadUpdate.hidden = true; installUpdate.hidden = false; }
      if (name === 'error') updateStatus.textContent = `更新失败：${payload.message}`;
    });
    const mcpToggle = panel.querySelector('[data-mcp-toggle]');
    const mcpBody = panel.querySelector('[data-mcp-body]');
    const mcpCommand = panel.querySelector('[data-mcp-command]');
    const copyMcpButton = panel.querySelector('[data-copy-mcp]');
    mcpToggle.onclick = async () => {
      const open = mcpToggle.getAttribute('aria-expanded') !== 'true';
      mcpToggle.setAttribute('aria-expanded', String(open));
      mcpBody.hidden = !open;
      if (open) {
        const result = await window.desktopAPI?.getMcpCommand();
        mcpCommand.textContent = result?.ok ? result.command : '命令读取失败';
      }
      requestAnimationFrame(positionPanel);
    };
    copyMcpButton.onclick = async () => {
      if (!mcpCommand.textContent || mcpCommand.textContent.includes('读取失败')) return;
      await navigator.clipboard?.writeText(mcpCommand.textContent);
      onToast('MCP 启动命令已复制');
    };
    requestAnimationFrame(positionPanel);
  }

  return { openPanel, closePanel: () => closeActivePanel?.(), getTheme: () => ({ ...theme }) };
}
