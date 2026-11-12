const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');

function fixture(platform = 'win32') {
  const main = path.resolve(__dirname, '../main.cjs');
  const localRequire = createRequire(main);
  const sends = [], protections = [];
  let menu, visible = true;
  const window = {
    isDestroyed: () => false, isVisible: () => visible,
    show: () => { visible = true; }, focus() {}, hide: () => { visible = false; },
    setAlwaysOnTop(value) { this.top = value; }, top: false,
    setContentProtection: value => { protections.push(value); },
    webContents: { send: (...args) => sends.push(args) },
  };
  const tray = { isDestroyed: () => false, setToolTip() {}, setContextMenu: next => { menu = next; } };
  const electron = {
    app: { isPackaged: true, getVersion: () => '0.3.0', requestSingleInstanceLock: () => false, quit() {}, on() {} },
    Menu: { buildFromTemplate: items => items },
  };
  const context = vm.createContext({
    require: name => name === 'electron' ? electron : localRequire(name),
    process: { platform, argv: [] }, __dirname: path.dirname(main),
  });
  vm.runInContext(fs.readFileSync(main, 'utf8'), context);
  context.testWindow = window;
  context.testTray = tray;
  vm.runInContext('win = testWindow; tray = testTray; updateTray();', context);
  return { context, window, protections, sends, menu: () => menu };
}

test('tray capture exclusion and native state stay synchronized', () => {
  const f = fixture();
  const toggle = f.menu().find(item => item.label?.startsWith('Hide from screen sharing'));
  assert.equal(toggle.checked, true);
  toggle.click({ checked: false });
  assert.deepEqual(f.protections, [false]);
  assert.equal(f.menu().find(item => item.label?.startsWith('Hide from screen sharing')).checked, false);
  assert.equal(f.sends.at(-1)[1].contentProtection, false);
  assert.throws(() => vm.runInContext('setContentProtection("yes")', f.context), /Expected boolean/);
});

test('hide releases screen-saver always-on-top before the window disappears and show puts it back', () => {
  const f = fixture();
  vm.runInContext('alwaysOnTop = true; hide();', f.context);
  assert.equal(f.window.top, false);
  assert.equal(f.window.isVisible(), false);
  vm.runInContext('holdOnTop();', f.context);
  assert.equal(f.window.top, false);
  f.menu().find(item => item.label === 'Show Sonora').click();
  assert.equal(f.window.isVisible(), true);
  assert.equal(f.window.top, true);
});

test('hide and tray restore preserve active audio and keep Stop available', () => {
  const f = fixture();
  vm.runInContext('captureActive = true; hide();', f.context);
  assert.equal(f.window.isVisible(), false);
  assert.equal(f.sends.at(-1)[1].captureActive, true);
  assert.equal(f.menu().find(item => item.label === 'Stop audio capture').enabled, true);
  f.menu().find(item => item.label === 'Show Sonora').click();
  assert.equal(f.window.isVisible(), true);
  assert.equal(f.sends.at(-1)[1].captureActive, true);
});

test('unsupported platform does not offer capture exclusion', () => {
  const f = fixture('linux');
  const toggle = f.menu().find(item => item.label?.startsWith('Hide from screen sharing'));
  assert.equal(toggle.enabled, false);
  assert.equal(toggle.checked, false);
});

test('minimize and the restore hotkey hide to the tray without a taskbar window', () => {
  const f = fixture();
  f.window.setSkipTaskbar = value => { f.window.skip = value; };
  f.window.isMinimized = () => false;
  vm.runInContext('minimizeToTray();', f.context);
  assert.equal(f.window.isVisible(), false);
  assert.equal(f.window.skip, true);
  vm.runInContext('onHotkey({ id: "toggle", forward: false });', f.context);
  assert.equal(f.window.isVisible(), true);
  const main = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8');
  assert.match(main, /win\.on\('minimize', \(\) => minimizeToTray\(\)\)/);
  assert.match(main, /tray\.on\('click', toggle\)/);
  assert.match(main, /skipTaskbar: true/);
  assert.match(main, /type: 'toolbar'/);
  assert.match(main, /page-title-updated/);
});

test('failed native protection change does not falsely update requested state', () => {
  const f = fixture();
  f.window.setContentProtection = () => { throw new Error('native failure'); };
  assert.throws(() => vm.runInContext('setContentProtection(false)', f.context), /native failure/);
  assert.equal(vm.runInContext('state().contentProtection', f.context), true);
});
