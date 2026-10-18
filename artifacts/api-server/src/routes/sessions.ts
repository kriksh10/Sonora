import { Router, type IRouter, type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { GoogleGenAI } from "@google/genai";
import { and, desc, eq } from "drizzle-orm";
import { db, callSessionsTable, type TranscriptEntry } from "@workspace/db";
import { logger } from "../lib/logger";

const router: IRouter = Router();

function currentUserId(req: Request, res: Response) {
  const userId = getAuth(req).userId;
  if (!userId) {
    res.status(401).json({ error: "Sign in to use live sessions." });
    return null;
  }
  return userId;
}

function asText(value: unknown, maxLength = 40_000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function asBoolean(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function ownedSessionQuery(id: string, userId: string) {
  return and(eq(callSessionsTable.id, id), eq(callSessionsTable.userId, userId));
}

router.get("/sessions", async (req, res, next) => {
  const userId = currentUserId(req, res);
  if (!userId) return;
  try {
    const sessions = await db
      .select()
      .from(callSessionsTable)
      .where(eq(callSessionsTable.userId, userId))
      .orderBy(desc(callSessionsTable.createdAt));
    return res.json(sessions);
  } catch (error) {
    return next(error);
  }
});

router.post("/sessions", async (req, res, next) => {
  const userId = currentUserId(req, res);
  if (!userId) return;
  const sessionType = req.body?.sessionType === "call" ? "call" : "interview";
  const company = asText(req.body?.company, 200);
  const description = asText(req.body?.description, 8_000);
  const title =
    sessionType === "interview"
      ? company || "Interview session"
      : asText(req.body?.title, 200) || "Regular call";
  try {
    const [session] = await db
      .insert(callSessionsTable)
      .values({
        userId,
        sessionType,
        title,
        company: company || null,
        description,
        resumeText: asText(req.body?.resumeText),
        documentsText: asText(req.body?.documentsText),
        instructions: asText(req.body?.instructions, 8_000),
        answerPreference: asText(req.body?.answerPreference, 40) || "concise",
        model:
          req.body?.model === "gemini-3-flash-preview"
            ? "gemini-3-flash-preview"
            : "gemini-2.5-flash",
        language: asText(req.body?.language, 40) || "English",
        autoAnswer: asBoolean(req.body?.autoAnswer, false),
        saveTranscript: asBoolean(req.body?.saveTranscript, true),
      })
      .returning();
    return res.status(201).json(session);
  } catch (error) {
    return next(error);
  }
});

router.get("/sessions/:id", async (req, res, next) => {
  const userId = currentUserId(req, res);
  if (!userId) return;
  try {
    const [session] = await db
      .select()
      .from(callSessionsTable)
      .where(ownedSessionQuery(req.params.id, userId))
      .limit(1);
    if (!session) return res.status(404).json({ error: "Session not found." });
    return res.json(session);
  } catch (error) {
    return next(error);
  }
});

router.patch("/sessions/:id", async (req, res, next) => {
  const userId = currentUserId(req, res);
  if (!userId) return;
  const status = req.body?.status;
  if (status !== "active" && status !== "ended" && status !== "ready") {
    return res.status(400).json({ error: "Choose a valid session status." });
  }
  try {
    const updates: Partial<typeof callSessionsTable.$inferInsert> = { status };
    if (status === "active") updates.startedAt = new Date();
    if (status === "ended") updates.endedAt = new Date();
    const [session] = await db
      .update(callSessionsTable)
      .set(updates)
      .where(ownedSessionQuery(req.params.id, userId))
      .returning();
    if (!session) return res.status(404).json({ error: "Session not found." });
    return res.json(session);
  } catch (error) {
    return next(error);
  }
});

router.post("/sessions/:id/transcript", async (req, res, next) => {
  const userId = currentUserId(req, res);
  if (!userId) return;
  const text = asText(req.body?.text, 8_000);
  const role = req.body?.role === "assistant" ? "assistant" : "user";
  const source =
    req.body?.source === "microphone"
      ? "microphone"
      : role === "assistant"
        ? "ai"
        : "typed";
  if (!text) return res.status(400).json({ error: "Transcript text is required." });
  try {
    const [session] = await db
      .select()
      .from(callSessionsTable)
      .where(ownedSessionQuery(req.params.id, userId))
      .limit(1);
    if (!session) return res.status(404).json({ error: "Session not found." });
    const entry: TranscriptEntry = {
      role,
      text,
      source,
      createdAt: new Date().toISOString(),
    };
    const transcript = session.saveTranscript
      ? [...(session.transcript ?? []), entry].slice(-500)
      : session.transcript ?? [];
    const [updated] = await db
      .update(callSessionsTable)
      .set({ transcript })
      .where(ownedSessionQuery(req.params.id, userId))
      .returning();
    return res.json(updated);
  } catch (error) {
    return next(error);
  }
});

router.post("/sessions/:id/answer", async (req, res, next) => {
  const userId = currentUserId(req, res);
  if (!userId) return;
  const question = asText(req.body?.question, 8_000);
  if (!question) return res.status(400).json({ error: "Enter a question first." });
  try {
    const [session] = await db
      .select()
      .from(callSessionsTable)
      .where(ownedSessionQuery(req.params.id, userId))
      .limit(1);
    if (!session) return res.status(404).json({ error: "Session not found." });

    const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
    const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
    if (!baseUrl || !apiKey) {
      return res.status(503).json({ error: "Gemini is not configured on the server." });
    }
    const ai = new GoogleGenAI({
      apiKey,
      httpOptions: { apiVersion: "", baseUrl },
    });
    const answerStyle =
      session.answerPreference === "detailed"
        ? "Give a thorough but spoken-sounding answer."
        : session.answerPreference === "technical"
          ? "Give a technically precise answer with a concise explanation and concrete examples."
          : "Give a concise, natural answer that can be spoken in an interview.";
    const prompt = [
      "You are a private live interview assistant. Help the candidate formulate a truthful, natural response to the question.",
      "Do not invent experience, skills, employers, metrics, or personal facts not present in the supplied context. If important facts are missing, state that briefly and suggest a safe way for the candidate to answer.",
      `Respond in ${session.language || "English"}. ${answerStyle}`,
      session.sessionType === "interview"
        ? `Company: ${session.company || "not specified"}`
        : `Call title: ${session.title}`,
      `Conversation context: ${session.description || "not provided"}`,
      `Candidate resume: ${session.resumeText || "not provided"}`,
      `Reference documents: ${session.documentsText || "not provided"}`,
      `Candidate instructions: ${session.instructions || "none"}`,
      `Question or latest interviewer statement: ${question}`,
    ].join("\n\n");
    const result = await ai.models.generateContent({
      model: session.model,
      contents: prompt,
    });
    const answer = result.text?.trim();
    if (!answer) throw new Error("Gemini returned an empty answer.");

    if (session.saveTranscript) {
      const entry: TranscriptEntry = {
        role: "assistant",
        text: answer,
        source: "ai",
        createdAt: new Date().toISOString(),
      };
      await db
        .update(callSessionsTable)
        .set({
          transcript: [...(session.transcript ?? []), entry].slice(-500),
        })
        .where(ownedSessionQuery(req.params.id, userId));
    }
    return res.json({ answer, model: session.model });
  } catch (error) {
    logger.error({ err: error }, "Gemini answer generation failed");
    return res.status(502).json({
      error: "Gemini could not generate an answer. Please try again.",
    });
  }
});

export default router;
