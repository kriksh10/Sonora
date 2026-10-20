import { clerkClient, getAuth } from "@clerk/express";
import type { Request, RequestHandler } from "express";
import { and, eq } from "drizzle-orm";
import { db, appAccessTable, type AppAccess } from "@workspace/db";

export function configuredRole(email: string, owner: string, approver: string): AppAccess["role"] {
  const normalized = email.trim().toLowerCase();
  if (owner && normalized === owner.trim().toLowerCase()) return "owner";
  if (approver && normalized === approver.trim().toLowerCase()) return "approver";
  return "user";
}
export function mayChangeAccess(actor: AppAccess, target: AppAccess, action: string) {
  if (actor.status !== "approved" || actor.userId === target.userId || target.role === "owner") return false;
  if (actor.role === "owner") {
    return action === "approve" ? target.status !== "approved"
      : action === "deny" ? target.status === "pending"
      : action === "revoke" && target.status === "approved";
  }
  return actor.role === "approver" && target.role === "user" && target.requested &&
    target.status === "pending" && action === "approve";
}
export async function ensureAccess(userId: string): Promise<AppAccess> {
  const owner = process.env.SONORA_OWNER_EMAIL?.trim();
  if (!owner) throw Object.assign(new Error("Access setup is incomplete. The publisher must configure the owner account."), { status: 503 });
  const [known] = await db.select().from(appAccessTable).where(eq(appAccessTable.userId, userId)).limit(1);
  if (known) return known; // Never re-grant seeded permissions after a revocation.
  const user = await clerkClient.users.getUser(userId);
  const primary = user.emailAddresses.find(email => email.id === user.primaryEmailAddressId);
  if (!primary || primary.verification?.status !== "verified") {
    throw Object.assign(new Error("Verify your primary sign-in email before requesting access."), { status: 403 });
  }
  const role = configuredRole(primary.emailAddress, owner, process.env.SONORA_APPROVER_EMAIL ?? "");
  await db.insert(appAccessTable).values({
    userId, email: primary.emailAddress.toLowerCase(), role,
    status: role === "user" ? "pending" : "approved", bootstrapApplied: role !== "user",
  }).onConflictDoNothing();
  const [saved] = await db.select().from(appAccessTable).where(eq(appAccessTable.userId, userId)).limit(1);
  return saved;
}
export async function hasApprovedAccess(userId: string) {
  const [row] = await db.select({ id: appAccessTable.userId }).from(appAccessTable)
    .where(and(eq(appAccessTable.userId, userId), eq(appAccessTable.status, "approved"))).limit(1);
  return !!row;
}
export function publicAccess(row: AppAccess) {
  return { status: row.status, role: row.role, email: row.email, requested: row.requested };
}
export function accessUser(req: Request) { return getAuth(req).userId; }
export const requireApprovedAccess: RequestHandler = async (req, res, next) => {
  const userId = accessUser(req);
  if (!userId) { res.status(401).json({ error: "Sign in to use Sonora." }); return; }
  try {
    const row = await ensureAccess(userId);
    if (row.status !== "approved") {
      res.status(403).json({ error: "Sonora access requires approval.", accessStatus: row.status }); return;
    }
    next();
  } catch (error) { next(error); }
};
