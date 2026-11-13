const test = require('node:test');
const assert = require('node:assert/strict');
const { ACTIONS, normalizeAccelerator, resolveHotkeys, registerHotkeys, nudgeBounds, snapBounds } = require('../hotkeys.cjs');

test('live-session shortcuts match the overlay cheat sheet and do not share a key', () => {
  assert.equal(ACTIONS.length, 14);
  const byId = Object.fromEntries(ACTIONS.map(action => [action.id, action.accelerator]));
  assert.equal(byId.answer, 'CommandOrControl+Enter');
  assert.equal(byId.screenshot, 'CommandOrControl+Shift+Enter');
  assert.equal(byId.scrollUp, 'CommandOrControl+Up');
  assert.equal(byId.scrollDown, 'CommandOrControl+Down');
  assert.equal(byId.previous, 'CommandOrControl+Left');
  assert.equal(byId.next, 'CommandOrControl+Right');
  assert.equal(byId.clearAnswers, 'CommandOrControl+Backspace');
  assert.equal(byId.clearTranscript, 'CommandOrControl+Shift+Backspace');
  assert.equal(byId.hideShow, 'CommandOrControl+H');
  assert.equal(byId.chat, 'CommandOrControl+Shift+Space');
  assert.equal(byId.snapLeft, 'CommandOrControl+Shift+Left');
  const accelerators = new Set(ACTIONS.map(action => action.accelerator));
  assert.equal(accelerators.size, ACTIONS.length);
});

test('shortcut text is normalized and duplicates or bare keys are rejected', () => {
  assert.equal(normalizeAccelerator('ctrl+shift+enter'), 'CommandOrControl+Shift+Enter');
  assert.equal(normalizeAccelerator(''), '');
  assert.throws(() => normalizeAccelerator('Space'), /modifier/);
  assert.throws(() => normalizeAccelerator('Ctrl+NotAKey'), /key/);
  const custom = resolveHotkeys({ screenshot: 'Alt+S', chat: '' });
  assert.equal(custom.find(item => item.id === 'screenshot').accelerator, 'Alt+S');
  assert.equal(custom.find(item => item.id === 'chat').accelerator, '');
  assert.throws(() => resolveHotkeys({ answer: 'CommandOrControl+Shift+Enter' }), /already used/);
});

test('registration reports failures and moves stay inside the work area', () => {
  const fired = [];
  const taken = new Set(['CommandOrControl+Shift+Enter']);
  const shortcut = { register: accelerator => { if (taken.has(accelerator)) return false; fired.push(accelerator); return true; } };
  const registered = registerHotkeys(shortcut, resolveHotkeys({}), binding => fired.push(binding.id));
  assert.equal(registered.find(item => item.id === 'screenshot').registered, false);
  assert.equal(registered.find(item => item.id === 'chat').registered, true);
  const area = [{ workArea: { x: 0, y: 0, width: 1200, height: 900 } }];
  const topLeft = snapBounds({ width: 300, height: 200 }, 'snapLeft', area, { col: 1, row: 0 });
  const topCenter = snapBounds({ width: 300, height: 200 }, 'snapRight', area, topLeft);
  const topRight = snapBounds({ width: 300, height: 200 }, 'snapRight', area, topCenter);
  const bottomRight = snapBounds({ width: 300, height: 200 }, 'snapDown', area, topRight);
  assert.deepEqual([topLeft.col, topCenter.col, topRight.col], [0, 1, 2]);
  assert.equal(topLeft.x, 0);
  assert.equal(topRight.x, 900);
  assert.equal(bottomRight.y, 700);
  assert.equal(snapBounds({ width: 300, height: 200 }, 'snapUp', area, bottomRight).y, 0);
  const displays = [{ workArea: { x: 0, y: 0, width: 800, height: 600 } }];
  assert.deepEqual(nudgeBounds({ x: 10, y: 10, width: 400, height: 300 }, 'moveLeft', displays), { x: 0, y: 10 });
  assert.deepEqual(nudgeBounds({ x: 760, y: 10, width: 100, height: 100 }, 'moveRight', displays), { x: 700, y: 10 });
});
