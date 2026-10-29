import { Router, type RequestHandler } from "express";
import { getAuth } from "@clerk/express";
import { and, eq, sql } from "drizzle-orm";
import { db, appAccessTable, callSessionsTable, creditAccounts, creditLedger, sessionBilling } from "@workspace/db";
import { creditsForSession, findSku, FREE_SESSION_LIMIT } from "@workspace/pricing";
import { createTestCheckout, readPaidCheckout, stripeConfigured, catalogForClient } from "../billing/stripe-checkout";

const router = Router();
router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
router.param("id", (_req, res, next, id: string) => {
  if (!/^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i.test(id)) { res.status(400).json({ error: "Invalid session ID." }); return; }
  next();
});

// Must be mounted before JSON parsing. Stripe verifies the exact original bytes.
export const stripeWebhook: RequestHandler = async (req, res, next) => {
  if (!stripeConfigured()) { res.json({ comingSoon: true }); return; }
  let grant;
  try {
    const signature = req.get("stripe-signature");
    if (!signature || !Buffer.isBuffer(req.body)) throw new Error("Missing signature.");
    grant = readPaidCheckout(req.body.toString("utf8"), signature);
  } catch {
    res.status(400).json({ error: "Invalid checkout webhook signature." }); return;
  }
  if (!grant) { res.json({ received: true }); return; }
  try {
    await db.transaction(async tx => {
      const [receipt] = await tx.insert(creditLedger).values({
        userId: grant.userId, delta: grant.credits, reason: `stripe-test:${grant.sku}`,
        reference: `stripe:${grant.checkoutId}`,
      }).onConflictDoNothing().returning();
      if (!receipt) return;
      await tx.insert(creditAccounts).values({ userId: grant.userId }).onConflictDoNothing();
      const [account] = await tx.select().from(creditAccounts).where(eq(creditAccounts.userId, grant.userId)).for("update");
      await tx.update(creditAccounts).set({
        balance: account.balance + grant.credits,
        unlimitedUntil: grant.unlimitedHours ? new Date(Math.max(Date.now(), account.unlimitedUntil?.getTime() ?? 0) + grant.unlimitedHours * 3600_000) : account.unlimitedUntil,
      }).where(eq(creditAccounts.userId, grant.userId));
    });
    res.json({ received: true });
  } catch (cause) { next(cause); }
};

