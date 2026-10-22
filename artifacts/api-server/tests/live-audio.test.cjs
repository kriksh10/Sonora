const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync, buildSync } = require("esbuild");
const { EventEmitter } = require("node:events");
const validatorsModule = { exports: {} };
new Function("module", "exports", "require", buildSync({
  entryPoints: [path.resolve(__dirname, "../../../lib/api-zod/src/index.ts")],
  bundle: true, write: false, platform: "node", format: "cjs",
}).outputFiles[0].text)(validatorsModule, validatorsModule.exports, require);

function fixture(configured = true) {
  let handler, approved = true, ended = false, controller, closed = 0;
  const sent = [];
  const streams = { send: value => sent.push(value), takeFinal: () => ({ text: "Explain the design", speaker: "S1" }), partial: () => "", close: () => closed++ };
  const scope = {
    module: { exports: {} }, Buffer, Date, Map, AbortController, setInterval, clearInterval,
    process: { env: configured ? { SPEECHMATICS_API_KEY: "test-fixture-not-a-real-key" } : {} },
    require(name) {
      if (name === "express") return { Router: () => ({ post: (_path, value) => { handler = value; } }) };
      if (name === "@clerk/express") return { getAuth: req => ({ userId: req.user }) };
      if (name === "drizzle-orm") return { eq: (key, value) => ({ key, value }), and: (...values) => values };
      if (name === "@workspace/api-zod") return validatorsModule.exports;
      if (name === "@workspace/db") return {
        callSessionsTable: { id: "id", userId: "userId" },
        db: { select: () => ({ from: () => ({ where: query => ({ limit: async () =>
          query.some(item => item.key === "userId" && item.value === "owner")
            ? [{ id: "session", userId: "owner", language: "English", roundNumber: 2, status: ended ? "ended" : "active" }] : [],
        }) }) }) },
      };
      if (name === "../lib/session-lifecycle") return {
        roundMatches: (a, b) => (a ?? 1) === (b ?? 1),
        sessionStillUsable: async () => approved && !ended,
        watchSession: (_id, _user, _round, value) => { controller = value; return () => {}; },
      };
      if (name === "../lib/speechmatics") return { speechmaticsTerms: () => [], openSpeechStream: async () => streams };
      return require(name);
    },
  };
  vm.runInNewContext(transformSync(fs.readFileSync(path.join(__dirname, "../src/routes/live-audio.ts"), "utf8"), {
    loader: "ts", format: "cjs",
  }).code, scope);
  return {
    sent, get closed() { return closed; },
    revoke() { approved = false; controller?.abort(); },
    end() { ended = true; },
    bind: scope.module.exports.bindLiveSocket,
    async request(body, user = "owner") {
      const res = { code: 200, status(code) { this.code = code; return this; }, setHeader() {}, json(data) { this.data = data; } };
      await handler({ body, user, params: { id: "session" } }, res);
      return res;
    },
  };
}

test("live audio rejects signed-out, foreign, stale-round and ended requests", async () => {
  const f = fixture();
  assert.equal((await f.request({ source: "system", open: true, roundNumber: 2 }, null)).code, 401);
  assert.equal((await f.request({ source: "system", open: true, roundNumber: 2 }, "other")).code, 404);
  assert.equal((await f.request({ source: "system", open: true, roundNumber: 1 })).code, 409);
  assert.equal((await f.request({ source: "other", open: true })).code, 400);
  f.end();
  assert.equal((await f.request({ source: "system", open: true, roundNumber: 2 })).code, 409);
});

test("missing optional live provider returns an explicit Gemini fallback signal", async () => {
  const f = fixture(false);
  const result = await f.request({ source: "system", open: true, roundNumber: 2 });
  assert.equal(result.code, 503);
  assert.match(result.data.error, /Phrase transcription will continue/);
});

test("socket tickets are one-use and access revocation closes the capture", async () => {
  const f = fixture();
  const opened = await f.request({ source: "system", open: true, roundNumber: 2 });
  assert.equal(opened.code, 200);
  assert.match(opened.data.ticket, /^[a-f0-9]{48}$/);
  const socket = new EventEmitter();
  const messages = [];
  let socketClosed = false;
  socket.send = value => messages.push(JSON.parse(value));
  socket.close = () => { socketClosed = true; socket.emit("close"); };
  f.bind(opened.data.ticket, socket);
  socket.emit("message", Buffer.alloc(320));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.sent.length, 1);
  assert.equal(messages[0].text, "Explain the design");
  let reusedClosed = false;
  f.bind(opened.data.ticket, { close() { reusedClosed = true; } });
  assert.equal(reusedClosed, true);
  f.revoke();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(socketClosed, true);
  assert.ok(f.closed >= 1);
  socket.emit("message", Buffer.alloc(320));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.sent.length, 1);
});
