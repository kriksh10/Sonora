import { wavBase64 } from "./pcm-wav";
import { createTranscriptionPacing, waitForTranscription } from "./transcription-pacing";

// Both channels share one provider lane; server concurrency limits remain enforced.
let transcriptionLane: Promise<void> = Promise.resolve();
const pacing = createTranscriptionPacing();

type Options = {
  source: "microphone" | "system";
  deviceName?: string;
  referenceDevice?: string;
  sessionId: string;
  roundNumber?: number;
  onText: (text: string, metadata: { source: "microphone" | "system"; capturedAt: string; endOfTurn?: boolean; speakerLabel?: string }) => void;
  onNotice: (text: string) => void;
  onTurnEnded?: () => void;
  onError: (error: Error) => void;
  onPcm?: (samples: Float32Array, rate: number) => void;
  onLevel?: (level: number, state: string) => void;
  onPhase?: (state: string) => void;
  onTiming?: (transcriptionMs: number) => void;
  transcribe?: boolean;
};
export type AudioCapture = { start: () => Promise<void>; stop: () => void };

function pcm16ToFloat(audio: string) {
  const binary = atob(audio);
  const samples = new Float32Array(binary.length >> 1);
  for (let index = 0; index < samples.length; index += 1) {
    const low = binary.charCodeAt(index * 2);
    const high = binary.charCodeAt(index * 2 + 1);
    let value = low | (high << 8);
    if (value & 0x8000) value -= 0x10000;
    samples[index] = value / 32768;
  }
  return samples;
}

