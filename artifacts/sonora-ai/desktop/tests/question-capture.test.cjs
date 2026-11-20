const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('esbuild');

function load(relative) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, performance: { now: () => 0 }, Date });
  vm.runInContext(buildSync({
    entryPoints: [path.resolve(__dirname, relative)], bundle: true, write: false,
    platform: 'node', format: 'iife', globalName: 'subject',
  }).outputFiles[0].text, context);
  return context.subject;
}

/** Fake timers. Speechmatics and the answer model are not called. */
function questions() {
  let now = 0, next = 0;
  const timers = new Map(), sent = [], notices = [];
  const { createInterviewerQuestions } = load('../../src/lib/interviewer-questions.ts');
  const router = createInterviewerQuestions({
    answer: async text => { sent.push(text); },
    notice: text => notices.push(text),
    clock: () => now,
    setTimer: (fn, delay) => { const id = ++next; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimer: id => timers.delete(id),
  });
  function advance(ms) {
    const target = now + ms;
    while (true) {
      const entry = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry || entry[1].at > target) break;
      now = entry[1].at; timers.delete(entry[0]); entry[1].fn();
    }
    now = target;
  }
  return { router, sent, notices, advance };
}

const LONG_QUESTION = 'Can you walk me through how you designed the cache? I want the tradeoffs you considered. Then tell me how you would change it for a larger region, including the failure mode you would test first.';

test('a long question with pauses stays one question and is not answered from the first sentence', () => {
  const q = questions();
  q.router.push('Can you walk me through how you designed the cache?', 'interviewer', true);
  q.advance(400);
  assert.equal(q.sent.length, 0);
  q.router.push('I want the tradeoffs you considered.', 'interviewer', true);
  q.advance(400);
  q.router.push('Then tell me how you would change it for a larger region, including the failure mode you would test first.', 'interviewer', true);
  q.advance(400);
  assert.equal(q.sent.length, 0);
  q.advance(900);
  assert.deepEqual(q.sent, [LONG_QUESTION]);
});

test('a two-part question spoken across a breath is sent whole', () => {
  const q = questions();
  q.router.push('What happened during the outage', 'interviewer', true);
  q.advance(700);
  q.router.push('and what would you do differently next time?', 'interviewer', true);
  q.advance(1300);
  assert.deepEqual(q.sent, ['What happened during the outage and what would you do differently next time?']);
});

test('questions that arrive while an answer is running are queued in full', async () => {
  let release = () => {};
  const sent = [];
  const { createInterviewerQuestions } = load('../../src/lib/interviewer-questions.ts');
  const router = createInterviewerQuestions({
    answer: text => { sent.push(text); return new Promise(resolve => { release = resolve; }); },
    notice() {},
    setTimer: fn => { fn(); return 1; },
    clearTimer() {},
  });
  const first = 'How did you design the first service, including the data model and the rollout?';
  const second = 'Why did you choose that cache, and what did you measure afterwards?';
  router.push(first, 'interviewer', true);
  await Promise.resolve();
  router.push(second, 'interviewer', true);
  assert.deepEqual(sent, [first]);
  release();
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(sent, [first, second]);
});

test('accented filler does not remove the rest of the interviewer question', () => {
  const q = questions();
  q.router.push('Um, so, can you explain me how the queue is working, and why we are using it for this service?', 'interviewer', true);
  q.advance(1300);
  assert.equal(q.sent.length, 1);
  assert.match(q.sent[0], /how the queue is working, and why we are using it for this service/);
});

