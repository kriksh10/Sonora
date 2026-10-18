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
test('worklet makes independent 6-second 16 kHz chunks and leaves outputs silent', () => {
  const { node, messages } = processor();
  const input = new Float32Array(48000).fill(0.1);
  const output = new Float32Array(48000);
  for (let i = 0; i < 6; i++) node.process([[input]], [[output]]);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].samples.length, 96000);
  assert.ok(Math.abs(messages[0].samples[0] - .1) < .00001);
  assert.ok(output.every(value => value === 0));
});
test('silence skips transcription and warns after 18 seconds', () => {
  const { node, messages } = processor();
  for (let i = 0; i < 18; i++) node.process([[new Float32Array(48000)]]);
  assert.equal(messages.length, 3);
  assert.equal(messages[0].prolonged, false);
  assert.equal(messages[2].prolonged, true);
  assert.equal(messages[2].samples, undefined);
});
