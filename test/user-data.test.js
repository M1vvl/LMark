const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrateUserData, migrateSettings, SETTINGS_VERSION } = require('../src/main/storage/user-data');

test('user data migration copies missing files without overwriting private current data', async (t) => {
  const appData = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'lmark-migration-'));
  t.after(() => fs.promises.rm(appData, { recursive: true, force: true }));
  const legacy = path.join(appData, 'codex-desktop-shell');
  const current = path.join(appData, 'LMark');
  await fs.promises.mkdir(legacy, { recursive: true });
  await fs.promises.mkdir(current, { recursive: true });
  await fs.promises.writeFile(path.join(legacy, 'settings.json'), 'legacy');
  await fs.promises.writeFile(path.join(legacy, 'history.json'), 'private history');
  await fs.promises.writeFile(path.join(current, 'settings.json'), 'current');
  const app = { getPath(name) { assert.equal(name, 'appData'); return appData; } };
  await migrateUserData(app);
  assert.equal(await fs.promises.readFile(path.join(current, 'settings.json'), 'utf8'), 'current');
  assert.equal(await fs.promises.readFile(path.join(current, 'history.json'), 'utf8'), 'private history');
});

test('settings migration removes plaintext API keys and records schema version', () => {
  const migrated = migrateSettings({ aiConfiguration: { apiKey: 'plaintext', encryptedApiKey: 'ciphertext' } });
  assert.equal(migrated.schemaVersion, SETTINGS_VERSION);
  assert.equal(migrated.aiConfiguration.apiKey, undefined);
  assert.equal(migrated.aiConfiguration.encryptedApiKey, 'ciphertext');
});
