const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const { buildSync } = require("esbuild");
const express = require("express");
const dbRequire = require("node:module").createRequire(path.resolve(__dirname, "../../../lib/db/package.json"));
process.env.NODE_ENV = "production"; // Keep the test harness free of logging worker threads.

const code = buildSync({
  stdin: { contents: `
    export { default as billing, stripeWebhook } from "./src/routes/billing";
    export { default as tools } from "./src/routes/session-tools";
    export { default as transcription } from "./src/routes/transcription";
    export { default as sessions } from "./src/routes/sessions";
    export { requireApprovedAccess } from "./src/lib/app-access";
    export { titleForNewSession } from "./src/routes/session-create-title";
    export { stripeConfigured, grantFromCheckout, readPaidCheckout } from "./src/billing/stripe-checkout";
    export { db, pool, appAccessTable, callSessionsTable, creditAccounts, creditLedger, sessionBilling, sessionNotes, questionBanks } from "@workspace/db";
    export { eq } from "drizzle-orm";
  `, resolveDir: path.resolve(__dirname, ".."), sourcefile: "integration-entry.ts" },
  bundle: true, write: false, platform: "node", format: "cjs",
  external: ["express", "@clerk/express", "pg", "stripe", "@google/genai", "pino"],
}).outputFiles[0].text;
let currentUser = null;
const loaded = { exports: {} };
new Function("module", "exports", "require", code)(loaded, loaded.exports, name =>
  name === "@clerk/express" ? { getAuth: () => ({ userId: currentUser }), clerkClient: {} } : name === "pg" ? dbRequire(name) : require(name));
const m = loaded.exports;

