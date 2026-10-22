const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { transformSync } = require('esbuild');
const { EventEmitter } = require('node:events');

const serverRoot = path.resolve(__dirname, '../../../api-server/src');
function loadTs(file, requireModule) {
  const context = { exports: {}, module: { exports: {} }, require: requireModule, Buffer, Date, Set,
    process: { env: { AI_INTEGRATIONS_GEMINI_BASE_URL: 'https://test.invalid', AI_INTEGRATIONS_GEMINI_API_KEY: 'unit-test-only' } },
    setTimeout, clearTimeout, AbortController };
  vm.runInNewContext(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, context);
  return context.module.exports;
}
const validatorsPath = path.resolve(__dirname, '../../../../lib/api-zod/src/generated/api.ts');
const validators = loadTs(validatorsPath, createRequire(validatorsPath));
const preferences = loadTs(path.join(serverRoot, 'lib/answer-preferences.ts'), require);
const standard = () => ({ ...preferences.standardAnswerPreferences });
const plain = value => JSON.parse(JSON.stringify(value));
const id = '550e8400-e29b-41d4-a716-446655440000';

test('audio source and speaker metadata persist, remain owner-scoped, and reach Gemini without relabeling legacy speech', async () => {
  const f = fixture();
  f.rows.push({ id, userId: 'user-a', status: 'active', saveTranscript: true, answerPreference: 'concise',
    transcript: [{ role: 'user', source: 'microphone', text: 'Legacy', createdAt: '2026-10-19T11:00:00.000Z' }] });
  const entry = { role: 'user', source: 'system', speaker: 'interviewer', text: 'Why this design?', capturedAt: '2026-10-19T12:00:00.000Z' };
  assert.equal((await f.call('post', '/sessions/:id/transcript', entry, 'user-b')).code, 404);
  const response = await f.call('post', '/sessions/:id/transcript', entry);
  assert.equal(response.code, 200);
  assert.equal(f.rows[0].transcript[0].speaker, undefined);
  assert.equal(f.rows[0].transcript[1].source, 'system');
  assert.equal(f.rows[0].transcript[1].speaker, 'interviewer');
  assert.equal(f.rows[0].transcript[1].capturedAt, entry.capturedAt);
  for (const invalid of [{ ...entry, source: 'mixed' }, { ...entry, speaker: 'person-1' }, { ...entry, capturedAt: 'yesterday' }]) {
    assert.equal((await f.call('post', '/sessions/:id/transcript', invalid)).code, 400);
  }
  await f.call('post', '/sessions/:id/answer', { question: entry.text });
  assert.ok(f.requests[0].contents.includes('Interviewer [system]: Why this design'));
  assert.ok(f.requests[0].contents.includes('Unknown speaker [microphone]: Legacy'));
  const count = f.rows[0].transcript.length;
  f.rows[0].saveTranscript = false;
  await f.call('post', '/sessions/:id/transcript', entry);
  assert.equal(f.rows[0].transcript.length, count);
});

test('ending wins over late activation; repeated activation cannot reset the start time', async () => {
  const f = fixture();
  f.rows.push({ id, userId: 'user-a', status: 'ready', transcript: [], saveTranscript: true });
  assert.equal((await f.call('patch', '/sessions/:id', { status: 'active' })).code, 200);
  const startedAt = f.rows[0].startedAt;
  assert.equal((await f.call('patch', '/sessions/:id', { status: 'active' })).code, 200);
  assert.equal(f.rows[0].startedAt, startedAt);
  assert.equal((await f.call('patch', '/sessions/:id', { status: 'ended' })).code, 200);
  assert.equal((await f.call('patch', '/sessions/:id', { status: 'active' })).code, 400);
  assert.equal((await f.call('patch', '/sessions/:id', { status: 'ready' })).code, 400);
  assert.equal(f.rows[0].status, 'ended');
  assert.equal((await f.call('patch', '/sessions/:id', { status: 'active' }, 'other-user')).code, 404);
});

