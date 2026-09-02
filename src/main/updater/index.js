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
    autoUpdater.on('update-available', (info) => send('available', { channel, version: info.version }));
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
      if (!configured) return { ok: false, skipped: true, reason: !autoUpdater ? '更新器依赖未安装' : (app.isPackaged ? '更新源未配置' : '开发模式不检查更新') };
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
