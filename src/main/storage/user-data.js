const fs = require('node:fs');
const path = require('node:path');

const SETTINGS_VERSION = 2;

function paths(app) {
  const appData = app.getPath('appData');
  return {
    current: path.join(appData, 'LMark'),
    legacy: path.join(appData, 'codex-desktop-shell')
  };
}

async function copyMissing(source, target) {
  await fs.promises.mkdir(target, { recursive: true });
  for (const entry of await fs.promises.readdir(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name);
    const to = path.join(target, entry.name);
    try { await fs.promises.access(to); continue; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (entry.isDirectory()) await copyMissing(from, to);
    else if (entry.isFile()) await fs.promises.copyFile(from, to);
  }
}

async function migrateUserData(app, log = () => {}) {
  const { current, legacy } = paths(app);
  await fs.promises.mkdir(current, { recursive: true });
  const marker = path.join(current, '.migration-v2');
  try { await fs.promises.access(marker); return { current, migrated: false }; } catch (error) { if (error.code !== 'ENOENT') throw error; }
  try {
    const legacyStat = await fs.promises.stat(legacy);
    if (legacyStat.isDirectory() && path.resolve(legacy).toLowerCase() !== path.resolve(current).toLowerCase()) {
      await copyMissing(legacy, current);
      log('Migrated private user data to %APPDATA%\\LMark without overwriting existing files');
    }
  } catch (error) {
    if (error.code !== 'ENOENT') log('User data migration skipped', error);
  }
  const settingsPath = path.join(current, 'settings.json');
  try {
    const originalSettings = JSON.parse(await fs.promises.readFile(settingsPath, 'utf8'));
    const backups = path.join(current, 'backups');
    await fs.promises.mkdir(backups, { recursive: true });
    const sanitized = migrateSettings(originalSettings);
    await fs.promises.writeFile(path.join(backups, 'settings-before-v2.json'), JSON.stringify(sanitized, null, 2), { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (!['ENOENT', 'EEXIST'].includes(error.code)) log('Sanitized settings backup could not be created', error);
  }
  await fs.promises.writeFile(marker, JSON.stringify({ version: SETTINGS_VERSION, migratedAt: new Date().toISOString() }), 'utf8');
  return { current, migrated: true };
}

function migrateSettings(settings = {}) {
  const version = Number(settings.schemaVersion || 1);
  const next = { ...settings, schemaVersion: SETTINGS_VERSION };
  if (version < 2 && next.aiConfiguration?.apiKey) {
    delete next.aiConfiguration.apiKey;
  }
  return next;
}

module.exports = { SETTINGS_VERSION, paths, migrateUserData, migrateSettings };
