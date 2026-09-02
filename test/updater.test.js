const test = require('node:test');
const assert = require('node:assert/strict');
const { compareVersions } = require('../src/main/updater');

test('update version comparison ignores v prefix and missing patch parts', () => {
  assert.equal(compareVersions('v0.2.0', '0.1.9'), 1);
  assert.equal(compareVersions('0.2', '0.2.0'), 0);
  assert.equal(compareVersions('0.1.0', 'v0.2.0'), -1);
});
