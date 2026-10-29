class SonoraPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.pending = [];
    this.pendingCount = 0;
    this.silentMs = 0;
    this.heard = false;
    this.ratio = sampleRate / 16000;
  }

  downsample(channel) {
    const length = Math.max(1, Math.floor(channel.length / this.ratio));
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const start = Math.floor(i * this.ratio);
      const end = Math.min(channel.length, Math.floor((i + 1) * this.ratio));
      let sum = 0;
      for (let j = start; j < end; j += 1) sum += channel[j];
      out[i] = sum / Math.max(1, end - start);
    }
    return out;
  }

  flush(endOfTurn) {
    if (!this.pendingCount) return;
    const samples = new Float32Array(this.pendingCount);
    let offset = 0;
    for (const chunk of this.pending) {
      samples.set(chunk, offset);
      offset += chunk.length;
    }
    this.pending = [];
    this.pendingCount = 0;
    this.heard = false;
    this.port.postMessage({ samples, endOfTurn, peak: 0.05 });
  }

  process(inputs) {
    const channel = inputs[0]?.[0];
    if (!channel?.length) return true;
    let peak = 0;
    for (let i = 0; i < channel.length; i += 1) peak = Math.max(peak, Math.abs(channel[i]));
    this.port.postMessage({ peak });
    const frameMs = (channel.length / sampleRate) * 1000;
    if (peak < 0.012) {
      this.silentMs += frameMs;
      if (this.heard && this.silentMs > 650 && this.pendingCount > 6400) this.flush(true);
      if (this.silentMs > 18000) {
        this.port.postMessage({ silent: true, prolonged: true, peak });
        this.silentMs = 0;
      } else if (this.silentMs > 500) {
        this.port.postMessage({ silent: true, peak });
      }
      return true;
    }
    this.silentMs = 0;
    this.heard = true;
    const down = this.downsample(channel);
    this.pending.push(down);
    this.pendingCount += down.length;
    if (this.pendingCount >= 16000 * 4) this.flush(false);
    return true;
  }
}

registerProcessor("sonora-pcm", SonoraPcm);
