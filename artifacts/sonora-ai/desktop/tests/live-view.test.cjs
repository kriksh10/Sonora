const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const path = require('node:path');
const vm = require('node:vm');

function fixture() {
  let cursor = 0, effects = [];
  const slots = [], handlers = new Map(), calls = [];
  const changed = (a, b) => !a || a.length !== b.length || a.some((v, i) => v !== b[i]);
  const react = {
    useRef(value) { const i = cursor++; return slots[i] ??= { current: value }; },
    useState(value) { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }]; },
    useMemo(fn) { return fn(); },
    useEffect(fn, deps) { const i = cursor++, old = slots[i]; if (!old || changed(old.deps, deps)) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; }); },
  };
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({
    window: { sonoraDesktop: {}, addEventListener: (name, h) => handlers.set(name, h), removeEventListener: name => handlers.delete(name) },
    require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : new Proxy({}, { get: () => () => null }),
  });
  vm.runInContext(buildSync({
    entryPoints: [path.resolve(__dirname, '../../src/components/live-session-view.tsx')],
    bundle: true, write: false, format: 'iife', globalName: 'subject', platform: 'node', jsx: 'automatic',
    alias: { '@': path.resolve(__dirname, '../../src') }, loader: { '.css': 'empty' },
    external: ['react', 'react/jsx-runtime', 'lucide-react'],
  }).outputFiles[0].text, context);
  const props = {
    session: { id: 'a', title: 'Interview', sessionType: 'interview', status: 'active', transcript: [], autoAnswer: false, saveTranscript: false,
      answerPreferences: { length: 'balanced' } },
    answer: 'Actual current answer', latestQuestion: 'Why this design?', busy: false, listening: true, requestingAudio: false,
    interimTranscript: '', duration: '01:23', notice: '', error: '', audioSource: 'both', remoteConfirmed: true, supportsDualAudio: true, question: 'Draft question',
    onAudioSourceChange() {}, onRemoteConfirmedChange() {}, onToggleAudio() {}, onEnd() {}, onBack() {}, onPreferences() {}, onQuestionChange() {}, onUseTranscript() {},
    onAsk: () => calls.push('ask'), onAnswerAction: action => calls.push(action), onAutoAnswerChange: value => calls.push(value),
    onLengthChange: value => calls.push(value), onRetry: () => calls.push('retry'),
  };
  const render = () => { cursor = 0; effects = []; const tree = context.subject.default(props); effects.forEach(fn => fn()); return tree; };
  function find(tree, id) {
    if (!tree || typeof tree !== 'object') return;
    if (tree.props?.['data-testid'] === id) return tree;
    for (const child of [tree.props?.children].flat(Infinity)) { const match = find(child, id); if (match) return match; }
  }
  return { props, render, find, calls, handlers };
}

test('paused automatic answers expose setup actions without starting capture or assuming speaker consent', () => {
  const f = fixture();
  f.props.listening = false; f.props.audioSource = 'microphone'; f.props.remoteConfirmed = false;
  let source, consent;
  f.props.onAudioSourceChange = value => { source = value; };
  f.props.onRemoteConfirmedChange = value => { consent = value; };
  f.props.onAutoAnswerChange = enabled => { f.props.session.autoAnswer = enabled; };
  let tree = f.render();
  assert.ok(f.find(tree, 'auto-answer-setup'));
  assert.equal(f.find(tree, 'button-use-call-audio'), undefined);
  f.find(tree, 'button-enable-auto-answer').props.onClick();
  assert.equal(f.props.session.autoAnswer, true);
  tree = f.render();
  f.find(tree, 'button-use-call-audio').props.onClick();
  assert.equal(source, 'system'); assert.equal(consent, undefined);
  f.props.audioSource = source; tree = f.render();
  f.find(tree, 'checkbox-confirm-interviewer').props.onChange({ target: { checked: true } });
  assert.equal(consent, true);
  assert.equal(f.props.listening, false);
});

test('answer view collapses transcript by default and per session, actions are wired and save policy is unchanged', () => {
  const f = fixture();
  let tree = f.render();
  assert.equal(f.find(tree, 'button-toggle-transcript').props['aria-expanded'], false);
  f.find(tree, 'button-toggle-transcript').props.onClick();
  tree = f.render();
  assert.equal(f.find(tree, 'button-toggle-transcript').props['aria-expanded'], true);
  f.find(tree, 'button-shorten').props.onClick();
  f.find(tree, 'button-explain').props.onClick();
  f.find(tree, 'button-again').props.onClick();
  f.find(tree, 'button-length-long').props.onClick();
  f.find(tree, 'button-session-menu').props.onClick();
  tree = f.render();
  f.find(tree, 'button-auto-answer').props.onClick();
  assert.deepEqual(f.calls, ['shorten', 'explain', 'again', 'long', true]);
  assert.equal(f.props.session.saveTranscript, false);
  f.props.session = { ...f.props.session, id: 'b' };
  f.render(); tree = f.render();
  assert.equal(f.find(tree, 'button-toggle-transcript').props['aria-expanded'], false);
});

