import { requestAnswer } from "@/lib/answer-stream";
import { apiRequest } from "@/lib/answer-preferences";
import type { CallSession } from "@workspace/api-client-react";

export type CreditBalance = {
  balance: number;
  freeRemaining: number;
  unlimitedUntil: string | null;
  bypass: boolean;
  checkout: boolean;
};

export type SessionNotes = {
  summary: string;
  questionsAsked: string;
  nextSteps: string;
  score: number | null;
};

export type BankItem = { question: string; modelAnswer: string };

export async function loadCreditBalance(role: string, sessionCount: number): Promise<CreditBalance> {
  if (role === "owner" || role === "approver") {
    return { balance: 0, freeRemaining: 10, unlimitedUntil: null, bypass: true, checkout: false };
  }
  try {
    return await apiRequest<CreditBalance>("/billing/balance");
  } catch {
    return {
      balance: 0,
      freeRemaining: Math.max(0, 10 - sessionCount),
      unlimitedUntil: null,
      bypass: false,
      checkout: false,
    };
  }
}

export async function startCheckout(sku: string): Promise<"soon" | "redirect" | "signin"> {
  try {
    const result = await apiRequest<{ comingSoon?: boolean; url?: string }>("/billing/checkout", {
      method: "POST",
      body: JSON.stringify({ sku }),
    });
    if (result.url) {
      window.location.href = result.url;
      return "redirect";
    }
    return "soon";
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : "";
    if (/sign in/i.test(message) || /401/.test(message)) return "signin";
    return "soon";
  }
}

export async function saveAutoExtend(sessionId: string, autoExtend: boolean) {
  try {
    localStorage.setItem(`sonora:auto-extend:${sessionId}`, autoExtend ? "1" : "0");
  } catch { /* ignore */ }
  try {
    await apiRequest(`/sessions/${sessionId}/billing`, { method: "PUT", body: JSON.stringify({ autoExtend }) });
  } catch { /* route is optional until the billing handler is mounted */ }
}

export function readAutoExtend(sessionId: string) {
  try {
    return localStorage.getItem(`sonora:auto-extend:${sessionId}`) === "1";
  } catch {
    return false;
  }
}

async function askQuiet(sessionId: string, question: string, roundNumber?: number) {
  const response = await requestAnswer(
    sessionId,
    { question, roundNumber, test: true, action: "answer" },
    AbortSignal.timeout(90_000),
    () => {},
  );
  return response.answer.trim();
}

export async function generateSessionNotes(session: CallSession): Promise<SessionNotes> {
  const transcript = session.transcript.map((entry) => `${entry.role}: ${entry.text}`).join("\n").slice(0, 6000);
  const text = await askQuiet(
    session.id,
    [
      "Write notes for this ended session. Use exactly these headings:",
      "Summary:",
      "Questions asked:",
      "Next steps:",
      "Do not invent facts that are not in the transcript or job description.",
      `Job: ${session.title}`,
      `Description: ${session.description ?? ""}`,
      `Transcript:\n${transcript || "(no transcript)"}`,
    ].join("\n"),
    session.roundNumber,
  );
  const section = (label: string) => {
    const match = new RegExp(`${label}:\\s*([\\s\\S]*?)(?=\\n(?:Summary|Questions asked|Next steps):|$)`, "i").exec(text);
    return (match?.[1] ?? "").trim();
  };
  const notes = {
    summary: section("Summary") || text,
    questionsAsked: section("Questions asked"),
    nextSteps: section("Next steps"),
    score: null,
  };
  try {
    await apiRequest(`/sessions/${session.id}/notes`, { method: "PUT", body: JSON.stringify(notes) });
  } catch { /* shown locally even if persistence is not mounted */ }
  try {
    localStorage.setItem(`sonora:notes:${session.id}`, JSON.stringify(notes));
  } catch { /* ignore */ }
  return notes;
}

export function readNotes(sessionId: string): SessionNotes | null {
  try {
    const raw = localStorage.getItem(`sonora:notes:${sessionId}`);
    return raw ? JSON.parse(raw) as SessionNotes : null;
  } catch {
    return null;
  }
}

