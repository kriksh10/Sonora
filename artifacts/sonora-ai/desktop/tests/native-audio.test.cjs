const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createNativeAudioHost, validWav } = require('../native-audio-host.cjs');
const id = '12345678-1234-1234-1234-123456789abc';
const other = '22345678-1234-1234-1234-123456789abc';
function wav() {
  const value = Buffer.alloc(192044);
  value.write('RIFF'); value.writeUInt32LE(192036, 4);
  value.write('WAVEfmt ', 8); value.writeUInt32LE(16, 16);
  value.writeUInt16LE(1, 20); value.writeUInt16LE(1, 22);
  value.writeUInt32LE(16000, 24); value.writeUInt32LE(32000, 28);
  value.writeUInt16LE(2, 32); value.writeUInt16LE(16, 34);
  value.write('data', 36); value.writeUInt32LE(192000, 40);
  return value.toString('base64');
}
function fixture(overrides = {}) {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdin.end = data => { child.stopCommand = data; };
  child.kill = signal => { child.killedWith = signal; child.emit('close'); };
  const events = [], states = [], spawns = [];
  const host = createNativeAudioHost({
    binary: '/fixed/native/sonora-audio', confirm: async () => true,
    emit: event => events.push(event), onActive: state => states.push(state),
    checkBinary() {},
    spawnProcess: (...args) => { spawns.push(args); return child; },
    ...overrides,
  });
  const send = value => child.stdout.emit('data', Buffer.from(JSON.stringify(value) + '\n'));
  return { host, child, events, states, spawns, send };
}
test('native host validates fixed PCM WAV framing and rejects malformed messages', () => {
  assert.equal(validWav(wav()), true);
  assert.equal(validWav('bad'), false);
  assert.equal(validWav(Buffer.alloc(192044).toString('base64')), false);
  assert.equal(validWav('A'.repeat(300000)), false);
});
test('native host needs consent, fixes executable/arguments, validates chunks and keeps physical capture state', async () => {
  const f = fixture();
  const started = f.host.start(id, 'system');
  await new Promise(setImmediate);
  assert.equal(f.states.length, 0);
  f.send({ type: 'ready', protocol: 1 });
  assert.deepEqual(await started, { captureId: id });
  assert.equal(f.spawns[0][0], '/fixed/native/sonora-audio');
  assert.deepEqual(f.spawns[0][1], ['--source', 'system']);
  assert.equal(f.spawns[0][2].shell, false);
  assert.equal(f.spawns[0][2].env.AI_INTEGRATIONS_GEMINI_API_KEY, undefined);
  f.send({ type: 'audio', audio: wav() });
  assert.equal(f.events[0].captureId, id);
  assert.equal(f.events[0].type, 'audio');
  assert.equal(f.host.stop(other), false);
  assert.equal(f.host.stop(id), true);
  assert.equal(f.child.stopCommand, 'stop\n');
  assert.equal(f.host.isActive(), true);
  f.child.emit('close');
  assert.equal(f.host.isActive(), false);
  assert.deepEqual(f.states, [true, false]);
});
test('stopping pending native consent never launches a process after late approval', async () => {
  let approve;
  const f = fixture({ confirm: () => new Promise(resolve => { approve = resolve; }) });
  const started = f.host.start(id, 'microphone');
  f.host.stop(id);
  approve(true);
  await assert.rejects(started, /cancelled/);
  assert.equal(f.spawns.length, 0);
});
test('denied native permission and missing helper fail without fallback or launching', async () => {
  const denied = fixture({ confirm: async () => false });
  await assert.rejects(denied.host.start(id, 'microphone'), /not granted/);
  assert.equal(denied.spawns.length, 0);
  const missing = fixture({ checkBinary() { throw new Error('missing'); } });
  await assert.rejects(missing.host.start(id, 'system'), /missing its native audio helper/);
  assert.equal(missing.spawns.length, 0);
});
test('native host rejects invalid sources and concurrent captures', async () => {
  const f = fixture();
  await assert.rejects(f.host.start(id, '--arbitrary-command'), /Invalid/);
  const started = f.host.start(id, 'system');
  await assert.rejects(f.host.start(other, 'microphone'), /already/);
  await new Promise(setImmediate);
  f.send({ type: 'ready', protocol: 1 });
  await started;
  f.host.shutdown();
  assert.equal(f.child.killedWith, 'SIGKILL');
});
test('malformed native audio stops capture and never forwards audio', async () => {
  const f = fixture();
  const started = f.host.start(id, 'system');
  await new Promise(setImmediate);
  f.send({ type: 'ready', protocol: 1 });
  await started;
  f.send({ type: 'audio', audio: 'not-a-wave' });
  assert.equal(f.events.length, 1);
  assert.equal(f.events[0].type, 'error');
  assert.equal(f.child.stopCommand, 'stop\n');
  f.child.emit('close');
});
test('native process exits before ready and during capture are visible failures', async () => {
  const early = fixture();
  const started = early.host.start(id, 'microphone');
  await new Promise(setImmediate);
  early.child.emit('close');
  await assert.rejects(started, /before becoming ready/);
  const active = fixture();
  const ready = active.host.start(id, 'system');
  await new Promise(setImmediate);
  active.send({ type: 'ready', protocol: 1 });
  await ready;
  active.child.emit('close');
  assert.equal(active.events[0].type, 'error');
  assert.equal(active.states.at(-1), false);
});
test('null native protocol messages fail safely without crashing the host', async () => {
  const f = fixture();
  const started = f.host.start(id, 'system');
  await new Promise(setImmediate);
  f.send(null);
  await assert.rejects(started, /invalid message/);
  assert.equal(f.child.stopCommand, 'stop\n');
  f.child.emit('close');
});

test('idle loopback heartbeats keep a responsive helper alive beyond 20 seconds without claiming audio, but missing heartbeats fail', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const started = f.host.start(id, 'system');
  await new Promise(setImmediate);
  f.send({ type: 'ready', protocol: 2 }); await started;
  for (let i = 1; i <= 75; i++) {
    t.mock.timers.tick(1000);
    f.send({ type: 'status', sampleAgeMs: i * 1000, peak: 0 });
  }
  assert.equal(f.events.length, 75);
  assert.ok(f.events.every(e => e.type === 'status' && e.peak === 0));
  assert.equal(f.child.stopCommand, undefined);
  t.mock.timers.tick(20001);
  assert.equal(f.events.at(-1).type, 'error');
  assert.match(f.events.at(-1).message, /stopped responding/);
  assert.equal(f.child.stopCommand, 'stop\n');
  f.child.emit('close');
});

test('native status messages are validated and real device failures still stop capture', async () => {
  for (const invalid of [{ peak: 2, sampleAgeMs: 0 }, { peak: 0, sampleAgeMs: -1 }, { peak: 'bad', sampleAgeMs: 4 }]) {
    const f = fixture();
    const started = f.host.start(id, 'system'); await new Promise(setImmediate);
    f.send({ type: 'ready', protocol: 2 }); await started;
    f.send({ type: 'status', ...invalid });
    assert.equal(f.events.at(-1).type, 'error');
    f.child.emit('close');
  }
  const f = fixture();
  const started = f.host.start(id, 'microphone'); await new Promise(setImmediate);
  f.send({ type: 'ready', protocol: 2 }); await started;
  f.send({ type: 'status', sampleAgeMs: 0, peak: .2 });
  f.send({ type: 'error', message: 'The audio device disconnected or stopped.' });
  assert.match(f.events.at(-1).message, /disconnected/);
  assert.equal(f.child.stopCommand, 'stop\n');
  f.child.emit('close');
});
