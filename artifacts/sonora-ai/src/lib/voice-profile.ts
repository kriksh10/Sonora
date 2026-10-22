const KEY = "sonora:voice-profile";
const EDGES = [80, 160, 280, 450, 700, 1100, 1700, 2600, 4000, 6000];
const FRAME = 512;
const HOP = 256;

export type VoicePrint = { bands: number[]; pitch: number };

const worklet = `
class SonoraVoiceEnroll extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor("sonora-voice-enroll", SonoraVoiceEnroll);
`;

function voicedFrame(frame: Float32Array, rate: number) {
  let energy = 0;
  for (let index = 0; index < frame.length; index += 1) energy += frame[index] * frame[index];
  energy /= frame.length;
  const bands = EDGES.slice(0, -1).map(() => 0);
  const minBin = Math.max(1, Math.floor((80 * frame.length) / rate));
  const maxBin = Math.min(frame.length >> 1, Math.ceil((6000 * frame.length) / rate));
  for (let bin = minBin; bin <= maxBin; bin += 1) {
    let real = 0;
    let imag = 0;
    const angle = (2 * Math.PI * bin) / frame.length;
    for (let index = 0; index < frame.length; index += 1) {
      real += frame[index] * Math.cos(angle * index);
      imag -= frame[index] * Math.sin(angle * index);
    }
    const hz = (bin * rate) / frame.length;
    const band = EDGES.findIndex((edge, index) => hz >= edge && hz < EDGES[index + 1]);
    if (band >= 0) bands[band] += real * real + imag * imag;
  }
  const minLag = Math.max(1, Math.floor(rate / 320));
  const maxLag = Math.min(frame.length - 1, Math.floor(rate / 70));
  let bestLag = 0;
  let best = 0;
  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let score = 0;
    for (let index = 0; index < frame.length - lag; index += 8) score += frame[index] * frame[index + lag];
    if (score > best) { best = score; bestLag = lag; }
  }
  return { energy, bands, pitch: bestLag ? rate / bestLag : 0 };
}

function normalize(bands: number[]) {
  const logged = bands.map(value => Math.log1p(value));
  const scale = Math.hypot(...logged);
  return scale ? logged.map(value => value / scale) : logged;
}

/** A compact print of one person's speech. Silence returns null. */
export function voiceprint(samples: Float32Array, rate = 16000): VoicePrint | null {
  if (samples.length < FRAME || rate < 8000) return null;
  const bands = EDGES.slice(0, -1).map(() => 0);
  const pitches: number[] = [];
  let voiced = 0;
  for (let start = 0; start + FRAME <= samples.length; start += HOP) {
    const frame = voicedFrame(samples.subarray(start, start + FRAME), rate);
    if (frame.energy < 0.0004 || frame.pitch < 70) continue;
    voiced += 1;
    frame.bands.forEach((value, index) => { bands[index] += value; });
    pitches.push(frame.pitch);
  }
  if (voiced < 6) return null;
  pitches.sort((left, right) => left - right);
  return { bands: normalize(bands), pitch: pitches[Math.floor(pitches.length / 2)] };
}

export function voiceMatches(profile: VoicePrint, samples: Float32Array, rate = 16000) {
  const heard = voiceprint(samples, rate);
  if (!heard || profile.bands.length !== heard.bands.length) return false;
  const cosine = profile.bands.reduce((sum, value, index) => sum + value * heard.bands[index], 0);
  const ratio = heard.pitch / profile.pitch;
  return cosine > 0.9 && ratio > 0.8 && ratio < 1.25;
}

export function rememberSamples(previous: Float32Array, next: Float32Array, max = 16000 * 3) {
  const clip = next.length > max ? next.subarray(next.length - max) : next;
  const combined = new Float32Array(Math.min(max, previous.length + clip.length));
  const keep = combined.length - clip.length;
  if (keep > 0) combined.set(previous.subarray(previous.length - keep));
  combined.set(clip, keep);
  return combined;
}

export function loadVoicePrint(): VoicePrint | null {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY) ?? "");
    if (!Array.isArray(parsed?.bands) || parsed.bands.length !== EDGES.length - 1) return null;
    if (!parsed.bands.every((value: unknown) => typeof value === "number" && Number.isFinite(value))) return null;
    if (typeof parsed.pitch !== "number" || parsed.pitch < 70 || parsed.pitch > 320) return null;
    return { bands: parsed.bands, pitch: parsed.pitch };
  } catch {
    return null;
  }
}

export function saveVoicePrint(print: VoicePrint) {
  localStorage.setItem(KEY, JSON.stringify(print));
}

export function clearVoicePrint() {
  localStorage.removeItem(KEY);
}

/** Records about four seconds from the microphone and keeps only the print. */
export async function recordVoicePrint(ms = 4000): Promise<VoicePrint> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error("This browser cannot record a microphone.");
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
  const context = new AudioContext();
  try {
    const url = URL.createObjectURL(new Blob([worklet], { type: "application/javascript" }));
    await context.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
    const source = context.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(context, "sonora-voice-enroll");
    const chunks: Float32Array[] = [];
    node.port.onmessage = (event: MessageEvent<Float32Array>) => { chunks.push(new Float32Array(event.data)); };
    source.connect(node);
    await context.resume();
    await new Promise(resolve => setTimeout(resolve, ms));
    node.disconnect();
    const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const samples = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) { samples.set(chunk, offset); offset += chunk.length; }
    const print = voiceprint(samples, context.sampleRate);
    if (!print) throw new Error("Not enough speech. Speak for the whole recording, then try again.");
    return print;
  } finally {
    stream.getTracks().forEach(track => track.stop());
    await context.close().catch(() => {});
  }
}
