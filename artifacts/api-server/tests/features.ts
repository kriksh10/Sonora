// Private test harness only: synthetic identities + real development database.
// Never imported by the production app, and never installed as a public route.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import express from "express";
import { eq, like } from "drizzle-orm";
import { db, pool, appAccessTable, callSessionsTable, answerDefaultsTable } from "@workspace/db";
import sessions from "../src/routes/sessions";
import lifecycle from "../src/routes/session-lifecycle";
import access from "../src/routes/access";
import files from "../src/routes/files";
import { ensureAccess, requireApprovedAccess } from "../src/lib/app-access";
import { legacyDoc } from "./word-fixtures";

const prefix = `fixture-${randomUUID()}-`;
const uid = (name: string) => `${prefix}${name}`;
const app = express();
app.use(express.json({ limit: "1mb" }));
app.use((req, _res, next) => {
  if (!String(req.headers["x-test-user"] ?? "").startsWith(prefix)) delete req.headers["x-test-user"];
  next();
});
app.use("/api", access);
app.use("/api", requireApprovedAccess, files, lifecycle, sessions);
app.use(((error: Error & { status?: number }, _req: unknown, res: express.Response, _next: unknown) => {
  res.status(error.status ?? 500).json({ error: error.message });
}) as express.ErrorRequestHandler);
const server = createServer(app);
let origin = "";
let assertions = 0;
async function request(method: string, route: string, user: string | null = "owner", data?: unknown, expected = 200) {
  const response = await fetch(`${origin}/api${route}`, {
    method, headers: { ...(user ? { "x-test-user": uid(user) } : {}), Origin: origin,
      "Content-Type": Buffer.isBuffer(data) ? "application/octet-stream" : "application/json" },
    body: data === undefined ? undefined : Buffer.isBuffer(data) ? new Uint8Array(data) : JSON.stringify(data),
  });
  const body = response.status === 204 ? null : await response.json();
  assert.equal(response.status, expected, `${method} ${route}: ${JSON.stringify(body)}`);
  assertions++;
  return body;
}
try {
  process.env.SONORA_OWNER_EMAIL = "fixtureowner@example.invalid";
  await db.insert(appAccessTable).values([
    { userId: uid("owner"), email: "owner@example.invalid", role: "owner", status: "approved" },
    { userId: uid("approver"), email: "approver@example.invalid", role: "approver", status: "approved" },
    { userId: uid("member"), email: "member@example.invalid", role: "user", status: "approved" },
    { userId: uid("pending"), email: "pending@example.invalid", role: "user", status: "pending", requested: true },
    { userId: uid("new"), email: "new@example.invalid", role: "user", status: "pending" },
  ]);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  await request("GET", "/sessions", null, undefined, 401);
  await request("GET", "/sessions", "pending", undefined, 403);
  await request("GET", "/access/users", "member", undefined, 403);
  const restricted = await request("GET", "/access/users", "approver");
  assert.ok(restricted.every((row: { status: string; role: string }) => row.status === "pending" && row.role === "user"));
  await request("PATCH", `/access/users/${uid("pending")}`, "approver", { action: "deny" }, 403);
  await request("PATCH", `/access/users/${uid("pending")}`, "pending", { action: "approve" }, 403);
  await request("PATCH", `/access/users/${uid("pending")}`, "approver", { action: "approve", role: "owner" }, 400);
  await request("PATCH", `/access/users/${uid("pending")}`, "approver", { action: "approve" });
  await request("GET", "/sessions", "pending");
  await request("PATCH", `/access/users/${uid("pending")}`, "owner", { action: "revoke" });
  await request("GET", "/sessions", "pending", undefined, 403);
  await request("PATCH", `/access/users/${uid("pending")}`, "approver", { action: "approve" }, 403);
  await request("POST", "/access/request", "new");
  const requestState = await request("GET", "/access/status", "new");
  assert.equal(requestState.requested, true);
  const seeded = await ensureAccess(uid("newowner"));
  assert.equal(seeded.role, "owner"); assert.equal(seeded.status, "approved");
  await db.update(appAccessTable).set({ status: "revoked" }).where(eq(appAccessTable.userId, seeded.userId));
  assert.equal((await ensureAccess(seeded.userId)).status, "revoked");
  const body = { sessionType: "interview", title: "Synthetic interview", company: "Example",
    description: "Engineer", resumeText: "Synthetic Python experience", documentsText: "", instructions: "",
    model: "gemini-2.5-flash", language: "English", autoAnswer: false, saveTranscript: true };
  const created = await request("POST", "/sessions", "member", body, 201);
  const route = `/sessions/${created.id}`;
  await request("GET", route, "owner", undefined, 404); // Admin has no private-history bypass.
  await request("DELETE", route, "member", undefined, 409);
  await request("PATCH", route, "member", { status: "active", roundNumber: 1 });
  await request("POST", `${route}/transcript`, "member", { text: "Round one saved", role: "user", source: "typed", roundNumber: 1 });
  await request("PATCH", route, "member", { status: "ended", roundNumber: 1 });
  await request("POST", `${route}/restart`, "owner", { requestId: randomUUID() }, 404);
  const restart = { requestId: randomUUID() };
  const [first, retry] = await Promise.all([
    request("POST", `${route}/restart`, "member", restart), request("POST", `${route}/restart`, "member", restart),
  ]);
  assert.equal(first.roundNumber, 2); assert.equal(retry.roundNumber, 2);
  assert.equal(first.startedAt, null); assert.equal(first.endedAt, null); assert.equal(first.status, "ready");
  assert.equal(first.rounds.length, 1); assert.equal(first.transcript[0].text, "Round one saved");
  assert.equal(first.resumeText, body.resumeText);
  await request("PATCH", route, "member", { status: "ended", roundNumber: 1 }, 400);
  await request("POST", `${route}/transcript`, "member", { text: "Stale speech", role: "user", source: "typed", roundNumber: 1 }, 409);
  await request("PATCH", route, "member", { status: "active", roundNumber: 2 });
  await request("PATCH", `${route}/preferences`, "member", { saveTranscript: false });
  await request("POST", `${route}/transcript`, "member", { text: "Unsaved new round", role: "user", source: "typed", roundNumber: 2 });
  const loaded = await request("GET", route, "member");
  assert.equal(loaded.transcript.length, 1);
  await request("PATCH", route, "member", { status: "ended", roundNumber: 2 });
  await request("DELETE", route, "owner", undefined, 404);
  await request("DELETE", route, "member", undefined, 204);
  await request("GET", route, "member", undefined, 404);
  await request("POST", `${route}/transcript`, "member", { text: "Late", role: "user", source: "typed", roundNumber: 2 }, 404);
  const docx = Buffer.from("UEsDBBQAAAAIAOshVF2sbhJangAAANwAAAATAAAAW0NvbnRlbnRfVHlwZXNdLnhtbF2PsQ7CMBBDf6XKitqrGBhQ24UdGPiBU3JtI5pLlBwF/p4EpA6Mlu1nubu9A6Xq5RZOvZpFwhEg6ZkcpsYH4uyMPjqULOMEAfUdJ4J92x5AexZiqaUw1NBdVorRGqquGOWMjnoFTx8NGK8fLiebTFPV6Vcry73CEBarUaxnWNn8bdZ+HK2mrV9oIXpNKVme3NJsjkPLu4KHoYPvqeEDUEsDBBQAAAAIAOshVF3jMqZrtgAAABkBAAARAAAAd29yZC9kb2N1bWVudC54bWxtkEEKwjAQRa8SegCnuHARajfizoXiCdJkbAPJJCQpbXcewhN6EptWEcTN+wwz8ximGrhysrdIiY3WUOTDvuhS8hwgyg6tiBvnkebezQUr0lyGFgYXlA9OYoyaWmtgW5Y7sEJTUVcDb5yacvqMkJHq4yisN8gOgpRWIiF73h/sPKXOEUNqNSGGCvJoZli4CFJjllhF8ld8vZzY7GTSuF4xHD0GjSTxjwvWfVhl8FbD52D4PqN+AVBLAQIUAxQAAAAIAOshVF2sbhJangAAANwAAAATAAAAAAAAAAAAAACAAQAAAABbQ29udGVudF9UeXBlc10ueG1sUEsBAhQDFAAAAAgA6yFUXeMypmu2AAAAGQEAABEAAAAAAAAAAAAAAIABzwAAAHdvcmQvZG9jdW1lbnQueG1sUEsFBgAAAAACAAIAgAAAALQBAAAAAA==", "base64");
  const extracted = await request("POST", "/files/extract", "member", docx);
  assert.match(extracted.text, /Python engineer/); assert.match(extracted.text, /SQL and cloud/);
  const classic = await request("POST", "/files/extract", "member", legacyDoc("Synthetic legacy Word resume\rSQL engineer"));
  assert.match(classic.text, /legacy Word resume/); assert.match(classic.text, /SQL engineer/);
  await request("POST", "/files/extract", "member", legacyDoc(""), 422);
  const bomb = Buffer.from(docx);
  bomb.writeUInt32LE(50 * 1024 * 1024, bomb.indexOf(Buffer.from("504b0102", "hex")) + 24);
  await request("POST", "/files/extract", "member", bomb, 422);
  await request("POST", "/files/extract", "pending", docx, 403);
  await request("POST", "/files/extract", "member", Buffer.from("damaged Word"), 422);
  await request("POST", "/files/extract", "member", Buffer.alloc(12 * 1024 * 1024 + 1), 413);
  console.log(`PASS: ${assertions} HTTP checks plus real-database round/history, ownership, approval and DOCX assertions.`);
} finally {
  await new Promise<void>(resolve => server.close(() => resolve()));
  await db.delete(callSessionsTable).where(like(callSessionsTable.userId, `${prefix}%`));
  await db.delete(answerDefaultsTable).where(like(answerDefaultsTable.userId, `${prefix}%`));
  await db.delete(appAccessTable).where(like(appAccessTable.userId, `${prefix}%`));
  await pool.end();
}
