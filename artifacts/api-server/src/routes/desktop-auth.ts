import { Router, type Request } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import { randomInt } from "node:crypto";
import { and, eq, gt, lt, sql } from "drizzle-orm";
import { db, desktopAuthRequestsTable as requests } from "@workspace/db";
import { StartDesktopAuthBody, ApproveDesktopAuthBody, PollDesktopAuthBody } from "@workspace/api-zod";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";
import { logger } from "../lib/logger";
import { createDesktopAuthLimiter, desktopAuthLifetimeMs, matchesProof, proofHash, sameOriginApproval } from "../lib/desktop-auth-security";

const router = Router();
const permit = createDesktopAuthLimiter();
const path = "/desktop-auth/requests";
const active = (id: string) => and(eq(requests.id, id), gt(requests.expiresAt, new Date()));
const publicState = (row: { status: string; expiresAt: Date }) => ({ status: row.status, expiresAt: row.expiresAt.toISOString() });
const clientKey = (req: Request) => req.ip || req.socket.remoteAddress || "unknown";

router.use("/desktop-auth", (_req, res, next) => {
  res.set({ "Cache-Control": "no-store", Pragma: "no-cache", "Referrer-Policy": "no-referrer" });
  next();
});
router.param("id", (_req, res, next, id) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    res.status(400).json({ error: "Invalid desktop request." }); return;
  }
  next();
});
router.post(path, async (req, res) => {
  const parsed = StartDesktopAuthBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid desktop challenge." }); return; }
  if (!permit(`start:${clientKey(req)}`, 30)) {
    res.status(429).json({ error: "Too many sign-in requests. Try again in five minutes." }); return;
  }
  await db.delete(requests).where(lt(requests.expiresAt, new Date()));
  const code = randomInt(100000, 1000000).toString();
  const [row] = await db.insert(requests).values({
    challenge: parsed.data.challenge, codeHash: proofHash(code),
    expiresAt: new Date(Date.now() + desktopAuthLifetimeMs),
  }).returning();
  res.status(201).json({ id: row.id, code, expiresAt: row.expiresAt.toISOString() });
});
router.get(`${path}/:id`, async (req, res) => {
  const [row] = await db.select().from(requests).where(active(String(req.params.id))).limit(1);
  if (!row) { res.status(410).json({ error: "This desktop request expired. Start again in Sonora." }); return; }
  res.json(publicState(row));
});
router.post(`${path}/:id/approve`, async (req, res) => {
  const userId = getAuth(req).userId;
  if (!userId) { res.status(401).json({ error: "Sign in before connecting Sonora desktop." }); return; }
  if (!sameOriginApproval(req.get("origin"), getClerkProxyHost(req), req.get("sec-fetch-site"))) {
    res.status(403).json({ error: "Approve from the Sonora browser page." }); return;
  }
  const parsed = ApproveDesktopAuthBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Enter the six-digit code shown in Sonora desktop." }); return; }
  const id = String(req.params.id);
  const [row] = await db.select().from(requests).where(active(id)).limit(1);
  if (!row) { res.status(410).json({ error: "This desktop request expired. Start again in Sonora." }); return; }
  if (row.status !== "pending") { res.status(409).json({ error: "This request is no longer awaiting approval." }); return; }
  // Each attempt increments atomically, including valid attempts racing invalid ones.
  const [attempt] = await db.update(requests).set({ attempts: sql`${requests.attempts} + 1` })
    .where(and(active(id), eq(requests.status, "pending"), lt(requests.attempts, 5))).returning();
  if (!attempt) { res.status(429).json({ error: "Code attempts exhausted. Start a new request in Sonora." }); return; }
  if (!matchesProof(parsed.data.code, row.codeHash)) {
    res.status(400).json({ error: "Code does not match the requesting Sonora desktop." }); return;
  }
  const [approved] = await db.update(requests).set({ status: "approved", userId })
    .where(and(active(id), eq(requests.status, "pending"))).returning();
  if (!approved) { res.status(409).json({ error: "This request was cancelled or already approved." }); return; }
  res.json(publicState(approved));
});
router.post(`${path}/:id/poll`, async (req, res) => {
  const parsed = PollDesktopAuthBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid desktop proof." }); return; }
  const id = String(req.params.id);
  const [row] = await db.select().from(requests).where(active(id)).limit(1);
  if (!row || !matchesProof(parsed.data.verifier, row.challenge)) {
    res.status(410).json({ error: "Desktop request expired or could not be verified. Start again." }); return;
  }
  if (row.status === "pending" || row.status === "exchanging") { res.json({ status: "pending" }); return; }
  if (row.status !== "approved" || !row.userId) {
    res.status(410).json({ error: "Desktop request was cancelled or already used. Start again." }); return;
  }
  const [claimed] = await db.update(requests).set({ status: "exchanging" })
    .where(and(active(id), eq(requests.status, "approved"))).returning();
  if (!claimed) { res.json({ status: "pending" }); return; }
  try {
    const client = clerkClient;
    const token = await client.signInTokens.createSignInToken({ userId: claimed.userId!, expiresInSeconds: 60 });
    const [consumed] = await db.update(requests).set({ status: "consumed", userId: null })
      .where(and(active(id), eq(requests.status, "exchanging"))).returning();
    if (!consumed) {
      await client.signInTokens.revokeSignInToken(token.id);
      res.status(410).json({ error: "This request was cancelled or expired. Start again." }); return;
    }
    res.json({ status: "complete", ticket: token.token });
  } catch (error) {
    await db.update(requests).set({ status: "approved" })
      .where(and(active(id), eq(requests.status, "exchanging")));
    logger.error({ status: (error as { status?: number }).status }, "Desktop authorization exchange failed");
    res.status(503).json({ error: "Could not complete desktop sign-in. Retry or start a new request." });
  }
});
router.post(`${path}/:id/cancel`, async (req, res) => {
  const parsed = PollDesktopAuthBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid desktop proof." }); return; }
  const id = String(req.params.id);
  const [row] = await db.select().from(requests).where(active(id)).limit(1);
  if (!row || !matchesProof(parsed.data.verifier, row.challenge)) {
    res.status(410).json({ error: "This desktop request is no longer available." }); return;
  }
  const [cancelled] = await db.update(requests).set({ status: "cancelled", userId: null })
    .where(and(active(id), sql`${requests.status} IN ('pending', 'approved', 'exchanging')`)).returning();
  res.json(publicState(cancelled ?? row));
});
export default router;