test('mocked Speechmatics keeps a long final instead of cutting it at 4000 characters', async () => {
  const source = fs.readFileSync(path.resolve(__dirname, '../../../api-server/src/lib/speechmatics.ts'), 'utf8');
  assert.match(source, /slice\(0, 8_000\)/);
  assert.doesNotMatch(source, /slice\(0, 4_000\)/);
  assert.match(source, /end_of_utterance_silence_trigger: 1\.2/);
  let holder, started;
  class Socket {
    static OPEN = 1;
    readyState = 1; bufferedAmount = 0; listeners = new Map();
    constructor() { holder = this; setImmediate(() => this.emit('open', {})); }
    addEventListener(event, listener) { const list = this.listeners.get(event) ?? []; list.push(listener); this.listeners.set(event, list); }
    removeEventListener() {}
    emit(event, data) { for (const fn of this.listeners.get(event) ?? []) fn(data); }
    send(data) {
      if (typeof data === 'string' && JSON.parse(data).message === 'StartRecognition') {
        started = JSON.parse(data);
        setImmediate(() => this.emit('message', { data: '{"message":"RecognitionStarted"}' }));
      }
    }
    close() { this.readyState = 3; this.emit('close', {}); }
  }
  const bundled = buildSync({
    entryPoints: [path.resolve(__dirname, '../../../api-server/src/lib/speechmatics.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node',
  }).outputFiles[0].text;
  const context = { exports: {}, module: { exports: {} }, Buffer, ArrayBuffer, AbortSignal, WebSocket: Socket,
    setTimeout, clearTimeout, process: { env: { SPEECHMATICS_API_KEY: 'test-placeholder-not-a-real-key' } },
    fetch: async () => ({ ok: true, json: async () => ({ key_value: 'test-ticket' }) }), require };
  vm.runInNewContext(bundled, context);
  const heard = [];
  const live = await context.module.exports.openSpeechStream('English', []);
  live.subscribe(update => heard.push(update));
  assert.equal(started.transcription_config.max_delay, 0.7);
  assert.equal(started.transcription_config.conversation_config.end_of_utterance_silence_trigger, 1.2);
  const long = `${'Please describe the full design of this service. '.repeat(120)}What would you change?`;
  assert.ok(long.length > 4000 && long.length < 8000);
  holder.emit('message', { data: JSON.stringify({ message: 'AddPartialTranscript', metadata: { transcript: 'Please describe' } }) });
  holder.emit('message', { data: JSON.stringify({ message: 'AddTranscript', metadata: { transcript: long } }) });
  holder.emit('message', { data: JSON.stringify({ message: 'EndOfUtterance' }) });
  assert.equal(heard.find(item => item.final).text, long);
  assert.equal(heard.at(-1).endOfTurn, true);
  live.close();
});

test('mocked model prompt receives the full captured question, not a shortened window', async () => {
  // This mocks Gemini. No provider is called.
  const serverRoot = path.resolve(__dirname, '../../../api-server/src');
  function loadTs(file, requireModule) {
    const context = { exports: {}, module: { exports: {} }, require: requireModule, Buffer, Date, Set,
      process: { env: { AI_INTEGRATIONS_GEMINI_BASE_URL: 'https://test.invalid', AI_INTEGRATIONS_GEMINI_API_KEY: 'unit-test-only' } },
      setTimeout, clearTimeout, AbortController };
    vm.runInNewContext(buildSync({ entryPoints: [file], bundle: false, write: false, format: 'cjs', platform: 'node' }).outputFiles[0].text, context);
    return context.module.exports;
  }
  const validators = loadTs(path.resolve(__dirname, '../../../../lib/api-zod/src/generated/api.ts'), require);
  const requests = [];
  const handlers = new Map();
  const rows = [];
  const id = '550e8400-e29b-41d4-a716-446655440000';
  const sessionTable = Object.fromEntries(['id', 'userId', 'status', 'saveTranscript', 'transcript', 'roundNumber'].map(key => [key, key]));
  const matches = (row, expr) => !expr || (expr.and ? expr.and.every(item => matches(row, item)) : expr.sql ? row.status !== 'ended' : row[expr.key] === expr.value);
  const db = {
    select: () => ({ from: () => ({ where: expr => ({ limit: async () => rows.filter(row => matches(row, expr)).slice(0, 1) }) }) }),
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
  };
  const router = { param() {}, post(url, handler) { handlers.set(url, handler); }, get() {}, patch() {}, put() {} };
  loadTs(path.join(serverRoot, 'routes/sessions.ts'), name => {
    if (name === 'express') return { Router: () => router };
    if (name === '@clerk/express') return { getAuth: () => ({ userId: 'user-a' }) };
    if (name === '@workspace/db') return { db, callSessionsTable: sessionTable, answerDefaultsTable: {} };
    if (name === '@workspace/api-zod') return validators;
    if (name === '../lib/answer-preferences') return loadTs(path.join(serverRoot, 'lib/answer-preferences.ts'), require);
    if (name === '../lib/answer-language') return loadTs(path.join(serverRoot, 'lib/answer-language.ts'), require);
    if (name === '../lib/interview-answer-policy') return loadTs(path.join(serverRoot, 'lib/interview-answer-policy.ts'), require);
    if (name === '../lib/answer-context') return loadTs(path.join(serverRoot, 'lib/answer-context.ts'), require);
    if (name === '../lib/job-page') return { readPublicJobPage: async () => '' };
    if (name === '../lib/session-lifecycle') return {
      roundMatches: () => true, approvedWriteCondition: () => ({ sql: true }), watchSession: () => () => {},
      stopSessionOperations() {}, sessionStillUsable: async () => true,
    };
    if (name === '../lib/logger') return { logger: { error() {} } };
    if (name === '../lib/gemini-answer') return loadTs(path.join(serverRoot, 'lib/gemini-answer.ts'), () => { throw new Error('unexpected'); });
    if (name === './session-create-title') return { titleForNewSession: () => 'Live call' };
    if (name === 'drizzle-orm') return { and: (...and) => ({ and }), or: (...or) => ({ or }), eq: (key, value) => ({ key, value }), desc: value => value, sql: () => ({ sql: true }) };
    if (name === '@google/genai') return { GoogleGenAI: class { models = { generateContent: async request => { requests.push(request); return { text: 'Use a queue so each job runs once.' }; }, generateContentStream: async () => { throw new Error('not used'); } }; } };
    throw new Error(`Unexpected import: ${name}`);
  });
  rows.push({
    id, userId: 'user-a', status: 'active', sessionType: 'call', title: 'Live interview',
    model: 'gemini-2.5-flash', language: 'English', answerLanguage: 'English', saveTranscript: false,
    transcript: Array.from({ length: 20 }, (_item, index) => ({ role: 'user', speaker: 'interviewer', source: 'system', text: `Earlier point ${index} about the cache design.` })),
  });
  const response = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; }, setHeader() {}, on() {}, off() {} };
  await handlers.get('/sessions/:id/answer')({ params: { id }, body: { question: LONG_QUESTION } }, response, error => { throw error; });
  assert.equal(response.code, 200);
  assert.equal(response.body.answer, 'Use a queue so each job runs once.');
  assert.equal(requests.length, 1);
  assert.ok(requests[0].contents.includes(LONG_QUESTION));
  assert.ok(requests[0].contents.includes('Earlier point 0 about the cache design.'));
  assert.match(requests[0].config.systemInstruction, /Answer language: English/);
});