function fixture(options = {}) {
  const handlers = new Map(), rows = [], defaults = [], requests = [];
  const sessionTable = Object.fromEntries(['id', 'userId', 'status', 'saveTranscript', 'transcript', 'createdAt', 'roundNumber'].map(k => [k, k]));
  const defaultsTable = { userId: 'userId', preferences: 'preferences' };
  const collection = table => table === sessionTable ? rows : defaults;
  const matches = (row, expr) => !expr || (expr.and ? expr.and.every(e => matches(row, e))
    : expr.or ? expr.or.some(e => matches(row, e))
    : expr.sql ? row.status !== 'ended'
    : (expr.key === 'roundNumber' ? row.roundNumber ?? 1 : row[expr.key]) === expr.value);
  const db = {
    select: () => ({ from: table => ({
      where: expr => {
        const found = () => collection(table).filter(row => matches(row, expr));
        return { limit: async n => found().slice(0, n), orderBy: async () => found() };
      },
    }) }),
    insert: table => ({ values: value => ({
      returning: async () => {
        const row = { id, status: 'ready', transcript: [], ...value };
        collection(table).push(row);
        return [row];
      },
      onConflictDoUpdate: async ({ set }) => {
        const existing = collection(table).find(row => row.userId === value.userId);
        if (existing) Object.assign(existing, set);
        else collection(table).push(value);
      },
    }) }),
    update: table => ({ set: changes => ({ where: expr => {
      const apply = () => {
        const found = collection(table).filter(row => matches(row, expr));
        for (const row of found) {
          for (const [key, value] of Object.entries(changes)) {
            if (value?.sql) {
              if (key === 'transcript' && row.saveTranscript) {
                const json = value.values.find(v => typeof v === 'string' && v.startsWith('[{'));
                if (json) row.transcript = [...row.transcript, ...JSON.parse(json)];
              }
            } else row[key] = value;
          }
        }
        return found;
      };
      return { returning: async () => apply(), then: (resolve, reject) => Promise.resolve().then(apply).then(resolve, reject) };
    } }) }),
  };
  const router = { param() {} };
  for (const method of ['get', 'post', 'patch', 'put']) {
    router[method] = (url, handler) => { handlers.set(`${method} ${url}`, handler); };
  }
  loadTs(path.join(serverRoot, 'routes/sessions.ts'), name => {
    if (name === 'express') return { Router: () => router };
    if (name === '@clerk/express') return { getAuth: req => ({ userId: req.testUser }) };
    if (name === '@workspace/db') return { db, callSessionsTable: sessionTable, answerDefaultsTable: defaultsTable };
    if (name === '@workspace/api-zod') return validators;
    if (name === '../lib/answer-preferences') return preferences;
    if (name === '../lib/interview-answer-policy') return loadTs(path.join(serverRoot, 'lib/interview-answer-policy.ts'), require);
    if (name === '../lib/answer-context') return loadTs(path.join(serverRoot, 'lib/answer-context.ts'), require);
    if (name === '../lib/job-page') return loadTs(path.join(serverRoot, 'lib/job-page.ts'), require);
    if (name === '../lib/session-lifecycle') return {
      roundMatches: (current, requested) => (current ?? 1) === (requested ?? 1),
      approvedWriteCondition: () => ({ sql: 'approved account' }),
      watchSession: () => () => {}, stopSessionOperations() {},
      sessionStillUsable: async (sessionId, userId, round) => rows.some(row => row.id === sessionId && row.userId === userId && row.status !== 'ended' && (row.roundNumber ?? 1) === round),
    };
    if (name === '../lib/logger') return { logger: { error() {} } };
    if (name === 'drizzle-orm') return {
      and: (...and) => ({ and }), or: (...or) => ({ or }), eq: (key, value) => ({ key, value }), desc: value => value,
      sql: (strings, ...values) => ({ sql: strings.join(''), values }),
    };
    if (name === '@google/genai') return { GoogleGenAI: class {
      models = {
        generateContent: async request => { requests.push(request); return { text: 'Test answer' }; },
        generateContentStream: async request => {
          requests.push(request);
          return (async function* () {
            yield { text: 'Test ' };
            options.betweenChunks?.();
            if (options.failStream) throw new Error('Provider interrupted');
            yield { text: 'answer' };
          })();
        },
      };
    } };
    throw new Error(`Unexpected import: ${name}`);
  });
  async function call(method, route, body, user = 'user-a') {
    const response = Object.assign(new EventEmitter(), {
      code: 200, frames: [], headers: {}, headersSent: false, writableEnded: false,
      status(code) { this.code = code; return this; },
      json(data) { this.body = plain(data); this.writableEnded = true; return this; },
      setHeader(name, value) { this.headers[name] = value; },
      flushHeaders() { this.headersSent = true; },
      write(value) { this.frames.push(value); options.onWrite?.(this, value); return true; },
      end() { this.writableEnded = true; return this; },
    });
    await handlers.get(`${method} ${route}`)({ testUser: user, params: { id }, body }, response, error => { throw error; });
    return response;
  }
  return { call, rows, defaults, requests };
}

