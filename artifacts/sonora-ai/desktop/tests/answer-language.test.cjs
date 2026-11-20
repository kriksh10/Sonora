const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { transformSync, buildSync } = require('esbuild');

const repo = path.resolve(__dirname, '../../../..');
const server = path.join(repo, 'artifacts/api-server/src');

function loadTs(file) {
  const context = {
    exports: {}, module: { exports: {} }, Buffer, process, require(name) {
      if (name === '@google/genai') return { GoogleGenAI: class {} };
      if (name === '../lib/audio-chunks') return { validateAudioChunk() { return Buffer.alloc(44); } };
      if (name === '../lib/app-access') return { hasApprovedAccess: async () => true };
      throw new Error(`Unexpected import: ${name}`);
    },
  };
  vm.runInNewContext(transformSync(fs.readFileSync(file, 'utf8'), { loader: 'ts', format: 'cjs' }).code, context);
  return context.module.exports;
}

test('Speechmatics keeps accented English on the English model and never auto-detects', () => {
  const speechmatics = loadTs(path.join(server, 'lib/speechmatics.ts'));
  assert.equal(speechmatics.speechmaticsLanguage('English'), 'en');
  assert.equal(speechmatics.speechmaticsLanguage('auto'), 'en');
  assert.equal(speechmatics.speechmaticsLanguage(''), 'en');
  assert.equal(speechmatics.speechmaticsLanguage('Hindi'), 'hi');
  const source = fs.readFileSync(path.join(server, 'lib/speechmatics.ts'), 'utf8');
  const live = fs.readFileSync(path.join(server, 'routes/live-audio.ts'), 'utf8');
  assert.match(source, /language: speechmaticsLanguage\(language\)/);
  assert.doesNotMatch(source, /language_identification/);
  assert.doesNotMatch(source, /language:\s*"auto"/);
  assert.match(live, /openSpeechStream\(session\.language/);
  assert.doesNotMatch(live, /openSpeechStream\(session\.answerLanguage/);
});

test('Gemini transcription fallback stays in the call language and does not translate an accent', () => {
  const stt = loadTs(path.join(server, 'transcription/gemini-stt.ts'));
  const prompt = stt.transcriptionPrompt('English');
  assert.match(prompt, /recognition language is English/);
  assert.match(prompt, /including accented speech/);
  assert.match(prompt, /Do not identify or switch to another language because of accent/);
  assert.match(prompt, /Do not translate the speech/);
  assert.match(prompt, /keep those words as spoken/);
  assert.doesNotMatch(prompt, /\bauto\b/i);
  const route = fs.readFileSync(path.join(server, 'routes/transcription.ts'), 'utf8');
  assert.match(route, /language: session\.language/);
  assert.doesNotMatch(route, /answerLanguage/);
});

test('preparation and mock-interview tools pin the session answer language', () => {
  const language = loadTs(path.join(server, 'lib/answer-language.ts'));
  const instruction = language.toolSystemInstruction(undefined);
  assert.match(instruction, /Answer language: English/);
  assert.match(instruction, /Do not translate the transcript/);
  assert.match(language.toolSystemInstruction('Spanish'), /Answer language: Spanish/);
  const tools = fs.readFileSync(path.join(server, 'routes/session-tools.ts'), 'utf8');
  assert.match(tools, /toolSystemInstruction\(res\.locals\.toolSession\?\.answerLanguage\)/);
  const sessions = fs.readFileSync(path.join(server, 'routes/sessions.ts'), 'utf8');
  assert.match(sessions, /answerLanguageInstruction\(session\.answerLanguage\)/);
  assert.doesNotMatch(sessions, /Respond in \$\{session\.language/);
});

test('a mocked Speechmatics start uses the spoken language code, not answer language', async () => {
  const bundled = buildSync({
    entryPoints: [path.join(server, 'lib/speechmatics.ts')],
    bundle: true, write: false, format: 'cjs', platform: 'node',
  }).outputFiles[0].text;
  let sent;
  class Socket {
    static OPEN = 1;
    readyState = 1; bufferedAmount = 0; listeners = new Map();
    constructor() { setImmediate(() => this.emit('open', {})); }
    addEventListener(event, listener) { const list = this.listeners.get(event) ?? []; list.push(listener); this.listeners.set(event, list); }
    removeEventListener() {}
    emit(event, data) { for (const fn of this.listeners.get(event) ?? []) fn(data); }
    send(data) {
      if (typeof data === 'string' && JSON.parse(data).message === 'StartRecognition') {
        sent = JSON.parse(data);
        setImmediate(() => this.emit('message', { data: '{"message":"RecognitionStarted"}' }));
      }
    }
    close() { this.readyState = 3; this.emit('close', {}); }
  }
  const context = { exports: {}, module: { exports: {} }, Buffer, ArrayBuffer, AbortSignal, WebSocket: Socket,
    setTimeout, clearTimeout, process: { env: { SPEECHMATICS_API_KEY: 'test-placeholder-not-a-real-key' } },
    fetch: async () => ({ ok: true, json: async () => ({ key_value: 'test-ticket' }) }), require };
  vm.runInNewContext(bundled, context);
  const stream = await context.module.exports.openSpeechStream('English', []);
  assert.equal(sent.transcription_config.language, 'en');
  assert.equal(sent.transcription_config.language_identification, undefined);
  stream.close();
  const hindi = await context.module.exports.openSpeechStream('Hindi', []);
  assert.equal(sent.transcription_config.language, 'hi');
  hindi.close();
});
