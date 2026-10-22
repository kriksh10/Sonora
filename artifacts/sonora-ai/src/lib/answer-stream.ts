import type { SessionAnswerRequest } from "@workspace/api-client-react";

/** Streaming uses fetch, not an Orval mutation (which expects one JSON response). */
export async function requestAnswer(
  sessionId: string,
  request: SessionAnswerRequest,
  signal: AbortSignal,
  onContent: (text: string) => void,
  screenshot?: string,
): Promise<{ answer: string; model: string }> {
  const response = await fetch(`${import.meta.env.BASE_URL}api/sessions/${sessionId}/answer`, {
    method: "POST", credentials: "include", signal,
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ ...request, stream: true, ...(screenshot ? { screenshot } : {}) }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(response.status === 401
      ? "Sign-in expired. Reconnect by signing in again; your current answer stays visible."
      : result.error || `Answer request failed (${response.status}). Retry when connected.`);
  }
  if (!response.headers.get("content-type")?.includes("text/event-stream")) {
    const result = await response.json();
    if (typeof result.answer !== "string" || !result.answer.trim() || result.answer.length > 24000) throw new Error("Invalid answer response.");
    onContent(result.answer);
    return result;
  }
  if (!response.body) throw new Error("The answer stream is unavailable.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "", answer = "";
  let completed: { answer: string; model: string } | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, "\n");
      if (buffer.length > 100000) throw new Error("Invalid oversized answer stream.");
      let boundary;
      while ((boundary = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = frame.split("\n").filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
        if (!data) continue;
        const event = JSON.parse(data);
        if (event.error) throw new Error(typeof event.error === "string" ? event.error : "Answer interrupted.");
        if (typeof event.content === "string") {
          answer += event.content;
          if (answer.length > 24000) throw new Error("Answer exceeded the supported size.");
          onContent(answer);
        }
        if (event.done === true) {
          if (typeof event.answer !== "string" || !event.answer.trim() || event.answer.length > 24000 ||
              typeof event.model !== "string" || event.answer !== answer) throw new Error("Invalid completed answer.");
          completed = { answer: event.answer, model: event.model };
        }
      }
      if (completed) break;
    }
    if (!completed) throw new Error("Answer stream interrupted. Partial text is not a completed answer. Retry when connected.");
    return completed;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
