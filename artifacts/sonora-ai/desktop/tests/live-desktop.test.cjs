const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { buildSync } = require('esbuild');
const { opacity, safeBounds } = require('../window-preferences.cjs');
const { createNativeAudioManager } = require('../native-audio-host.cjs');

function load(file, globals = {}, external = []) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, Date, ...globals });
  const code = buildSync({
    entryPoints: [path.resolve(__dirname, file)], bundle: true, write: false,
    format: 'iife', globalName: 'subject', platform: 'node', external, jsx: 'automatic',
    define: { 'import.meta.env.BASE_URL': '"/"' },
  }).outputFiles[0].text;
  vm.runInContext(code, context);
  return context.subject;
}

test('opacity validates rather than silently accepting unsafe values', () => {
  assert.equal(opacity(.15), .15); assert.equal(opacity(.45), .45); assert.equal(opacity(1), 1);
  for (const value of [NaN, Infinity, -1, 0, .14, 1.1, '0.8', undefined]) assert.throws(() => opacity(value));
});

test('saved window bounds recover across removed monitors, scaling, and invalid input', () => {
  const displays = [{ workArea: { x: -1280, y: 0, width: 1280, height: 720 } }, { workArea: { x: 0, y: 0, width: 1920, height: 1080 } }];
  assert.deepEqual(safeBounds({ x: -1100, y: 50, width: 600, height: 500 }, displays),
    { x: -1100, y: 50, width: 600, height: 620 });
  const recovered = safeBounds({ x: 8000, y: -3000, width: 2000, height: 2000 }, displays);
  assert.equal(recovered.x, -1280); assert.equal(recovered.y, 0);
  assert.equal(recovered.width, 1280); assert.equal(recovered.height, 720);
  const small = safeBounds({ x: NaN }, [{ workArea: { x: 0, y: 0, width: 350, height: 400 } }]);
  assert.deepEqual(small, { x: 0, y: 0, width: 350, height: 400 });
});

test('native manager isolates two sources, preserves aggregate state, and blocks duplicate leases', async () => {
  const children = [], events = [], active = [];
  const manager = createNativeAudioManager({
    binary: '/fixed/sonora-audio', confirm: async () => true, checkBinary() {},
    emit: event => events.push(event), onActive: value => active.push(value),
    spawnProcess(_binary, args) {
      const child = new EventEmitter();
      child.args = args;
      child.stdout = new EventEmitter(); child.stdin = new EventEmitter();
      child.stdin.end = () => {};
      child.kill = () => child.emit('close');
      children.push(child);
      queueMicrotask(() => child.stdout.emit('data', Buffer.from('{"type":"ready","protocol":1}\n')));
      return child;
    },
  });
  try {
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    await manager.start(a, 'microphone'); await manager.start(b, 'system');
    assert.deepEqual(children.map(c => c.args), [['--source', 'microphone'], ['--source', 'system']]);
    await assert.rejects(manager.start('33333333-3333-4333-8333-333333333333', 'microphone'), /already/);
    children[1].stdout.emit('data', Buffer.from('{"type":"silence","prolonged":true}\n'));
    assert.equal(events[0].source, 'system'); assert.equal(events[0].captureId, b);
    assert.ok(!Number.isNaN(Date.parse(events[0].capturedAt)));
    manager.stop(a); children[0].emit('close');
    assert.equal(manager.isActive(), true); assert.equal(active.at(-1), true);
    manager.stop(); children[1].emit('close');
    assert.equal(manager.isActive(), false); assert.equal(active.at(-1), false);
  } finally { manager.shutdown(); }
});

test('audio group rolls back partial startup and cancellation never starts the next channel', async () => {
  const { createAudioGroup } = load('../../src/lib/desktop-audio.ts');
  const calls = [];
  const good = { start: async () => calls.push('mic-start'), stop: () => calls.push('mic-stop') };
  const denied = { start: async () => { throw new Error('Permission denied'); }, stop: () => calls.push('system-stop') };
  await assert.rejects(createAudioGroup([good, denied]).start(), /Permission/);
  assert.deepEqual(calls, ['mic-start', 'mic-stop', 'system-stop']);
  let resolve;
  const late = { start: () => new Promise(r => { resolve = r; }), stop: () => calls.push('late-stop') };
  let started = false;
  const next = { start: async () => { started = true; }, stop() {} };
  const group = createAudioGroup([late, next]);
  const starting = group.start(); group.stop(); resolve(); await starting;
  assert.equal(started, false);
});

test('provider gate serializes a user while independently rate-limiting each audio channel', () => {
  let now = 10_000;
  const { TranscriptionGate } = load('../../../api-server/src/lib/audio-chunks.ts');
  const gate = new TranscriptionGate(() => now);
  assert.equal(gate.enter('u', 'microphone'), true);
  assert.equal(gate.enter('u', 'system'), false);
  gate.leave('u');
  assert.equal(gate.enter('u', 'system'), true);
  gate.leave('u');
  assert.equal(gate.enter('u', 'microphone'), false);
  now += 6000;
  assert.equal(gate.enter('u', 'microphone'), true);
});

