const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const path = require('node:path');
const vm = require('node:vm');
const fs = require('node:fs');
const code = buildSync({
  entryPoints: [path.resolve(__dirname, '../../src/lib/background-opacity.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs',
}).outputFiles[0].text;
const context = { module: { exports: {} }, setTimeout, clearTimeout };
vm.runInNewContext(code, context);
const { createBackgroundOpacity } = context.module.exports;
const tick = () => new Promise(setImmediate);

function harness() {
  const values = [], errors = [], writes = [];
  const controller = createBackgroundOpacity({
    display: value => values.push(value), error: message => errors.push(message),
    save: value => new Promise((resolve, reject) => writes.push({ value, resolve, reject })),
  });
  return { controller, values, errors, writes };
}

test('slider previews immediately, coalesces rapid input and ignores stale broadcasts', async () => {
  const h = harness();
  h.controller.sync(.7);
  h.controller.set(.6);
  assert.equal(h.values.at(-1), .6);
  await tick();
  h.controller.set(.4); h.controller.set(.15);
  h.controller.sync(.6);
  assert.equal(h.values.at(-1), .15);
  assert.equal(h.writes.length, 1);
  h.writes[0].resolve(.6); await tick();
  assert.equal(h.values.at(-1), .15);
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].value, .15);
  h.writes[1].resolve(.15); await tick();
  assert.equal(h.values.at(-1), .15);
  h.controller.sync(.45); assert.equal(h.values.at(-1), .45);
});

test('failure restores confirmed value, explains failure and allows retry / opaque reset', async () => {
  const h = harness();
  h.controller.sync(.65);
  h.controller.set(.2); await tick();
  h.writes[0].reject(new Error('IPC failed')); await tick();
  assert.equal(h.values.at(-1), .65);
  assert.match(h.errors.at(-1), /not applied/);
  h.controller.set(1); await tick();
  h.writes[1].resolve(1); await tick();
  assert.equal(h.values.at(-1), 1);
  assert.equal(h.errors.at(-1), '');
});

test('older failed write does not roll back newer intent; dispose ignores late results', async () => {
  const h = harness();
  h.controller.set(.3); await tick(); h.controller.set(.5);
  h.writes[0].reject(new Error('failed')); await tick();
  assert.equal(h.values.at(-1), .5);
  assert.equal(h.errors.at(-1), '');
  h.controller.dispose();
  const count = h.values.length;
  h.writes[1].resolve(.5); await tick();
  h.controller.sync(.8); h.controller.set(1);
  assert.equal(h.values.length, count);
});

test('invalid values never reach native code; hung IPC recovers with an honest error', async () => {
  const values = [], errors = [];
  let writes = 0;
  const h = createBackgroundOpacity({
    display: v => values.push(v), error: e => errors.push(e), timeoutMs: 5,
    save: async () => { writes++; return new Promise(() => {}); },
  });
  for (const value of [NaN, Infinity, .14, 1.01]) h.set(value);
  assert.equal(writes, 0); assert.equal(values.length, 0);
  h.sync(.9); h.set(.2);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(values.at(-1), .9); assert.match(errors.at(-1), /not applied/);
  h.dispose();
});

test('dragging is confined to handle and range has keyboard semantics and compatibility guidance', () => {
  const ui = fs.readFileSync(path.resolve(__dirname, '../../src/components/desktop-visibility-controls.tsx'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8');
  assert.match(ui, /className="sonora-window-bar sonora-overlay-controls"/);
  assert.match(ui, /sonora-window-drag-handle desktop-drag/);
  assert.match(ui, /type="range" min=\{minimumOpacity\} max="100" step="5"/);
  assert.match(ui, /onChange=\{event => opacityControl.current\?\.set/);
  assert.match(ui, /Opacity is unavailable in this installed app/);
  assert.match(ui, /backgroundOpacityMin === 0.15 \? 15 : 45/);
  assert.match(css, /\.sonora-window-popover, \.sonora-window-popover \* \{ -webkit-app-region: no-drag;/);
  assert.doesNotMatch(fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8'), /\.setOpacity\(/);
});
