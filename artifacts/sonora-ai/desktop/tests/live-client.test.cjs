const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');
const code = buildSync({ entryPoints: [path.resolve(__dirname, '../../src/lib/live-transcription.ts')], bundle: true,
  write: false, format: 'iife', globalName: 'subject', define: { 'import.meta.env.BASE_URL': '"/"' } }).outputFiles[0].text;
test('idle live stream does not falsely fail; resumed continuously unacknowledged audio does fail over', async () => {
  let now = 100000, tick;
  const reasons = [];
  class Socket {
    static OPEN = 1; readyState = 1; bufferedAmount = 0;
    constructor() { queueMicrotask(() => this.onmessage({ data: '{"ready":true}' })); }
    send() {}
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const context = vm.createContext({ URL, AbortController, AbortSignal, Date: { now: () => now }, WebSocket: Socket,
    window: { location: { href: 'https://example.test/' } }, setTimeout, clearTimeout,
    setInterval: fn => { tick = fn; return 1; }, clearInterval() {},
    fetch: async () => ({ ok: true, json: async () => ({ ticket: 'test-ticket' }) }) });
  vm.runInContext(code, context);
  const client = context.subject.createLiveTranscription({ sessionId: 'test', source: 'microphone',
    onUpdate() {}, onFallback: reason => reasons.push(reason) });
  await client.start();
  now += 60000; tick();
  assert.equal(reasons.length, 0, 'no frames means no missing acknowledgment');
  client.send(new Uint8Array(640));
  tick();
  assert.equal(reasons.length, 0, 'resuming gets a fresh deadline');
  for (let i = 0; i < 16; i++) { now += 1000; client.send(new Uint8Array(640)); tick(); }
  assert.equal(reasons.length, 1);
  assert.match(reasons[0], /stopped acknowledging/);
  client.stop();
});
