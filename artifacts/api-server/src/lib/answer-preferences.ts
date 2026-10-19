import type { AnswerPreferences } from "@workspace/db";

export const standardAnswerPreferences: AnswerPreferences = {
  format: "full_script",
  length: "balanced",
  tone: "simple",
  starMethod: false,
  fillerWords: false,
};

export function resolveAnswerPreferences(
  preferences: AnswerPreferences | null | undefined,
  legacy?: string,
): AnswerPreferences {
  return preferences ? { ...preferences } : {
    ...standardAnswerPreferences,
    length: legacy === "concise" ? "short" : legacy === "detailed" ? "long" : "balanced",
  };
}

export function withAnswerPreferences<T extends {
  answerPreferences?: AnswerPreferences | null; answerPreference?: string;
}>(session: T) {
  return { ...session, answerPreferences: resolveAnswerPreferences(session.answerPreferences, session.answerPreference) };
}

export function answerPreferenceInstructions(preferences: AnswerPreferences): string {
  return [
    preferences.format === "bullet_points"
      ? "Format: use short bullet points only, phrased as talking points the candidate can say in their own words."
      : preferences.format === "script_bullets"
        ? "Format: start with one spoken opening line, followed by supporting bullet points."
        : "Format: write a full, natural spoken script in paragraphs, suitable for reading aloud. For code, retain a separate fenced code block.",
    preferences.length === "short"
      ? "Length: short, only the essential answer; aim for about 40–80 words excluding code."
      : preferences.length === "long"
        ? "Length: long, explain the reasoning and supporting detail; aim for about 180–300 words excluding code."
        : "Length: balanced, give the core answer with useful context; aim for about 90–150 words excluding code.",
    preferences.tone === "formal"
      ? "Tone: precise, professional wording."
      : "Tone: simple, plain words; avoid unnecessary jargon while retaining technical correctness.",
    preferences.starMethod
      ? "For behavioral or experience questions, structure the response as Situation, Task, Action, Result (STAR). Do not force STAR onto coding or factual questions. Never fabricate a missing situation or result."
      : "Do not force the answer into STAR sections.",
    preferences.fillerWords
      ? 'Use occasional natural conversational transitions such as "Well" or "Let me explain", sparingly.'
      : "Avoid filler words and unnecessary conversational padding.",
  ].join("\n");
}
