const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function load(file, globals = {}) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, Date, require, ...globals });
  vm.runInContext(buildSync({
    entryPoints: [path.resolve(__dirname, file)], bundle: true, write: false, format: 'iife',
    platform: 'node', globalName: 'subject', jsx: 'automatic', external: ['react', 'react/jsx-runtime'],
  }).outputFiles[0].text, context);
  return context.subject;
}

test('phone and normal call routing stay distinct: mixed voices never become interviewer identity', () => {
  const { captureSpeaker, mayAutoAnswer } = load('../../src/lib/interview-input.ts');
  assert.equal(captureSpeaker('phone', 'microphone', true), 'unknown');
  assert.equal(captureSpeaker('computer', 'microphone', true), 'candidate');
  assert.equal(captureSpeaker('computer', 'system', false), 'interviewer');
  assert.equal(captureSpeaker('computer', 'system', true), 'interviewer');
  assert.equal(mayAutoAnswer('phone', 'microphone', false, false, true), false);
  assert.equal(mayAutoAnswer('phone', 'microphone', false, true, false), true);
  assert.equal(mayAutoAnswer('phone', 'system', true, true, true), false);
  assert.equal(mayAutoAnswer('computer', 'microphone', true, true, true), false);
  assert.equal(mayAutoAnswer('computer', 'system', false, true, true), true);
  assert.equal(mayAutoAnswer('computer', 'microphone', false, false, true, true), true);
  assert.equal(mayAutoAnswer('computer', 'microphone', false, false, false, true), false);
  assert.equal(mayAutoAnswer('computer', 'system', true, false, true), true);
});

test('recent phone utterance is bounded, expires after silence, and is cleared on submission', () => {
  let now = 1000;
  const { createRecentUtterance } = load('../../src/lib/interview-input.ts');
  const recent = createRecentUtterance(() => now);
  assert.equal(recent.append('Explain'), 'Explain');
  now += 4500;
  assert.equal(recent.append('SQL indexes'), 'Explain SQL indexes');
  assert.equal(recent.take(), 'Explain SQL indexes');
  assert.equal(recent.take(), '');
  recent.append('Old conversation');
  now += 13000;
  assert.equal(recent.append('New question'), 'New question');
  assert.equal(recent.append('x'.repeat(9000)).length, 8000);
  recent.clear(); assert.equal(recent.take(), '');
});

test('mixed-audio automation requires opt-in, silence speeds complete questions, reset invalidates waiting work', async () => {
  const timers = new Map(), answers = [], waits = [];
  let id = 0;
  const { createInterviewerQuestions } = load('../../src/lib/interviewer-questions.ts');
  const q = createInterviewerQuestions({
    answer: async (text, _at, isCurrent) => {
      await new Promise(resolve => waits.push(resolve));
      if (isCurrent()) answers.push(text);
    }, notice() {},
    setTimer: (fn, ms) => { timers.set(++id, { fn, ms }); return id; },
    clearTimer: id => timers.delete(id),
  });
  q.pushMixed('What is ETL?', false, true);
  q.push('Explain SQL', 'candidate', true);
  assert.equal(timers.size, 0);
  q.pushMixed('Explain SQL indexes', true, true);
  const ready = [...timers.values()].find(t => t.ms === 350);
  assert.ok(ready);
  ready.fn();
  q.reset();
  waits.shift()();
  await new Promise(setImmediate);
  assert.deepEqual(answers, []);
  q.pushMixed('Explain ETL pipelines', true, true);
  [...timers.values()].find(t => t.ms === 350).fn();
  waits.shift()();
  await new Promise(setImmediate);
  assert.deepEqual(answers, ['Explain ETL pipelines']);
});

test('timings describe measured stages, never claim an unmeasured acoustic question-end time', () => {
  const { firstTextTiming } = load('../../src/lib/live-timing.ts');
  assert.equal(firstTextTiming(1000, undefined, 2200), 'First text 1.2s after Ask');
  assert.equal(firstTextTiming(2000, 500, 3500), 'First text 3.0s after speech was transcribed · answer request 1.5s');
});

test('answer Markdown formats readable emphasis, lists and code without executing HTML or links', () => {
  const Component = load('../../src/components/safe-markdown.tsx').default;
  const html = renderToStaticMarkup(React.createElement(Component, {
    text: '**Transform**\n\n- Clean data\n- Standardize values\n\n```sql\nSELECT * FROM data;\n```\n\n<script>alert(1)</script> [click](javascript:alert(1))',
  }));
  assert.match(html, /<strong>Transform<\/strong>/);
  assert.match(html, /<ul><li>Clean data<\/li><li>Standardize values<\/li><\/ul>/);
  assert.match(html, /<pre><code>SELECT/);
  assert.doesNotMatch(html, /<script>|<a |dangerouslySetInnerHTML/);
  assert.match(html, /&lt;script&gt;/);
});
