const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../../public/audio-worklet.js'), 'utf8');
function processor() {
  const messages = [];
  let Processor;
  class Base { constructor() { this.port = { postMessage: data => messages.push(data) }; } }
  vm.runInNewContext(source, { AudioWorkletProcessor: Base, sampleRate: 48000, Float32Array, registerProcessor: (_name, value) => { Processor = value; } });
  return { node: new Processor(), messages };
}
test('worklet makes independent six-second 16 kHz chunks and leaves outputs silent', () => {
  const { node, messages } = processor();
  const input = new Float32Array(48000).fill(0.1);
  const output = new Float32Array(48000);
  for (let i = 0; i < 6; i++) node.process([[input]], [[output]]);
  const chunks = messages.filter(m => m.samples);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].samples.length, 96000);
  assert.equal(chunks[0].endOfTurn, false);
  assert.ok(Math.abs(chunks[0].samples[0] - .2) < .00001);
  assert.equal(messages.filter(m => typeof m.peak === 'number').length, 24);
  assert.ok(output.every(value => value === 0));
});
test('silence skips transcription and warns after 18 seconds', () => {
  const { node, messages } = processor();
  for (let i = 0; i < 18; i++) node.process([[new Float32Array(48000)]]);
  const chunks = messages.filter(m => m.silent);
  assert.equal(chunks.length, 3);
  assert.equal(chunks[0].prolonged, false);
  assert.equal(chunks[2].prolonged, true);
  assert.equal(chunks[2].samples, undefined);
});
test('trailing acoustic silence marks a turn boundary without losing short speech', () => {
  const { node, messages } = processor();
  for (let i = 0; i < 3; i++) node.process([[new Float32Array(48000).fill(.1)]]);
  for (let i = 0; i < 2; i++) node.process([[new Float32Array(48000)]]);
  const chunks = messages.filter(m => m.samples);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].endOfTurn, true);
  assert.equal(chunks[0].samples.length, 80000);
  assert.ok(chunks[0].samples.subarray(0, 48000).some(x => x > 0));
});
test('quiet speech is lifted and near-silence is still skipped', () => {
  const quiet = processor();
  quiet.node.process([[new Float32Array(48000 * 6).fill(0.01)]]);
  const lifted = quiet.messages.find(m => m.samples);
  assert.ok(lifted);
  assert.ok(Math.abs(lifted.samples[0] - 0.08) < 0.00001);
  const silent = processor();
  silent.node.process([[new Float32Array(48000 * 6).fill(0.001)]]);
  assert.equal(silent.messages.some(m => m.samples), false);
  assert.equal(silent.messages.some(m => m.silent), true);
});
test('browser worklet continuously emits 20ms raw frames, including silence, before any WAV-sized clip', () => {
  const { node, messages } = processor();
  node.process([[new Float32Array(48000).fill(.1)]]);
  const frames = messages.filter(m => m.pcm);
  assert.equal(frames.length, 50);
  assert.ok(frames.every(m => m.pcm.length === 320 && Math.abs(m.pcm[0] - .1) < .00001));
  assert.equal(messages.some(m => m.samples), false);
  node.process([[new Float32Array(48000)]]);
  assert.equal(messages.filter(m => m.pcm).length, 100);
  assert.ok(messages.filter(m => m.pcm).at(-1).pcm.every(value => value === 0));
});
