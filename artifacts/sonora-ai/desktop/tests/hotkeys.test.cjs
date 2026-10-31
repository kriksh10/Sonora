const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, normalizeAccelerator, resolveHotkeys, registerHotkeys, nudgeBounds } = require('../hotkeys.cjs');

test('the default cheat sheet covers the interview controls and keeps the existing toggle', () => {
  assert.equal(ACTIONS.length, 15);
  const byId = Object.fromEntries(ACTIONS.map(action => [action.id, action.accelerator]));
  assert.equal(byId.toggle, 'CommandOrControl+Shift+Space');
  assert.equal(byId.moveUp, 'CommandOrControl+Shift+Up');
  assert.equal(byId.moveDown, 'CommandOrControl+Shift+Down');
  assert.equal(byId.moveLeft, 'CommandOrControl+Shift+Left');
  assert.equal(byId.moveRight, 'CommandOrControl+Shift+Right');
  for (const id of ['answer', 'alternate', 'scrollUp', 'scrollDown', 'previous', 'next', 'hideShow', 'clearAnswers', 'clearTranscript', 'screenshot']) {
    assert.ok(byId[id], id);
  }
  const accelerators = new Set(ACTIONS.map(action => action.accelerator));
  assert.equal(accelerators.size, ACTIONS.length);
});

test('shortcut text is normalized and duplicates or bare keys are rejected', () => {
  assert.equal(normalizeAccelerator('ctrl+shift+enter'), 'CommandOrControl+Shift+Enter');
  assert.equal(normalizeAccelerator(''), '');
  assert.throws(() => normalizeAccelerator('Space'), /modifier/);
  assert.throws(() => normalizeAccelerator('Ctrl+NotAKey'), /key/);
  const custom = resolveHotkeys({ screenshot: 'Alt+S', toggle: '' });
  assert.equal(custom.find(item => item.id === 'screenshot').accelerator, 'Alt+S');
  assert.equal(custom.find(item => item.id === 'toggle').accelerator, '');
  assert.throws(() => resolveHotkeys({ answer: 'CommandOrControl+Shift+A' }), /already used/);
});

test('registration reports failures and moves stay inside the work area', () => {
  const fired = [];
  const taken = new Set(['CommandOrControl+Shift+S']);
  const shortcut = { register: accelerator => { if (taken.has(accelerator)) return false; fired.push(accelerator); return true; } };
  const registered = registerHotkeys(shortcut, resolveHotkeys({}), binding => fired.push(binding.id));
  assert.equal(registered.find(item => item.id === 'screenshot').registered, false);
  assert.equal(registered.find(item => item.id === 'toggle').registered, true);
  const displays = [{ workArea: { x: 0, y: 0, width: 800, height: 600 } }];
  assert.deepEqual(nudgeBounds({ x: 10, y: 10, width: 400, height: 300 }, 'moveLeft', displays), { x: 0, y: 10 });
  assert.deepEqual(nudgeBounds({ x: 760, y: 10, width: 100, height: 100 }, 'moveRight', displays), { x: 700, y: 10 });
});