test('separate capture clients share the provider lane and retain source/time metadata', async () => {
  const listeners = new Set(), ids = new Map(), requests = [], texts = [];
  const bridge = {
    onNativeAudio(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    startNativeCapture: async (id, source) => { ids.set(source, id); },
    stopNativeCapture: async () => true,
  };
  const { createDesktopAudio } = load('../../src/lib/desktop-audio.ts', {
    window: { sonoraDesktop: bridge }, crypto: require('node:crypto'), AbortController, AbortSignal,
    fetch: (_url, options) => new Promise(resolve => { requests.push({ options, resolve }); }),
  });
  const one = createDesktopAudio({ source: 'microphone', sessionId: 's', onNotice() {}, onError() {}, onText: (text, meta) => texts.push({ text, ...meta }) });
  const two = createDesktopAudio({ source: 'system', sessionId: 's', onNotice() {}, onError() {}, onText: (text, meta) => texts.push({ text, ...meta }) });
  try {
    await one.start(); await two.start();
    const capturedAt = '2026-10-19T12:00:00.000Z';
    for (const source of ['microphone', 'system']) {
      for (const listener of listeners) listener({ type: 'audio', audio: 'fixed-wav', captureId: ids.get(source), source, capturedAt });
    }
    await new Promise(setImmediate);
    assert.equal(requests.length, 1);
    assert.equal(JSON.parse(requests[0].options.body).source, 'microphone');
    requests[0].resolve({ ok: true, json: async () => ({ text: 'Candidate speech' }) });
    await new Promise(setImmediate);
    assert.equal(requests.length, 2);
    assert.equal(JSON.parse(requests[1].options.body).source, 'system');
    requests[1].resolve({ ok: true, json: async () => ({ text: 'Remote speech' }) });
    await new Promise(setImmediate);
    assert.deepEqual(texts.map(t => [t.text, t.source, t.capturedAt]), [
      ['Candidate speech', 'microphone', capturedAt], ['Remote speech', 'system', capturedAt],
    ]);
  } finally { one.stop(); two.stop(); }
});

test('readiness capture exposes levels locally, sends no audio to Gemini, and unsubscribes on Stop', async () => {
  let listener, id, stopped = false;
  const levels = [];
  const { createDesktopAudio } = load('../../src/lib/desktop-audio.ts', {
    window: { sonoraDesktop: {
      onNativeAudio(fn) { listener = fn; return () => { listener = null; }; },
      startNativeCapture: async value => { id = value; },
      stopNativeCapture: async () => { stopped = true; },
    } }, crypto: require('node:crypto'), AbortController, AbortSignal,
    fetch: () => assert.fail('Readiness levels must never send audio to transcription'),
  });
  const capture = createDesktopAudio({ source: 'system', sessionId: 's', transcribe: false,
    onNotice() {}, onError(error) { throw error; }, onText() { assert.fail('No transcription expected'); },
    onLevel: (level, state) => levels.push({ level, state }),
  });
  await capture.start();
  listener({ type: 'status', captureId: id, peak: .2, sampleAgeMs: 0 });
  listener({ type: 'audio', captureId: id, audio: 'fixed-wav' });
  listener({ type: 'status', captureId: id, peak: 0, sampleAgeMs: 25000 });
  await new Promise(setImmediate);
  assert.equal(levels[0].level, .2);
  assert.match(levels[1].state, /No audio samples/);
  capture.stop(); await new Promise(setImmediate);
  assert.equal(stopped, true); assert.equal(listener, null);
});

function questions(answer = async () => {}) {
  let nextId = 0;
  const timers = new Map(), notices = [], sent = [];
  const { createInterviewerQuestions } = load('../../src/lib/interviewer-questions.ts');
  const router = createInterviewerQuestions({
    answer: async text => { sent.push(text); await answer(text); }, notice: text => notices.push(text),
    setTimer: fn => { timers.set(++nextId, fn); return nextId; },
    clearTimer: id => timers.delete(id), clock: () => 10_000,
  });
  const flush = () => { const pending = [...timers.values()]; timers.clear(); pending.forEach(fn => fn()); };
  return { router, sent, notices, flush };
}

test('candidate, unknown, and audio-check speech never trigger automatic answers', () => {
  const q = questions();
  q.router.push('How do we solve this?', 'candidate');
  q.router.push('Tell me about yourself', 'unknown');
  q.flush(); assert.equal(q.sent.length, 0);
  q.router.push('Can you hear me?', 'interviewer'); q.flush();
  assert.equal(q.sent.length, 0);
});

test('remote fragments assemble across chunks, duplicate turns are suppressed, reset cancels pending work', async () => {
  const q = questions();
  q.router.push('Can you explain how', 'interviewer');
  q.router.push('your cache works?', 'interviewer'); q.flush();
  await Promise.resolve(); await Promise.resolve();
  assert.deepEqual(q.sent, ['Can you explain how your cache works?']);
  q.router.push('Can you explain how your cache works?', 'interviewer'); q.flush();
  assert.equal(q.sent.length, 1); assert.match(q.notices.at(-1), /Repeated/);
  q.router.push('Why Redis?', 'interviewer'); q.router.reset(); q.flush();
  assert.equal(q.sent.length, 1);
});

test('continuous six-second remote chunks cannot postpone automatic answers forever', () => {
  const { createInterviewerQuestions, isInterviewQuestion } = load('../../src/lib/interviewer-questions.ts');
  let now = 0, next = 0;
  const timers = new Map(), sent = [];
  const router = createInterviewerQuestions({
    answer: async text => { sent.push(text); }, notice() {}, clock: () => now,
    setTimer: (fn, delay) => { const id = ++next; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimer: id => timers.delete(id),
  });
  function advance(to) {
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > to) break;
      now = entry[1].at; timers.delete(entry[0]); entry[1].fn();
    }
    now = to;
  }
  router.push('Then you give me a brief about your', 'interviewer');
  advance(6000); router.push('recent project and the tradeoffs', 'interviewer');
  advance(12000); router.push('you considered', 'interviewer');
  assert.equal(sent.length, 0);
  advance(15000); assert.equal(sent.length, 1);
  assert.match(sent[0], /tradeoffs you considered/);
  advance(40000); assert.equal(sent.length, 1);
  router.push('Explain your next project', 'interviewer'); router.reset();
  advance(60000); assert.equal(sent.length, 1);
  assert.equal(isInterviewQuestion('Then you give me brief about your experience.'), true);
  assert.equal(isInterviewQuestion('Okay, can you hear me?'), false);
});

