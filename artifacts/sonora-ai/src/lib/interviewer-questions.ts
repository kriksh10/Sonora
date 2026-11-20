function preparedTurn(text: string) {
  return text.trim()
    .replace(/^(hello|hi|hey)\b[,!:.\s]*/i, "")
    .replace(/^(?:(?:okay|ok|so|then|and|now|well)[,!:.\s]+)+/i, "")
    .replace(/^(?:(?:please|(?:i|we)(?:'d| would) like you to|(?:i|we) want you to)[,!:.\s]+)+/i, "")
    .trim();
}

/** Greetings, thanks, and audio checks are never interview questions. */
function isDismissedTurn(text: string) {
  if (!/[\p{L}\p{N}]/u.test(text)) return true;
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

/** Confirmed interviewer speech after a pause is the question, even without question wording. */
export function isPausedInterviewerTurn(text: string) {
  if (isDismissedTurn(text)) return false;
  if (isInterviewQuestion(text)) return true;
  return preparedTurn(text).split(/\s+/).filter(Boolean).length >= 4;
}

/** A short pause can be the speaker taking a breath. Wait before treating the turn as finished. */
const TURN_GAP_MS = 1_200;
/** No new words for this long means the turn is stuck, not that the speaker is still going. */
const STUCK_TURN_MS = 15_000;
const QUESTION_LIMIT = 8_000;
const QUEUE_LIMIT = 12;

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
    // A question that arrives while an answer is running stays queued. Only a very
    // long backlog is left in the transcript instead of being dropped silently.
    if (pending.length >= QUEUE_LIMIT) {
      notice("Several questions are already queued. The latest remains in the transcript; select it manually.");
      return;
    }
    seen.push({ key, time: clock() });
    seen = seen.slice(-12);
    pending.push({ text, receivedAt });
    if (running) notice("Interviewer question queued while the current answer finishes.");
    void pump();
  };
  const collect = (text: string, endOfTurn = false, endedAt?: number) => {
      if (!text.trim()) return;
      const token = generation;
      if (!fragments) receivedAt = endedAt ?? (typeof performance === "undefined" ? clock() : performance.now());
      fragments = `${fragments} ${text}`.trim();
      turnEnded = endOfTurn || turnEnded;
      // The stuck-turn timer follows the latest words. Continuous speech must not
      // be cut off because the first fragment was fifteen seconds ago.
      clearTimer(deadline);
      deadline = setTimer(() => { if (generation === token) flush(); }, STUCK_TURN_MS);
      if (fragments.length > QUESTION_LIMIT) {
        const whole = fragments;
        const head = whole.slice(0, QUESTION_LIMIT).trim();
        const overflow = whole.slice(QUESTION_LIMIT).trim();
        fragments = head;
        turnEnded = true;
        notice("This interviewer turn is longer than one automatic question. The first part is answered and the rest stays with the following speech.");
        flush();
        fragments = overflow;
        receivedAt = endedAt ?? clock();
        if (!fragments) return;
      }
      clearTimer(timer);
      // End of utterance still waits briefly so a second part spoken after a
      // breath is the same question. Speech with no end marker waits for quiet.
      timer = setTimer(() => { if (generation === token) flush(); }, endOfTurn ? TURN_GAP_MS : 3000);
  };
  const pause = () => {
    if (!fragments.trim()) return;
    turnEnded = true;
    const token = generation;
    clearTimer(timer);
    timer = setTimer(() => { if (generation === token) flush(); }, 0);
  };
  return {
    push(text: string, speaker: "candidate" | "interviewer" | "unknown", endOfTurn = false, endedAt?: number) {
      if (speaker === "interviewer") collect(text, endOfTurn, endedAt);
    },
    /** Explicit mixed-audio opt-in, not a claim that the speaker is the interviewer. */
    pushMixed(text: string, optedIn: boolean, endOfTurn = false, endedAt?: number) {
      if (optedIn) collect(text, endOfTurn, endedAt);
    },
    pause,
    reset() {
      generation += 1;
      clearTimer(timer);
      clearTimer(deadline);
      deadline = undefined;
      turnEnded = false;
      fragments = "";
      pending = [];
      seen = [];
    },
  };
}
