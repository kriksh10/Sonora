const test = require('node:test');
const assert = require('node:assert/strict');
const { prerequisiteProblems } = require('../build-windows.cjs');
const { checkHostedService } = require('../prepare-release.cjs');
const { prepareInstall } = require('../../../../scripts/preinstall.cjs');

const ready = { platform: 'win32', arch: 'x64', machine: 'x86_64', nodeVersion: '22.20.0',
  pnpmVersion: '10.26.1', rustVersion: 'rustc 1.91.0\nhost: x86_64-pc-windows-msvc',
  hasGit: true, hasCpp: true, hasSdk: true };

test('Windows prerequisite gate accepts supported tools and reports missing requirements together', () => {
  assert.deepEqual(prerequisiteProblems(ready), []);
  assert.equal(prerequisiteProblems({ ...ready, pnpmVersion: '', rustVersion: '', hasGit: false, hasCpp: false, hasSdk: false }).length, 5);
  assert.match(prerequisiteProblems({ ...ready, platform: 'linux' })[0], /Windows x64/);
  assert.match(prerequisiteProblems({ ...ready, machine: 'ARM64' })[0], /Windows ARM/);
  assert.match(prerequisiteProblems({ ...ready, rustVersion: 'rustc 1.90.0\nhost: x86_64-pc-windows-msvc' })[0], /Rust/);
});

test('portable preinstall enforces pnpm without a Unix shell', () => {
  const removed = [];
  prepareInstall('/unused', 'pnpm/10.26.1', file => removed.push(file));
  assert.equal(removed.length, 2);
  assert.ok(removed.some(file => file.endsWith('package-lock.json')));
  assert.throws(() => prepareInstall('/unused', 'npm/11', () => assert.fail('Must reject before deleting')), /pnpm/);
});

test('Windows preflight refuses preview, unhealthy, and unrelated hosted services', async () => {
  await assert.rejects(checkHostedService('https://preview.replit.dev', () => assert.fail('No preview requests')), /published HTTPS/);
  await assert.rejects(checkHostedService('https://service.example/', async () => ({ ok: false })), /health\/release/);
  const responses = values => async () => ({ ok: true, json: async () => values.shift() });
  await assert.rejects(checkHostedService('https://service.example/', responses([{ status: 'ok' }, { product: 'other' }])), /healthy Sonora/);
  await assert.rejects(checkHostedService('https://service.example/', responses([{ status: 'ok' }, { product: 'sonora' }])), /Publish the latest/);
  await assert.rejects(checkHostedService('https://service.example/', responses([{ status: 'ok', desktopAuthProtocol: 1 }, { product: 'sonora' }])), /separate-channel/);
  await assert.rejects(checkHostedService('https://service.example/', responses([{ status: 'ok', desktopAuthProtocol: 1, desktopAudioProtocol: 2 }, { product: 'sonora' }])), /streaming answer/);
  assert.equal(await checkHostedService('https://service.example/', responses([{ status: 'ok', desktopAuthProtocol: 1, desktopAudioProtocol: 2, desktopAnswerProtocol: 1 }, { product: 'sonora' }])), 'https://service.example/');
});
