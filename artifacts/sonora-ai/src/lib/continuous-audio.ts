import { wavBase64 } from "./pcm-wav";

export type CaptureDiagnostic = {
  at: string; source: "microphone" | "system"; event: string;
  clip?: number; durationMs?: number; queueDepth?: number; detail: string;
};

export const OVERLAP_SAMPLES = 12000; // 750ms at 16kHz
const WINDOW = 96000;

/** Never stops/restarts capture: each window retains the previous 750ms. */
export function createContinuousWindows(emit: (samples: Float32Array, overlap: boolean) => void) {
  const buffer = new Float32Array(WINDOW);
  let used = 0, overlap = false;
  return {
    push(input: Float32Array) {
      let offset = 0;
      while (offset < input.length) {
        const count = Math.min(WINDOW - used, input.length - offset);
        buffer.set(input.subarray(offset, offset + count), used);
        used += count; offset += count;
        if (used !== WINDOW) continue;
        const out = buffer.slice();
        let peak = 0;
        for (const value of out) peak = Math.max(peak, Math.abs(value));
        if (peak > 0 && peak < .2) {
          const gain = Math.min(8, .2 / peak);
          for (let i = 0; i < out.length; i++) out[i] *= gain;
        }
        emit(out, overlap);
        buffer.copyWithin(0, WINDOW - OVERLAP_SAMPLES);
        used = OVERLAP_SAMPLES; overlap = true;
      }
    },
    pendingMs() { return Math.max(0, used - (overlap ? OVERLAP_SAMPLES : 0)) / 16; },
  };
}

/** Legacy WAV/browser clips remain continuous; prepend a small boundary tail. */
export function createWavOverlap() {
  let tail = new Float32Array(0);
  return (audio: string) => {
    const bytes = Uint8Array.from(atob(audio), c => c.charCodeAt(0));
    const view = new DataView(bytes.buffer);
    if (bytes.length < 44 || view.getUint32(24, true) !== 16000 ||
        view.getUint16(22, true) !== 1 || view.getUint16(34, true) !== 16 ||
        view.getUint32(40, true) !== bytes.length - 44) {
      throw new Error("Capture returned an unsupported WAV format.");
    }
    const samples = new Float32Array((bytes.length - 44) / 2);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(44 + i * 2, true) / 32768;
    if (samples.length + tail.length > 128000) throw new Error("Overlapped audio exceeded eight seconds.");
    const out = new Float32Array(tail.length + samples.length);
    out.set(tail); out.set(samples, tail.length);
    const overlap = tail.length > 0;
    tail = samples.slice(-OVERLAP_SAMPLES);
    return { audio: wavBase64(out), overlap, durationMs: out.length / 16 };
  };
}

/** Only compare adjacent overlapping clips, never globally erase repeated questions. */
export function removeOverlapText(previous: string, next: string): string {
  const words = (text: string) => [...text.matchAll(/[\p{L}\p{N}']+/gu)];
  const a = words(previous), b = words(next);
  // 750ms cannot contain a whole long question. Limit removal to a short
  // boundary so genuinely repeated questions are not mistaken for overlap.
  for (let size = Math.min(6, a.length, b.length); size > 0; size--) {
    if (a.slice(-size).every((word, i) => word[0].toLowerCase() === b[i][0].toLowerCase())) {
      const end = b[size - 1].index! + b[size - 1][0].length;
      return next.slice(end).replace(/^[\s,.;:!?—-]+/, "").trim();
    }
  }
  return next;
}