test('streamed answers emit real chunks and one completion, persist once, and accept contextual answer actions', async () => {
  const f = fixture();
  f.rows.push({ id, userId: 'user-a', status: 'active', saveTranscript: true, transcript: [] });
  const response = await f.call('post', '/sessions/:id/answer', { question: 'Explain an API', stream: true, action: 'shorten', previousAnswer: 'An earlier answer' });
  assert.equal(response.code, 200);
  assert.equal(response.headers['Content-Type'], 'text/event-stream');
  const events = response.frames.map(frame => JSON.parse(frame.slice(6)));
  assert.deepEqual(events.map(e => e.content).filter(Boolean), ['Test ', 'answer']);
  assert.equal(events.at(-1).done, true);
  assert.equal(events.at(-1).answer, 'Test answer');
  assert.equal(f.rows[0].transcript.filter(t => t.role === 'assistant').length, 1);
  assert.ok(f.requests[0].contents.includes('An earlier answer'));
  assert.ok(f.requests[0].contents.includes('more briefly'));
});

test('readiness tests and Save Transcript disabled during streaming never store an assistant answer', async () => {
  const f = fixture();
  f.rows.push({ id, userId: 'user-a', status: 'ready', saveTranscript: true, transcript: [] });
  await f.call('post', '/sessions/:id/answer', { question: 'API check', stream: true, test: true });
  assert.equal(f.rows[0].transcript.length, 0);
  const edited = fixture({ betweenChunks() { edited.rows[0].saveTranscript = false; } });
  edited.rows.push({ id, userId: 'user-a', status: 'active', saveTranscript: true, transcript: [] });
  await edited.call('post', '/sessions/:id/answer', { question: 'API check', stream: true });
  assert.equal(edited.rows[0].transcript.length, 0);
});

test('interrupted or disconnected streams do not save partial output and release the generation lane', async () => {
  const f = fixture({ failStream: true });
  f.rows.push({ id, userId: 'user-a', status: 'active', saveTranscript: true, transcript: [] });
  const failed = await f.call('post', '/sessions/:id/answer', { question: 'API check', stream: true });
  assert.ok(failed.frames.at(-1).includes('interrupted'));
  assert.equal(f.rows[0].transcript.length, 0);
  assert.equal((await f.call('post', '/sessions/:id/answer', { question: 'API check' })).code, 200);
  const disconnect = fixture({ onWrite(response) { response.emit('close'); } });
  disconnect.rows.push({ id, userId: 'user-a', status: 'active', saveTranscript: true, transcript: [] });
  const stopped = await disconnect.call('post', '/sessions/:id/answer', { question: 'API check', stream: true });
  assert.equal(stopped.frames.length, 1);
  assert.equal(disconnect.rows[0].transcript.length, 0);
});

test('answer actions and stream access retain validation and owner restrictions', async () => {
  const f = fixture();
  f.rows.push({ id, userId: 'user-a', status: 'active', transcript: [] });
  assert.equal((await f.call('post', '/sessions/:id/answer', { question: 'API', stream: true }, 'user-b')).code, 404);
  assert.equal((await f.call('post', '/sessions/:id/answer', { question: 'API', action: 'shorten' })).code, 400);
  assert.equal((await f.call('post', '/sessions/:id/answer', { question: 'API', action: 'invent' })).code, 400);
  assert.equal((await f.call('post', '/sessions/:id/answer', { question: 'API', previousAnswer: 'x'.repeat(24001) })).code, 400);
});

test('legacy sessions get compatible structured preferences without changing stored data', () => {
  for (const [legacy, expected] of [['concise', 'short'], ['detailed', 'long'], ['technical', 'balanced']]) {
    const session = { answerPreference: legacy, answerPreferences: null };
    const normalized = preferences.withAnswerPreferences(session);
    assert.equal(normalized.answerPreferences.length, expected);
    assert.equal(session.answerPreferences, null);
  }
});

