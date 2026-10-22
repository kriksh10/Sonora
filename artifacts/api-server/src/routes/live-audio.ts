import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { db, callSessionsTable } from "@workspace/db";
import { roundMatches, sessionStillUsable } from "../lib/session-lifecycle";
import { openSpeechStream, speechmaticsTerms, type SpeechStream } from "../lib/speechmatics";

const router: IRouter = Router();

const streams = new Map<string, Promise<SpeechStream>>();
const streamKey = (userId: string, sessionId: string, source: string) => `${userId}:${sessionId}:${source}`;

function validFrame(audio: string) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(audio) || audio.length % 4 !== 0 || audio.length > 8_000) return false;
  const bytes = Buffer.from(audio, "base64").length;
  return bytes >= 320 && bytes <= 3_200 && bytes % 320 === 0;
}

const tickets = new Map<string, { id: string; expires: number }>();

export function bindLiveSocket(ticket: string, socket: {
  on: (event: "message" | "close", listener: (data: Buffer) => void) => void;
  send: (data: string) => void;
  close: () => void;
}) {
  const entry = tickets.get(ticket);
  tickets.delete(ticket);
  const pending = entry && entry.expires > Date.now() ? streams.get(entry.id) : undefined;
  if (!pending) { socket.close(); return; }
  let closed = false;
  socket.on("close", () => { closed = true; if (entry) void closeStream(entry.id); });
  socket.on("message", data => {
    if (closed) return;
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (bytes.length < 320 || bytes.length > 3_200 || bytes.length % 320 !== 0) return;
    void pending.then(stream => {
      stream.send(bytes);
      const finished = stream.takeFinal();
      const partial = stream.partial();
      if (!finished?.text && !partial) return;
      socket.send(JSON.stringify({
        accepted: true, text: finished?.text ?? "", final: Boolean(finished?.text),
        partial, speaker: finished?.speaker ?? "",
      }));
    }).catch(() => { if (!closed) socket.close(); });
  });
}

async function closeStream(id: string) {
  const pending = streams.get(id);
  streams.delete(id);
  const stream = await pending?.catch(() => undefined);
  stream?.close();
}

router.post("/sessions/:id/live-audio", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Sign in to transcribe audio." }); return; }
  const source = req.body?.source === "system" ? "system" : req.body?.source === "microphone" ? "microphone" : "";
  const roundNumber = typeof req.body?.roundNumber === "number" ? req.body.roundNumber : undefined;
  if (!source) { res.status(400).json({ error: "Provide a microphone or call-audio source." }); return; }
  const [session] = await db.select().from(callSessionsTable).where(and(
    eq(callSessionsTable.id, req.params.id), eq(callSessionsTable.userId, userId),
  )).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found." }); return; }
  if (session.status === "ended" || !roundMatches(session.roundNumber, roundNumber)) {
    res.status(409).json({ error: "This interview round has ended or changed. Refresh it." }); return;
  }
  const id = streamKey(userId, session.id, source);
  if (req.body?.stop === true) {
    await closeStream(id);
    res.json({ accepted: false, text: "", final: false, partial: "" });
    return;
  }
  if (req.body?.open === true) {
    if (!await sessionStillUsable(session.id, userId, session.roundNumber ?? 1)) {
      res.status(409).json({ error: "Interview or access changed during transcription." }); return;
    }
    if (!process.env.SPEECHMATICS_API_KEY) {
      res.status(503).json({ error: "Live transcription is not configured. Phrase transcription will continue." }); return;
    }
    const ticket = randomBytes(24).toString("hex");
    if (!streams.has(id)) {
      streams.set(id, openSpeechStream(session.language, speechmaticsTerms([
        session.company, session.title, session.description, session.resumeText,
      ])));
    }
    tickets.set(ticket, { id, expires: Date.now() + 30_000 });
    res.json({ ticket });
    return;
  }
  if (typeof req.body?.audio !== "string" || !validFrame(req.body.audio)) {
    res.status(400).json({ error: "Provide a 10 millisecond mono PCM frame." }); return;
  }
  if (!process.env.SPEECHMATICS_API_KEY) {
    res.status(503).json({ error: "Live transcription is not configured. Phrase transcription will continue." }); return;
  }
  if (!await sessionStillUsable(session.id, userId, session.roundNumber ?? 1)) {
    res.status(409).json({ error: "Interview or access changed during transcription." }); return;
  }
  try {
    let pending = streams.get(id);
    if (!pending) {
      pending = openSpeechStream(session.language, speechmaticsTerms([
        session.company, session.title, session.description, session.resumeText,
      ]));
      streams.set(id, pending);
    }
    const stream = await pending;
    stream.send(Buffer.from(req.body.audio, "base64"));
    const finished = stream.takeFinal();
    res.json({
      accepted: true, text: finished?.text ?? "", final: Boolean(finished?.text),
      partial: stream.partial(), speaker: finished?.speaker ?? "",
    });
  } catch {
    await closeStream(id);
    res.status(503).json({ error: "Live transcription is unavailable. Phrase transcription will continue." });
  }
});

export default router;