router.get("/billing/catalog", (_req, res) => { res.json(catalogForClient()); });
router.get("/billing/balance", async (req, res, next) => {
  try {
    const userId = getAuth(req).userId!;
    await db.insert(creditAccounts).values({ userId }).onConflictDoNothing();
    const [account] = await db.select().from(creditAccounts).where(eq(creditAccounts.userId, userId));
    const [access] = await db.select().from(appAccessTable).where(eq(appAccessTable.userId, userId));
    res.json({ balance: account.balance, freeRemaining: Math.max(0, FREE_SESSION_LIMIT - account.freeSessionsUsed),
      unlimitedUntil: account.unlimitedUntil, bypass: access?.role === "owner" || access?.role === "approver", checkout: stripeConfigured() });
  } catch (cause) { next(cause); }
});
router.post("/billing/checkout", async (req, res, next) => {
  if (!stripeConfigured()) { res.json({ comingSoon: true }); return; }
  if (typeof req.body?.sku !== "string" || !findSku(req.body.sku)) {
    res.status(400).json({ error: "Choose a valid plan or credit pack." }); return;
  }
  // Explicit, trusted deployment configuration only; never trust request Host/return URLs.
  const origin = process.env.SONORA_PUBLIC_URL;
  if (!origin || !/^https:\/\/[^/]+\/?$/.test(origin)) { res.json({ comingSoon: true }); return; }
  try {
    const root = origin.replace(/\/$/, "");
    res.json(await createTestCheckout({ userId: getAuth(req).userId!, sku: req.body.sku,
      successUrl: `${root}/dashboard?checkout=success`, cancelUrl: `${root}/pricing?checkout=cancelled` }));
  } catch (cause) { next(cause); }
});
router.put("/sessions/:id/billing", async (req, res, next) => {
  if (typeof req.body?.autoExtend !== "boolean") { res.status(400).json({ error: "Choose an auto-extend setting." }); return; }
  try {
    const userId = getAuth(req).userId!;
    const [session] = await db.select().from(callSessionsTable).where(and(eq(callSessionsTable.id, req.params.id), eq(callSessionsTable.userId, userId)));
    if (!session) { res.status(404).json({ error: "Session not found." }); return; }
    const [saved] = await db.insert(sessionBilling).values({ sessionId: session.id, userId, autoExtend: req.body.autoExtend })
      .onConflictDoUpdate({ target: sessionBilling.sessionId, set: { autoExtend: req.body.autoExtend } }).returning();
    res.json(saved);
  } catch (cause) { next(cause); }
});
router.get("/sessions/:id/billing", async (req, res, next) => {
  try {
    const userId = getAuth(req).userId!;
    const [session] = await db.select().from(callSessionsTable).where(and(eq(callSessionsTable.id, req.params.id), eq(callSessionsTable.userId, userId)));
    if (!session) { res.status(404).json({ error: "Session not found." }); return; }
    const [saved] = await db.select().from(sessionBilling).where(eq(sessionBilling.sessionId, session.id));
    res.json(saved ?? { sessionId: session.id, autoExtend: false, billedBlocks: 0 });
  } catch (cause) { next(cause); }
});
router.post("/billing/settle", async (req, res, next) => {
  if (typeof req.body?.sessionId !== "string" || !/^[\da-f-]{36}$/i.test(req.body.sessionId)) {
    res.status(400).json({ error: "Choose a valid session." }); return;
  }
  try {
    const userId = getAuth(req).userId!;
    const result = await db.transaction(async tx => {
      const [session] = await tx.select().from(callSessionsTable).where(and(eq(callSessionsTable.id, req.body.sessionId), eq(callSessionsTable.userId, userId))).for("update");
      if (!session) return { status: 404, body: { error: "Session not found." } };
      if (session.status !== "ended") return { status: 409, body: { error: "End this round before settling." } };
      await tx.insert(creditAccounts).values({ userId }).onConflictDoNothing();
      const [account] = await tx.select().from(creditAccounts).where(eq(creditAccounts.userId, userId)).for("update");
      const [access] = await tx.select().from(appAccessTable).where(eq(appAccessTable.userId, userId));
      const minutes = session.startedAt && session.endedAt ? Math.max(0, (session.endedAt.getTime() - session.startedAt.getTime()) / 60_000) : 0;
      const debit = creditsForSession({ role: access?.role ?? "user", freeSessionsUsed: account.freeSessionsUsed,
        elapsedMinutes: minutes, unlimitedUntilMs: account.unlimitedUntil?.getTime() ?? null, nowMs: Date.now() });
      const [receipt] = await tx.insert(creditLedger).values({ userId, sessionId: session.id, delta: -Math.min(account.balance, debit.credits),
        reason: debit.reason, reference: `session:${session.id}:round:${session.roundNumber}` }).onConflictDoNothing().returning();
      if (!receipt) return { status: 200, body: { settled: true, duplicate: true } };
      // Preview accounting never changes the existing approval-based usage policy.
      await tx.update(creditAccounts).set({ balance: account.balance + receipt.delta,
        freeSessionsUsed: debit.reason === "bypass" ? account.freeSessionsUsed : account.freeSessionsUsed + 1 }).where(eq(creditAccounts.userId, userId));
      await tx.insert(sessionBilling).values({ sessionId: session.id, userId, billedBlocks: debit.credits })
        .onConflictDoUpdate({ target: sessionBilling.sessionId, set: { billedBlocks: sql`${sessionBilling.billedBlocks} + ${debit.credits}` } });
      return { status: 200, body: { settled: true, credits: -receipt.delta, preview: true } };
    });
    res.status(result.status).json(result.body);
  } catch (cause) { next(cause); }
});
export default router;
