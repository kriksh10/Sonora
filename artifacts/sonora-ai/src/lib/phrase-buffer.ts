type Phrase = {
  text: string;
  source: "microphone" | "system" | "typed";
  speaker: "candidate" | "interviewer" | "unknown";
  capturedAt: string;
};

/** Joins word-sized transcripts into one line. A real pause, or a speaker change, commits the line. */
export function createPhraseBuffer(options: {
  commit: (phrase: Phrase) => void;
  preview?: (text: string) => void;
  waitMs?: number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}) {
  const wait = options.waitMs ?? 1200;
  const setTimer = options.setTimer ?? setTimeout;
  const clearTimer = options.clearTimer ?? clearTimeout;
  const pending = new Map<string, Phrase & { timer: ReturnType<typeof setTimeout> }>();

  const flush = (key: string) => {
    const item = pending.get(key);
    if (!item) return;
    clearTimer(item.timer);
    pending.delete(key);
    const text = item.text.trim();
    if (!text) return;
    options.commit({ text, source: item.source, speaker: item.speaker, capturedAt: item.capturedAt });
    if (!pending.size) options.preview?.("");
  };

  return {
    push(text: string, phrase: Omit<Phrase, "text">) {
      const clean = text.replace(/\s+/g, " ").trim();
      if (!clean) return;
      const key = phrase.source;
      if (!/[\p{L}\p{N}]/u.test(clean)) {
        const open = pending.get(key);
        if (!open) return;
        clearTimer(open.timer);
        const next = `${open.text} ${clean}`.trim();
        pending.set(key, { ...open, text: next, timer: setTimer(() => flush(key), wait) });
        options.preview?.(next);
        return;
      }
      const current = pending.get(key);
      if (current && current.speaker !== phrase.speaker) flush(key);
      const item = pending.get(key);
      if (item) clearTimer(item.timer);
      const next = `${item?.text ?? ""} ${clean}`.trim();
      const timer = setTimer(() => flush(key), wait);
      pending.set(key, {
        text: next,
        source: phrase.source,
        speaker: phrase.speaker,
        capturedAt: item?.capturedAt || phrase.capturedAt,
        timer,
      });
      options.preview?.(next);
      if (next.length > 700) flush(key);
    },
    flush() {
      for (const key of [...pending.keys()]) flush(key);
    },
  };
}
