const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createAutoUpdate } = require('../auto-update.cjs');

function fakeUpdater() {
  const emitter = new EventEmitter();
  const calls = [];
  emitter.autoDownload = false;
  emitter.autoInstallOnAppQuit = false;
  emitter.checkForUpdates = async () => { calls.push('check'); };
  emitter.quitAndInstall = (silent, restart) => { calls.push(['install', silent, restart]); };
  return { updater: emitter, calls };
}

test('a packaged app checks on start, downloads in the background, and can restart', async () => {
  const { updater, calls } = fakeUpdater();
  const prompts = [];
  let sent = null;
  const updates = createAutoUpdate({
    updater, isPackaged: true,
    dialog: { showMessageBox: async (_win, options) => { prompts.push(options); return { response: 1 }; } },
    getWindow: () => ({ id: 1 }),
    send: status => { sent = status; },
    schedule: () => 1,
    clear: () => {},
  });
  updates.start();
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, true);
  assert.deepEqual(calls, ['check']);
  updater.emit('update-available', { version: '0.4.0' });
  updater.emit('download-progress', { percent: 40 });
  assert.equal(sent.phase, 'downloading');
  updater.emit('update-downloaded', { version: '0.4.0' });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(prompts[0].buttons[1], 'Restart now');
  assert.deepEqual(calls.at(-1), ['install', true, true]);
  assert.equal(updates.status().phase, 'ready');
});

test('development and missing updater builds do not check or install', async () => {
  const updates = createAutoUpdate({ isPackaged: false, schedule: () => { throw new Error('should not schedule'); } });
  updates.start();
  assert.equal(updates.status().phase, 'disabled');
  await updates.check();
  assert.throws(() => updates.install(), /No downloaded update/);
});
