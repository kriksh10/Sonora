const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { transformSync } = require("esbuild");

const source = fs.readFileSync(path.resolve(__dirname, "../src/lib/gemini-answer.ts"), "utf8");
const scope = { module: { exports: {} }, exports: {} };
vm.runInNewContext(transformSync(source, { loader: "ts", format: "cjs" }).code, scope);
const subject = scope.module.exports;

test("the live Gemini request asks for a long answer and continues when the provider stops at the token limit", () => {
  const signal = new AbortController().signal;
  const flash = subject.answerGenerationConfig("gemini-2.5-flash", signal);
  assert.equal(flash.maxOutputTokens, 8192);
  assert.equal(flash.abortSignal, signal);
  assert.equal(flash.thinkingConfig.thinkingBudget, 0);
  const other = subject.answerGenerationConfig("gemini-2.5-pro", signal);
  assert.equal(other.maxOutputTokens, 8192);
  assert.equal(other.thinkingConfig, undefined);
  assert.equal(subject.answerWasCutOff("MAX_TOKENS"), true);
  assert.equal(subject.answerWasCutOff("STOP"), false);
  assert.equal(subject.chunkFinishReason({ candidates: [{ finishReason: "MAX_TOKENS" }] }), "MAX_TOKENS");
  assert.equal(subject.chunkAnswerText({
    text: "",
    candidates: [{ content: { parts: [{ thought: true, text: "hidden" }, { text: "Visible answer" }] } }],
  }), "Visible answer");
  const route = fs.readFileSync(path.resolve(__dirname, "../src/routes/sessions.ts"), "utf8");
  assert.match(route, /answerGenerationConfig\(session\.model, controller\.signal\)/);
  assert.match(route, /answerWasCutOff\(reason\)/);
  assert.match(route, /capped/);
  assert.doesNotMatch(route, /Answer exceeded the supported size/);
  assert.match(route, /chunkAnswerText\(chunk\)/);
});
