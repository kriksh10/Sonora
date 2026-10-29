export type PcmEvent = { pcm?: Float32Array; samples?: Float32Array; peak?: number; silent?: boolean; prolonged?: boolean; endOfTurn?: boolean };

/** Compatibility path for browsers which expose AudioWorklet but cannot load it.
 * The output is the same independently decodable mono 16kHz PCM as the worklet.
 */
export function createCompatPcm(rate: number, emit: (event: PcmEvent) => void) {
  let samples = new Float32Array(96000), used = 0, phase = 0, sum = 0, count = 0;
  let peak = 0, quiet = 0, silentChunks = 0;
  let raw = new Float32Array(320), rawUsed = 0;
  return (input: Float32Array) => {
    let meter = 0;
    for (const value of input) {
      meter = Math.max(meter, Math.abs(value));
      peak = Math.max(peak, Math.abs(value));
      sum += value; count++; phase += 16000;
      if (phase < rate) continue;
      phase -= rate;
      const sample = sum / count;
      raw[rawUsed++] = sample;
      if (rawUsed === raw.length) { emit({ pcm: raw }); raw = new Float32Array(320); rawUsed = 0; }
      samples[used++] = sample;
      sum = 0; count = 0;
      quiet = Math.abs(sample) < .003 ? quiet + 1 : 0;
      const full = used === samples.length;
      const turn = used >= 80000 && quiet >= 11200 && peak > .003;
      if (!full && !turn) continue;
      if (peak > .003) {
        const out = samples.slice(0, used), gain = Math.min(8, .2 / peak);
        if (peak < .2) for (let i = 0; i < out.length; i++) out[i] = Math.max(-1, Math.min(1, out[i] * gain));
        emit({ samples: out, endOfTurn: quiet >= 11200 });
        silentChunks = 0;
      } else emit({ silent: true, prolonged: ++silentChunks >= 3 });
      samples = new Float32Array(96000); used = 0; peak = 0; quiet = 0;
    }
    emit({ peak: Math.min(1, meter) });
  };
}
