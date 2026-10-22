const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { buildSync } = require("esbuild");

function load(file) {
  const code = buildSync({
    entryPoints: [path.resolve(__dirname, file)],
    bundle: true, write: false, platform: "node", format: "cjs",
  }).outputFiles[0].text;
  const module = { exports: {} };
  const fn = new Function("module", "exports", "require", code);
  fn(module, module.exports, require);
  return module.exports;
}

const context = load("../src/lib/answer-context.ts");
const jobs = load("../src/lib/job-page.ts");

test("a long document keeps the passage that matches the question", () => {
  const billing = "Billing service\n\n" + "invoice ledger ".repeat(400);
  const caching = "Cache design\n\nThe cache uses a write-through policy and measures hit rate before eviction.";
  const picked = context.relevantDocuments(`${billing}\n\n${caching}`, "How does the cache hit rate work?");
  assert.match(picked, /write-through policy/);
  assert.doesNotMatch(picked, /invoice ledger/);
});

test("the interviewer is the question and the candidate is already spoken", () => {
  const heard = context.transcriptForAnswer([
    { speaker: "candidate", text: "I led the migration." },
    { speaker: "interviewer", text: "How did you roll it back?" },
  ]);
  assert.match(heard, /Interviewer: How did you roll it back\?/);
  assert.match(heard, /Candidate already said: I led the migration\./);
});

test("a job link must be public https text", async () => {
  await assert.rejects(() => jobs.readPublicJobPage("http://example.com/job", {
    lookupHost: async () => ["93.184.216.34"], fetchPage: async () => { throw new Error("fetch"); },
  }), /https/);
  await assert.rejects(() => jobs.readPublicJobPage("https://169.254.169.254/latest", {
    lookupHost: async () => ["169.254.169.254"], fetchPage: async () => { throw new Error("fetch"); },
  }), /public page/);
  const text = await jobs.readPublicJobPage("https://example.com/jobs/1", {
    lookupHost: async () => ["93.184.216.34"],
    fetchPage: async () => ({
      ok: true, status: 200,
      headers: { get: name => name === "content-type" ? "text/html" : "" },
      text: async () => "<html><style>body{}</style><h1>Backend engineer</h1><p>Build the billing and cache services for the platform team.</p></html>",
    }),
  });
  assert.match(text, /Backend engineer/);
  assert.doesNotMatch(text, /body\{\}/);
});
