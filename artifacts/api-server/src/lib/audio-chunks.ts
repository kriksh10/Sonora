/** Accept only the fixed PCM WAV format emitted by the desktop audio client. */
export function validateAudioChunk(audio: string): Buffer {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audio) || audio.length % 4 !== 0) {
    throw new Error("Audio must be base64 PCM WAV.");
  }
  const bytes = Buffer.from(audio, "base64");
  if (bytes.length < 46 || bytes.length > 256_044 ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WAVE" ||
      bytes.toString("ascii", 12, 16) !== "fmt " ||
      bytes.readUInt32LE(16) !== 16 || bytes.readUInt16LE(20) !== 1 ||
      bytes.readUInt16LE(22) !== 1 || bytes.readUInt32LE(24) !== 16_000 ||
      bytes.readUInt32LE(28) !== 32_000 || bytes.readUInt16LE(32) !== 2 ||
      bytes.readUInt16LE(34) !== 16 || bytes.toString("ascii", 36, 40) !== "data" ||
      bytes.readUInt32LE(40) !== bytes.length - 44 ||
      bytes.readUInt32LE(4) !== bytes.length - 8 || (bytes.length - 44) % 2 !== 0) {
    throw new Error("Use a mono 16 kHz PCM WAV chunk of at most eight seconds.");
  }
  return bytes;
}

/** Bounded per-process abuse/concurrency guard; rate failures do not retain audio. */
export class TranscriptionGate {
  private slots = new Map<string, { active: boolean; started: number; channels: Partial<Record<"microphone" | "system", number>> }>();
  constructor(private clock = Date.now) {}
  enter(user: string, source: "microphone" | "system" = "microphone") {
    const now = this.clock();
    const slot = this.slots.get(user);
    const last = slot?.channels[source];
    if (slot && (slot.active || (last !== undefined && now - last < 4_000))) return false;
    this.slots.set(user, { active: true, started: now, channels: { ...slot?.channels, [source]: now } });
    // Expire idle keys so many one-time users cannot grow this map indefinitely.
    for (const [key, value] of this.slots) {
      if (!value.active && now - value.started > 60_000) this.slots.delete(key);
    }
    return true;
  }
  leave(user: string) {
    const slot = this.slots.get(user);
    if (slot) slot.active = false;
  }
}
