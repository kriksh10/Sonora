/** Standalone WAV chunks: unlike slices of WebM, every request is independently decodable. */
export function encodeWav(samples: Float32Array): Uint8Array {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) view.setUint8(offset + i, value.charCodeAt(i));
  };
  text(0, "RIFF"); view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE"); text(12, "fmt "); view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true);
  text(36, "data"); view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const value = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true);
  });
  return new Uint8Array(buffer);
}
export function wavBase64(samples: Float32Array): string {
  const bytes = encodeWav(samples);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary);
}

/** Coalesce queued phrases without exceeding the server's eight-second PCM limit. */
export function joinWavPhrases(first: string, second: string): string | null {
  try {
    const a = Uint8Array.from(atob(first), char => char.charCodeAt(0));
    const b = Uint8Array.from(atob(second), char => char.charCodeAt(0));
    const size = a.length + b.length - 44;
    if (a.length < 46 || b.length < 46 || size > 256044) return null;
    const header = (bytes: Uint8Array) => String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF"
      && String.fromCharCode(...bytes.subarray(8, 16)) === "WAVEfmt ";
    if (!header(a) || !header(b)) return null;
    const bytes = new Uint8Array(size);
    bytes.set(a);
    bytes.set(b.subarray(44), a.length);
    const view = new DataView(bytes.buffer);
    view.setUint32(4, size - 8, true);
    view.setUint32(40, size - 44, true);
    let binary = "";
    for (let index = 0; index < bytes.length; index += 8192) binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
    return btoa(binary);
  } catch { return null; }
}
