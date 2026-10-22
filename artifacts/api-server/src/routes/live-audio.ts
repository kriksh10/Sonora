import { randomBytes } from "node:crypto";
import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { db, callSessionsTable } from "@workspace/db";
import { SendSessionLiveAudioBody } from "@workspace/api-zod";
import { roundMatches, sessionStillUsable, watchSession } from "../lib/session-lifecycle";
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
const leases = new Map<string, { userId: string; sessionId: string; round: number; touched: number; controller: AbortController; unwatch: () => void }>();
const cleanup = setInterval(() => {
  const now = Date.now();
  for (const [ticket, entry] of tickets) if (entry.expires < now) tickets.delete(ticket);
  for (const [id, lease] of leases) if (now - lease.touched > 60_000) void closeStream(id);
}, 15_000);
cleanup.unref();

function ensureStream(id: string, session: typeof callSessionsTable.$inferSelect, userId: string) {
  if (!streams.has(id)) {
    const controller = new AbortController();
    const unwatch = watchSession(session.id, userId, session.roundNumber ?? 1, controller);
    const lease = { userId, sessionId: session.id, round: session.roundNumber ?? 1, touched: Date.now(), controller, unwatch };
    leases.set(id, lease);
    controller.signal.addEventListener("abort", () => { void closeStream(id); }, { once: true });
    const pending = openSpeechStream(session.language, speechmaticsTerms([
      session.company, session.title, session.description, session.resumeText,
    ]));
    streams.set(id, pending);
    // Opening a ticket must not leave a rejected provider promise unhandled.
    void pending.catch(() => { if (streams.get(id) === pending) void closeStream(id); });
  }
  const lease = leases.get(id);
  if (lease) lease.touched = Date.now();
  return streams.get(id)!;
}

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
  const lease = leases.get(entry!.id);
  const authorized = lease ? sessionStillUsable(lease.sessionId, lease.userId, lease.round) : Promise.resolve(false);
  const abort = () => { closed = true; socket.close(); };
  lease?.controller.signal.addEventListener("abort", abort, { once: true });
  const idleTimer = setInterval(() => {
    if (!leases.has(entry!.id)) abort();
  }, 5000);
  idleTimer.unref();
  socket.on("close", () => {
    closed = true;
    clearInterval(idleTimer);
    lease?.controller.signal.removeEventListener("abort", abort);
    if (entry) void closeStream(entry.id);
  });
  socket.on("message", data => {
    if (closed) return;
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (bytes.length < 320 || bytes.length > 3_200 || bytes.length % 320 !== 0) return;
    void authorized.then(async usable => {
      if (!usable || closed || lease?.controller.signal.aborted || !leases.has(entry!.id)) { abort(); return; }
      const stream = await pending;
      if (closed || lease?.controller.signal.aborted) return;
      if (lease) lease.touched = Date.now();
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
  const lease = leases.get(id);
  leases.delete(id);
  lease?.unwatch();
  lease?.controller.abort();
  for (const [ticket, entry] of tickets) if (entry.id === id) tickets.delete(ticket);
  const pending = streams.get(id);
  streams.delete(id);
  const stream = await pending?.catch(() => undefined);
  stream?.close();
}

router.post("/sessions/:id/live-audio", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Sign in to transcribe audio." }); return; }
  const parsed = SendSessionLiveAudioBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Provide a valid microphone or call-audio request." }); return; }
  const { source, roundNumber } = parsed.data;
  const [session] = await db.select().from(callSessionsTable).where(and(
    eq(callSessionsTable.id, req.params.id), eq(callSessionsTable.userId, userId),
  )).limit(1);
  if (!session) { res.status(404).json({ error: "Session not found." }); return; }
  if (session.status === "ended" || !roundMatches(session.roundNumber, roundNumber)) {
    res.status(409).json({ error: "This interview round has ended or changed. Refresh it." }); return;
  }
  const id = `${streamKey(userId, session.id, source)}:${session.roundNumber ?? 1}`;
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
    // A new connection replaces the old capture rather than reusing a stale lease.
    await closeStream(id);
    if (streams.size >= 100) { res.status(503).json({ error: "Live transcription is busy. Phrase transcription will continue." }); return; }
    try { await ensureStream(id, session, userId); }
    catch { await closeStream(id); res.status(503).json({ error: "Live transcription is unavailable. Phrase transcription will continue." }); return; }
    const ticket = randomBytes(24).toString("hex");
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
    if (!streams.has(id) && streams.size >= 100) { res.status(503).json({ error: "Live transcription is busy. Phrase transcription will continue." }); return; }
    const pending = ensureStream(id, session, userId);
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
