import { and, eq, sql } from "drizzle-orm";
import { db, callSessionsTable, appAccessTable } from "@workspace/db";
import { hasApprovedAccess } from "./app-access";

export function roundMatches(current: number | undefined, requested: number | undefined) {
  return (current ?? 1) === (requested ?? 1);
}
export function approvedWriteCondition(userId: string) {
  return sql`exists (select 1 from ${appAccessTable} where ${appAccessTable.userId} = ${userId} and ${appAccessTable.status} = 'approved')`;
}
const operations = new Map<string, Set<AbortController>>();
const key = (id: string, userId: string) => `${userId}:${id}`;
export function stopSessionOperations(id: string, userId: string) {
  for (const controller of operations.get(key(id, userId)) ?? []) controller.abort();
}
export async function sessionStillUsable(id: string, userId: string, roundNumber: number) {
  if (!await hasApprovedAccess(userId)) return false;
  const [current] = await db.select().from(callSessionsTable)
    .where(and(eq(callSessionsTable.id, id), eq(callSessionsTable.userId, userId))).limit(1);
  return !!current && current.status !== "ended" && roundMatches(current.roundNumber, roundNumber);
}
export function watchSession(id: string, userId: string, roundNumber: number, controller: AbortController) {
  const idKey = key(id, userId);
  const group = operations.get(idKey) ?? new Set<AbortController>();
  group.add(controller); operations.set(idKey, group);
  let checking = false;
  const timer = setInterval(() => {
    if (checking) return;
    checking = true;
    void sessionStillUsable(id, userId, roundNumber).then(ok => { if (!ok) controller.abort(); })
      .catch(() => controller.abort()).finally(() => { checking = false; });
  }, 5000);
  return () => {
    clearInterval(timer); group.delete(controller);
    if (!group.size) operations.delete(idKey);
  };
}
