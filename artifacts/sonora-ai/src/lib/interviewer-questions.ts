function preparedTurn(text: string) {
  return text.trim()
    .replace(/^(hello|hi|hey)\b[,!:.\s]*/i, "")
    .replace(/^(?:(?:okay|ok|so|then|and|now|well)[,!:.\s]+)+/i, "")
    .replace(/^(?:(?:please|(?:i|we)(?:'d| would) like you to|(?:i|we) want you to)[,!:.\s]+)+/i, "")
    .trim();
}

function isDismissedTurn(text: string) {
  if (/^(hello|hi|hey)[?.!\s]*$/i.test(text.trim())) return true;
  const clean = preparedTurn(text);
  return !clean
    || /^(can you hear|could you hear|are you there|is (my|the) (audio|microphone)|thank(s| you))/i.test(clean)
    || /^(how are you|are you ready|shall we (start|begin))[?.!\s]*$/i.test(clean)
    || /^(hello|hi|hey|okay|ok|thanks|thank you|yes|yeah|yep|no|nope)[?.!\s]*$/i.test(clean);
}

export function isInterviewQuestion(text: string) {
  if (isDismissedTurn(text)) return false;
  const clean = preparedTurn(text);
  return clean.includes("?") ||
    /^(what|how|why|when|where|which|who|(?:can|could|would|have|did|do|are|will) you|tell (?:me|us)|describe|explain|walk (?:me|us)|(?:you )?give (?:me|us)|write|implement|design|compare|discuss|demonstrate|solve|outline|let(?:'s| us) (?:discuss|talk about))\b/i.test(clean) ||
    /\b(?:my|our|the next) question is\b|\b(?:can|could|would) you (?:explain|describe|tell|walk|give|compare|design|implement)\b/i.test(clean);
}

/** Only used after a pause on an explicitly allowed source; not voice identification. */
export function isPausedInterviewerTurn(text: string) {
  if (isDismissedTurn(text)) return false;
  return isInterviewQuestion(text) || preparedTurn(text).split(/\s+/).filter(Boolean).length >= 4;
}
/** Source-based routing, not speaker recognition. State lives only for this capture. */
export function createInterviewerQuestions({
  answer, notice, setTimer = setTimeout, clearTimer = clearTimeout, clock = Date.now,
}: {
  answer: (text: string, receivedAt: number, isCurrent: () => boolean) => Promise<void>;
  notice: (message: string) => void;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
  clock?: () => number;
}) {
  let fragments = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  let receivedAt = 0;
  let pending: { text: string; receivedAt: number }[] = [];
  let running = false;
  let generation = 0;
  let seen: { key: string; time: number }[] = [];
  let turnEnded = false;
  const pump = async () => {
    if (running) return;
    running = true;
    try {
      while (pending.length) {
        const item = pending.shift()!;
        const token = generation;
        try { await answer(item.text, item.receivedAt, () => generation === token); }
        catch { notice("A queued answer failed. Select the question to retry."); }
      }
    } finally { running = false; }
  };
  const flush = () => {
    clearTimer(timer);
    clearTimer(deadline);
    deadline = undefined;
    const paused = turnEnded;
    turnEnded = false;
    const text = fragments.trim();
    fragments = "";
    if (!(paused ? isPausedInterviewerTurn(text) : isInterviewQuestion(text))) {
      if (text) notice("Call speech received, but no question detected yet. Select a transcript line to ask manually.");
      return;
    }
    seen = seen.filter(item => clock() - item.time < 30_000);
    const key = text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
    if (seen.some(item => item.key === key)) {
      notice("Repeated question ignored. Select it manually to ask again.");
      return;
    }
    // Backpressure is visible; never silently discard an arriving question.
    if (pending.length >= 2) {
      notice("Two questions are already queued. The latest remains in the transcript; select it manually.");
      return;
    }
    seen.push({ key, time: clock() });
    seen = seen.slice(-12);
    pending.push({ text, receivedAt });
    if (running) notice("Interviewer question queued while the current answer finishes.");
    void pump();
  };
  const collect = (text: string, endOfTurn = false) => {
      if (!text.trim()) return;
      const token = generation;
      if (!fragments) receivedAt = typeof performance === "undefined" ? clock() : performance.now();
      fragments = `${fragments} ${text}`.trim();
      turnEnded = endOfTurn;
      // Chunk delivery is not silence: a bounded turn deadline must survive
      // subsequent chunks, otherwise 6-second arrivals reset an 8.5-second timer forever.
      if (deadline === undefined) deadline = setTimer(() => { if (generation === token) flush(); }, 15_000);
      if (fragments.length > 8000) {
        fragments = "";
        clearTimer(timer);
        clearTimer(deadline);
        deadline = undefined;
        notice("Remote turn exceeded the automatic question limit. Select the relevant transcript text manually.");
        return;
      }
      clearTimer(timer);
      // A complete punctuated question can be used quickly; unpunctuated speech
      // gets a full chunk interval to collect its continuation.
      timer = setTimer(() => { if (generation === token) flush(); },
        endOfTurn ? 350 : /[?]\s*$/.test(fragments) ? 1500 : 8500);
  };
  return {
    push(text: string, speaker: "candidate" | "interviewer" | "unknown", endOfTurn = false) {
      if (speaker === "interviewer") collect(text, endOfTurn);
    },
    /** Explicit mixed-audio opt-in, not a claim that the speaker is the interviewer. */
    pushMixed(text: string, optedIn: boolean, endOfTurn = false) {
      if (optedIn) collect(text, endOfTurn);
    },
    pause() {
      if (!fragments.trim()) return;
      turnEnded = true;
      clearTimer(timer);
      const token = generation;
      timer = setTimer(() => { if (generation === token) flush(); }, 350);
    },
    reset() {
      generation += 1;
      clearTimer(timer);
      clearTimer(deadline);
      deadline = undefined;
      fragments = "";
      pending = [];
      seen = [];
      turnEnded = false;
    },
  };
}
