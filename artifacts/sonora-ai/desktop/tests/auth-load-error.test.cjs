const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { buildSync } = require("esbuild");
const code = buildSync({ entryPoints: [path.resolve(__dirname, "../../src/lib/auth-load-error.ts")],
  bundle: true, write: false, platform: "node", format: "cjs" }).outputFiles[0].text;
const mod = { exports: {} };
new Function("module", "exports", code)(mod, mod.exports);
const { isClerkLoadFailure } = mod.exports;

test("known Clerk load errors use recovery; other bugs remain visible", () => {
  assert.equal(isClerkLoadFailure(new Error("Clerk: Failed to load Clerk JS")), true);
  assert.equal(isClerkLoadFailure({ message: 'Clerk JS failure (code="failed_to_load_clerk_js")' }), true);
  assert.equal(isClerkLoadFailure(new Error("Cannot read properties of undefined")), false);
  assert.equal(isClerkLoadFailure(new Error("Clerk: invalid publishable key")), false);
  assert.equal(isClerkLoadFailure(undefined), false);
});

test("runtime overlay server filter suppresses only the handled load failure", async () => {
  const { default: overlay } = await import("@replit/vite-plugin-runtime-error-modal");
  const plugin = overlay({ filter: error => !isClerkLoadFailure(error) });
  let listener;
  let events = [];
  await plugin.configureServer({
    ws: { on: (_name, handler) => { listener = handler; }, send: data => events.push(data) },
    moduleGraph: { getModuleById: () => undefined },
    config: { logger: { error() {}, warn() {} } },
  });
  const client = { send: (...args) => events.push(args) };
  await listener({ message: "Clerk: Failed to load Clerk JS", stack: "Error: failed_to_load_clerk_js\n at load (https://example.invalid/auth.js:1:1)" }, client);
  assert.equal(events.length, 0, "handled Clerk errors must never emit an overlay or parent notification");
});