export async function generateQuestionBank(session: CallSession): Promise<BankItem[]> {
  const text = await askQuiet(
    session.id,
    [
      "List 5 likely interview questions for this role and a short model answer for each.",
      "Format every item as:",
      "Q: question",
      "A: model answer",
      `Role: ${session.title}`,
      `Job description: ${session.description ?? ""}`,
      `Resume: ${session.resumeText || "(none)"}`,
    ].join("\n"),
    session.roundNumber,
  );
  const items: BankItem[] = [];
  for (const block of text.split(/\n(?=Q:)/)) {
    const question = /Q:\s*([\s\S]*?)(?:\nA:|$)/.exec(block)?.[1]?.trim();
    const modelAnswer = /A:\s*([\s\S]*)/.exec(block)?.[1]?.trim();
    if (question && modelAnswer) items.push({ question, modelAnswer });
  }
  return items.length ? items : [{ question: "Could not split the list.", modelAnswer: text }];
}

export async function tailorResume(session: CallSession, resume: string) {
  return askQuiet(
    session.id,
    [
      "Rewrite this resume so it fits the job description. Keep the person's real experience. Do not invent employers, degrees, or metrics.",
      "Return only the revised resume text.",
      `Job description: ${session.description ?? ""}`,
      `Resume:\n${resume}`,
    ].join("\n"),
    session.roundNumber,
  );
}

export async function nextMockQuestion(session: CallSession) {
  return askQuiet(
    session.id,
    [
      "You are running a mock interview. Ask exactly one question based on the job description and resume.",
      "Do not answer it. Output only the question.",
      `Job: ${session.title}`,
      `Description: ${session.description ?? ""}`,
      `Resume: ${session.resumeText || "(none)"}`,
    ].join("\n"),
    session.roundNumber,
  );
}

export async function scoreMockAnswer(session: CallSession, question: string, answer: string) {
  const text = await askQuiet(
    session.id,
    [
      "Give brief feedback on this mock-interview answer, then a line exactly like Score: 72",
      "The score is 0-100. Base it only on the answer, the question, and the job description.",
      `Question: ${question}`,
      `Answer: ${answer}`,
    ].join("\n"),
    session.roundNumber,
  );
  const score = Number(/Score:\s*(\d{1,3})/.exec(text)?.[1]);
  return { feedback: text, score: Number.isFinite(score) ? Math.min(100, score) : null };
}

export async function captureDisplayFrame(): Promise<string | null> {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  const video = document.createElement("video");
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth || 1280;
  canvas.height = video.videoHeight || 720;
  canvas.getContext("2d")?.drawImage(video, 0, 0);
  stream.getTracks().forEach((track) => track.stop());
  const url = canvas.toDataURL("image/jpeg", 0.72);
  const data = url.split(",")[1];
  return data || null;
}

function pdfEscape(value: string) {
  return value.replace(/[^\x20-\x7E]/g, "?").replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function downloadText(filename: string, text: string) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function downloadPdf(filename: string, text: string) {
  const lines = text.split(/\n/).flatMap((line) => {
    const chunks: string[] = [];
    const safe = line || " ";
    for (let i = 0; i < safe.length; i += 90) chunks.push(safe.slice(i, i + 90));
    return chunks;
  }).slice(0, 45);
  let stream = "BT /F1 11 Tf 50 760 Td 14 TL\n";
  lines.forEach((line, index) => {
    stream += `(${pdfEscape(line)}) Tj\n`;
    if (index < lines.length - 1) stream += "T*\n";
  });
  stream += "ET";
  const objects = [
    "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n",
    "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n",
    "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj\n",
    `4 0 obj << /Length ${stream.length} >> stream\n${stream}\nendstream endobj\n`,
    "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj\n",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  for (const object of objects) {
    offsets.push(pdf.length);
    pdf += object;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (let i = 1; i < offsets.length; i += 1) pdf += `${String(offsets[i]).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const blob = new Blob([pdf], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}
