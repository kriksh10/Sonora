import { wavBase64 } from "./pcm-wav";

type Options = {
  source: "microphone" | "system";
  sessionId: string;
  onText: (text: string) => void;
  onNotice: (text: string) => void;
  onError: (error: Error) => void;
};
export type AudioCapture = { start: () => Promise<void>; stop: () => void };

/** Bounded FIFO with at most two waiting chunks; stop on lag instead of silently losing speech. */
export function createDesktopAudio(options: Options): AudioCapture {
  let stopped = false;
  let context: AudioContext | null = null;
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;
  let active = false;
  let pending: Float32Array[] = [];
  const abort = new AbortController();
  const stop = () => {
    if (stopped) return;
    stopped = true;
    abort.abort();
    pending = [];
    if (node) { node.port.onmessage = null; node.disconnect(); }
    stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== "closed") void context.close().catch(() => {});
    void window.sonoraDesktop?.setCaptureActive(false).catch(() => {});
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
        const samples = pending.shift()!;
        const response = await fetch(`/api/sessions/${options.sessionId}/transcribe`, {
          method: "POST", credentials: "include", signal: abort.signal,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio: wavBase64(samples), mimeType: "audio/wav" }),
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || `Transcription failed (${response.status}).`);
        if (!stopped && result.text) options.onText(result.text);
      }
    } catch (error) { fail(error); }
    finally { active = false; }
  };
  return {
    stop,
    start: async () => {
      try {
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
        node.port.onmessage = (event: MessageEvent<{ samples?: Float32Array; silent?: boolean; prolonged?: boolean }>) => {
          if (stopped) return;
          if (event.data.prolonged) options.onNotice("No audible speech for 18 seconds. Check your selected source, volume, and OS audio permission.");
          if (!event.data.samples) return;
          if (pending.length >= 2) { fail(new Error("Transcription is falling behind. Capture stopped to avoid dropping speech. Retry or type your question.")); return; }
          pending.push(event.data.samples);
          void pump();
        };
        await context.resume();
        if (stopped) return;
        await window.sonoraDesktop?.setCaptureActive(true);
      } catch (error) { stop(); throw error; }
    },
  };
}
