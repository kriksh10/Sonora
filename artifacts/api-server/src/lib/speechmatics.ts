const LANGUAGES: Record<string, string> = {
  english: "en", spanish: "es", french: "fr", german: "de", italian: "it", portuguese: "pt",
  dutch: "nl", polish: "pl", russian: "ru", ukrainian: "uk", japanese: "ja", korean: "ko",
  mandarin: "cmn", chinese: "cmn", arabic: "ar", hindi: "hi", turkish: "tr", swedish: "sv",
  danish: "da", norwegian: "no", finnish: "fi", czech: "cs", greek: "el", hebrew: "he",
  hungarian: "hu", romanian: "ro", indonesian: "id", malay: "ms", vietnamese: "vi", thai: "th",
  bulgarian: "bg", catalan: "ca", croatian: "hr", slovak: "sk", tamil: "ta", urdu: "ur",
};

export function speechmaticsLanguage(language: string) {
  const value = language.trim().toLowerCase();
  return LANGUAGES[value] ?? (value.length === 2 ? value : "en");
}

/** Short custom terms only. A long dictionary makes Speechmatics take several seconds to start. */
export function speechmaticsTerms(parts: Array<string | null | undefined>) {
  const terms: string[] = [];
  const seen = new Set<string>();
  for (const match of parts.filter(Boolean).join(" ").matchAll(/\b[A-Za-z][A-Za-z0-9&+.'-]{2,40}\b/g)) {
    const term = match[0];
    const key = term.toLowerCase();
    if (seen.has(key) || term.length < 3) continue;
    seen.add(key);
    terms.push(term);
    if (terms.length === 30) break;
  }
  return terms;
}

type SpeechResult = { alternatives?: Array<{ speaker?: string }> };
type SpeechMessage = {
  message?: string;
  metadata?: { transcript?: string; end_time?: number };
  results?: SpeechResult[];
  seq_no?: number;
};

export type SpeechFinal = { text: string; speaker: string };
export type SpeechUpdate = { text?: string; partial?: string; speaker?: string; final?: boolean; endOfTurn?: boolean; error?: string; endTime?: number };
export type SpeechStream = {
  send: (audio: Buffer) => void;
  takeFinal: () => SpeechFinal | undefined;
  partial: () => string;
  subscribe: (listener: (update: SpeechUpdate) => void) => () => void;
  endTurn: () => void;
  close: () => void;
};

function dominantSpeaker(results: SpeechResult[] | undefined) {
  const counts = new Map<string, number>();
  for (const result of results ?? []) {
    const speaker = result.alternatives?.[0]?.speaker?.trim();
    if (!speaker) continue;
    counts.set(speaker, (counts.get(speaker) ?? 0) + 1);
  }
  let best = "";
  let bestCount = 0;
  for (const [speaker, count] of counts) {
    if (count > bestCount) { best = speaker; bestCount = count; }
  }
  return best;
}

function messageText(data: unknown) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  return "";
}

export async function openSpeechStream(language: string, terms: string[]): Promise<SpeechStream> {
  const apiKey = process.env.SPEECHMATICS_API_KEY;
  if (!apiKey) throw new Error("Live transcription is not configured.");
  const tokenResponse = await fetch("https://mp.speechmatics.com/v1/api_keys?type=rt", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ttl: 3600 }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error("Live transcription could not start.");
  const token = await tokenResponse.json() as { key_value?: string };
  if (!token.key_value) throw new Error("Live transcription could not start.");

  const socket = new WebSocket(`wss://global.rt.speechmatics.com/v2?jwt=${encodeURIComponent(token.key_value)}`);
  const queued: Buffer[] = [];
  const finals: SpeechFinal[] = [];
  let partial = "";
  let started = false;
  let lastSeq = 0;
  let failed = false;
  let closing = false;
  const listeners = new Set<(update: SpeechUpdate) => void>();
  const publish = (update: SpeechUpdate) => { for (const listener of listeners) listener(update); };

  const sendQueued = () => {
    if (!started || socket.readyState !== WebSocket.OPEN) return;
    while (queued.length) socket.send(queued.shift()!);
  };

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => { socket.close(); reject(new Error("Live transcription timed out.")); }, 12_000);
    const fail = () => { clearTimeout(timer); socket.close(); reject(new Error("Live transcription could not start.")); };
    socket.addEventListener("error", fail);
    socket.addEventListener("close", () => { if (!started) fail(); });
    socket.addEventListener("open", () => {
      socket.send(JSON.stringify({
        message: "StartRecognition",
        audio_format: { type: "raw", encoding: "pcm_s16le", sample_rate: 16000 },
        transcription_config: {
          language: speechmaticsLanguage(language),
          model: "standard",
          enable_partials: true,
          max_delay: 0.7,
          max_delay_mode: "fixed",
          diarization: "speaker",
          speaker_diarization_config: { max_speakers: 2 },
          conversation_config: { end_of_utterance_silence_trigger: 0.6 },
          ...(terms.length ? { additional_vocab: terms.map(content => ({ content })) } : {}),
        },
      }));
    });
    socket.addEventListener("message", event => {
      const raw = messageText(event.data);
      if (!raw) return;
      let message: SpeechMessage;
      try { message = JSON.parse(raw) as SpeechMessage; } catch { return; }
      if (message.message === "RecognitionStarted") {
        started = true;
        clearTimeout(timer);
        socket.removeEventListener("error", fail);
        sendQueued();
        resolve();
      } else if (message.message === "AddPartialTranscript") {
        partial = message.metadata?.transcript?.trim().slice(0, 4_000) ?? "";
        publish({ partial });
      } else if (message.message === "AddTranscript") {
        const text = message.metadata?.transcript?.trim().slice(0, 4_000) ?? "";
        if (text) {
          const final = { text, speaker: dominantSpeaker(message.results) };
          finals.push(final);
          if (finals.length > 100) finals.shift();
          publish({ ...final, final: true, partial: "", endTime: message.metadata?.end_time });
        }
        partial = "";
      } else if (message.message === "EndOfUtterance") {
        publish({ endOfTurn: true });
      } else if (message.message === "AudioAdded" && typeof message.seq_no === "number") {
        lastSeq = message.seq_no;
      } else if (message.message === "Error") {
        failed = true;
        publish({ error: "Speechmatics rejected the live stream." });
        if (!started) fail();
      }
    });
  });
  socket.addEventListener("close", () => { if (!closing) publish({ error: "Speechmatics stream closed." }); });
  socket.addEventListener("error", () => publish({ error: "Speechmatics stream failed." }));

  return {
    send(audio) {
      if (failed || socket.readyState !== WebSocket.OPEN) throw new Error("Live transcription stopped.");
      if (socket.bufferedAmount > 640_000) throw new Error("Live provider cannot keep up with capture.");
      queued.push(audio);
      sendQueued();
    },
    takeFinal: () => finals.shift(),
    partial: () => partial,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    endTurn() { if (!failed && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ message: "ForceEndOfUtterance" })); },
    close() {
      closing = true;
      listeners.clear();
      if (socket.readyState !== WebSocket.OPEN) return;
      if (started) socket.send(JSON.stringify({ message: "EndOfStream", last_seq_no: lastSeq }));
      socket.close();
    },
  };
}
