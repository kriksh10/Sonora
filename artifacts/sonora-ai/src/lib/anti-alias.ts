/** Low-pass and gain smoothing for the 16 kHz capture path.
 * Measured offline. Not a Speechmatics model change.
 */
export const LOWPASS_CUTOFF_HZ = 7200;
export const LOWPASS_TAPS = 31;
export const GAIN_STEP = 0.065;
export const GAIN_TARGET = 0.2;
export const GAIN_MAX = 8;
const SPEECH_FLOOR = 0.003;

export function lowpassTaps(rate: number, cutoff = LOWPASS_CUTOFF_HZ, taps = LOWPASS_TAPS) {
  const half = (taps - 1) / 2;
  const fc = cutoff / rate;
  const out = new Float64Array(taps);
  let sum = 0;
  for (let i = 0; i < taps; i++) {
    const n = i - half;
    const sinc = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
    const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
    out[i] = sinc * window;
    sum += out[i];
  }
  for (let i = 0; i < taps; i++) out[i] /= sum;
  return out;
}

/** Identity at 16 kHz. Above that, a linear-phase low-pass runs before downsampling. */
export function createLowpass(rate: number) {
  if (rate <= 16000) return (value: number) => value;
  const taps = lowpassTaps(rate);
  const delay = new Float64Array(taps.length);
  let pos = 0;
  return (value: number) => {
    delay[pos] = value;
    let acc = 0;
    const n = taps.length;
    for (let k = 0; k < n; k++) acc += delay[(pos - k + n) % n] * taps[k];
    pos = (pos + 1) % n;
    return acc;
  };
}

export function downsample(input: ArrayLike<number>, rate: number) {
  const filter = createLowpass(rate);
  const output: number[] = [];
  let phase = 0, sum = 0, count = 0;
  for (let i = 0; i < input.length; i++) {
    sum += filter(input[i]);
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

export function targetGain(peak: number) {
  if (peak < SPEECH_FLOOR || peak >= GAIN_TARGET) return 1;
  return Math.min(GAIN_MAX, GAIN_TARGET / peak);
}

/** One 10 ms step toward the target. Silence keeps the current gain instead of snapping it. */
export function smoothGain(current: number, peak: number) {
  if (peak < SPEECH_FLOOR) return current;
  return current + (targetGain(peak) - current) * GAIN_STEP;
}
