const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const vm = require('node:vm');
const { buildSync } = require('esbuild');
const { listAudioDevices, validDeviceName } = require('../audio-devices.cjs');
const { createNativeAudioHost } = require('../native-audio-host.cjs');
const { EventEmitter } = require('node:events');

function load(relative) {
  const context = vm.createContext({ console, setTimeout, clearTimeout, setInterval, clearInterval, Date });
  vm.runInContext(buildSync({
    entryPoints: [path.resolve(__dirname, relative)], bundle: true, write: false,
    platform: 'node', format: 'iife', globalName: 'subject',
  }).outputFiles[0].text, context);
  return context.subject;
}

test('output discovery uses a fixed helper, bounded no-shell execution, and validates returned local names', async () => {
  const devices = await listAudioDevices('/fixed/helper.exe', 'system', (binary, args, options, done) => {
    assert.equal(binary, '/fixed/helper.exe');
    assert.deepEqual(args, ['--list-devices', 'system']);
    assert.equal(options.shell, false);
    assert.equal(options.timeout, 10000);
    assert.equal(options.env.CLERK_SECRET_KEY, undefined);
    done(null, '{"devices":["Headset","Speakers","Headset"]}');
  });
  assert.deepEqual(devices, ['Headset', 'Speakers']);
  await assert.rejects(listAudioDevices('/fixed/helper', 'arbitrary'), /Invalid/);
  await assert.rejects(listAudioDevices('/fixed/helper', 'system', (_b, _a, _o, done) => done(null, '{"devices":["bad\\nname"]}')), /invalid device list/);
  await assert.rejects(listAudioDevices('/fixed/helper', 'system', (_b, _a, _o, done) => done(new Error())), /updated desktop/);
  for (const value of ['', undefined, 'bad\nname', 'x'.repeat(1025)]) assert.equal(validDeviceName(value), false);
});

test('chosen output name reaches the native helper as one argument and invalid names never launch', async () => {
  let child;
  const host = createNativeAudioHost({
    binary: '/fixed/helper', confirm: async () => true, checkBinary() {}, emit() {}, onActive() {},
    spawnProcess(_binary, args) {
      assert.deepEqual(args, ['--source', 'system', '--device-name', 'Headset & Speakers']);
      child = new EventEmitter();
      child.stdin = new EventEmitter(); child.stdin.end = () => {};
      child.stdout = new EventEmitter(); child.kill = () => child.emit('close');
      queueMicrotask(() => child.stdout.emit('data', Buffer.from('{"type":"ready","protocol":2}\n')));
      return child;
    },
  });
  const id = '11111111-1111-4111-8111-111111111111';
  await assert.rejects(host.start(id, 'system', 'bad\narg'), /Invalid audio device/);
  await host.start(id, 'system', 'Headset & Speakers');
  host.shutdown();
});

test('backlog pacing keeps each source above the server interval without blocking the other source', () => {
  let now = 10000;
  const { createTranscriptionPacing } = load('../../src/lib/transcription-pacing.ts');
  const pacing = createTranscriptionPacing(() => now);
  assert.equal(pacing.remaining('system'), 0);
  pacing.mark('system');
  now += 500;
  assert.equal(pacing.remaining('system'), 3600);
  assert.equal(pacing.remaining('microphone'), 0);
  now += 3600;
  assert.equal(pacing.remaining('system'), 0);
  pacing.mark('system');
  assert.equal(pacing.remaining('system'), 4100);
});

test('stopping capture aborts a queued transcription wait immediately', async () => {
  const { waitForTranscription } = load('../../src/lib/transcription-pacing.ts');
  const controller = new AbortController();
  const waiting = waitForTranscription(10000, controller.signal);
  controller.abort(new Error('stopped'));
  await assert.rejects(waiting, /stopped/);
});

test('natural interviewer requests are recognized without admitting common audio checks or candidate speech', () => {
  const { isInterviewQuestion, createInterviewerQuestions } = load('../../src/lib/interviewer-questions.ts');
  for (const text of [
    "I'd like you to explain how you would scale this service",
    "Please compare SQL and NoSQL",
    "Our question is about cache invalidation",
    "Based on that, could you describe a recovery strategy",
    "Tell us about managing production incidents",
    "Let's discuss caching",
    "Have you worked with distributed systems",
  ]) assert.equal(isInterviewQuestion(text), true, text);
  for (const text of ['Can you hear me?', 'Thank you', 'Okay', 'How are you?']) assert.equal(isInterviewQuestion(text), false, text);
  const timers = [];
  const questions = createInterviewerQuestions({ answer: async () => assert.fail('Candidate must not auto-answer'), notice() {},
    setTimer: fn => { timers.push(fn); return timers.length; }, clearTimer() {} });
  questions.push('Please explain database indexing', 'candidate');
  questions.push('Please explain database indexing', 'unknown');
  assert.equal(timers.length, 0);
});

test('missing-resume policy requires experienced knowledge answers, selected length and no fabricated biography', () => {
  const { interviewAnswerPolicy: policy } = load('../../../api-server/src/lib/interview-answer-policy.ts');
  assert.match(policy, /even if the topic is absent from the resume/);
  assert.match(policy, /trade-offs/);
  assert.match(policy, /selected answer length/);
  assert.match(policy, /Do not invent the candidate's experience/);
  assert.match(policy, /clearly labeled hypothetical example/);
  assert.match(policy, /Do not stop at a missing-resume disclaimer/);
});
