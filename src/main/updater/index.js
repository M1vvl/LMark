// Installed builds use electron-updater. The release-publish directory build
// uses a portable ZIP fallback so updates never overwrite user data.
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null;
}
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const RELEASES_URL = 'https://api.github.com/repos/M1vvl/LMark/releases?per_page=20';
const RELEASE_ASSET_RE = /^LMark-Portable-[\w.-]+-x64\.zip$/i;
const MAX_UPDATE_BYTES = 600 * 1024 * 1024;

function versionParts(value) {
  const match = String(value || '').replace(/^v/i, '').match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2] || 0), Number(match[3] || 0)] : [0, 0, 0];
}

function compareVersions(left, right) {
  const a = versionParts(left);
  const b = versionParts(right);
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
  }
  return 0;
}

function isUnpackedBuild(app) {
  if (!app.isPackaged) return true;
  return path.basename(path.dirname(process.execPath)).toLowerCase() === 'win-unpacked';
}

function createUpdater({ app, getMainWindow, log = () => {} }) {
  let autoUpdate = false;
  let configured = false;
  let pendingRelease = null;
  let pendingDownloadPath = '';
  const send = (event, payload = {}) => {
    const mainWindow = getMainWindow();
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update:' + event, payload);
  };

  async function latestRelease() {
    const response = await fetch(RELEASES_URL, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'LMark-Updater' },
      signal: AbortSignal.timeout(8000)
    });
    if (!response.ok) throw new Error('GitHub 返回 ' + response.status);
    const releases = await response.json();
    return releases
      .filter((release) => !release.draft && !release.prerelease)
      .sort((left, right) => String(right.published_at || '').localeCompare(String(left.published_at || '')))[0] || null;
  }

  function configure(_nextChannel = 'stable', options = {}) {
    if (typeof options.autoUpdate === 'boolean') autoUpdate = options.autoUpdate;
    if (!app.isPackaged || !autoUpdater || isUnpackedBuild(app)) return false;
    if (!fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return false;
    autoUpdater.channel = 'latest';
    autoUpdater.allowPrerelease = false;
    // Checking may be automatic, but downloading always requires confirmation.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    if (configured) return true;
    autoUpdater.on('checking-for-update', () => send('checking'));
    autoUpdater.on('update-available', (info) => send('available', {
      version: info.version,
      releaseNotes: typeof info.releaseNotes === 'string' ? info.releaseNotes : ''
    }));
    autoUpdater.on('update-not-available', (info) => send('none', { version: info.version }));
    autoUpdater.on('download-progress', (progress) => send('progress', {
      percent: progress.percent,
      transferred: progress.transferred,
      total: progress.total
    }));
    autoUpdater.on('update-downloaded', (info) => send('downloaded', { version: info.version }));
    autoUpdater.on('error', (error) => {
      log('Auto update failed', error);
      send('error', { message: error.message });
    });
    configured = true;
    return true;
  }

  async function downloadPortable() {
    const release = pendingRelease || await latestRelease();
    if (!release) return { ok: false, error: '没有可用的稳定版本' };
    const asset = (release.assets || []).find((item) => RELEASE_ASSET_RE.test(item.name || ''));
    if (!asset || !asset.browser_download_url) return { ok: false, error: '该 Release 未提供可更新的便携版程序包' };
    const response = await fetch(asset.browser_download_url, {
      headers: { Accept: 'application/octet-stream', 'User-Agent': 'LMark-Updater' },
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok || !response.body) throw new Error('更新包下载失败（' + response.status + '）');
    const expected = Number(response.headers.get('content-length') || asset.size || 0);
    if (expected > MAX_UPDATE_BYTES) throw new Error('更新包超过允许大小');
    const destination = path.join(app.getPath('temp'), 'LMark-update-' + Date.now() + '.zip');
    const handle = await fs.promises.open(destination, 'w');
    let received = 0;
    try {
      for await (const chunk of response.body) {
        received += chunk.length;
        if (received > MAX_UPDATE_BYTES) throw new Error('更新包超过允许大小');
        await handle.write(Buffer.from(chunk));
        send('progress', { percent: expected ? received / expected * 100 : 0, transferred: received, total: expected });
      }
    } catch (error) {
      await handle.close().catch(() => {});
      await fs.promises.rm(destination, { force: true }).catch(() => {});
      throw error;
    }
    await handle.close();
    pendingDownloadPath = destination;
    return { ok: true, version: release.tag_name };
  }

  async function schedulePortableInstall() {
    if (!pendingDownloadPath || !fs.existsSync(pendingDownloadPath)) return { ok: false, error: '请先下载更新包' };
    const installRoot = path.dirname(process.execPath);
    const helper = path.join(app.getPath('temp'), 'LMark-apply-update-' + Date.now() + '.ps1');
    const helperSource = [
      'param([Parameter(Mandatory=$true)][string]$InstallRoot,[Parameter(Mandatory=$true)][string]$Archive,[Parameter(Mandatory=$true)][int]$ParentPid)',
      "$ErrorActionPreference = 'Stop'",
      "$stage = Join-Path $env:TEMP ('LMark-stage-' + [guid]::NewGuid().ToString('N'))",
      'try {',
      '  $deadline = (Get-Date).AddSeconds(45)',
      '  while ((Get-Process -Id $ParentPid -ErrorAction SilentlyContinue) -and (Get-Date) -lt $deadline) { Start-Sleep -Milliseconds 250 }',
      '  New-Item -ItemType Directory -Path $stage -Force | Out-Null',
      '  Expand-Archive -LiteralPath $Archive -DestinationPath $stage -Force',
      '  $source = $stage',
      "$nested = Join-Path $stage 'win-unpacked'",
      '  if (Test-Path -LiteralPath $nested -PathType Container) { $source = $nested }',
      '  Get-ChildItem -LiteralPath $source -Force | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination (Join-Path $InstallRoot $_.Name) -Recurse -Force }',
      "$exe = Join-Path $InstallRoot 'LMark.exe'",
      '  if (Test-Path -LiteralPath $exe) { Start-Process -FilePath $exe }',
      '} catch {',
      "  \$_ | Out-File -LiteralPath (Join-Path \$env:TEMP 'LMark-update-error.log') -Encoding utf8",
      '} finally {',
      '  Remove-Item -LiteralPath $stage -Recurse -Force -ErrorAction SilentlyContinue',
      '  Remove-Item -LiteralPath $Archive -Force -ErrorAction SilentlyContinue',
      '  Remove-Item -LiteralPath $PSCommandPath -Force -ErrorAction SilentlyContinue',
      '}'
    ].join('\r\n');
    await fs.promises.writeFile(helper, helperSource, 'utf8');
    spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden',
      '-ExecutionPolicy', 'Bypass', '-File', helper,
      '-InstallRoot', installRoot, '-Archive', pendingDownloadPath,
      '-ParentPid', String(process.pid)
    ], { detached: true, stdio: 'ignore' }).unref();
    pendingDownloadPath = '';
    app.quit();
    return { ok: true };
  }

  return {
    configure,
    getStatus: () => ({
      configured,
      updaterAvailable: Boolean(autoUpdater),
      autoUpdate,
      packaged: app.isPackaged,
      version: app.getVersion(),
      unpacked: isUnpackedBuild(app)
    }),
    setAutoUpdate(enabled) {
      autoUpdate = Boolean(enabled);
      if (autoUpdater) autoUpdater.autoDownload = false;
      return this.getStatus();
    },
    async check({ manual = false } = {}) {
      if (configured) {
        try {
          const result = await autoUpdater.checkForUpdates();
          const updateInfo = result?.updateInfo || null;
          const current = app.getVersion();
          const available = Boolean(updateInfo && compareVersions(updateInfo.version, current) > 0);
          if (!available) {
            send('none', { version: current, manual });
            return { ok: true, manual, available: false, updateInfo: null };
          }
          const payload = {
            version: updateInfo.version,
            releaseName: updateInfo.releaseName || '',
            releaseNotes: typeof updateInfo.releaseNotes === 'string' ? updateInfo.releaseNotes : '',
            manual
          };
          send('available', payload);
          return { ok: true, manual, available: true, updateInfo: payload };
        } catch (error) {
          log('Update check failed', error);
          return { ok: false, error: error.message };
        }
      }
      try {
        const release = await latestRelease();
        const current = app.getVersion();
        const available = Boolean(release && compareVersions(release.tag_name, current) > 0);
        if (!available) {
          send('none', { version: current, manual });
          return { ok: true, manual, available: false, updateInfo: null };
        }
        pendingRelease = release;
        const asset = (release.assets || []).find((item) => RELEASE_ASSET_RE.test(item.name || ''));
        const payload = {
          version: release.tag_name,
          releaseName: release.name || '',
          releaseNotes: release.body || '',
          manual,
          url: release.html_url || '',
          assetUrl: asset?.browser_download_url || '',
          assetName: asset?.name || ''
        };
        send('available', payload);
        return { ok: true, manual, available: true, updateInfo: payload };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    },
    async download() {
      if (configured) {
        try {
          await autoUpdater.downloadUpdate();
          return { ok: true };
        } catch (error) {
          log('Update download failed', error);
          return { ok: false, error: error.message };
        }
      }
      try {
        const result = await downloadPortable();
        if (result.ok) send('downloaded', { version: result.version, manual: true });
        return result;
      } catch (error) {
        log('Portable update download failed', error);
        return { ok: false, error: error.message };
      }
    },
    async install() {
      if (configured) {
        autoUpdater.quitAndInstall(false, true);
        return { ok: true };
      }
      try {
        return await schedulePortableInstall();
      } catch (error) {
        log('Portable update install failed', error);
        return { ok: false, error: error.message };
      }
    }
  };
}

module.exports = { createUpdater, compareVersions };
