export type InterviewInputMode = "computer" | "phone";
export type CaptureSource = "microphone" | "system";

/** A phone speaker and the candidate share one microphone; never invent identity. */
export function captureSpeaker(mode: InterviewInputMode, source: CaptureSource, confirmed: boolean) {
  if (mode === "phone" || !confirmed) return "unknown" as const;
  return source === "system" ? "interviewer" as const : "candidate" as const;
}

export function friendlyCaptureError(error: unknown, source: "microphone" | "system" | "speech" = "microphone") {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "ServerSttUnavailable") return "SERVER_STT_UNAVAILABLE";
  if (name === "NotAllowedError" || name === "AbortError" || /permission denied/i.test(message)) {
    return source === "system"
      ? "The share picker was closed, so Sonora did not start listening. When you are ready, share the meeting tab and turn on tab audio."
      : "Microphone access was not granted. You can allow it and try again, or type a question.";
  }
  if (source === "speech" && /audio-capture/i.test(message)) {
    return "This browser’s built-in speech recognition cannot capture audio. Type a question, or use server transcription when it is available.";
  }
  return message || "Could not start listening.";
}

export function mayAutoAnswer(
  mode: InterviewInputMode, source: CaptureSource, confirmed: boolean,
  phoneOptIn: boolean, sessionAutoAnswer: boolean,
) {
  return mode === "phone"
    ? source === "microphone" && phoneOptIn
    : source === "system" && confirmed && sessionAutoAnswer;
}

/** Only the recent utterance, never an unbounded microphone conversation. */
export function createRecentUtterance(clock = Date.now) {
  let text = "";
  let last = 0;
  return {
    append(fragment: string) {
      const now = clock();
      if (now - last > 12_000) text = "";
      text = `${text} ${fragment.trim()}`.trim().slice(-8000);
      last = now;
      return text;
    },
    take() { const result = text; text = ""; last = 0; return result; },
    clear() { text = ""; last = 0; },
  };
}
