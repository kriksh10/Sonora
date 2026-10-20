import { wavBase64 } from "./pcm-wav";
import { createTranscriptionPacing, waitForTranscription } from "./transcription-pacing";

// Both channels share one provider lane; server concurrency limits remain enforced.
let transcriptionLane: Promise<void> = Promise.resolve();
const pacing = createTranscriptionPacing();

type Options = {
  source: "microphone" | "system";
  deviceName?: string;
  sessionId: string;
  roundNumber?: number;
  onText: (text: string, metadata: { source: "microphone" | "system"; capturedAt: string; endOfTurn?: boolean }) => void;
  onNotice: (text: string) => void;
  onTurnEnded?: () => void;
  onError: (error: Error) => void;
  onLevel?: (level: number, state: string) => void;
  onPhase?: (state: string) => void;
  onTiming?: (transcriptionMs: number) => void;
  transcribe?: boolean;
};
export type AudioCapture = { start: () => Promise<void>; stop: () => void };

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
  const notePause = () => {
    // A pause belongs after the last queued chunk, not the oldest in-flight one.
    if (pending.length) pending[pending.length - 1].endOfTurn = true;
    else if (active) speakerPaused = true;
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
        const response = await fetch(`/api/sessions/${options.sessionId}/transcribe`, {
          method: "POST", credentials: "include", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio, mimeType: "audio/wav", source: options.source, ...(options.roundNumber ? { roundNumber: options.roundNumber } : {}) }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Transcription failed (${response.status}).`);
        if (!stopped) {
          options.onTiming?.(Date.now() - startedAt);
          options.onPhase?.(result.text ? "Speech transcribed" : "Audio received · no clear speech");
          const paused = speakerPaused;
          speakerPaused = false;
          if (result.text) options.onText(result.text, {
            source: options.source, capturedAt, ...((endOfTurn || paused) ? { endOfTurn: true } : {}),
          });
          else if (paused || endOfTurn) options.onTurnEnded?.();
        }
        } finally { release(); }
      }
    } catch (error) { fail(error); }
    finally { active = false; }
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
            else if (event.type === "audio" && event.audio) {
              if (event.source && event.source !== options.source) { fail(new Error("Native audio source mismatch.")); return; }
              enqueue(event.audio, event.capturedAt, event.endOfTurn);
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
          await desktop.startNativeCapture(nativeId, options.source, options.deviceName);
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
          enqueue(wavBase64(event.data.samples), undefined, event.data.endOfTurn);
        };
        await context.resume();
        if (stopped) return;
        await window.sonoraDesktop?.setCaptureActive(true);
      } catch (error) { stop(); throw error; }
    },
  };
}