/** Only a successful, authenticated availability probe enables server transcription. */
export async function serverSttAvailable(sessionId: string) {
  try {
    const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/sessions/${sessionId}/transcribe`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ probe: true }),
      signal: AbortSignal.timeout(4000),
    });
    if (response.status === 404 || response.status === 503) return false;
    if (!response.ok) return false;
    const data = await response.json().catch(() => ({}));
    return data.available !== false;
  } catch {
    return false;
  }
}

export function createAudioGroup(captures: AudioCapture[]): AudioCapture {
  let stopped = false;
  const stop = () => { stopped = true; captures.forEach(capture => capture.stop()); };
  return {
    stop,
    async start() {
      try {
        for (const capture of captures) {
          if (stopped) return;
          await capture.start();
        }
      } catch (error) { stop(); throw error; }
    },
  };
}

/** Bounded FIFO with at most two waiting chunks; stop on lag instead of silently losing speech. */
export function createDesktopAudio(options: Options): AudioCapture {
  let stopped = false;
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;
  let active = false;
  let pending: { audio: string; capturedAt: string; endOfTurn?: boolean }[] = [];
  let speakerPaused = false;
  let liveMode: "try" | "on" | "off" = "try";
  let liveStarted = false;
  let liveSocket: WebSocket | null = null;
  let liveSocketFailed = false;
  const liveFrames: string[] = [];
  let liveSending = false;
  const notePause = () => {
    if (active || pending.length) speakerPaused = true;
    else options.onTurnEnded?.();
  };
  let nativeId: string | null = null;
  let unsubscribeNative: (() => void) | undefined;
  const abort = new AbortController();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    pending = [];
    unsubscribeNative?.();
    if (nativeId) void window.sonoraDesktop?.stopNativeCapture?.(nativeId).catch(() => {});
    liveSocket?.close();
    if (liveStarted) {
      void fetch(`/api/sessions/${options.sessionId}/live-audio`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stop: true, source: options.source, ...(options.roundNumber ? { roundNumber: options.roundNumber } : {}) }),
      }).catch(() => {});
    }
    if (node) { node.port.onmessage = null; node.disconnect(); }
    stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== "closed") void context.close().catch(() => {});
    if (!nativeId) void window.sonoraDesktop?.setCaptureActive(false).catch(() => {});
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    stop();
    options.onError(error instanceof Error ? error : new Error("Desktop audio stopped."));
  };
  const pump = async () => {
    if (active || stopped) return;
    active = true;
    try {
      while (pending.length && !stopped) {
        const { audio, capturedAt, endOfTurn } = pending.shift()!;
        const previous = transcriptionLane;
        let release!: () => void;
        transcriptionLane = new Promise<void>(resolve => { release = resolve; });
        await previous;
        try {
        if (stopped) return;
        const delay = pacing.remaining(options.source);
        if (delay) {
          options.onPhase?.("Queued for transcription");
          await waitForTranscription(delay, abort.signal);
        }
        if (stopped) return;
        options.onPhase?.("Transcribing");
        pacing.mark(options.source);
        const startedAt = Date.now();
        const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/sessions/${options.sessionId}/transcribe`, {
          method: "POST", credentials: "include", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio, mimeType: "audio/wav", source: options.source, ...(options.roundNumber ? { roundNumber: options.roundNumber } : {}) }),
        });
        const result = await response.json().catch(() => ({}));
        if (response.status === 404 || response.status === 503) {
          const unavailable = new Error("Server transcription is unavailable.");
          unavailable.name = "ServerSttUnavailable";
          throw unavailable;
        }
        if (!response.ok) throw new Error(result.error || `Transcription failed (${response.status}).`);
        if (!stopped) {
          options.onTiming?.(Date.now() - startedAt);
          options.onPhase?.(result.text ? "Speech transcribed" : "Audio received · no clear speech");
          const paused = speakerPaused;
          speakerPaused = false;
          if (result.text) options.onText(result.text, {
            source: options.source, capturedAt, ...((endOfTurn || paused) ? { endOfTurn: true } : {}),
          });
          else if (paused) options.onTurnEnded?.();
        }
        } finally { release(); }
      }
    } catch (error) { fail(error); }
    finally { active = false; }
  };
  const applyLive = (result: { accepted?: boolean; partial?: string; text?: string; final?: boolean; speaker?: string }) => {
    if (stopped || !result.accepted) return;
    liveMode = "on";
    if (result.partial) options.onPhase?.(result.partial);
    if (result.final && result.text) options.onText(result.text, {
      source: options.source, capturedAt: new Date().toISOString(), endOfTurn: true,
      ...(result.speaker ? { speakerLabel: result.speaker } : {}),
    });
  };
  const postFrame = async (audio: string) => {
    const response = await fetch(`/api/sessions/${options.sessionId}/live-audio`, {
      method: "POST", credentials: "include", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audio, source: options.source, ...(options.roundNumber ? { roundNumber: options.roundNumber } : {}) }),
    });
    if (response.status === 404 || response.status === 503) { liveMode = "off"; return; }
    const result = await response.json().catch(() => ({}));
    if (response.ok) applyLive(result);
  };
  const postLive = async (audio: string) => {
    if (liveMode === "off" || stopped) return;
    liveStarted = true;
    try {
      if (!liveSocketFailed && !liveSocket) {
        const response = await fetch(`/api/sessions/${options.sessionId}/live-audio`, {
          method: "POST", credentials: "include", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(20_000)]),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ open: true, source: options.source, ...(options.roundNumber ? { roundNumber: options.roundNumber } : {}) }),
        });
        if (response.status === 404 || response.status === 503) { liveMode = "off"; return; }
        const opened = await response.json().catch(() => ({}));
        if (response.ok && opened.ticket && typeof WebSocket === "function" && typeof location !== "undefined") {
          const url = `${location.protocol === "https:" ? "wss:" : "ws:"}//${location.host}/api/live-audio?ticket=${encodeURIComponent(opened.ticket)}`;
          const ws = new WebSocket(url);
          ws.binaryType = "arraybuffer";
          await new Promise<void>((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("Live transcription timed out.")), 8_000);
            ws.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
            ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("Live transcription socket failed.")); }, { once: true });
          });
          ws.addEventListener("message", event => {
            if (typeof event.data !== "string") return;
            try { applyLive(JSON.parse(event.data)); } catch { /* ignore a malformed live message */ }
          });
          ws.addEventListener("close", () => { if (liveSocket === ws) liveSocket = null; });
          liveSocket = ws;
          liveMode = "on";
        } else liveSocketFailed = true;
      }
      if (liveSocket?.readyState === WebSocket.OPEN) {
        liveSocket.send(Uint8Array.from(atob(audio), char => char.charCodeAt(0)));
        return;
      }
      await postFrame(audio);
    } catch {
      liveSocketFailed = true;
      liveSocket?.close();
      liveSocket = null;
      if (!stopped && liveMode !== "off") await postFrame(audio).catch(() => { liveMode = "off"; });
    }
  };
  const pushLive = (audio: string) => {
    if (liveMode === "off" || stopped || options.transcribe === false) return;
    liveFrames.push(audio);
    if (liveFrames.length > 100) liveFrames.shift();
    if (liveSending) return;
    liveSending = true;
    void (async () => {
      while (liveFrames.length && !stopped) await postLive(liveFrames.shift()!);
      liveSending = false;
    })();
  };
  const enqueue = (audio: string, capturedAt = new Date().toISOString(), endOfTurn?: boolean) => {
    if (stopped) return;
    if (options.transcribe === false) return;
    if (pending.length >= 2) { fail(new Error("Transcription is falling behind. Capture stopped to avoid dropping speech. If using Both, switch to Call audio only to prioritize interviewer answers, then restart. You can also type a question.")); return; }
    pending.push({ audio, capturedAt, endOfTurn });
    void pump();
  };
  return {
    stop,
    start: async () => {
      try {
        const desktop = window.sonoraDesktop;
        if (desktop?.startNativeCapture && desktop.onNativeAudio && desktop.stopNativeCapture) {
          nativeId = crypto.randomUUID();
          unsubscribeNative = desktop.onNativeAudio(event => {
            if (stopped || event.captureId !== nativeId) return;
            if (event.type === "error") fail(new Error(event.message || "Native audio stopped."));
            else if (event.type === "pcm" && event.audio) {
              options.onPcm?.(pcm16ToFloat(event.audio), 16000);
              if (liveMode !== "off") void pushLive(event.audio);
            }
            else if (event.type === "audio" && event.audio) {
              if (event.source && event.source !== options.source) { fail(new Error("Native audio source mismatch.")); return; }
              if (liveMode !== "on") enqueue(event.audio, event.capturedAt, event.endOfTurn);
            }
            else if (event.type === "silence") {
              notePause();
              if (event.prolonged) options.onNotice(options.source === "system"
              ? "No call speech for 18 seconds. Confirm Meet’s speaker/headset matches Meeting output. Check the Call meter while remote speech plays."
              : "No microphone speech for 18 seconds. Check the microphone source, volume, and OS permission.");
            }
            else if (event.type === "status") {
              options.onLevel?.(event.peak ?? 0, (event.sampleAgeMs ?? 0) > 2000 ? "No audio samples yet · check source" : (event.peak ?? 0) > 0.003 ? "Audio activity" : "Silent samples");
            }
          });
          await desktop.startNativeCapture(nativeId, options.source, options.deviceName, options.referenceDevice);
          if (stopped) { void desktop.stopNativeCapture(nativeId); return; }
          options.onNotice("Native audio capture is active. Short audio chunks are sent to Gemini for transcription.");
          return;
        }
        stream = options.source === "system"
          ? await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
          : await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
        if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
        if (!stream.getAudioTracks().length) throw new Error("No audio source was shared. Allow system audio, or choose microphone input.");
        stream.getTracks().forEach(track => track.addEventListener("ended", () => fail(new Error("The shared audio source ended. Capture stopped.")), { once: true }));
        context = new AudioContext();
        await context.audioWorklet.addModule(`${import.meta.env.BASE_URL}audio-worklet.js`);
        if (stopped) return;
        const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
        node = new AudioWorkletNode(context, "sonora-pcm");
        source.connect(node);
        node.connect(context.destination);
        node.onprocessorerror = () => fail(new Error("Audio processing stopped. Retry capture."));
        node.port.onmessage = (event: MessageEvent<{ samples?: Float32Array; silent?: boolean; prolonged?: boolean; peak?: number; endOfTurn?: boolean }>) => {
          if (stopped) return;
          if (typeof event.data.peak === "number") options.onLevel?.(event.data.peak, event.data.peak > 0.003 ? "Audio activity" : "Silent samples");
          if (event.data.silent) notePause();
          if (event.data.prolonged) options.onNotice("No audible speech for 18 seconds. Check your selected source, volume, and OS audio permission.");
          if (!event.data.samples) return;
          options.onPcm?.(event.data.samples, 16000);
          enqueue(wavBase64(event.data.samples), undefined, event.data.endOfTurn);
        };
        await context.resume();
        if (stopped) return;
        await window.sonoraDesktop?.setCaptureActive(true);
      } catch (error) { stop(); throw error; }
    },
  };
}
