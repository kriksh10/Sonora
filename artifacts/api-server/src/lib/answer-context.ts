const STOP = new Set("the a an and or to for of in on with your you our this that from into about what how why when where which who tell describe explain walk give would could should please just are was were have has can will not".split(" "));

type Heard = { role?: string; speaker?: string; source?: string; text?: string };

/** Keeps the document passages that share words with the question. Short documents stay whole. */
export function relevantDocuments(documents: string | null | undefined, question: string, limit = 6_000) {
  const text = (documents ?? "").trim();
  if (!text) return "not provided";
  if (text.length <= limit) return text;
  const terms = new Set(
    question.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(word => word.length > 2 && !STOP.has(word)),
  );
  const parts = text.split(/\n{2,}/).flatMap(part => {
    const clean = part.trim();
    if (!clean) return [];
    if (clean.length <= 800) return [clean];
    const slices: string[] = [];
    for (let index = 0; index < clean.length; index += 800) slices.push(clean.slice(index, index + 800));
    return slices;
  });
  const ranked = parts.map(part => {
    const seen = new Set<string>();
    for (const word of part.toLowerCase().split(/[^\p{L}\p{N}]+/u)) if (terms.has(word)) seen.add(word);
    return { part, score: seen.size };
  }).sort((left, right) => right.score - left.score);
  const chosen: string[] = [];
  let used = 0;
  for (const item of ranked) {
    if (item.score === 0 && chosen.length) break;
    if (used + item.part.length > limit) continue;
    chosen.push(item.part);
    used += item.part.length;
  }
  return chosen.length ? chosen.join("\n\n") : text.slice(0, limit);
}

/** Interviewer lines are the question. Candidate lines are already spoken and are not a new question. */
export function transcriptForAnswer(entries: Heard[]) {
  const recent = entries.filter(entry => entry.text?.trim()).slice(-12);
  if (!recent.length) return "none";
  return recent.map(entry => {
    const who = entry.role === "assistant"
      ? "Previous suggested answer"
      : entry.speaker === "interviewer"
        ? "Interviewer"
        : entry.speaker === "candidate"
          ? "Candidate already said"
          : "Unknown speaker";
    const channel = entry.source === "microphone" || entry.source === "system" ? ` [${entry.source}]` : "";
    return `${who}${channel}: ${entry.text!.trim()}`;
  }).join("\n");
}
