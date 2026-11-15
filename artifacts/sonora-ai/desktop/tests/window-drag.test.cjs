const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const vm = require('node:vm');

const code = buildSync({
  entryPoints: [path.resolve(__dirname, '../../src/lib/window-drag.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs',
}).outputFiles[0].text;
const context = { module: { exports: {} } };
vm.runInNewContext(code, context);
const { windowDragAction } = context.module.exports;
const gesture = input => {
  const result = windowDragAction(input);
  return `${result.armed ? 'armed' : 'idle'}:${result.phase ?? 'none'}`;
};

test('a pointer move with no button held does not arm a drag', () => {
  assert.equal(gesture({ type: 'move', button: 0, buttons: 0, armed: false }), 'idle:none');
  assert.equal(gesture({ type: 'move', button: -1, buttons: 0, armed: false }), 'idle:none');
  assert.equal(gesture({ type: 'down', button: 2, buttons: 2, armed: false }), 'idle:none');
});

test('the left button arms a drag, and button-up or a missed button ends it', () => {
  assert.equal(gesture({ type: 'down', button: 0, buttons: 1, armed: false }), 'armed:start');
  assert.equal(gesture({ type: 'move', button: 0, buttons: 1, armed: true }), 'armed:move');
  assert.equal(gesture({ type: 'up', button: 0, buttons: 0, armed: true }), 'idle:end');
  assert.equal(gesture({ type: 'move', button: 0, buttons: 0, armed: true }), 'idle:end');
  assert.equal(gesture({ type: 'cancel', button: 0, buttons: 1, armed: true }), 'idle:end');
  assert.equal(gesture({ type: 'move', button: 0, buttons: 0, armed: false }), 'idle:none');
});

test('native caption dragging stays off so a hover cannot snap or maximize', () => {
  const css = fs.readFileSync(path.resolve(__dirname, '../../src/index.css'), 'utf8');
  const overlay = fs.readFileSync(path.resolve(__dirname, '../../src/desktop-parakeet.css'), 'utf8');
  const bar = fs.readFileSync(path.resolve(__dirname, '../../src/components/desktop-visibility-controls.tsx'), 'utf8');
  const live = fs.readFileSync(path.resolve(__dirname, '../../src/components/desktop-live-overlay.tsx'), 'utf8');
  assert.match(css, /\.desktop-drag \{ -webkit-app-region: no-drag; app-region: no-drag; \}/);
  assert.match(css, /\.sonora-window-drag-handle \{[^}]*-webkit-app-region: no-drag; app-region: no-drag; \}/);
  assert.match(overlay, /\.dp-drag \{[^}]*-webkit-app-region: no-drag; app-region: no-drag; \}/);
  assert.match(bar, /moveExpanded\("move", event\)/);
  assert.match(live, /moveWindow\("move", event\)/);
  assert.doesNotMatch(bar, /onPointerMove=\{\(\) => \{ void bridge\.dragWindow/);
  assert.doesNotMatch(live, /onPointerMove=\{\(\) => \{ void window\.sonoraDesktop\?\.dragWindow/);
});
