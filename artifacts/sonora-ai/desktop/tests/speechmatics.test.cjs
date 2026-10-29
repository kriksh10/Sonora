const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');
const code = buildSync({ entryPoints: [path.resolve(__dirname, '../../../api-server/src/lib/speechmatics.ts')],
  bundle: true, write: false, format: 'iife', globalName: 'subject', platform: 'node' }).outputFiles[0].text;

test('provider pushes partials/finals/EOU without another audio send and uses accepted low-latency configuration', async () => {
  let socket;
  class Socket {
    static OPEN = 1;
    readyState = 1; bufferedAmount = 0; listeners = new Map(); sent = [];
    constructor() { socket = this; setImmediate(() => this.emit('open', {})); }
    addEventListener(event, listener) { const list = this.listeners.get(event) ?? []; list.push(listener); this.listeners.set(event, list); }
    removeEventListener(event, listener) { this.listeners.set(event, (this.listeners.get(event) ?? []).filter(l => l !== listener)); }
    emit(event, data) { for (const fn of this.listeners.get(event) ?? []) fn(data); }
    send(data) {
      this.sent.push(data);
      if (typeof data === 'string' && JSON.parse(data).message === 'StartRecognition')
        setImmediate(() => this.emit('message', { data: '{"message":"RecognitionStarted"}' }));
    }
    close() { this.readyState = 3; this.emit('close', {}); }
  }
  const context = vm.createContext({ Buffer, ArrayBuffer, AbortSignal, WebSocket: Socket, setTimeout, clearTimeout,
    process: { env: { SPEECHMATICS_API_KEY: 'test-placeholder-not-a-real-key' } },
    fetch: async () => ({ ok: true, json: async () => ({ key_value: 'test-ticket' }) }) });
  vm.runInContext(code, context);
  const stream = await context.subject.openSpeechStream('English', ['SQL']);
  const config = JSON.parse(socket.sent[0]);
  assert.equal(config.transcription_config.max_delay, .7);
  assert.equal(config.transcription_config.conversation_config.end_of_utterance_silence_trigger, .6);
  assert.equal(config.transcription_config.additional_vocab[0].content, 'SQL');
  const updates = [];
  stream.subscribe(update => updates.push(update));
  socket.emit('message', { data: '{"message":"AddPartialTranscript","metadata":{"transcript":"What is"}}' });
  socket.emit('message', { data: '{"message":"AddTranscript","metadata":{"transcript":"What is SQL?","end_time":1.5}}' });
  socket.emit('message', { data: '{"message":"EndOfUtterance"}' });
  assert.equal(updates[0].partial, 'What is');
  assert.equal(updates[1].text, 'What is SQL?');
  assert.equal(updates[1].endTime, 1.5);
  assert.equal(updates[2].endOfTurn, true);
  stream.endTurn();
  assert.equal(JSON.parse(socket.sent.at(-1)).message, 'ForceEndOfUtterance');
  socket.bufferedAmount = 640001;
  assert.throws(() => stream.send(Buffer.alloc(640)), /cannot keep up/);
  stream.close();
  assert.equal(updates.length, 3);
});
