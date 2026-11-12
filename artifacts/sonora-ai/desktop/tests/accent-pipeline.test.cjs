const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const app = path.resolve(__dirname, '../..');
const repo = path.resolve(__dirname, '../../../..');
const worklet = fs.readFileSync(path.join(app, 'public/audio-worklet.js'), 'utf8');
const speech = fs.readFileSync(path.join(repo, 'artifacts/api-server/src/lib/speechmatics.ts'), 'utf8');
const capture = fs.readFileSync(path.join(app, 'src/lib/desktop-audio.ts'), 'utf8');
const native = fs.readFileSync(path.join(app, 'desktop/native-audio/src/pcm.rs'), 'utf8');
const wasapi = fs.readFileSync(path.join(app, 'desktop/native-audio/src/platform.rs'), 'utf8');

/** Same boxcar used by the worklet and the native encoder: average each input bucket that lands on 16 kHz. */
function resample(input, rate) {
  const output = [];
  let phase = 0, sum = 0, count = 0;
  for (const value of input) {
    sum += value;
    count += 1;
    phase += 16000;
    if (phase >= rate) {
      phase -= rate;
      output.push(sum / count);
      sum = 0;
      count = 0;
    }
  }
  return output;
}

function sine(rate, frequency, samples) {
  const data = new Float32Array(samples);
  for (let i = 0; i < samples; i++) data[i] = Math.sin((2 * Math.PI * frequency * i) / rate);
  return data;
}

function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    aa += a[i] * a[i];
    bb += b[i] * b[i];
  }
  return dot / Math.sqrt(aa * bb);
}

function rms(data) {
  let sum = 0;
  for (const value of data) sum += value * value;
  return Math.sqrt(sum / data.length);
}

function pcm16le(samples) {
  const bytes = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => bytes.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), index * 2));
  return bytes;
}

test('Speechmatics is declared pcm_s16le 16 kHz and the pipeline emits that encoding', () => {
  assert.match(speech, /encoding: "pcm_s16le", sample_rate: 16000/);
  assert.match(speech, /model: "standard"/);
  assert.match(speech, /language: speechmaticsLanguage\(language\)/);
  assert.match(speech, /max_delay: 0\.7/);
  assert.match(speech, /enable_partials: true/);
  assert.doesNotMatch(speech, /audio_filtering/);
  assert.doesNotMatch(speech, /operating_point/);
  assert.match(native, /pub const RATE: u32 = 16_000/);
  assert.match(native, /pub const FRAME: usize = 160/);
  const frame = pcm16le(new Array(160).fill(0.25));
  assert.equal(frame.length, 320);
  assert.equal(frame.readInt16LE(0), 8192);
});

test('browser capture leaves noise suppression and auto gain at the browser default', () => {
  const mic = capture.slice(capture.indexOf('getUserMedia'), capture.indexOf('getUserMedia') + 180);
  assert.match(mic, /echoCancellation: true/);
  assert.doesNotMatch(mic, /noiseSuppression/);
  assert.doesNotMatch(mic, /autoGainControl/);
  assert.match(wasapi, /use the first two/);
});

test('48 kHz speech keeps its duration and a 12 kHz tone aliases through the boxcar', () => {
  const voice = resample(sine(48000, 1000, 48000), 48000);
  assert.equal(voice.length, 16000);
  const kept = Math.abs(correlation(voice, sine(16000, 1000, voice.length)));
  assert.ok(kept > 0.95, `1 kHz correlation ${kept}`);
  const aliased = resample(sine(48000, 12000, 48000), 48000);
  const leftover = rms(aliased);
  assert.ok(leftover > 0.2, `12 kHz tone above the 8 kHz Nyquist still has RMS ${leftover} after the boxcar`);
});

test('quiet-speech lift changes gain between neighbouring 10 ms frames', () => {
  const gain = peak => Math.min(8, 0.2 / peak);
  const quiet = 0.01 * gain(0.01);
  const louder = 0.05 * gain(0.05);
  assert.ok(Math.abs(quiet - 0.08) < 1e-9);
  assert.ok(Math.abs(louder - 0.2) < 1e-9);
  assert.ok(quiet / 0.01 !== louder / 0.05);
  assert.match(worklet, /const gain = Math\.min\(8, 0\.2 \/ this\.peak\)/);
});

test('real Speechmatics word error rate is not measured without an API key', (t) => {
  if (!process.env.SPEECHMATICS_API_KEY) {
    t.skip('SPEECHMATICS_API_KEY is unset. No accent sample was sent to Speechmatics and no word error rate was computed.');
    return;
  }
  throw new Error('A key is present. This harness does not call Speechmatics until accent fixtures and scoring are wired.');
});
