// Worklet runs only after user permission. Delivers independent six-second PCM chunks.
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
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel) return true;
    for (const value of channel) {
      this.sum += value;
      this.count++;
      this.peak = Math.max(this.peak, Math.abs(value));
      this.phase += 16000;
      if (this.phase >= sampleRate) {
        this.phase -= sampleRate;
        this.samples[this.used++] = this.sum / this.count;
        this.sum = 0;
        this.count = 0;
        if (this.used === this.samples.length) {
          if (this.peak > 0.003) {
            this.port.postMessage({ samples: this.samples }, [this.samples.buffer]);
            this.silentChunks = 0;
          } else {
            this.port.postMessage({ silent: true, prolonged: ++this.silentChunks >= 3 });
          }
          this.samples = new Float32Array(96000);
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
