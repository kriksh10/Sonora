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
  const scope = { module: { exports: {} }, require: requireModule, process: { env } };
  vm.runInNewContext(transformSync(fs.readFileSync(path.join(root, relative), 'utf8'), {
    loader: 'ts', format: 'cjs',
  }).code, scope);
  return scope.module.exports;
}

test('installer endpoints allow anonymous downloads and preserve exact bytes and range verification', async t => {
  const bytes = Buffer.from('MZ: controlled installer transport fixture; not a Windows execution test');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const release = { version: '0.3.5', filename: 'Sonora-0.3.5-win-x64.exe', sha256,
    sizeBytes: bytes.length, signing: 'Unsigned', minimumOs: 'Windows 11' };
  const subject = load('src/routes/desktop-releases.ts', name =>
    name === '../lib/windows-release.json' ? release : apiRequire(name));
  let calls = 0, broken = false;
  const express = apiRequire('express');
  const app = express();
  app.use('/api/desktop', subject.createDesktopReleasesRouter(() => {
    calls++;
    if (broken) throw new Error('storage failure');
    return {
      getMetadata: async () => [{ size: String(bytes.length), metadata: { sha256 } }],
      createReadStream: (options = {}) => Readable.from([
        bytes.subarray(options.start ?? 0, options.end === undefined ? undefined : options.end + 1),
      ]),
    };
  }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/desktop`;
  const request = (endpoint, user, method = 'GET') => fetch(base + endpoint, {
    method, headers: user ? { 'x-test-user': user } : {},
  });
  for (const endpoint of ['/releases', '/installers/windows-x64']) {
    for (const method of ['GET', 'HEAD']) {
      for (const user of [null, 'pending', 'denied', 'revoked']) {
        const res = await request(endpoint, user, method);
        assert.equal(res.status, 200, `${user} ${method} ${endpoint}`);
        assert.match(res.headers.get('cache-control'), /private, no-store/);
        await res.arrayBuffer();
      }
    }
  }
  for (const user of ['approved', 'owner', 'approver']) {
    const meta = await request('/releases', user);
    assert.equal(meta.status, 200);
    const data = await meta.json();
    assert.equal(data.builds[0].url, '/api/desktop/installers/windows-x64');
    assert.equal(data.builds[0].sha256, sha256);
    assert.equal(data.builds[0].status, 'preview');
    assert.equal(data.builds[1].url, null);
    assert.doesNotMatch(JSON.stringify(data), /storage.googleapis|privateObject|bucketName/);
    const head = await request('/installers/windows-x64', user, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.headers.get('content-length'), String(bytes.length));
    const res = await request('/installers/windows-x64', user);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment; filename="Sonora-0.3.5-win-x64.exe"/);
    assert.match(res.headers.get('cache-control'), /private, no-store/);
    assert.match(res.headers.get('vary'), /Authorization/);
    const downloaded = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(downloaded, bytes);
    assert.equal(createHash('sha256').update(downloaded).digest('hex'), sha256);
  }
  for (const [range, expectedStart, expectedEnd] of [
    ['bytes=0-9', 0, 9], ['bytes=10-', 10, bytes.length - 1],
    ['bytes=-8', bytes.length - 8, bytes.length - 1],
    ['bytes=0-999999', 0, bytes.length - 1],
  ]) {
    const res = await fetch(base + '/installers/windows-x64', {
      headers: { 'x-test-user': 'approved', Range: range },
    });
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), `bytes ${expectedStart}-${expectedEnd}/${bytes.length}`);
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), bytes.subarray(expectedStart, expectedEnd + 1));
  }
  for (const range of ['bytes=999999-', 'bytes=8-2', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', 'invalid']) {
    const res = await fetch(base + '/installers/windows-x64', {
      headers: { 'x-test-user': 'approved', Range: range },
    });
    assert.equal(res.status, 416, range);
    assert.equal(res.headers.get('content-range'), `bytes */${bytes.length}`);
    await res.arrayBuffer();
  }
  assert.equal((await request('/installers/windows-x64', 'revoked')).status, 200);
  assert.equal((await fetch(base + '/installers/windows-x64', {
    headers: { 'x-test-user': 'approved', Range: 'bytes=0-9' },
  })).status, 206, 'public ranges do not require approval');
  assert.equal((await request('/installers/windows-x64', null)).status, 200, 'signed-out download');
  broken = true;
  const failed = await request('/releases', 'owner');
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /temporarily unavailable/);
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

test('actual private installer traverses HTTP byte ranges and the browser checksum assembler', {
  skip: process.env.SONORA_TEST_PRIVATE_INSTALLER !== '1',
}, async t => {
  const release = apiRequire('./src/lib/windows-release.json');
  const storage = load('src/lib/desktop-storage.ts', name =>
    name === './windows-release.json' ? release : apiRequire(name), process.env);
  const subject = load('src/routes/desktop-releases.ts', name =>
    name === '../lib/windows-release.json' ? release : apiRequire(name));
  const app = apiRequire('express')();
  app.use('/api/desktop', subject.createDesktopReleasesRouter(storage.windowsInstallerFile));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const url = `http://127.0.0.1:${server.address().port}/api/desktop/installers/windows-x64`;
  let count = 0, received = 0;
  const blob = await transferClient()(url, release, {
    signal: new AbortController().signal,
    onProgress: n => { received = n; },
    fetcher: (url, init) => {
      count++;
      return fetch(url, init);
    },
  });
  assert.equal(received, release.sizeBytes);
  assert.equal(blob.size, release.sizeBytes);
  assert.equal(count, Math.ceil(release.sizeBytes / (4 * 1024 * 1024)));
  assert.equal(createHash('sha256').update(Buffer.from(await blob.arrayBuffer())).digest('hex'), release.sha256);
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
