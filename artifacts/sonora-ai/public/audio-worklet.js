// Explicit capture only. 4.5s chunks respect the provider's 4s per-source interval.
class SonoraPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.samples = new Float32Array(72000);
    this.used = 0;
    this.phase = 0;
    this.sum = 0;
    this.count = 0;
    this.peak = 0;
    this.silentChunks = 0;
    this.meterFrames = 0;
    this.meterPeak = 0;
    this.trailingQuiet = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const value of channel) {
      this.sum += value;
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
        this.samples[this.used++] = sample;
        this.trailingQuiet = Math.abs(sample) < 0.003 ? this.trailingQuiet + 1 : 0;
        this.sum = 0;
        this.count = 0;
        if (this.used === this.samples.length) {
          if (this.peak > 0.003) {
            this.port.postMessage({ samples: this.samples, endOfTurn: this.trailingQuiet >= 11200 }, [this.samples.buffer]);
            this.silentChunks = 0;
          } else {
            this.port.postMessage({ silent: true, prolonged: ++this.silentChunks >= 4 });
          }
          this.samples = new Float32Array(72000);
          this.used = 0;
          this.peak = 0;
        }
      }
    }
    // Output remains zero: never play captured speech back through the speakers.
    return true;
  }
}
registerProcessor("sonora-pcm", SonoraPcm);
