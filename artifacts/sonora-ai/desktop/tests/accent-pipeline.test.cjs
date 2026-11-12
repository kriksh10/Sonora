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
const compat = fs.readFileSync(path.join(app, 'src/lib/compat-pcm.ts'), 'utf8');
const proposal = fs.readFileSync(path.join(app, 'src/lib/anti-alias.ts'), 'utf8');
const measured = new Function(`${proposal
  .replace(/export const /g, 'const ')
  .replace(/export function /g, 'function ')
  .replace(/: ArrayLike<number>/g, '')
  .replace(/: number\[\]/g, '')
  .replace(/: number/g, '')}; return { downsample, smoothGain };`)();

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

test('a low-pass before the boxcar keeps 1 kHz and rejects 12 kHz', () => {
  const bare = resample(sine(48000, 12000, 48000), 48000);
  assert.ok(rms(bare) > 0.2, `boxcar alone still aliases 12 kHz at RMS ${rms(bare)}`);
  const voice = measured.downsample(sine(48000, 1000, 48000), 48000);
  assert.equal(voice.length, 16000);
  let kept = 0;
  const reference = sine(16000, 1000, voice.length);
  for (let lag = 0; lag <= 40; lag++) kept = Math.max(kept, Math.abs(correlation(voice.slice(lag), reference)));
  assert.ok(kept > 0.95, `1 kHz correlation ${kept}`);
  const filtered = rms(measured.downsample(sine(48000, 12000, 48000), 48000));
  assert.ok(filtered < 0.02, `12 kHz RMS after the low-pass is ${filtered}`);
  assert.match(proposal, /LOWPASS_CUTOFF_HZ = 7200/);
  assert.match(proposal, /LOWPASS_TAPS = 31/);
  assert.match(worklet, /const taps = 31, fc = 7200 \/ sampleRate/);
  assert.match(worklet, /this\.sum \+= this\.lowpass\(value\)/);
  assert.match(compat, /sum \+= lowpass\(value\)/);
  assert.match(native, /LOWPASS_CUTOFF: f64 = 7_200\.0/);
  assert.match(native, /LOWPASS_TAPS: usize = 31/);
  assert.match(native, /self\.sum \+= self\.lowpass\.apply/);
});

test('neighbouring 10 ms frames move gain by a step instead of snapping', () => {
  let gain = 1;
  for (let frame = 0; frame < 80; frame++) gain = measured.smoothGain(gain, 0.01);
  const settled = gain;
  const next = measured.smoothGain(settled, 0.05);
  const step = Math.abs(next - settled);
  assert.ok(settled > 6, `gain settled at ${settled}`);
  assert.ok(step < 0.5, `one frame moved gain by ${step}, the old snap was 4`);
  assert.match(proposal, /GAIN_STEP = 0\.065/);
  assert.match(native, /GAIN_STEP: f32 = 0\.065/);
  assert.match(native, /self\.gain \+= \(target - self\.gain\) \* GAIN_STEP/);
  assert.doesNotMatch(native.slice(native.indexOf('frame_peak'), native.indexOf('chunks.push(Chunk::Pcm')), /lift_quiet_speech/);
});

test('real Speechmatics word error rate is not measured without an API key', (t) => {
  if (!process.env.SPEECHMATICS_API_KEY) {
    t.skip('SPEECHMATICS_API_KEY is unset. No accent sample was sent to Speechmatics and no word error rate was computed.');
    return;
  }
  throw new Error('A key is present. This harness does not call Speechmatics until accent fixtures and scoring are wired.');
});
