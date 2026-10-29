const MODEL = "gemini-2.5-flash";

export function geminiSttConfigured(env: NodeJS.ProcessEnv = process.env) {
  return Boolean(env.AI_INTEGRATIONS_GEMINI_BASE_URL?.trim() && env.AI_INTEGRATIONS_GEMINI_API_KEY?.trim());
}

export async function transcribeWav(audioBase64: string, language = "English", env: NodeJS.ProcessEnv = process.env) {
  const baseUrl = env.AI_INTEGRATIONS_GEMINI_BASE_URL?.trim().replace(/\/$/, "");
  const apiKey = env.AI_INTEGRATIONS_GEMINI_API_KEY?.trim();
  if (!baseUrl || !apiKey) {
    const error = new Error("Server transcription is not configured.");
    (error as Error & { status?: number }).status = 503;
    throw error;
  }
  if (!audioBase64 || audioBase64.length < 64 || audioBase64.length > 600_000) {
    throw new Error("Audio chunk is empty or larger than a few seconds.");
  }
  const response = await fetch(`${baseUrl}/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
      "x-goog-api-key": apiKey,
    },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [
          { text: `Transcribe the speech in ${language}. Return only the spoken words. If there is no speech, return an empty string.` },
          { inlineData: { mimeType: "audio/wav", data: audioBase64 } },
        ],
      }],
    }),
  });
  const payload = await response.json().catch(() => ({})) as {
    error?: { message?: string };
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  if (!response.ok) {
    const error = new Error(payload.error?.message || "Gemini could not transcribe that audio.");
    (error as Error & { status?: number }).status = response.status >= 500 ? 503 : 502;
    throw error;
  }
  return payload.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim() ?? "";
}

/** POST /api/sessions/:id/transcribe. `probe: true` checks availability without audio. */
export async function handleTranscribeRequest(body: { probe?: boolean; audio?: string; language?: string }, env: NodeJS.ProcessEnv = process.env) {
  if (!geminiSttConfigured(env)) {
    return { status: 503, body: { available: false, error: "Server transcription is not configured." } };
  }
  if (body.probe) return { status: 200, body: { available: true } };
  try {
    const text = await transcribeWav(body.audio ?? "", body.language, env);
    return { status: 200, body: { text, available: true } };
  } catch (cause) {
    const status = (cause as { status?: number }).status ?? 502;
    return { status, body: { error: cause instanceof Error ? cause.message : "Transcription failed.", available: false } };
  }
}
