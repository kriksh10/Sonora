const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');
const code = buildSync({ entryPoints: [path.resolve(__dirname, '../../src/lib/continuous-audio.ts')],
  bundle: true, write: false, format: 'iife', globalName: 'subject', platform: 'browser' }).outputFiles[0].text;
const context = vm.createContext({ Float32Array, Uint8Array, ArrayBuffer, DataView, btoa, atob });
vm.runInContext(code, context);
const { createContinuousWindows, createWavOverlap, removeOverlapText } = context.subject;

test('native 10ms frame windows contain every sample and exactly750ms overlap', () => {
  const input = Float32Array.from({ length: 400000 }, (_, i) => .3 + i / 600000);
  const clips = [], collector = createContinuousWindows((samples, overlap) => clips.push({ samples, overlap }));
  for (let i = 0; i < input.length; i += 160) collector.push(input.subarray(i, i + 160));
  assert.equal(clips.length, 4);
  assert.equal(clips[0].overlap, false);
  assert.deepEqual(clips[0].samples, input.slice(0, 96000));
  for (let i = 1; i < clips.length; i++) {
    assert.equal(clips[i].overlap, true);
    assert.equal(clips[i].samples.length, 96000);
    assert.deepEqual(clips[i].samples, input.slice(i * 84000, i * 84000 + 96000));
    assert.deepEqual(clips[i].samples.slice(0, 12000), clips[i - 1].samples.slice(-12000));
  }
  assert.equal(collector.pendingMs(), (400000 - (3 * 84000 + 96000)) / 16);
});

test('joined transcript removes only boundary suffix/prefix words, keeping punctuation and later repetitions', () => {
  assert.equal(removeOverlapText('Explain a process and a thread.', 'And a thread. How do they differ?'), 'How do they differ?');
  assert.equal(removeOverlapText('What is SQL?', 'What is SQL?'), '');
  assert.equal(removeOverlapText('Tell me about SQL.', 'Explain a process.'), 'Explain a process.');
  assert.equal(removeOverlapText('You used SQL.', 'SQL is useful. SQL is useful.'), 'is useful. SQL is useful.');
  const repeatedQuestion = 'Can you explain the difference between a process and a thread?';
  assert.equal(removeOverlapText(repeatedQuestion, repeatedQuestion), repeatedQuestion);
});

test('legacy WAV overlap remains independently decodable and under8s', () => {
  const fixture = Buffer.alloc(44 + 96000 * 2);
  fixture.write('RIFF'); fixture.writeUInt32LE(fixture.length - 8, 4);
  fixture.write('WAVEfmt ', 8); fixture.writeUInt32LE(16, 16); fixture.writeUInt16LE(1, 20);
  fixture.writeUInt16LE(1, 22); fixture.writeUInt32LE(16000, 24); fixture.writeUInt32LE(32000, 28);
  fixture.writeUInt16LE(2, 32); fixture.writeUInt16LE(16, 34); fixture.write('data', 36); fixture.writeUInt32LE(192000, 40);
  const overlap = createWavOverlap();
  const first = overlap(fixture.toString('base64')), second = overlap(fixture.toString('base64'));
  assert.equal(first.overlap, false); assert.equal(first.durationMs, 6000);
  assert.equal(second.overlap, true); assert.equal(second.durationMs, 6750);
  const bytes = Buffer.from(second.audio, 'base64');
  assert.equal(bytes.readUInt32LE(40), bytes.length - 44);
  assert.equal(bytes.length, 216044);
  assert.throws(() => overlap('not valid PCM WAV'));
});
