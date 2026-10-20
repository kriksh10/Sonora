import { Router } from "express";
import { and, desc, eq } from "drizzle-orm";
import { db, appAccessTable } from "@workspace/db";
import { ChangeUserAccessBody } from "@workspace/api-zod";
import { accessUser, ensureAccess, publicAccess, mayChangeAccess } from "../lib/app-access";
import { sameOriginApproval } from "../lib/desktop-auth-security";
import { getClerkProxyHost } from "../middlewares/clerkProxyMiddleware";

const router = Router();
router.use("/access", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  if (!accessUser(req)) { res.status(401).json({ error: "Sign in first." }); return; }
  if (req.method !== "GET" && !sameOriginApproval(req.get("origin"), getClerkProxyHost(req), req.get("sec-fetch-site"))) {
    res.status(403).json({ error: "Manage access from the Sonora app." }); return;
  }
  next();
});
router.get("/access/status", async (req, res) => res.json(publicAccess(await ensureAccess(accessUser(req)!))));
router.post("/access/request", async (req, res) => {
  const row = await ensureAccess(accessUser(req)!);
  if (row.status === "pending" && !row.requested) {
    await db.update(appAccessTable).set({ requested: true, updatedAt: new Date() })
      .where(and(eq(appAccessTable.userId, row.userId), eq(appAccessTable.status, "pending")));
  }
  res.json(publicAccess(await ensureAccess(row.userId)));
});
router.get("/access/users", async (req, res) => {
  const actor = await ensureAccess(accessUser(req)!);
  if (actor.status !== "approved" || !["owner", "approver"].includes(actor.role)) {
    res.status(403).json({ error: "Approval permission required." }); return;
  }
  const rows = await db.select().from(appAccessTable)
    .where(actor.role === "approver"
      ? and(eq(appAccessTable.status, "pending"), eq(appAccessTable.requested, true), eq(appAccessTable.role, "user"))
      : undefined).orderBy(desc(appAccessTable.updatedAt)).limit(500);
  res.json(rows.map(row => ({ ...publicAccess(row), userId: row.userId, updatedAt: row.updatedAt.toISOString() })));
});
router.patch("/access/users/:userId", async (req, res) => {
  const body = ChangeUserAccessBody.strict().safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Choose Approve, Deny or Revoke." }); return; }
  const actorId = accessUser(req)!;
  const result = await db.transaction(async tx => {
    // Lock actor too: a concurrently revoked approver must not grant new access.
    const records = await tx.select().from(appAccessTable).orderBy(appAccessTable.userId).for("update");
    const actor = records.find(row => row.userId === actorId);
    const target = records.find(row => row.userId === req.params.userId);
    if (!actor || !target || !mayChangeAccess(actor, target, body.data.action)) return null;
    const status = body.data.action === "approve" ? "approved" : body.data.action === "deny" ? "denied" : "revoked";
    const [updated] = await tx.update(appAccessTable).set({ status, updatedAt: new Date() })
      .where(eq(appAccessTable.userId, target.userId)).returning();
    return updated;
  });
  if (!result) { res.status(403).json({ error: "This access change is not permitted. Refresh the request list." }); return; }
  res.json({ ...publicAccess(result), userId: result.userId, updatedAt: result.updatedAt.toISOString() });
});
export default router;
