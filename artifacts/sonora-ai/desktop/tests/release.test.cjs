const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const release = require('../../public/desktop-release.json');
test('release manifest never advertises absent installers', () => {
  assert.equal(release.product, 'sonora');
  assert.equal(release.builds.length, 3);
  for (const build of release.builds) {
    if (build.status === 'unavailable') { assert.equal(build.url, null); continue; }
    assert.equal(new URL(build.url).protocol, 'https:');
    assert.match(build.sha256, /^[a-f0-9]{64}$/);
    assert.ok(['preview', 'verified'].includes(build.status));
  }
});
test('packaged default is intentionally unconfigured, never points at localhost', () => {
  assert.equal(require('../runtime-config.json').serviceUrl, null);
  const config = fs.readFileSync(path.join(__dirname, '../electron-builder.cjs'), 'utf8');
  assert.match(config, /publish: null/);
  assert.match(config, /NSAudioCaptureUsageDescription/);
});
