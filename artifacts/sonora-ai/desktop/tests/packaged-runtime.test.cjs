const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const config = require('../electron-builder.cjs');
const { runtimeFiles } = require('../runtime-files.cjs');
const { verifyRuntimeFiles, verifyStagedRuntime, verifyArchive } = require('../verify-runtime.cjs');

function stage() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sonora-runtime-'));
  const app = path.join(root, 'app');
  fs.mkdirSync(app);
  for (const file of runtimeFiles) fs.copyFileSync(path.resolve(__dirname, '..', file), path.join(app, file));
  fs.writeFileSync(path.join(app, 'package.json'), '{"name":"sonora-desktop","main":"main.cjs","version":"0.3.4"}');
  fs.writeFileSync(path.join(app, 'runtime-config.json'), '{"serviceUrl":"https://service.example/"}');
  return { root, app };
}

test('installer allowlist uses every staged runtime module, including audio-devices', () => {
  for (const name of runtimeFiles) assert.ok(config.files.includes(name), `Archive omitted ${name}`);
  assert.ok(config.files.includes('audio-devices.cjs'));
  assert.equal(typeof config.afterPack, 'function');
});

test('actual ASAR retains the selected runtime and the helper required at startup', async () => {
  const f = stage();
  try {
    verifyStagedRuntime(f.app);
    // Mirror builder's exact root-file allowlist, not an archive of all source files.
    const selected = path.join(f.root, 'selected');
    fs.mkdirSync(selected);
    for (const file of fs.readdirSync(f.app).filter(name => config.files.includes(name))) {
      fs.copyFileSync(path.join(f.app, file), path.join(selected, file));
    }
    const archive = path.join(f.root, 'app.asar');
    await asar.createPackage(selected, archive);
    verifyArchive(archive);
    assert.match(asar.extractFile(archive, 'audio-devices.cjs').toString(), /listAudioDevices/);
    const resources = path.join(f.root, 'resources');
    fs.mkdirSync(resources);
    fs.copyFileSync(archive, path.join(resources, 'app.asar'));
    await config.afterPack({ electronPlatformName: 'win32', appOutDir: f.root });
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('missing audio-devices fails both staging and the actual archive audit', async () => {
  const f = stage();
  try {
    fs.unlinkSync(path.join(f.app, 'audio-devices.cjs'));
    assert.throws(() => verifyStagedRuntime(f.app), /missing audio-devices.cjs/);
    const archive = path.join(f.root, 'broken.asar');
    await asar.createPackage(f.app, archive);
    assert.throws(() => verifyArchive(archive), /missing audio-devices.cjs/);
  } finally { fs.rmSync(f.root, { recursive: true, force: true }); }
});

test('new nested relative imports cannot be added without packaging their dependencies', () => {
  const files = [...runtimeFiles, 'package.json', 'runtime-config.json'];
  assert.throws(() => verifyRuntimeFiles(files, name => name === 'main.cjs'
    ? "require('./new-helper.cjs')" : ''), /main.cjs requires missing .\/new-helper.cjs/);
});