test('live view shows interrupted state and retry, blocks busy/ended actions, and local shortcut respects text fields', () => {
  const f = fixture();
  f.props.answerState = 'interrupted';
  let tree = f.render();
  assert.match(f.find(tree, 'text-answer-state').props.children, /Interrupted/);
  f.find(tree, 'button-retry').props.onClick();
  const key = f.handlers.get('keydown');
  const event = target => ({ key: 'Enter', ctrlKey: true, target, preventDefault() {} });
  key(event({ tagName: 'INPUT', getAttribute: () => 'other' }));
  assert.deepEqual(f.calls, ['retry']);
  key(event({ tagName: 'BUTTON' }));
  assert.deepEqual(f.calls, ['retry', 'ask']);
  f.props.busy = true; tree = f.render();
  assert.equal(f.find(tree, 'button-shorten').props.disabled, true);
  f.find(tree, 'button-session-menu').props.onClick();
  tree = f.render();
  assert.equal(f.find(tree, 'select-audio-source').props.disabled, true);
  f.props.session.status = 'ended'; f.props.busy = false; tree = f.render();
  assert.equal(f.find(tree, 'button-ask').props.disabled, true);
  assert.equal(f.find(tree, 'button-again').props.disabled, true);
});

test('live screen hides setup clutter until opened and keeps Stop and answer controls accessible', () => {
  const f = fixture();
  let tree = f.render();
  assert.equal(f.find(tree, 'session-menu'), undefined);
  assert.equal(f.find(tree, 'select-audio-source'), undefined);
  assert.equal(f.find(tree, 'live-status'), undefined);
  assert.ok(f.find(tree, 'button-toggle-audio'));
  assert.ok(f.find(tree, 'input-question'));
  f.find(tree, 'button-session-menu').props.onClick();
  tree = f.render();
  assert.ok(f.find(tree, 'session-menu'));
  assert.ok(f.find(tree, 'select-audio-source'));
});

test('phone capture requires consent, hides false speaker mapping and supports manual recent answers', () => {
  const f = fixture();
  Object.assign(f.props, {
    inputMode: 'phone', listening: false, phoneConsent: false, phoneAuto: false,
    recentPhoneText: 'Explain database indexes', onAnswerRecent: () => f.calls.push('recent'),
    onPhoneConsentChange: value => { f.props.phoneConsent = value; },
    onPhoneAutoChange: value => { f.props.phoneAuto = value; },
  });
  let tree = f.render();
  assert.equal(f.find(tree, 'button-toggle-audio').props.disabled, true);
  assert.equal(f.find(tree, 'checkbox-phone-auto').props.disabled, true);
  f.find(tree, 'checkbox-phone-consent').props.onChange({ target: { checked: true } });
  tree = f.render();
  assert.equal(f.find(tree, 'button-toggle-audio').props.disabled, false);
  assert.equal(f.find(tree, 'checkbox-phone-auto').props.disabled, false);
  f.find(tree, 'button-session-menu').props.onClick();
  tree = f.render();
  assert.equal(f.find(tree, 'checkbox-remote-confirmed'), undefined);
  assert.equal(f.find(tree, 'select-audio-source'), undefined);
  f.props.listening = true;
  tree = f.render();
  assert.ok(f.find(tree, 'phone-live-strip'));
  f.find(tree, 'button-answer-recent').props.onClick();
  assert.deepEqual(f.calls, ['recent']);
  f.props.busy = true;
  tree = f.render();
  assert.equal(f.find(tree, 'button-answer-recent').props.disabled, true);
});

test('phone answer shortcut is configurable, focus-local and does not submit other input fields', () => {
  const f = fixture();
  Object.assign(f.props, {
    inputMode: 'phone', phoneConsent: true, recentPhoneText: 'What is ETL?',
    onAnswerRecent: () => f.calls.push('recent'), answerRecentShortcut: 'alt-enter',
  });
  f.render();
  const key = f.handlers.get('keydown');
  const event = (extra = {}) => ({ key: 'Enter', altKey: true, target: { tagName: 'BUTTON' }, preventDefault() {}, ...extra });
  key(event());
  assert.deepEqual(f.calls, ['recent']);
  key(event({ target: { tagName: 'INPUT', getAttribute: () => 'other' } }));
  assert.deepEqual(f.calls, ['recent']);
  f.props.answerRecentShortcut = 'ctrl-shift-enter'; f.render();
  key(event());
  assert.deepEqual(f.calls, ['recent']);
  key(event({ altKey: false, ctrlKey: true, shiftKey: true }));
  assert.deepEqual(f.calls, ['recent', 'recent']);
  f.props.session.status = 'ended'; f.render();
  key(event({ altKey: false, ctrlKey: true, shiftKey: true }));
  assert.deepEqual(f.calls, ['recent', 'recent']);
});
