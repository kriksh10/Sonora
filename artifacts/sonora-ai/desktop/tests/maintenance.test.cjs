const test = require('node:test');
const assert = require('node:assert/strict');
const { validateRelease, createMaintenance, diagnosticReport } = require('../maintenance.cjs');
const options = { serviceUrl: 'https://sonora.example/', version: '0.3.0', platform: 'win32', arch: 'x64' };
const manifest = () => ({ product: 'sonora', version: '0.3.1', builds: [{
  platform: 'windows', architecture: 'x64', status: 'available',
  url: 'https://sonora.example/downloads/Sonora-0.3.1.exe', sha256: 'a'.repeat(64), signing: 'Unsigned preview',
}] });

test('release metadata only offers newer, compatible, same-origin HTTPS installers with integrity/signing metadata', () => {
  assert.equal(validateRelease(manifest(), options).available, true);
  assert.equal(validateRelease(manifest(), { ...options, version: '0.3.1' }).available, false);
  assert.equal(validateRelease({ ...manifest(), version: '0.2.0' }, options).available, false);
  assert.throws(() => validateRelease(manifest(), { ...options, arch: 'arm64' }), /compatible/);
  for (const url of ['https://evil.example/a.exe', 'http://sonora.example/a.exe', 'https://sonora.example/a.exe?token=secret',
    'https://user:pass@sonora.example/a.exe', 'https://sonora.example/a.cmd']) {
    const bad = manifest(); bad.builds[0].url = url;
    assert.throws(() => validateRelease(bad, options), /validation/);
  }
  const missing = manifest(); missing.builds[0].status = 'unavailable';
  assert.throws(() => validateRelease(missing, options), /No compatible installer/);
});

test('update checks verify installer availability; downloads require user approval and never accept renderer URLs', async () => {
  const calls = [], opened = [];
  const updater = createMaintenance({ ...options, fetcher: async (url, init) => {
    calls.push({ url: String(url), init });
    return { ok: true, headers: { get: () => 'application/octet-stream' }, text: async () => JSON.stringify(manifest()) };
  } });
  await assert.rejects(updater.download(async () => true, url => opened.push(url)), /Check/);
  await updater.check();
  assert.equal(calls[1].init.method, 'HEAD');
  assert.equal(calls[1].init.redirect, 'error');
  await updater.download(async () => false, url => opened.push(url));
  assert.equal(opened.length, 0);
  await updater.download(async () => true, url => opened.push(url));
  assert.deepEqual(opened, [manifest().builds[0].url]);
  let phase = 0;
  const missing = createMaintenance({ ...options, fetcher: async () => ({ ok: ++phase === 1, text: async () => JSON.stringify(manifest()) }) });
  await assert.rejects(missing.check(), /unavailable/);
  await assert.rejects(missing.download(async () => true, () => assert.fail()), /Check/);
});

test('a 200 HTML fallback for a missing installer is rejected before it can be offered', async () => {
  const updater = createMaintenance({ ...options, fetcher: async (_url, init) =>
    init.method === 'HEAD' ? { ok: true, headers: { get: () => 'text/html; charset=utf-8' } }
      : { ok: true, text: async () => JSON.stringify(manifest()) },
  });
  await assert.rejects(updater.check(), /not served as an installer/);
  await assert.rejects(updater.download(async () => true, () => assert.fail()), /Check/);
});

test('native diagnostics are an allowlist, never arbitrary renderer or account content', () => {
  const report = diagnosticReport({ version: '0.3.0', platform: 'win32', arch: 'x64', audioProtocol: 2, captureActive: true,
    shortcutRegistered: false, token: 'PRIVATE', transcript: 'SECRET', deviceName: 'PERSONAL', path: '/private/file' });
  const encoded = JSON.stringify(report);
  for (const secret of ['PRIVATE', 'SECRET', 'PERSONAL', '/private/file']) assert.ok(!encoded.includes(secret));
  assert.equal(report.captureActive, true);
  assert.equal(report.showHideShortcutRegistered, false);
  assert.deepEqual(Object.keys(report).sort(), ['product','version','platform','architecture','nativeAudioProtocol',
    'captureActive','showHideShortcutRegistered','hostedCompatibility','excludes'].sort());
});