test('busy answers retain bounded follow-up questions and surface overflow explicitly', async () => {
  let release;
  const q = questions(() => new Promise(resolve => { release = resolve; }));
  for (const text of ['How one?', 'Why two?', 'What three?', 'Where four?']) {
    q.router.push(text, 'interviewer'); q.flush();
  }
  assert.deepEqual(q.sent, ['How one?']);
  assert.ok(q.notices.some(text => /Two questions/.test(text)));
  release(); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(q.sent, ['How one?', 'Why two?']);
  q.router.reset(); release();
});

test('follow-latest pane follows growth, pauses for reading, jumps, resizes and resets per session', () => {
  let cursor = 0, effects = [];
  const slots = [], observers = [];
  const changed = (a, b) => !a || a.length !== b.length || a.some((value, i) => value !== b[i]);
  const effect = (fn, deps) => {
    const index = cursor++, old = slots[index];
    if (!old || changed(old.deps, deps)) effects.push(() => { old?.cleanup?.(); slots[index] = { deps, cleanup: fn() }; });
  };
  const react = {
    useRef: value => { const i = cursor++; return slots[i] ??= { current: value }; },
    useState: initial => { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], value => { slots[i] = value; }]; },
    useCallback: (fn, deps) => { const i = cursor++; if (!slots[i] || changed(slots[i].deps, deps)) slots[i] = { deps, fn }; return slots[i].fn; },
    useEffect: effect, useLayoutEffect: effect,
  };
  const jsx = (type, props) => ({ type, props });
  const { default: Pane } = load('../../src/components/follow-latest-pane.tsx', {
    require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : { ArrowDown() {} },
    ResizeObserver: class { constructor(cb) { this.cb = cb; observers.push(this); } observe() {} disconnect() {} },
  }, ['react', 'react/jsx-runtime', 'lucide-react']);
  const element = { scrollHeight: 1000, clientHeight: 200, scrollTop: 0 };
  function render(resetKey = 'a') {
    cursor = 0; effects = [];
    const tree = Pane({ resetKey, label: 'Transcript', children: 'Real content' });
    const scroll = tree.props.children[0];
    scroll.props.ref.current = element;
    scroll.props.children.props.ref.current = {};
    effects.forEach(fn => fn());
    return { tree, scroll };
  }
  let view = render(); assert.equal(element.scrollTop, 800);
  element.scrollTop = 300; view.scroll.props.onScroll(); view = render();
  assert.equal(view.scroll.props['data-following'], 'false');
  element.scrollHeight = 1400; observers[0].cb(); assert.equal(element.scrollTop, 300);
  view.tree.props.children[1].props.onClick(); view = render();
  assert.equal(element.scrollTop, 1200); assert.equal(view.scroll.props['data-following'], 'true');
  element.clientHeight = 300; observers[0].cb(); assert.equal(element.scrollTop, 1100);
  element.scrollTop = 100; view.scroll.props.onScroll(); render('b'); view = render('b');
  assert.equal(view.scroll.props['data-following'], 'true'); assert.equal(element.scrollTop, 1100);
});
