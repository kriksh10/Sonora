// Independently decodable 5–6 second PCM clips preserve enough context for STT.
class SonoraPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(96000);
    this.used = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.peak = 0;
    this.silentChunks = 0;
    this.meterFrames = 0;
    this.meterPeak = 0;
    this.trailingQuiet = 0;
    this.raw = new Float32Array(320);
    this.rawUsed = 0;
    this.taps = null;
    this.delay = null;
    this.delayPos = 0;
  }
  // Same 31-tap, 7200 Hz low-pass as src/lib/anti-alias.ts. At 16 kHz it is a no-op.
  lowpass(value) {
    if (sampleRate <= 16000) return value;
    if (!this.taps) {
      const taps = 31, fc = 7200 / sampleRate, half = (taps - 1) / 2;
      this.taps = new Float64Array(taps);
      let sum = 0;
      for (let i = 0; i < taps; i++) {
        const n = i - half;
        const sinc = n === 0 ? 2 * fc : Math.sin(2 * Math.PI * fc * n) / (Math.PI * n);
        const window = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (taps - 1));
        this.taps[i] = sinc * window;
        sum += this.taps[i];
      }
      for (let i = 0; i < taps; i++) this.taps[i] /= sum;
      this.delay = new Float64Array(taps);
      this.delayPos = 0;
    }
    const n = this.taps.length;
    this.delay[this.delayPos] = value;
    let acc = 0;
    for (let k = 0; k < n; k++) acc += this.delay[(this.delayPos - k + n) % n] * this.taps[k];
    this.delayPos = (this.delayPos + 1) % n;
    return acc;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const value of channel) {
      this.sum += this.lowpass(value);
      this.count++;
      this.peak = Math.max(this.peak, Math.abs(value));
      this.meterPeak = Math.max(this.meterPeak, Math.abs(value));
      if (++this.meterFrames >= sampleRate / 4) {
        this.port.postMessage({ peak: Math.min(1, this.meterPeak) });
        this.meterFrames = 0; this.meterPeak = 0;
      }
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        const sample = this.sum / this.count;
        this.raw[this.rawUsed++] = sample;
        if (this.rawUsed === this.raw.length) {
          this.port.postMessage({ pcm: this.raw }, [this.raw.buffer]);
          this.raw = new Float32Array(320); this.rawUsed = 0;
        }
        this.samples[this.used++] = sample;
        this.trailingQuiet = Math.abs(sample) < 0.003 ? this.trailingQuiet + 1 : 0;
        this.sum = 0;
        this.count = 0;
        const full = this.used === this.samples.length;
        const turn = this.used >= 80000 && this.trailingQuiet >= 11200 && this.peak > 0.003;
        if (full || turn) {
          if (this.peak > 0.003) {
            const out = this.samples.slice(0, this.used);
            // Same bounded lift as the native encoder: quiet mic or tab audio
            // becomes usable, and samples already near 0.2 stay unchanged.
            if (this.peak < 0.2) {
              const gain = Math.min(8, 0.2 / this.peak);
              for (let i = 0; i < out.length; i++) {
                const value = out[i] * gain;
                out[i] = value > 1 ? 1 : value < -1 ? -1 : value;
              }
            }
            this.port.postMessage({ samples: out, endOfTurn: this.trailingQuiet >= 11200 }, [out.buffer]);
            this.silentChunks = 0;
          } else if (full) {
            this.port.postMessage({ silent: true, prolonged: ++this.silentChunks >= 3 });
          } else {
            continue;
          }
          this.samples = new Float32Array(96000);
          this.used = 0;
          this.peak = 0;
          this.trailingQuiet = 0;
        }
      }
    }
    // Output remains zero: never play captured speech back through the speakers.
    return true;
  }
}
registerProcessor("sonora-pcm", SonoraPcm);
