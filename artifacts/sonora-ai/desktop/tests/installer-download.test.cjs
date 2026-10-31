const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { createHash } = require('node:crypto');
const { Readable } = require('node:stream');
const { transformSync } = require('esbuild');

const root = path.resolve(__dirname, '../../../api-server');
const apiRequire = createRequire(path.join(root, 'package.json'));
function load(relative, requireModule, env = { SONORA_OWNER_EMAIL: 'owner@example.test' }) {
  const scope = { module: { exports: {} }, require: requireModule, process: { env },
    console, AbortSignal, URL };
  vm.runInNewContext(transformSync(fs.readFileSync(path.join(root, relative), 'utf8'), {
    loader: 'ts', format: 'cjs',
  }).code, scope);
  return scope.module.exports;
}

test('installer metadata is public and the download redirects to the GitHub release asset', async t => {
  const sha256 = 'ab'.repeat(32);
  const tag = 'v0.3.6';
  const filename = 'Sonora-0.3.6-win-x64.exe';
  const downloadUrl = `https://github.com/kriksh10/Sonora/releases/download/${tag}/${filename}`;
  const release = {
    tag_name: tag, published_at: '2026-10-31T00:00:00Z',
    assets: [
      { name: filename, size: 4096, browser_download_url: downloadUrl },
      { name: 'Sonora-0.3.6-win-x64.exe.blockmap', size: 80, browser_download_url: `${downloadUrl}.blockmap` },
      { name: 'sonora-desktop-release.json', size: 120, browser_download_url: `https://github.com/kriksh10/Sonora/releases/download/${tag}/sonora-desktop-release.json` },
    ],
  };
  const metadata = { product: 'sonora', version: '0.3.6', filename, sha256, sizeBytes: 4096, signing: 'Azure Trusted Signing' };
  let fetches = 0;
  const subject = load('src/routes/desktop-releases.ts', name => apiRequire(name));
  const evil = subject.snapshotFromRelease({
    tag_name: 'v0.3.6', published_at: '2026-10-31T00:00:00Z',
    assets: [{ name: filename, size: 10, browser_download_url: 'https://evil.example/app.exe' }],
  }, { product: 'sonora', version: '0.3.6', filename, sha256, signing: 'Not signed' });
  assert.equal(evil.downloadUrl, downloadUrl);
  assert.equal(evil.status, 'preview');
  const express = apiRequire('express');
  const app = express();
  app.use('/api', subject.createDesktopReleasesRouter({
    now: () => 1_000,
    ttlMs: 60_000,
    fetchImpl: async url => {
      fetches += 1;
      const href = String(url);
      if (href.includes('evil.example')) throw new Error('must not follow an untrusted asset url');
      if (href.endsWith('sonora-desktop-release.json')) return { ok: true, status: 200, json: async () => metadata };
      if (href.includes('api.github.com')) return { ok: true, status: 200, json: async () => release };
      return { ok: false, status: 404, json: async () => ({}) };
    },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const meta = await fetch(base + '/desktop/releases');
  assert.equal(meta.status, 200);
  const data = await meta.json();
  assert.equal(data.version, '0.3.6');
  assert.equal(data.builds[0].url, '/api/desktop/installers/windows-x64');
  assert.equal(data.builds[0].sha256, sha256);
  assert.equal(data.builds[0].sizeBytes, 4096);
  assert.equal(data.builds[0].status, 'verified');
  assert.equal(data.builds[0].signing, 'Azure Trusted Signing');
  assert.equal(data.builds[1].url, null);
  assert.doesNotMatch(JSON.stringify(data), /storage.googleapis|privateObject|bucketName|SONORA_GITHUB_TOKEN/);
  const firstFetches = fetches;
  const again = await fetch(base + '/desktop/releases');
  assert.equal(again.status, 200);
  assert.equal(fetches, firstFetches, 'metadata is cached');
  const download = await fetch(base + '/desktop/installers/windows-x64', { redirect: 'manual' });
  assert.equal(download.status, 302);
  assert.equal(download.headers.get('location'), downloadUrl);
  const body = Buffer.from(await download.arrayBuffer());
  assert.ok(body.length < 500, 'redirect must not stream the installer');
  assert.doesNotMatch(body.toString(), /MZ/);
  const head = await fetch(base + '/desktop/installers/windows-x64', { method: 'HEAD', redirect: 'manual' });
  assert.equal(head.status, 302);
  assert.equal(head.headers.get('location'), downloadUrl);
});

function transferClient() {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/lib/installer-transfer.ts'), 'utf8');
  const scope = { module: { exports: {} }, fetch, AbortController, setTimeout, clearTimeout,
    Blob, Uint8Array, crypto: require('node:crypto').webcrypto };
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, scope);
  return scope.module.exports.fetchInstaller;
}

test('download client retries partial transfers, reports progress and verifies the complete checksum', async () => {
  const bytes = Buffer.alloc(4 * 1024 * 1024 + 27, 77);
  const release = { sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const progress = [];
  const requests = [];
  let broken = true;
  const blob = await transferClient()('/api/desktop/installers/windows-x64', release, {
    signal: new AbortController().signal,
    onProgress: (n) => progress.push(n),
    fetcher: async (_url, init) => {
      assert.equal(init.credentials, 'include');
      requests.push(init.headers.Range);
      const [, from, to] = /^bytes=(\d+)-(\d+)$/.exec(init.headers.Range);
      const start = Number(from), end = Number(to);
      const body = broken ? bytes.subarray(start, start + 5) : bytes.subarray(start, end + 1);
      broken = false;
      return new Response(body, { status: 206,
        headers: { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } });
    },
  });
  assert.equal(requests.length, 3);
  assert.equal(requests[0], requests[1], 'retry only the interrupted part');
  assert.deepEqual(progress, [0, 4 * 1024 * 1024, bytes.length]);
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), bytes);
});

test('download client rejects auth errors, stale servers, corrupt bytes and cancellation', async () => {
  const bytes = Buffer.from('test');
  const release = { sizeBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const fetchInstaller = transferClient();
  const run = fetcher => fetchInstaller('/installer', release, {
    signal: new AbortController().signal, onProgress: () => {}, fetcher,
  });
  for (const status of [401, 403]) {
    let calls = 0;
    await assert.rejects(run(async () => { calls++; return new Response('', { status }); }), /denied access/);
    assert.equal(calls, 1, 'never retry access denial');
  }
  await assert.rejects(run(async () => new Response(bytes)), /Publish the latest update/);
  await assert.rejects(run(async () => new Response(Buffer.from('nope'), {
    status: 206, headers: { 'Content-Range': 'bytes 0-3/4' },
  })), /verification failed/);
  let attempts = 0;
  await assert.rejects(run(async () => { attempts++; throw new Error('network'); }), /after retries/);
  assert.equal(attempts, 3);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(fetchInstaller('/installer', release, {
    signal: controller.signal, onProgress: () => {}, fetcher: () => assert.fail('must not fetch'),
  }), { name: 'AbortError' });
});

test('a GitHub lookup failure does not redirect and does not invent a download', async t => {
  const subject = load('src/routes/desktop-releases.ts', name => apiRequire(name));
  const app = apiRequire('express')();
  app.use('/api', subject.createDesktopReleasesRouter({
    fetchImpl: async () => { throw new Error('network down'); },
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const meta = await fetch(base + '/desktop/releases');
  const data = await meta.json();
  assert.equal(data.builds[0].status, 'unavailable');
  assert.equal(data.builds[0].url, null);
  const download = await fetch(base + '/desktop/installers/windows-x64', { redirect: 'manual' });
  assert.equal(download.status, 404);
  assert.equal(download.headers.get('location'), null);
});

test('client download helper rejects public, arbitrary and cross-origin URLs', () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../src/lib/installer-download.ts'), 'utf8');
  const context = { module: { exports: {} } };
  vm.runInNewContext(transformSync(source, { loader: 'ts', format: 'cjs' }).code, context);
  const { installerDownloadPath } = context.module.exports;
  assert.equal(installerDownloadPath('/api/desktop/installers/windows-x64', '/sonora/'),
    '/sonora/api/desktop/installers/windows-x64');
  for (const bad of [null, 'https://example.test/app.exe', '//example.test', '/public/app.exe', 'javascript:alert(1)']) {
    assert.equal(installerDownloadPath(bad, '/'), null);
  }
});
