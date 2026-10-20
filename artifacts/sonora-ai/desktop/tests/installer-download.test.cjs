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
function load(relative, requireModule) {
  const scope = { module: { exports: {} }, require: requireModule, process: { env: { SONORA_OWNER_EMAIL: 'owner@example.test' } } };
  vm.runInNewContext(transformSync(fs.readFileSync(path.join(root, relative), 'utf8'), {
    loader: 'ts', format: 'cjs',
  }).code, scope);
  return scope.module.exports;
}

test('installer endpoints enforce the real approval guard, private headers and exact bytes', async t => {
  const rows = new Map([
    ['approved', { userId: 'approved', status: 'approved', role: 'user' }],
    ['owner', { userId: 'owner', status: 'approved', role: 'owner' }],
    ['approver', { userId: 'approver', status: 'approved', role: 'approver' }],
    ['pending', { userId: 'pending', status: 'pending', role: 'user' }],
    ['denied', { userId: 'denied', status: 'denied', role: 'user' }],
    ['revoked', { userId: 'revoked', status: 'revoked', role: 'user' }],
  ]);
  // Run the actual approval middleware against seeded access states, not a fake allow-all.
  const access = load('src/lib/app-access.ts', name => {
    if (name === '@clerk/express') return { getAuth: req => ({ userId: req.get('x-test-user') || null }) };
    if (name === 'drizzle-orm') return { eq: (field, value) => ({ field, value }), and: (...args) => args };
    if (name === '@workspace/db') return {
      appAccessTable: { userId: 'userId' },
      db: { select: () => ({ from: () => ({ where: query => ({
        limit: async () => rows.has(query.value) ? [rows.get(query.value)] : [],
      }) }) }) },
    };
    throw new Error(`Unexpected access dependency: ${name}`);
  });
  const bytes = Buffer.from('MZ: controlled installer transport fixture; not a Windows execution test');
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const release = { version: '0.3.5', filename: 'Sonora-0.3.5-win-x64.exe', sha256,
    sizeBytes: bytes.length, signing: 'Unsigned', minimumOs: 'Windows 11' };
  const subject = load('src/routes/desktop-releases.ts', name =>
    name === '../lib/windows-release.json' ? release : apiRequire(name));
  let calls = 0, broken = false;
  const express = apiRequire('express');
  const app = express();
  app.use('/api/desktop', subject.createDesktopReleasesRouter(access.requireApprovedAccess, () => {
    calls++;
    if (broken) throw new Error('storage failure');
    return {
      getMetadata: async () => [{ size: String(bytes.length), metadata: { sha256 } }],
      createReadStream: () => Readable.from([bytes]),
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
        const before = calls;
        const res = await request(endpoint, user, method);
        assert.equal(res.status, user ? 403 : 401, `${user} ${method} ${endpoint}`);
        assert.equal(calls, before, 'denied requests must never touch installer storage');
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
  rows.get('approved').status = 'revoked';
  assert.equal((await request('/installers/windows-x64', 'approved')).status, 403);
  assert.equal((await request('/installers/windows-x64', null)).status, 401, 'signed-out download');
  broken = true;
  const failed = await request('/releases', 'owner');
  assert.equal(failed.status, 503);
  assert.match((await failed.json()).error, /temporarily unavailable/);
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
