import { Router } from "express";
import { getAuth } from "@clerk/express";
import { and, eq } from "drizzle-orm";
import { db, callSessionsTable } from "@workspace/db";
import { GetSessionParams, RestartSessionBody } from "@workspace/api-zod";
import { withAnswerPreferences } from "../lib/answer-preferences";
import { stopSessionOperations } from "../lib/session-lifecycle";

const router = Router();
router.param("id", (_req, res, next, id) => {
  if (!GetSessionParams.safeParse({ id }).success) { res.status(400).json({ error: "Invalid interview." }); return; }
  next();
});
router.post("/sessions/:id/restart", async (req, res) => {
  const userId = getAuth(req).userId!;
  const input = RestartSessionBody.strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "A valid restart request ID is required." }); return; }
  const result = await db.transaction(async tx => {
    const [current] = await tx.select().from(callSessionsTable).where(and(
      eq(callSessionsTable.id, req.params.id), eq(callSessionsTable.userId, userId),
    )).for("update");
    if (!current) return { status: 404, error: "Interview not found." } as const;
    if (current.restartRequestId === input.data.requestId) return { session: current };
    if ((current.roundNumber ?? 1) !== (input.data.roundNumber ?? 1)) {
      return { status: 409, error: "This round changed before your restart request. Refresh the interview." } as const;
    }
    if (current.status !== "ended") return { status: 409, error: "End the current round before starting the next one." } as const;
    const rounds = [...(current.rounds ?? []), {
      number: current.roundNumber ?? 1,
      startedAt: current.startedAt?.toISOString() ?? null,
      endedAt: current.endedAt?.toISOString() ?? null,
    }];
    const [updated] = await tx.update(callSessionsTable).set({
      status: "ready", startedAt: null, endedAt: null,
      roundNumber: (current.roundNumber ?? 1) + 1, rounds, restartRequestId: input.data.requestId,
    }).where(eq(callSessionsTable.id, current.id)).returning();
    return { session: updated };
  });
  if ("error" in result) { res.status(result.status!).json({ error: result.error }); return; }
  stopSessionOperations(req.params.id, userId);
  res.json(withAnswerPreferences(result.session!));
});
router.delete("/sessions/:id", async (req, res) => {
  const userId = getAuth(req).userId!;
  const condition = and(eq(callSessionsTable.id, req.params.id), eq(callSessionsTable.userId, userId));
  const deleted = await db.delete(callSessionsTable).where(and(condition, eq(callSessionsTable.status, "ended"))).returning({ id: callSessionsTable.id });
  if (!deleted.length) {
    const [existing] = await db.select({ id: callSessionsTable.id }).from(callSessionsTable).where(condition).limit(1);
    res.status(existing ? 409 : 404).json({ error: existing ? "End this interview before deleting it." : "Interview not found." }); return;
  }
  stopSessionOperations(req.params.id, userId);
  res.status(204).end();
});
export default router;
