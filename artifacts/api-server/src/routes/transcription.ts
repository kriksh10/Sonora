import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { roundMatches, sessionStillUsable, watchSession } from "../lib/session-lifecycle";
import { handleTranscribeRequest } from "../transcription/gemini-stt";
import { and, eq } from "drizzle-orm";
import { db, callSessionsTable } from "@workspace/db";
import { TranscribeSessionAudioBody, TranscribeSessionAudioParams } from "@workspace/api-zod";
import { TranscriptionGate, validateAudioChunk } from "../lib/audio-chunks";

const router: IRouter = Router();
const gate = new TranscriptionGate();
router.post("/sessions/:id/transcribe", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Sign in to transcribe audio." }); return; }
  const params = TranscribeSessionAudioParams.safeParse(req.params);
  const probe = req.body?.probe === true;
  const body = TranscribeSessionAudioBody.safeParse(req.body);
  if (!params.success || !body.success) {
    res.status(400).json({ error: "Provide a valid session and short PCM WAV audio chunk." }); return;
  }
  try { if (!probe) validateAudioChunk(body.data.audio ?? ""); }
  catch { res.status(400).json({ error: "Use mono 16 kHz PCM WAV audio, at most eight seconds." }); return; }
  const [session] = await db.select().from(callSessionsTable).where(and(
    eq(callSessionsTable.id, params.data.id), eq(callSessionsTable.userId, userId),
  )).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found." }); return; }
  if (session.status === "ended" || !roundMatches(session.roundNumber, body.data.roundNumber)) {
    res.status(409).json({ error: "This interview round has ended or changed. Refresh it." }); return;
  }
  const baseUrl = process.env.AI_INTEGRATIONS_GEMINI_BASE_URL;
  const apiKey = process.env.AI_INTEGRATIONS_GEMINI_API_KEY;
  if (!baseUrl || !apiKey) { res.status(503).json({ error: "Transcription is not configured." }); return; }
  if (probe) {
    const result = await handleTranscribeRequest({ probe: true });
    res.status(result.status).json(result.body); return;
  }
  if (!gate.enter(userId, body.data.source ?? "microphone")) { res.status(429).json({ error: "A transcription is already running or this audio channel was requested too recently." }); return; }
  const controller = new AbortController();
  const stop = () => controller.abort();
  res.once("close", stop);
  const timeout = setTimeout(stop, 30_000);
  const unwatch = watchSession(params.data.id, userId, session.roundNumber ?? 1, controller);
  try {
    const result = await handleTranscribeRequest({ audio: body.data.audio, language: session.language }, process.env, controller.signal);
    if (!await sessionStillUsable(params.data.id, userId, session.roundNumber ?? 1)) {
      res.status(409).json({ error: "Interview or access changed during transcription." }); return;
    }
    controller.signal.throwIfAborted();
    // Audio is request-scoped only; the renderer decides whether to save recognized text.
    res.status(result.status).json(result.body);
  } catch (error) {
    req.log.warn({ status: (error as { status?: number }).status }, "Audio transcription failed");
    res.status(502).json({ error: "Audio transcription failed. Capture has stopped; retry or type the question." });
  } finally { unwatch(); clearTimeout(timeout); res.off("close", stop); gate.leave(userId); }
});
export default router;
