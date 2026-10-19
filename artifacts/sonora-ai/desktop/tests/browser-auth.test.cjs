const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createBrowserAuth } = require('../browser-auth.cjs');
const id = '550e8400-e29b-41d4-a716-446655440000';
const id2 = '550e8400-e29b-41d4-a716-446655440001';
const hash = value => createHash('sha256').update(value).digest('hex');
const ok = value => ({ ok: true, json: async () => value });

function fixture(override) {
  const calls = [], opened = [];
  let now = 1_000_000, count = 0;
  const host = createBrowserAuth({
    serviceUrl: 'https://sonora.example/', clock: () => now,
    openExternal: async url => { opened.push(url); },
    fetcher: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url: url.href, body, options });
      if (override) return override(url, body);
      if (url.pathname.endsWith('/poll')) return ok({ status: 'complete', ticket: 'test-ticket' });
      if (url.pathname.endsWith('/cancel')) return ok({ status: 'cancelled' });
      return ok({ id: count++ ? id2 : id, code: '123456', expiresAt: new Date(now + 300000).toISOString() });
    },
  });
  return { host, calls, opened, advance: ms => { now += ms; } };
}
test('browser handoff keeps proof native and delivers a ticket only once to the requester', async () => {
  const f = fixture();
  const started = await f.host.start();
  assert.equal(started.code, '123456');
  assert.deepEqual(Object.keys(started).sort(), ['code', 'expiresAt', 'id']);
  assert.equal(f.opened[0], `https://sonora.example/desktop-connect/${id}`);
  const completed = await f.host.poll(id);
  assert.equal(completed.ticket, 'test-ticket');
  const verifier = f.calls[1].body.verifier;
  assert.equal(hash(verifier), f.calls[0].body.challenge);
  assert.ok(!f.opened[0].includes(verifier));
  assert.equal(f.calls[1].options.redirect, 'error');
  await assert.rejects(f.host.poll(id), /Start a new/);
});
test('expired and cancelled requests cannot be redeemed', async () => {
  const f = fixture();
  await f.host.start(); f.advance(300001);
  await assert.rejects(f.host.poll(id), /expired/);
  assert.ok(f.calls.some(c => c.url.endsWith('/cancel')));
  await f.host.start(); await f.host.cancel(id2);
  await assert.rejects(f.host.poll(id2), /Start a new/);
});
test('stale renderer cancellation cannot cancel a newer request', async () => {
  const f = fixture();
  await f.host.start(); await f.host.start();
  await f.host.cancel(id);
  assert.equal((await f.host.poll(id2)).status, 'complete');
});
test('cancellation during polling never returns a late ticket', async () => {
  let resolvePoll;
  const f = fixture((url) => url.pathname.endsWith('/poll')
    ? new Promise(resolve => { resolvePoll = resolve; })
    : ok({ id, code: '123456', expiresAt: new Date(1_300_000).toISOString() }));
  await f.host.start();
  const poll = f.host.poll(id);
  await f.host.cancel(id);
  resolvePoll(ok({ status: 'complete', ticket: 'test-ticket' }));
  await assert.rejects(poll, /cancelled/);
});
test('old hosted services and invalid protocol responses fail visibly', async () => {
  const old = createBrowserAuth({ serviceUrl: 'https://sonora.example/', openExternal: () => assert.fail(),
    fetcher: async () => ({ ok: false, status: 404, json: async () => ({}) }) });
  await assert.rejects(old.start(), /Publish the latest/);
  const invalid = fixture(() => ok({ id: 'bad', code: '123456', expiresAt: 'bad' }));
  await assert.rejects(invalid.host.start(), /invalid/);
  assert.equal(invalid.opened.length, 0);
});
