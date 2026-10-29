import { wavBase64 } from "./pcm-wav";
import { createTranscriptionPacing, waitForTranscription } from "./transcription-pacing";
import { createCompatPcm, type PcmEvent } from "./compat-pcm";
import { createContinuousWindows, createTranscriptSentences, createWavOverlap, removeOverlapText, type CaptureDiagnostic } from "./continuous-audio";

// Both channels share one provider lane; server concurrency limits remain enforced.
let transcriptionLane: Promise<void> = Promise.resolve();
const pacing = createTranscriptionPacing();

type Options = {
  context?: AudioContext;
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
  onDiagnostic?: (event: CaptureDiagnostic) => void;
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
    // Busy is not unavailable: let the clip queue handle server throttling.
    if (response.status === 429) return true;
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

/** Continuous capture and a bounded, observable Gemini-only transcription queue. */
export function createDesktopAudio(options: Options): AudioCapture {
  let stopped = false;
  let context: AudioContext | null = options.context ?? null;
  let stream: MediaStream | null = null;
  let node: AudioWorkletNode | null = null;
  let compatibilityNode: ScriptProcessorNode | null = null;
  let active = false;
  type Clip = { audio: string; capturedAt: string; endOfTurn?: boolean; overlap: boolean; durationMs: number; sequence: number; retries: number };
  let pending: Clip[] = [];
  let inFlight: Clip | null = null;
  let sequence = 0, lastSequence = 0, nativePcmSeen = false;
  let speakerPaused = false;
  let lastText = "";
  const sentences = createTranscriptSentences();
  const diagnose = (event: string, detail: string, clip?: Clip) => options.onDiagnostic?.({
    at: new Date().toISOString(), source: options.source, event, detail, queueDepth: pending.length,
    ...(clip ? { clip: clip.sequence, durationMs: clip.durationMs } : {}),
  });
  const overlapWav = createWavOverlap();
  const notePause = () => {
    if (active || pending.length) speakerPaused = true;
    else options.onTurnEnded?.();
  };
  let nativeId: string | null = null;
  let unsubscribeNative: (() => void) | undefined;
  const abort = new AbortController();
  const stop = () => {
    if (stopped) return;
    for (const clip of pending) diagnose("dropped", "Capture stopped with clip queued.", clip);
    if (inFlight && !pending.includes(inFlight)) diagnose("dropped", "In-flight transcription cancelled by Stop.", inFlight);
    if (continuous.pendingMs()) diagnose("dropped", `Capture stopped with ${continuous.pendingMs()}ms of unfinished new audio.`);
    if (sentences.pendingWords()) diagnose("dropped", `Capture stopped with ${sentences.pendingWords()} words awaiting sentence completion.`);
    stopped = true;
    abort.abort();
    pending = [];
    unsubscribeNative?.();
    if (nativeId) void window.sonoraDesktop?.stopNativeCapture?.(nativeId).catch(() => {});
    if (node) { node.port.onmessage = null; node.disconnect(); }
    if (compatibilityNode) { compatibilityNode.onaudioprocess = null; compatibilityNode.disconnect(); }
    stream?.getTracks().forEach(track => track.stop());
    if (context && context.state !== "closed") void context.close().catch(() => {});
    if (!nativeId) void window.sonoraDesktop?.setCaptureActive(false).catch(() => {});
  };
  const fail = (error: unknown) => {
    if (stopped) return;
    stop();
    options.onError(error instanceof Error ? error : new Error("Desktop audio stopped."));
  };
  const retry = async (clip: Clip, detail: string) => {
    if (clip.retries++ < 2) {
      if (pending.length >= 12) {
        const dropped = pending.pop()!;
        diagnose("dropped", "Queue capacity exceeded while retaining a retry.", dropped);
      }
      pending.unshift(clip);
      diagnose("retry", `${detail}; retry ${clip.retries}/2. Capture continues.`, clip);
      options.onNotice("Transcription is busy; retaining this clip for retry. Capture is still running.");
      await waitForTranscription(4100, abort.signal);
    } else {
      diagnose("skipped", `${detail}; retry limit exceeded. Capture continues.`, clip);
      options.onNotice("A transcription clip failed after two retries. See capture diagnostics. Listening is still on.");
    }
  };
  const startupStep = async <T>(operation: Promise<T>, message: string): Promise<T> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cancel: () => void = () => {};
    try {
      return await Promise.race([operation, new Promise<T>((_resolve, reject) => {
        cancel = () => reject(new Error("Audio startup cancelled."));
        abort.signal.addEventListener("abort", cancel, { once: true });
        timer = setTimeout(() => reject(new Error(`${message}. Please retry.`)), 10_000);
      })]);
    } finally {
      clearTimeout(timer); abort.signal.removeEventListener("abort", cancel);
    }
  };
  const pump = async () => {
    if (active || stopped) return;
    active = true;
    try {
      while (pending.length && !stopped) {
        const clip = pending.shift()!;
        inFlight = clip;
        const { audio, capturedAt, endOfTurn } = clip;
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
        diagnose("sent", "POST /api/sessions/:id/transcribe · Gemini · audio/wav", clip);
        let response: Response;
        try { response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/sessions/${options.sessionId}/transcribe`, {
          method: "POST", credentials: "include", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(30_000)]),
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ audio, mimeType: "audio/wav", source: options.source, ...(options.roundNumber ? { roundNumber: options.roundNumber } : {}) }),
        }); } catch (error) {
          if (abort.signal.aborted) throw error;
          await retry(clip, "Transcription network timeout or failure");
          continue;
        }
        const result = await response.json().catch(() => ({}));
        if (response.status === 429) {
          options.onPhase?.("Waiting for transcription capacity");
          await retry(clip, "Server throttled transcription (429)");
          continue;
        }
        if ([500, 502, 504].includes(response.status)) { await retry(clip, `Transcription returned ${response.status}`); continue; }
        if (response.status === 404 || response.status === 503) {
          diagnose("skipped", `Gemini transcription service unavailable (${response.status}); capture stopped.`, clip);
          const unavailable = new Error("Server transcription is unavailable.");
          unavailable.name = "ServerSttUnavailable";
          throw unavailable;
        }
        if (!response.ok) {
          diagnose("skipped", `Transcription rejected (${response.status}); capture stopped.`, clip);
          throw new Error(result.error || `Transcription failed (${response.status}).`);
        }
        if (!stopped) {
          options.onTiming?.(Date.now() - startedAt);
          options.onPhase?.(result.text ? "Speech transcribed" : "Audio received · no clear speech");
          const paused = !nativePcmSeen && speakerPaused;
          speakerPaused = false;
          const text = typeof result.text === "string" ? result.text.trim() : "";
          // Suppress repeated greeting-only hallucinations, not repeated real questions.
          const filler = /^(hello|hi|hey|thank you|thanks)[.! ]*$/i.test(text) && text.toLowerCase() === lastText.toLowerCase();
          const joined = clip.overlap && clip.sequence === lastSequence + 1 ? removeOverlapText(lastText, text) : text;
          lastText = text; lastSequence = clip.sequence;
          diagnose("completed", text ? `Recognized ${text.split(/\s+/).length} words; removed ${Math.max(0, text.length - joined.length)} overlapping characters.` : "No speech recognized.", clip);
          const complete = sentences.push(filler ? "" : joined, Boolean(endOfTurn || paused || !nativePcmSeen));
          if (complete) options.onText(complete, {
            source: options.source, capturedAt, ...((endOfTurn || paused) ? { endOfTurn: true } : {}),
          });
          else if (endOfTurn || paused) options.onTurnEnded?.();
          else if (sentences.pendingWords()) diagnose("joining", `Holding ${sentences.pendingWords()} words for sentence completion or a pause.`, clip);
        }
        } finally { inFlight = null; release(); }
      }
    } catch (error) { fail(error); }
    finally { active = false; }
  };
  const enqueue = (audio: string, capturedAt = new Date().toISOString(), endOfTurn?: boolean, provided?: { overlap: boolean; durationMs: number }) => {
    if (stopped) return;
    if (options.transcribe === false) return;
    let window: { audio: string; overlap: boolean; durationMs: number };
    try { window = provided ? { audio, ...provided } : overlapWav(audio); }
    catch (error) { diagnose("skipped", "Invalid captured WAV; capture stopped."); fail(error); return; }
    const clip: Clip = { ...window, capturedAt, endOfTurn, sequence: ++sequence, retries: 0 };
    diagnose("captured", `Independent mono 16kHz WAV; 750ms boundary overlap after first clip; ${endOfTurn ? "speaker pause" : "duration boundary"}.`, clip);
    if (pending.length >= 12) {
      const dropped = pending.shift()!;
      diagnose("dropped", "Queue capacity exceeded (12 waiting clips).", dropped);
      options.onNotice("Transcription is catching up; an older queued clip was skipped. Listening is still on.");
    }
    pending.push(clip);
    void pump();
  };
  const continuous = createContinuousWindows((samples, overlap, endOfTurn) => {
    enqueue(wavBase64(samples), undefined, endOfTurn, { overlap, durationMs: samples.length / 16 });
  });
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
              if (!nativePcmSeen) {
                nativePcmSeen = true;
                diagnose("path", "Native helper → Electron IPC → continuous PCM windows → server Gemini. Live-audio/Speechmatics bypassed.");
              }
              const samples = pcm16ToFloat(event.audio);
              options.onPcm?.(samples, 16000);
              if (options.transcribe !== false) continuous.push(samples);
            }
            else if (event.type === "audio" && event.audio) {
              if (event.source && event.source !== options.source) { fail(new Error("Native audio source mismatch.")); return; }
              if (!nativePcmSeen) enqueue(event.audio, event.capturedAt, event.endOfTurn);
            }
            else if (event.type === "silence") {
              if (!nativePcmSeen) notePause();
              if (event.prolonged) options.onNotice(options.source === "system"
              ? "No call speech for 18 seconds. Confirm Meet’s speaker/headset matches Meeting output. Check the Call meter while remote speech plays."
              : "No microphone speech for 18 seconds. Check the microphone source, volume, and OS permission.");
            }
            else if (event.type === "status") {
              options.onLevel?.(event.peak ?? 0, (event.sampleAgeMs ?? 0) > 2000 ? "No audio samples yet · check source" : (event.peak ?? 0) > 0.003 ? "Audio activity" : "Silent samples");
            }
          });
          await desktop.startNativeCapture(nativeId, options.source, options.deviceName, options.referenceDevice);
          diagnose("started", "Native capture bridge active; PCM streaming to Gemini selected.");
          if (stopped) { void desktop.stopNativeCapture(nativeId); return; }
          options.onNotice("Native audio capture is active. Short audio chunks are sent to Gemini for transcription.");
          return;
        }
        stream = options.source === "system"
          ? await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
          : await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true }, video: false });
        diagnose("path", options.source === "system" ? "Browser/Electron display media → overlapping WAV → server Gemini." : "Browser microphone → overlapping WAV → server Gemini.");
        if (stopped) { stream.getTracks().forEach(track => track.stop()); return; }
        if (!stream.getAudioTracks().length) throw new Error("No audio source was shared. Allow system audio, or choose microphone input.");
        stream.getTracks().forEach(track => track.addEventListener("ended", () => fail(new Error("The shared audio source ended. Capture stopped.")), { once: true }));
        context ??= new AudioContext();
        const source = context.createMediaStreamSource(new MediaStream(stream.getAudioTracks()));
        const receive = (data: PcmEvent) => {
          if (stopped) return;
          if (typeof data.peak === "number") options.onLevel?.(data.peak, data.peak > 0.003 ? "Audio activity" : "Silent samples");
          if (data.silent) notePause();
          if (data.prolonged) options.onNotice("No audible speech for 18 seconds. Check your selected source, volume, and OS audio permission.");
          if (!data.samples) return;
          options.onPcm?.(data.samples, 16000);
          enqueue(wavBase64(data.samples), undefined, data.endOfTurn);
        };
        try {
          options.onPhase?.("Loading audio processor");
          await startupStep(context.audioWorklet.addModule(`${import.meta.env.BASE_URL}audio-worklet.js`), "Audio processor did not load");
          if (stopped) return;
          node = new AudioWorkletNode(context, "sonora-pcm");
          node.port.onmessage = event => receive(event.data);
          node.onprocessorerror = () => fail(new Error("Audio processing stopped. Retry capture."));
          source.connect(node); node.connect(context.destination);
        } catch (error) {
          if (stopped) return;
          if (!context.createScriptProcessor) throw error;
          // Deprecated but widely supported; used only when worklet startup fails.
          compatibilityNode = context.createScriptProcessor(4096, 1, 1);
          const collect = createCompatPcm(context.sampleRate, receive);
          compatibilityNode.onaudioprocess = event => {
            event.outputBuffer.getChannelData(0).fill(0);
            collect(event.inputBuffer.getChannelData(0));
          };
          source.connect(compatibilityNode); compatibilityNode.connect(context.destination);
          options.onNotice("Compatibility audio capture is active because the worklet did not load.");
        }
        options.onPhase?.("Activating microphone audio");
        await startupStep(context.resume(), "Audio could not start. Click Start listening again to allow audio playback");
        if (stopped) return;
        await window.sonoraDesktop?.setCaptureActive(true);
      } catch (error) { stop(); throw error; }
    },
  };
}
