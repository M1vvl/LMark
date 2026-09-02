// electron-updater is optional for unpacked/dev builds. A missing optional
// dependency must never prevent the main process from starting.
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null;
}
const fs = require('node:fs');
const path = require('node:path');

function createUpdater({ app, getMainWindow, log = () => {} }) {
  let channel = 'stable';
  let autoUpdate = false;
  let configured = false;
  const send = (event, payload = {}) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(`update:${event}`, payload);
  };
  async function latestRelease() {
    const response = await fetch('https://api.github.com/repos/M1vvl/LMark/releases?per_page=20', { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LMark-Updater' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error(`GitHub 返回 ${response.status}`);
    const releases = await response.json();
    return releases.find((release) => !release.draft && (channel === 'beta' || !release.prerelease)) || null;
  }
  function configure(nextChannel = 'stable', options = {}) {
    channel = nextChannel === 'beta' ? 'beta' : 'stable';
    if (typeof options.autoUpdate === 'boolean') autoUpdate = options.autoUpdate;
    if (!app.isPackaged || !autoUpdater) return false;
    if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return false;
    autoUpdater.channel = channel === 'beta' ? 'beta' : 'latest';
    autoUpdater.allowPrerelease = channel === 'beta';
    autoUpdater.autoDownload = autoUpdate;
    autoUpdater.autoInstallOnAppQuit = true;
    if (configured) return true;
    autoUpdater.on('checking-for-update', () => send('checking', { channel }));
    autoUpdater.on('update-available', (info) => send('available', { channel, version: info.version, releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : '' }));
    autoUpdater.on('update-not-available', (info) => send('none', { channel, version: info.version }));
    autoUpdater.on('download-progress', (progress) => send('progress', { percent: progress.percent, transferred: progress.transferred, total: progress.total }));
    autoUpdater.on('update-downloaded', (info) => send('downloaded', { version: info.version }));
    autoUpdater.on('error', (error) => { log('Auto update failed', error); send('error', { message: error.message }); });
    configured = true;
    return true;
  }
  return {
    configure,
    getStatus: () => ({ configured, updaterAvailable: Boolean(autoUpdater), channel, autoUpdate, packaged: app.isPackaged, version: app.getVersion() }),
    setAutoUpdate(enabled) {
      autoUpdate = Boolean(enabled);
      if (autoUpdater) autoUpdater.autoDownload = autoUpdate;
      return this.getStatus();
    },
    async check() {
      if (!configured) {
        try {
          const release = await latestRelease();
          if (!release) return { ok: true, manual: true, updateInfo: null };
          const current = app.getVersion();
          const available = release.tag_name.replace(/^v/, '') !== current;
          if (available) send('available', { channel, version: release.tag_name, manual: true, url: release.html_url });
          else send('none', { channel, version: current });
          return { ok: true, manual: true, available, updateInfo: available ? { version: release.tag_name, releaseName: release.name, url: release.html_url } : null };
        } catch (error) { return { ok: false, error: error.message }; }
      }
      try { const result = await autoUpdater.checkForUpdates(); return { ok: true, updateInfo: result?.updateInfo || null }; }
      catch (error) { log('Update check failed', error); return { ok: false, error: error.message }; }
    },
    async download() {
      if (!configured) return { ok: false, error: '更新器未配置' };
      try { await autoUpdater.downloadUpdate(); return { ok: true }; } catch (error) { log('Update download failed', error); return { ok: false, error: error.message }; }
    },
    install() {
      if (!configured) return { ok: false, error: '更新器未配置' };
      autoUpdater.quitAndInstall(false, true);
      return { ok: true };
    }
  };
}

module.exports = { createUpdater };