test('all five independent settings reach actual answer instructions', () => {
  const text = preferences.answerPreferenceInstructions({ format: 'script_bullets', length: 'long',
    tone: 'formal', starMethod: true, fillerWords: true });
  for (const expected of ['opening line', '180–300', 'professional', 'Situation, Task, Action, Result', 'sparingly']) {
    assert.ok(text.includes(expected), expected);
  }
  const other = preferences.answerPreferenceInstructions({ format: 'bullet_points', length: 'short',
    tone: 'simple', starMethod: false, fillerWords: false });
  for (const expected of ['bullet points only', '40–80', 'plain words', 'Do not force', 'Avoid filler']) {
    assert.ok(other.includes(expected), expected);
  }
});

test('defaults and settings require authentication; invalid and empty changes are rejected', async () => {
  const f = fixture();
  for (const [method, route, body] of [
    ['get', '/answer-preferences/defaults', undefined],
    ['put', '/answer-preferences/defaults', standard()],
    ['patch', '/sessions/:id/preferences', { answerPreferences: standard() }],
  ]) assert.equal((await f.call(method, route, body, null)).code, 401);
  for (const body of [{}, { status: 'ended' }, { answerPreferences: { ...standard(), length: 'huge' } },
    { autoAnswer: 'true' }, { instructions: 'x'.repeat(8001) }]) {
    assert.equal((await f.call('patch', '/sessions/:id/preferences', body)).code, 400);
  }
});

test('defaults are per-user, affect new sessions, and do not rewrite existing sessions', async () => {
  const f = fixture();
  const saved = { ...standard(), tone: 'formal', length: 'long' };
  assert.equal((await f.call('put', '/answer-preferences/defaults', saved)).code, 200);
  assert.deepEqual((await f.call('get', '/answer-preferences/defaults')).body, saved);
  assert.deepEqual((await f.call('get', '/answer-preferences/defaults', undefined, 'user-b')).body, standard());
  const created = await f.call('post', '/sessions', { sessionType: 'interview', company: 'Test' });
  assert.deepEqual(created.body.answerPreferences, saved);
  await f.call('put', '/answer-preferences/defaults', standard());
  assert.deepEqual(f.rows[0].answerPreferences, saved);
});

test('mid-call edits persist only to the owner and do not change status or transcript', async () => {
  const f = fixture();
  f.rows.push({ id, userId: 'user-a', status: 'active', transcript: [{ text: 'Prior' }], answerPreference: 'concise' });
  const settings = { answerPreferences: { ...standard(), format: 'bullet_points' }, instructions: '',
    saveTranscript: false, autoAnswer: true, language: 'French', model: 'gemini-2.5-flash' };
  assert.equal((await f.call('patch', '/sessions/:id/preferences', settings, 'user-b')).code, 404);
  const edited = await f.call('patch', '/sessions/:id/preferences', settings);
  assert.equal(edited.body.status, 'active');
  assert.deepEqual(edited.body.transcript, [{ text: 'Prior' }]);
  assert.equal(edited.body.saveTranscript, false);
  assert.deepEqual(edited.body.answerPreferences, settings.answerPreferences);
  const reopened = await f.call('get', '/sessions/:id');
  assert.deepEqual(reopened.body.answerPreferences, settings.answerPreferences);
});

test('Regular Call ignores hidden resume context and Gemini receives the saved preferences', async () => {
  const f = fixture();
  await f.call('post', '/sessions', { sessionType: 'call', resumeText: 'Must not leak', saveTranscript: false,
    answerPreferences: { ...standard(), tone: 'formal', format: 'script_bullets' } });
  assert.equal(f.rows[0].resumeText, '');
  const response = await f.call('post', '/sessions/:id/answer', { question: 'Explain the approach?' });
  assert.equal(response.code, 200);
  assert.equal(f.requests.length, 1);
  assert.ok(f.requests[0].config.systemInstruction.includes('professional wording'));
  assert.ok(f.requests[0].config.systemInstruction.includes('opening line'));
  assert.ok(!f.requests[0].contents.includes('Must not leak'));
  assert.deepEqual(f.rows[0].transcript, []);
});

test('Save Transcript off prevents transcript append, including at the SQL write boundary', async () => {
  const f = fixture();
  f.rows.push({ id, userId: 'user-a', saveTranscript: false, transcript: [], answerPreference: 'concise' });
  const response = await f.call('post', '/sessions/:id/transcript', { text: 'Private', role: 'user', source: 'typed' });
  assert.equal(response.code, 200);
  assert.deepEqual(f.rows[0].transcript, []);
});
