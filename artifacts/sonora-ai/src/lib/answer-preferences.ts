import type { AnswerPreferences, CallSession } from "@workspace/api-client-react";

export const DEFAULT_ANSWER_PREFERENCES: AnswerPreferences = {
  format: "full_script",
  length: "balanced",
  tone: "simple",
  starMethod: false,
  fillerWords: false,
};

export function legacyToPreferences(legacy: string | undefined): AnswerPreferences {
  const length = legacy === "concise" ? "short" : legacy === "detailed" ? "long" : "balanced";
  return { ...DEFAULT_ANSWER_PREFERENCES, length };
}

export function sessionPreferences(session: Pick<CallSession, "answerPreferences" | "answerPreference">): AnswerPreferences {
  return session.answerPreferences ?? legacyToPreferences(session.answerPreference);
}

export function samePrefs(a: AnswerPreferences, b: AnswerPreferences) {
  return a.format === b.format && a.length === b.length && a.tone === b.tone &&
    a.starMethod === b.starMethod && a.fillerWords === b.fillerWords;
}

export const FORMAT_LABELS = { full_script: "Full script", script_bullets: "Script + bullets", bullet_points: "Bullet points" } as const;
export const LENGTH_LABELS = { short: "Short", balanced: "Balanced", long: "Long" } as const;
export const TONE_LABELS = { simple: "Simple", formal: "Formal" } as const;
export function summarizePreferences(p: AnswerPreferences) {
  return `${FORMAT_LABELS[p.format]} · ${LENGTH_LABELS[p.length]} · ${TONE_LABELS[p.tone]}${p.starMethod ? " · STAR" : ""}${p.fillerWords ? " · Filler words" : ""}`;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    credentials: "include",
    ...init,
    headers: { ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status}).`);
  return payload as T;
}

export const fetchDefaultPreferences = () => apiRequest<AnswerPreferences>("/answer-preferences/defaults");
export const saveDefaultPreferences = (value: AnswerPreferences) =>
  apiRequest<AnswerPreferences>("/answer-preferences/defaults", { method: "PUT", body: JSON.stringify(value) });

export const QUESTION_TYPES = [
  "Behavioral", "Coding (LeetCode-style)", "Experience check", "How-do-you",
  "Situational", "System design", "Technical knowledge", "Tell me about yourself",
] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

export const EXAMPLE_QUESTIONS: Record<QuestionType, string> = {
  Behavioral: "Tell me about a time you disagreed with a teammate.",
  "Coding (LeetCode-style)": "Find two numbers in an array that add up to a target.",
  "Experience check": "Have you worked with PostgreSQL in production?",
  "How-do-you": "How do you prioritize when everything is urgent?",
  Situational: "A release is due tomorrow and a critical bug appears. What do you do?",
  "System design": "Design a URL shortener.",
  "Technical knowledge": "What is the difference between a process and a thread?",
  "Tell me about yourself": "Tell me about yourself.",
};

// Each entry: [situation, task, action, result, extra]
const LINES: Record<QuestionType, string[]> = {
  Behavioral: [
    "Last year a teammate and I disagreed on how to roll out a new billing flow.",
    "I needed us to agree without slipping the deadline.",
    "I asked for their concerns, put both options side by side with the risks, and we tested the riskiest part first.",
    "We shipped on time and the combined approach cut support tickets.",
    "Since then I start every disagreement by writing down what each side is trying to protect.",
  ],
  "Coding (LeetCode-style)": [
    "The brute force version checks every pair, which takes O(n squared) time.",
    "I want to do a single pass instead.",
    "I keep a hash map of value to index, and for each number I check whether target minus that number is already stored.",
    "That runs in O(n) time with O(n) extra space, and returns the pair as soon as it is found.",
    "I would also cover empty input, duplicates like 3 and 3 for target 6, and the case with no answer.",
  ],
  "Experience check": [
    "Yes, I have used PostgreSQL in production for about four years.",
    "Most of that was on an order system with a few hundred writes a second.",
    "I designed the indexes, tuned slow queries with EXPLAIN, and ran schema changes without downtime.",
    "That brought our slowest report from 12 seconds down to under one.",
    "I am less experienced with multi-region replication, but I understand the trade-offs.",
  ],
  "How-do-you": [
    "When several things are urgent, I first check what is actually blocking other people.",
    "Then I rank the rest by impact and cost of delay.",
    "I share the order with stakeholders so anything I am dropping is a visible, agreed choice.",
    "This keeps surprises low and the important work moving.",
    "I revisit the list daily because the order often changes.",
  ],
  Situational: [
    "A critical bug the day before a release is a risk decision, not just a coding task.",
    "I would first confirm how severe it is and who it affects.",
    "If it is severe, I would fix or roll back that change, tell the team early, and re-run the key tests.",
    "If it is minor, I would ship with a known-issue note and patch right after.",
    "Afterward I would add a test so it cannot return.",
  ],
  "System design": [
    "I would start by confirming scale, say 100 million links and read-heavy traffic.",
    "The core job is to map a short code to a long URL quickly.",
    "I would generate unique codes from a counter encoded in base 62, store them in a key-value store, and put a cache in front for reads.",
    "Redirects stay fast, and the store scales by sharding on the code.",
    "Then I would discuss analytics, expiry, and abuse protection.",
  ],
  "Technical knowledge": [
    "A process is an independent program with its own memory space.",
    "A thread is a unit of execution inside a process.",
    "Threads share memory, so they are cheap to create and communicate, but they need locks to avoid race conditions.",
    "Processes are isolated, so one crash does not take down the others.",
    "In practice I use threads for shared work and processes for isolation.",
  ],
  "Tell me about yourself": [
    "I am a software engineer with six years of experience, mostly on web products.",
    "My focus has been on making complex systems feel simple to use.",
    "Recently I led a rewrite of our checkout flow and mentored two junior developers.",
    "It lifted conversion and taught me how much clear communication matters.",
    "I am looking for a team where I can keep building and learning, which is why this role interests me.",
  ],
};

const FORMAL: [RegExp, string][] = [
  [/\bI am\b/g, "I am"], [/\bI have\b/g, "I have"], [/\bnot just\b/g, "not merely"],
  [/\bkeep(s)?\b/g, "maintain$1"], [/\bcheap\b/g, "inexpensive"], [/\bshare\b/g, "communicate"],
  [/\buse\b/g, "utilize"], [/\bused\b/g, "utilized"], [/\bshipped\b/g, "delivered"],
  [/\bfast\b/g, "efficient"], [/\bcut\b/g, "reduced"], [/\bput\b/g, "present"],
  [/\bbig\b/g, "substantial"], [/\bhelp(s)?\b/g, "assist$1"], [/\bstart\b/g, "begin"],
  [/\bwhich is why\b/g, "and for that reason"], [/\bsay\b/g, "approximately"],
];
function formalize(text: string) {
  return FORMAL.reduce((out, [pattern, to]) => out.replace(pattern, to), text);
}

const STAR_TYPES: QuestionType[] = ["Behavioral", "Experience check"];
const FILLERS = ["Well, ", "So, ", "I mean, ", "You know, ", "Honestly, "];

export function buildPreview(type: QuestionType, p: AnswerPreferences): { label: string; text: string }[] {
  const lines = LINES[type];
  const idx = p.length === "short" ? [2, 3] : p.length === "balanced" ? [0, 2, 3] : [0, 1, 2, 3, 4];
  const labels = ["Situation", "Task", "Action", "Result", "Reflection"];
  return idx.map((i, n) => {
    let text = lines[i];
    if (p.tone === "formal") text = formalize(text);
    else text = text.replace(/\bdo not\b/g, "don't").replace(/\bI would\b/g, "I'd");
    if (p.fillerWords) {
      const filler = FILLERS[(n + type.length) % FILLERS.length];
      const keepCase = /^(I\b|[A-Z]{2,}|[A-Z][a-z]*SQL)/.test(text);
      text = filler + (keepCase ? text : text.charAt(0).toLowerCase() + text.slice(1));
    }
    return { label: p.starMethod && STAR_TYPES.includes(type) ? labels[i] : "", text };
  });
}

export function renderPreview(type: QuestionType, p: AnswerPreferences): string {
  const parts = buildPreview(type, p);
  const line = (x: { label: string; text: string }) => (x.label ? `${x.label}: ${x.text}` : x.text);
  if (p.format === "full_script") return parts.map(line).join(" ");
  if (p.format === "bullet_points") return parts.map((x) => `- ${line(x)}`).join("\n");
  const [head, ...rest] = parts;
  return [line(head), ...rest.map((x) => `- ${line(x)}`)].join("\n");
}
