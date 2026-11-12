/** Live answers. The provider default is small enough to stop a long answer with MAX_TOKENS. */
export const ANSWER_OUTPUT_TOKENS = 8192;
export const ANSWER_CONTINUATIONS = 4;

export function answerGenerationConfig(model: string, signal: AbortSignal) {
  return {
    abortSignal: signal,
    maxOutputTokens: ANSWER_OUTPUT_TOKENS,
    ...(model === "gemini-2.5-flash" ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
  };
}

type Part = { text?: string; thought?: boolean };
type Candidate = { finishReason?: string; content?: { parts?: Part[] } };
export type AnswerChunk = { text?: string; candidates?: Candidate[] };

export function chunkAnswerText(chunk: AnswerChunk) {
  const parts = chunk.candidates?.[0]?.content?.parts ?? [];
  const visible = parts.filter(part => part && part.thought !== true && typeof part.text === "string").map(part => part.text).join("");
  if (visible) return visible;
  return typeof chunk.text === "string" ? chunk.text : "";
}

export function chunkFinishReason(chunk: AnswerChunk) {
  return chunk.candidates?.[0]?.finishReason ?? "";
}

export function answerWasCutOff(reason: string) {
  return reason === "MAX_TOKENS";
}
