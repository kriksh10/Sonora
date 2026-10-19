const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { transformSync } = require('esbuild');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../../api-server/src');
function load(file, requireModule) {
  const scope = { module: { exports: {} }, require: requireModule, Buffer, Date, Map, URL };
  vm.runInNewContext(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, scope);
  return scope.module.exports;
}
const security = load(path.join(root, 'lib/desktop-auth-security.ts'), require);
const validatorFile = path.resolve(__dirname, '../../../../lib/api-zod/src/generated/api.ts');
const validators = load(validatorFile, createRequire(validatorFile));
const verifier = 'a'.repeat(64);
const wrong = 'b'.repeat(64);
const id = '550e8400-e29b-41d4-a716-446655440000';
const base = '/desktop-auth/requests';
const clone = value => structuredClone(value);
function fixture(issue = async () => ({ id: 'test-token-id', token: 'test-ticket' })) {
  const rows = [], handlers = new Map(), issued = [], revoked = [];
  const table = Object.fromEntries(['id', 'challenge', 'codeHash', 'status', 'userId', 'attempts', 'expiresAt'].map(k => [k, k]));
  const matches = (row, cond) => !cond ? true : cond.and ? cond.and.every(c => matches(row, c)) :
    cond.sql ? ['pending', 'approved', 'exchanging'].includes(row.status) :
    cond.op === 'eq' ? row[cond.key] === cond.value :
    cond.op === 'gt' ? row[cond.key] > cond.value : row[cond.key] < cond.value;
  const db = {
    select: () => ({ from: () => ({ where: cond => ({ limit: async n => rows.filter(r => matches(r, cond)).slice(0, n).map(clone) }) }) }),
    delete: () => ({ where: async cond => { for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], cond)) rows.splice(i, 1); } }),
    insert: () => ({ values: value => ({ returning: async () => {
      const row = { id, status: 'pending', attempts: 0, userId: null, ...value }; rows.push(row); return [clone(row)];
    } }) }),
    update: () => ({ set: value => ({ where: cond => {
      const apply = () => {
        const found = rows.filter(r => matches(r, cond));
        for (const row of found) for (const [k, v] of Object.entries(value)) row[k] = v?.sql ? row[k] + 1 : v;
        return found.map(clone);
      };
      return { returning: async () => apply(), then: (resolve, reject) => Promise.resolve().then(apply).then(resolve, reject) };
    } }) }),
  };
  const router = { use() {}, param() {} };
  for (const method of ['get', 'post']) router[method] = (route, handler) => handlers.set(`${method} ${route}`, handler);
  load(path.join(root, 'routes/desktop-auth.ts'), name => {
    if (name === 'express') return { Router: () => router };
    if (name === 'node:crypto') return crypto;
    if (name === '@workspace/db') return { db, desktopAuthRequestsTable: table };
    if (name === '@workspace/api-zod') return validators;
    if (name === '../middlewares/clerkProxyMiddleware') return { getClerkProxyHost: () => 'sonora.example' };
    if (name === '../lib/desktop-auth-security') return security;
    if (name === '../lib/logger') return { logger: { error() {} } };
    if (name === 'drizzle-orm') return { and: (...and) => ({ and }),
      eq: (key, value) => ({ key, value, op: 'eq' }), gt: (key, value) => ({ key, value, op: 'gt' }),
      lt: (key, value) => ({ key, value, op: 'lt' }), sql: (...values) => ({ sql: true, values }) };
    if (name === '@clerk/express') return { getAuth: req => ({ userId: req.userId }),
      clerkClient: { signInTokens: {
        createSignInToken: async args => { issued.push(args); return issue(); },
        revokeSignInToken: async tokenId => { revoked.push(tokenId); },
      } } };
    throw new Error(`Unexpected import ${name}`);
  });
  async function call(suffix, body, userId, origin = 'https://sonora.example') {
    const method = body === undefined ? 'get' : 'post';
    const response = { code: 200, status(n) { this.code = n; return this; }, json(body) { this.body = clone(body); return this; } };
    await handlers.get(`${method} ${base}${suffix}`)({
      body, userId, params: { id }, ip: '127.0.0.1',
      get: key => ({ origin, 'sec-fetch-site': origin === 'https://sonora.example' ? 'same-origin' : 'cross-site' })[key],
    }, response);
    return response;
  }
  return { rows, issued, revoked, call,
    start: () => call('', { challenge: security.proofHash(verifier) }),
    approve: code => call('/:id/approve', { code }, 'test-user') };
}
test('proof and same-origin checks fail closed; rate limit expires', () => {
  assert.ok(security.matchesProof(verifier, security.proofHash(verifier)));
  assert.ok(!security.matchesProof(wrong, security.proofHash(verifier)));
  assert.ok(!security.matchesProof(verifier, 'malformed'));
  assert.ok(security.sameOriginApproval('https://sonora.example', 'sonora.example', 'same-origin'));
  assert.ok(!security.sameOriginApproval('https://evil.example', 'sonora.example', 'cross-site'));
  assert.ok(!security.sameOriginApproval(undefined, 'sonora.example', undefined));
  const permit = security.createDesktopAuthLimiter();
  assert.ok(permit('test', 1, 0)); assert.ok(!permit('test', 1, 1)); assert.ok(permit('test', 1, 300001));
});
test('real route protocol binds authenticated approval to one native proof and one ticket', async () => {
  const f = fixture(), started = await f.start();
  assert.equal(started.code, 201);
  const browser = await f.call('/:id');
  assert.deepEqual(Object.keys(browser.body).sort(), ['expiresAt', 'status']);
  assert.equal((await f.call('/:id/poll', { verifier })).body.status, 'pending');
  assert.equal((await f.call('/:id/approve', { code: started.body.code })).code, 401);
  assert.equal((await f.call('/:id/approve', { code: started.body.code }, 'attacker', 'https://evil.example')).code, 403);
  assert.equal((await f.call('/:id/approve', { code: started.body.code, userId: 'injected' }, 'test-user')).code, 400);
  assert.equal((await f.approve(started.body.code)).body.status, 'approved');
  assert.equal((await f.call('/:id/poll', { verifier: wrong })).code, 410);
  const done = await f.call('/:id/poll', { verifier });
  assert.equal(done.body.ticket, 'test-ticket');
  assert.deepEqual(clone(f.issued), [{ userId: 'test-user', expiresInSeconds: 60 }]);
  assert.equal(f.rows[0].userId, null);
  assert.equal((await f.call('/:id/poll', { verifier })).code, 410);
  assert.equal(f.issued.length, 1);
});
test('wrong codes lock after five attempts, and expiry/cancel prevent approval', async () => {
  const f = fixture(), started = await f.start();
  for (let n = 0; n < 5; n++) assert.equal((await f.approve('000000')).code, 400);
  assert.equal((await f.approve(started.body.code)).code, 429);
  await f.call('/:id/cancel', { verifier });
  assert.equal((await f.approve(started.body.code)).code, 409);
  f.rows[0].expiresAt = new Date(0);
  assert.equal((await f.call('/:id')).code, 410);
  assert.equal((await f.call('/:id/poll', { verifier })).code, 410);
});
test('provider failure leaves approval retryable without exposing an exception or credential', async () => {
  const f = fixture(async () => { throw new Error('private provider error'); });
  const started = await f.start(); await f.approve(started.body.code);
  const failed = await f.call('/:id/poll', { verifier });
  assert.equal(failed.code, 503);
  assert.ok(!JSON.stringify(failed.body).includes('private provider'));
  assert.equal(f.rows[0].status, 'approved');
});
test('concurrent redemption issues once and cancellation during issuance revokes the ticket', async () => {
  let resolveIssue;
  const f = fixture(() => new Promise(resolve => { resolveIssue = resolve; }));
  const started = await f.start(); await f.approve(started.body.code);
  const first = f.call('/:id/poll', { verifier });
  // Let the first call claim the row before a second request.
  while (!resolveIssue) await new Promise(resolve => setImmediate(resolve));
  assert.equal((await f.call('/:id/poll', { verifier })).body.status, 'pending');
  await f.call('/:id/cancel', { verifier });
  resolveIssue({ id: 'test-token-id', token: 'test-ticket' });
  assert.equal((await first).code, 410);
  assert.deepEqual(f.revoked, ['test-token-id']);
  assert.equal(f.issued.length, 1);
});