test("merged routes preserve approval and persist tools; settlement is replay-safe", async () => {
  const userId = `qa-merge-${randomUUID()}`;
  const pendingId = `qa-pending-${randomUUID()}`;
  const otherId = `qa-other-${randomUUID()}`;
  process.env.SONORA_OWNER_EMAIL ||= "qa-owner@example.invalid";
  const app = express();
  app.post("/api/billing/webhook", express.raw({ type: "application/json" }), m.stripeWebhook);
  app.use(express.json());
  app.use((req, _res, next) => { req.log = { warn() {}, error() {}, info() {} }; next(); });
  app.use("/api", m.requireApprovedAccess, m.billing, m.tools, m.transcription, m.sessions);
  app.use((err, _req, res, _next) => res.status(500).json({ error: err.message }));
  const server = app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  const request = async (url, method = "GET", data) => {
    const res = await fetch(origin + url, { method, headers: { "Content-Type": "application/json" }, ...(data ? { body: JSON.stringify(data) } : {}) });
    return { status: res.status, body: await res.json() };
  };
  let session;
  try {
    await m.db.insert(m.appAccessTable).values([
      { userId, email: `${userId}@example.invalid`, status: "approved", role: "user" },
      { userId: pendingId, email: `${pendingId}@example.invalid`, status: "pending", role: "user" },
      { userId: otherId, email: `${otherId}@example.invalid`, status: "approved", role: "user" },
    ]);
    currentUser = userId;
    const created = await request("/sessions", "POST", {
      sessionType: "mock", title: "Engineer – QA integration", company: "QA",
      model: "gemini-2.5-pro", language: "Telugu", resumeText: "Synthetic QA resume",
    });
    assert.equal(created.status, 201);
    session = created.body;
    assert.equal(session.title, "Engineer – QA integration");
    assert.equal(session.sessionType, "mock");
    assert.equal(session.model, "gemini-2.5-pro");
    assert.equal(session.language, "Telugu");
    assert.equal(session.resumeText, "Synthetic QA resume");
    await m.db.update(m.callSessionsTable).set({
      model: "gemini-2.5-flash", language: "English",
      status: "ended", startedAt: new Date(Date.now() - 60_000), endedAt: new Date(),
    }).where(m.eq(m.callSessionsTable.id, session.id));
    currentUser = null;
    assert.equal((await request("/billing/balance")).status, 401);
    currentUser = pendingId;
    assert.equal((await request("/billing/balance")).status, 403);
    assert.equal((await request(`/sessions/${session.id}/notes`)).status, 403);
    currentUser = otherId;
    assert.equal((await request(`/sessions/${session.id}/notes`)).status, 404);
    currentUser = userId;
    assert.equal((await request("/billing/balance")).body.freeRemaining, 10);
    const notes = { summary: "A real persisted note", questionsAsked: "Explain queues", nextSteps: "Practice", score: 73 };
    assert.equal((await request(`/sessions/${session.id}/notes`, "PUT", notes)).status, 200);
    assert.equal((await request(`/sessions/${session.id}/notes`)).body.summary, notes.summary);
    assert.equal((await request(`/sessions/${session.id}/notes`, "PUT", { ...notes, score: 101 })).status, 400);
    const items = [{ question: "What is a queue?", modelAnswer: "A FIFO data structure." }];
    assert.deepEqual((await request(`/sessions/${session.id}/question-bank`, "PUT", { items })).body, items);
    assert.deepEqual((await request(`/sessions/${session.id}/question-bank`)).body, items);
    assert.equal((await request(`/sessions/${session.id}/billing`, "PUT", { autoExtend: true })).body.autoExtend, true);
    assert.equal((await request(`/sessions/${session.id}/billing`)).body.autoExtend, true);
    assert.equal((await request(`/sessions/${session.id}/transcribe`, "POST", { probe: true })).status, 409);
    await m.db.update(m.callSessionsTable).set({ status: "ready" }).where(m.eq(m.callSessionsTable.id, session.id));
    const probe = await request(`/sessions/${session.id}/transcribe`, "POST", { probe: true });
    assert.equal(probe.status, process.env.AI_INTEGRATIONS_GEMINI_API_KEY && process.env.AI_INTEGRATIONS_GEMINI_BASE_URL ? 200 : 503);
    assert.equal((await request(`/sessions/${session.id}/transcribe`, "POST", { audio: "junk", mimeType: "audio/wav" })).status, 400);
    if (probe.status === 200) {
      const answer = await request(`/sessions/${session.id}/answer`, "POST", { question: "In one short sentence, what is a FIFO queue?", test: true, roundNumber: 1 });
      assert.equal(answer.status, 200);
      assert.ok(answer.body.answer?.length > 10, "Gemini should return a real typed answer");
    }
    await m.db.update(m.callSessionsTable).set({ status: "ended" }).where(m.eq(m.callSessionsTable.id, session.id));
    const settled = await request("/billing/settle", "POST", { sessionId: session.id, elapsedMinutes: 999999 });
    assert.equal(settled.status, 200);
    assert.equal(settled.body.credits, 0);
    assert.equal((await request("/billing/settle", "POST", { sessionId: session.id })).body.duplicate, true);
    assert.equal((await request("/billing/balance")).body.freeRemaining, 9);
    const savedSecret = process.env.STRIPE_SECRET_KEY;
    const savedWebhook = process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    try {
      assert.equal((await request("/billing/checkout", "POST", { sku: "daily" })).body.comingSoon, true);
      assert.equal((await request("/billing/webhook", "POST", {})).body.comingSoon, true);
      process.env.STRIPE_SECRET_KEY = "sk_test_qa_fixture_not_a_real_key";
      process.env.STRIPE_WEBHOOK_SECRET = "whsec_qa_fixture_not_a_real_secret";
      const stripe = new (require("stripe"))(process.env.STRIPE_SECRET_KEY);
      const checkout = { id: `cs_test_${randomUUID()}`, object: "checkout.session", payment_status: "paid", livemode: false,
        currency: "usd", amount_total: 1500, metadata: { userId, sku: "pack-1" } };
      const payload = JSON.stringify({ id: `evt_${randomUUID()}`, object: "event", type: "checkout.session.completed", data: { object: checkout } });
      const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: process.env.STRIPE_WEBHOOK_SECRET });
      const sendWebhook = (sig) => fetch(origin + "/billing/webhook", { method: "POST", headers: { "Content-Type": "application/json", "stripe-signature": sig }, body: payload });
      assert.equal((await sendWebhook("invalid")).status, 400);
      assert.equal((await sendWebhook(signature)).status, 200);
      assert.equal((await sendWebhook(signature)).status, 200);
      assert.equal((await request("/billing/balance")).body.balance, 1);
      assert.equal(m.grantFromCheckout({ ...checkout, amount_total: 1 }), null);
    } finally {
      if (savedSecret) process.env.STRIPE_SECRET_KEY = savedSecret; else delete process.env.STRIPE_SECRET_KEY;
      if (savedWebhook) process.env.STRIPE_WEBHOOK_SECRET = savedWebhook; else delete process.env.STRIPE_WEBHOOK_SECRET;
    }
    assert.equal(m.titleForNewSession("interview", "Engineer – QA", "QA"), "Engineer – QA");
    assert.equal(m.titleForNewSession("mock", "", "QA"), "QA");
    assert.equal(m.titleForNewSession("call", "", ""), "Regular call");
    assert.equal(m.stripeConfigured({ STRIPE_SECRET_KEY: "sk_live_disabled", STRIPE_WEBHOOK_SECRET: "test-only" }), false);
    assert.equal(m.readPaidCheckout("{}", "", {}), null);
    assert.equal(m.grantFromCheckout({ payment_status: "paid", livemode: true }), null);
  } finally {
    if (session) {
      for (const table of [m.sessionNotes, m.questionBanks, m.sessionBilling]) await m.db.delete(table).where(m.eq(table.sessionId, session.id));
      await m.db.delete(m.callSessionsTable).where(m.eq(m.callSessionsTable.id, session.id));
    }
    await m.db.delete(m.creditLedger).where(m.eq(m.creditLedger.userId, userId));
    for (const id of [userId, pendingId, otherId]) {
      await m.db.delete(m.creditAccounts).where(m.eq(m.creditAccounts.userId, id));
      await m.db.delete(m.appAccessTable).where(m.eq(m.appAccessTable.userId, id));
    }
    await new Promise(resolve => server.close(resolve));
    await m.pool.end();
  }
});
