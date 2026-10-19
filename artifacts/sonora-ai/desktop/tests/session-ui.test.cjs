const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

function fixture() {
  const calls = [];
  const context = vm.createContext({
    fetch: async (...args) => {
      calls.push(args);
      return { ok: true, json: async () => ({}) };
    },
  });
  const code = buildSync({
    entryPoints: [path.resolve(__dirname, '../../src/lib/answer-preferences.ts')],
    bundle: true, write: false, format: 'iife', globalName: 'subject', platform: 'node',
  }).outputFiles[0].text;
  vm.runInContext(code, context);
  return { subject: context.subject, calls };
}

test('all eight question previews support structured formats, length and tone', () => {
  const { subject } = fixture();
  const base = { ...subject.DEFAULT_ANSWER_PREFERENCES };
  assert.equal(subject.QUESTION_TYPES.length, 8);
  for (const type of subject.QUESTION_TYPES) {
    const short = subject.renderPreview(type, { ...base, length: 'short' });
    const balanced = subject.renderPreview(type, { ...base, length: 'balanced' });
    const long = subject.renderPreview(type, { ...base, length: 'long' });
    assert.ok(short.length < balanced.length && balanced.length < long.length, type);
    assert.ok(subject.renderPreview(type, { ...base, format: 'bullet_points' }).startsWith('- '));
    assert.ok(subject.renderPreview(type, { ...base, format: 'script_bullets' }).includes('\n- '));
    assert.notEqual(subject.renderPreview(type, { ...base, fillerWords: true }), balanced);
  }
  assert.notEqual(subject.renderPreview('Behavioral', { ...base, tone: 'formal' }),
    subject.renderPreview('Behavioral', base));
  assert.ok(subject.renderPreview('Behavioral', { ...base, starMethod: true }).includes('Situation:'));
  assert.ok(!subject.renderPreview('Coding (LeetCode-style)', { ...base, starMethod: true }).includes('Situation:'));
});

test('default preference writes use the authenticated endpoint without account-local storage', async () => {
  const { subject, calls } = fixture();
  await subject.fetchDefaultPreferences();
  await subject.saveDefaultPreferences(subject.DEFAULT_ANSWER_PREFERENCES);
  assert.equal(calls[0][0], '/api/answer-preferences/defaults');
  assert.equal(calls[1][1].method, 'PUT');
  assert.equal(calls[1][1].credentials, 'include');
  assert.deepEqual(JSON.parse(calls[1][1].body), JSON.parse(JSON.stringify(subject.DEFAULT_ANSWER_PREFERENCES)));
});

test('legacy summaries use human labels and preserve compatible lengths', () => {
  const { subject } = fixture();
  assert.equal(subject.sessionPreferences({ answerPreference: 'detailed' }).length, 'long');
  assert.equal(subject.sessionPreferences({ answerPreference: 'concise' }).length, 'short');
  assert.equal(subject.sessionPreferences({ answerPreference: 'technical' }).length, 'balanced');
  assert.ok(subject.summarizePreferences(subject.DEFAULT_ANSWER_PREFERENCES).includes('Full script'));
});
