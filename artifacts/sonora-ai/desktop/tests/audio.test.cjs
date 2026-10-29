const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto').webcrypto;
const { buildSync } = require('esbuild');
function bundle(relative) {
  return buildSync({
    entryPoints: [path.join(__dirname, relative)], bundle: true, write: false,
    format: 'iife', globalName: 'subject', platform: 'node',
    define: { 'import.meta.env.BASE_URL': '"/"' },
  }).outputFiles[0].text;
}
const wavCode = bundle('../../src/lib/pcm-wav.ts');
const validatorCode = bundle('../../../api-server/src/lib/audio-chunks.ts');
const captureCode = bundle('../../src/lib/desktop-audio.ts');
const compatCode = bundle('../../src/lib/compat-pcm.ts');
test('compatibility processor preserves 5–6s mono PCM and skips silence', () => {
  const context = vm.createContext({ Float32Array, Math });
  vm.runInContext(compatCode, context);
  const events = [];
  const collect = context.subject.createCompatPcm(48000, event => events.push(event));
  for (let i = 0; i < 6; i++) collect(new Float32Array(48000).fill(.1));
  assert.equal(events.filter(e => e.samples).length, 1);
  assert.equal(events.find(e => e.samples).samples.length, 96000);
  for (let i = 0; i < 18; i++) collect(new Float32Array(48000));
  assert.equal(events.filter(e => e.samples).length, 1);
  assert.ok(events.some(e => e.prolonged));
});
test('client WAV encoder roundtrips through server validation, rejects malformed/oversize data', () => {
  const client = vm.createContext({ Uint8Array, Float32Array, ArrayBuffer, DataView, btoa, atob });
  vm.runInContext(wavCode, client);
  const server = vm.createContext({ Buffer, Date });
  vm.runInContext(validatorCode, server);
  const audio = client.subject.wavBase64(new Float32Array(96000).fill(.1));
  assert.equal(server.subject.validateAudioChunk(audio).length, 192044);
  for (const invalid of ['x', '!'.repeat(64), Buffer.from('not a wave').toString('base64')]) {
    assert.throws(() => server.subject.validateAudioChunk(invalid));
  }
  assert.throws(() => server.subject.validateAudioChunk(client.subject.wavBase64(new Float32Array(128001))));
  const phrase = client.subject.wavBase64(new Float32Array(16000).fill(.2));
  const joined = client.subject.joinWavPhrases(phrase, phrase);
  assert.equal(server.subject.validateAudioChunk(joined).length, 64044);
  assert.equal(client.subject.joinWavPhrases(audio, audio), null);
});
test('transcription gate serializes per user, limits request rate and allows recovery', () => {
  const server = vm.createContext({ Buffer, Date });
  vm.runInContext(validatorCode, server);
  let time = 0;
  const gate = new server.subject.TranscriptionGate(() => time);
  assert.equal(gate.enter('a'), true);
  assert.equal(gate.enter('a'), false);
  assert.equal(gate.enter('b'), true);
  time = 9000;
  assert.equal(gate.enter('a'), false);
  gate.leave('a');
  assert.equal(gate.enter('a'), true);
  gate.leave('a');
  assert.equal(gate.enter('a'), false);
  time += 4000;
  assert.equal(gate.enter('a'), true);
});
function captureHarness(overrides = {}) {
  let node;
  let closed = false;
  const bridgeStates = [];
  const track = { stopped: false, stop() { this.stopped = true; }, addEventListener() {} };
  const stream = { getAudioTracks: () => [track], getTracks: () => [track] };
  class Context {
    state = 'running';
    audioWorklet = { addModule: async () => {} };
    destination = {};
    createMediaStreamSource() { return { connect() {} }; }
    resume() { return Promise.resolve(); }
    close() { closed = true; this.state = 'closed'; return Promise.resolve(); }
  }
  class Worklet {
    constructor() { node = this; this.port = {}; }
    connect() {}
    disconnect() {}
  }
  const context = vm.createContext({
    Uint8Array, Float32Array, ArrayBuffer, DataView, btoa, atob, AbortController, AbortSignal,
    setTimeout, clearTimeout, Date,
    window: { sonoraDesktop: { setCaptureActive: async value => { bridgeStates.push(value); } } },
    navigator: { mediaDevices: { getUserMedia: async () => stream, getDisplayMedia: async () => stream } },
    AudioContext: Context, AudioWorkletNode: Worklet, MediaStream: class { constructor() {} },
    fetch: async () => ({ ok: true, json: async () => ({ text: 'What is a closure?' }) }),
    ...overrides,
  });
  vm.runInContext(captureCode, context);
  return { context, stream, track, bridgeStates, get node() { return node; }, get closed() { return closed; } };
}
test('stop after permission request releases tracks even if permission resolves late', async () => {
  let resolvePermission;
  const pending = new Promise(resolve => { resolvePermission = resolve; });
  const harness = captureHarness({ navigator: { mediaDevices: { getUserMedia: () => pending } } });
  const capture = harness.context.subject.createDesktopAudio({ source: 'microphone' });
  const started = capture.start();
  capture.stop();
  resolvePermission(harness.stream);
  await started;
  assert.equal(harness.track.stopped, true);
  assert.ok(!harness.bridgeStates.includes(true));
});
test('a throttled clip is skipped without stopping the microphone or later transcription', async () => {
  let requests = 0;
  const texts = [], errors = [], notices = [];
  const harness = captureHarness({ fetch: async () => {
    requests++;
    return requests === 1 ? { ok: false, status: 429, json: async () => ({ error: "busy" }) }
      : { ok: true, status: 200, json: async () => ({ text: "How do threads share memory?" }) };
  } });
  const capture = harness.context.subject.createDesktopAudio({ source: "microphone", sessionId: "test",
    onError: error => errors.push(error.message), onNotice: text => notices.push(text), onText: text => texts.push(text) });
  await capture.start();
  harness.node.port.onmessage({ data: { samples: new Float32Array(96000).fill(.1) } });
  await new Promise(setImmediate);
  harness.node.port.onmessage({ data: { samples: new Float32Array(96000).fill(.1) } });
  await new Promise(resolve => setTimeout(resolve, 4300));
  assert.equal(harness.track.stopped, false);
  assert.deepEqual(errors, []);
  assert.ok(notices.some(text => /continuing to listen/.test(text)));
  assert.deepEqual(texts, ["How do threads share memory?"]);
  capture.stop();
});
test('a throttled availability probe does not switch to a separate browser speech pipeline', async () => {
  const harness = captureHarness({ fetch: async () => ({ ok: false, status: 429 }) });
  assert.equal(await harness.context.subject.serverSttAvailable("test"), true);
});
test('worklet failure uses compatibility capture, sends WAV and never plays back input', async () => {
  let processor, closed = false;
  class CompatibilityContext {
    state = "running";
    sampleRate = 16000;
    destination = {};
    audioWorklet = { addModule: async () => { throw new Error("Worklet unavailable"); } };
    createMediaStreamSource() { return { connect() {} }; }
    createScriptProcessor() { processor = { connect() {}, disconnect() {}, onaudioprocess: null }; return processor; }
    resume() { return Promise.resolve(); }
    close() { closed = true; return Promise.resolve(); }
  }
  const texts = [], notices = [], errors = [];
  const harness = captureHarness({ AudioContext: CompatibilityContext });
  const capture = harness.context.subject.createDesktopAudio({ source: "microphone", sessionId: "test",
    onError: error => errors.push(error.message), onNotice: text => notices.push(text), onText: text => texts.push(text) });
  await capture.start();
  const output = new Float32Array(4096).fill(.5);
  processor.onaudioprocess({ inputBuffer: { getChannelData: () => new Float32Array(96000).fill(.1) },
    outputBuffer: { getChannelData: () => output } });
  await new Promise(setImmediate);
  assert.deepEqual(texts, ["What is a closure?"]);
  assert.deepEqual(errors, []);
  assert.ok(notices.some(text => /Compatibility audio capture/.test(text)));
  assert.ok(output.every(value => value === 0));
  capture.stop();
  assert.equal(processor.onaudioprocess, null);
  assert.equal(closed, true);
});
test('queue pressure skips old speech with a notice rather than stopping capture', async () => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const errors = [], notices = [];
  const harness = captureHarness({ fetch: () => pending });
  const capture = harness.context.subject.createDesktopAudio({ source: "system", sessionId: "test",
    onError: error => errors.push(error.message), onNotice: text => notices.push(text), onText() {} });
  await capture.start();
  for (let i = 0; i < 8; i++) harness.node.port.onmessage({ data: { samples: new Float32Array(96000).fill(.1) } });
  assert.equal(harness.track.stopped, false);
  assert.deepEqual(errors, []);
  assert.ok(notices.some(text => /older queued clip was skipped/.test(text)));
  capture.stop();
  release({ ok: true, json: async () => ({ text: "" }) });
  await new Promise(setImmediate);
});
test('provider failure stops tracks, closes audio context and reports recoverable error', async () => {
  const errors = [];
  const harness = captureHarness({ fetch: async () => ({ ok: false, json: async () => ({ error: 'Provider unavailable' }) }) });
  const capture = harness.context.subject.createDesktopAudio({ source: 'microphone', sessionId: 'test', onError: error => errors.push(error.message), onNotice() {}, onText() {} });
  await capture.start();
  harness.node.port.onmessage({ data: { samples: new Float32Array(96000).fill(.2) } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(errors, ['Provider unavailable']);
  assert.equal(harness.track.stopped, true);
  assert.equal(harness.closed, true);
  assert.equal(harness.bridgeStates.at(-1), false);
});
test('stop aborts in-flight request and prevents late transcript callbacks', async () => {
  let resolveRequest;
  let requestSignal;
  const texts = [];
  const harness = captureHarness({ fetch: (_url, options) => {
    requestSignal = options.signal;
    return new Promise(resolve => { resolveRequest = resolve; });
  } });
  const capture = harness.context.subject.createDesktopAudio({ source: 'system', sessionId: 'test', onError() {}, onNotice() {}, onText: text => texts.push(text) });
  await capture.start();
  harness.node.port.onmessage({ data: { samples: new Float32Array(96000).fill(.2) } });
  await new Promise(resolve => setImmediate(resolve));
  capture.stop();
  assert.equal(requestSignal.aborted, true);
  resolveRequest({ ok: true, json: async () => ({ text: 'late text' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(texts, []);
  assert.equal(harness.track.stopped, true);
});

function nativeHarness({ start, fetch } = {}) {
  let listener;
  let captureId;
  const stops = [];
  const native = {
    setCaptureActive: async () => { throw new Error('Native state belongs to the host'); },
    startNativeCapture: async (id, source) => { captureId = id; if (start) await start(id, source); return { captureId: id }; },
    stopNativeCapture: async id => { stops.push(id); return true; },
    onNativeAudio: fn => { listener = fn; return () => { listener = null; }; },
  };
  const harness = captureHarness({
    crypto, window: { sonoraDesktop: native },
    navigator: { mediaDevices: { getUserMedia() { throw new Error('Unexpected browser fallback'); } } },
    ...(fetch ? { fetch } : {}),
  });
  return { harness, stops, emit: event => listener?.({ captureId, ...event }) };
}
test('native chunks go to the existing Gemini endpoint; stale events are ignored', async () => {
  const requests = [], texts = [];
  const f = nativeHarness({ fetch: async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return { ok: true, json: async () => ({ text: 'Native transcript' }) };
  } });
  const capture = f.harness.context.subject.createDesktopAudio({
    source: 'system', sessionId: 'session', onNotice() {}, onError() {}, onText: text => texts.push(text),
  });
  await capture.start();
  f.emit({ type: 'audio', audio: 'ignored', captureId: 'stale-id' });
  f.emit({ type: 'audio', audio: 'validated-native-wav' });
  await new Promise(setImmediate);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/api/sessions/session/transcribe');
  assert.deepEqual(requests[0].body, { audio: 'validated-native-wav', mimeType: 'audio/wav', source: 'system' });
  assert.deepEqual(texts, ['Native transcript']);
  capture.stop();
  assert.equal(f.stops.length, 1);
});
test('silence while a chunk is transcribing marks that transcript as the end of the turn', async () => {
  let resolveRequest;
  const texts = [];
  const turns = [];
  const f = nativeHarness({ fetch: () => new Promise(resolve => { resolveRequest = resolve; }) });
  const capture = f.harness.context.subject.createDesktopAudio({
    source: 'system', sessionId: 'session', onNotice() {}, onError() {},
    onText: (text, meta) => texts.push({ text, endOfTurn: meta.endOfTurn }),
    onTurnEnded: () => turns.push('ended'),
  });
  await capture.start();
  f.emit({ type: 'audio', audio: 'validated-native-wav', endOfTurn: false });
  await new Promise(setImmediate);
  f.emit({ type: 'silence', prolonged: false });
  resolveRequest({ ok: true, json: async () => ({ text: 'Tell me about the migration' }) });
  await new Promise(setImmediate);
  assert.deepEqual(texts, [{ text: 'Tell me about the migration', endOfTurn: true }]);
  assert.deepEqual(turns, []);
  f.emit({ type: 'silence', prolonged: false });
  assert.deepEqual(turns, ['ended']);
  capture.stop();
});
test('native start cancellation stops a late-starting helper and unsubscribes', async () => {
  let resolveStart;
  const f = nativeHarness({ start: () => new Promise(resolve => { resolveStart = resolve; }) });
  const capture = f.harness.context.subject.createDesktopAudio({ source: 'system', onNotice() {} });
  const starting = capture.start();
  capture.stop();
  resolveStart();
  await starting;
  assert.equal(f.stops.length, 2);
  assert.equal(f.stops[0], f.stops[1]);
});
test('Speechmatics frames commit finished phrases and phrase recordings continue when live is unavailable', async () => {
  const requests = [], texts = [], phases = [];
  const f = nativeHarness({ fetch: async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url, body });
    if (url.endsWith('/live-audio')) {
      if (body.open) return { ok: true, status: 200, json: async () => ({}) };
      const frames = requests.filter(request => request.body?.audio).length;
      if (frames === 1) return { ok: true, status: 200, json: async () => ({ accepted: true, partial: 'Where did', text: '', final: false }) };
      return { ok: true, status: 200, json: async () => ({ accepted: true, partial: '', text: 'Where did you work?', final: true }) };
    }
    return { ok: true, status: 200, json: async () => ({ text: 'Phrase fallback' }) };
  } });
  const capture = f.harness.context.subject.createDesktopAudio({
    source: 'system', sessionId: 'session', onNotice() {}, onError() {},
    onPhase: text => phases.push(text),
    onText: text => texts.push(text),
  });
  await capture.start();
  const flush = async () => { for (let i = 0; i < 8; i += 1) await new Promise(resolve => setImmediate(resolve)); };
  f.emit({ type: 'pcm', audio: 'live-frame' });
  await flush();
  assert.deepEqual(phases, ['Where did']);
  assert.deepEqual(texts, []);
  f.emit({ type: 'pcm', audio: 'live-frame-2' });
  await flush();
  assert.deepEqual(texts, ['Where did you work?']);
  f.emit({ type: 'audio', audio: 'should-not-send' });
  await new Promise(setImmediate);
  assert.equal(requests.some(request => request.url.endsWith('/transcribe')), false);
  capture.stop();
});

test('Gemini transcription failure stops native capture with a visible error', async () => {
  const errors = [];
  const f = nativeHarness({ fetch: async () => ({ ok: false, json: async () => ({ error: 'Gemini unavailable' }) }) });
  const capture = f.harness.context.subject.createDesktopAudio({
    source: 'microphone', sessionId: 'session', onNotice() {}, onText() {},
    onError: error => errors.push(error.message),
  });
  await capture.start();
  f.emit({ type: 'audio', audio: 'validated-native-wav' });
  await new Promise(setImmediate);
  assert.deepEqual(errors, ['Gemini unavailable']);
  assert.equal(f.stops.length, 1);
});
