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
    setVisibleOnAllWorkspaces() {}, moveTop() {},
    bounds: { x: 10, y: 20, width: 800, height: 600 },
    getBounds() { return { ...this.bounds }; },
    setBounds(next) { this.bounds = { ...this.bounds, ...next }; },
    setResizable() {}, setSkipTaskbar(value) { this.skip = value; },
    isMinimized: () => false, restore() {},
    webContents: { send: (...args) => sends.push(args) },
  };
  const tray = { isDestroyed: () => false, destroy() { this.destroyed = true; }, destroyed: false, on() {}, setToolTip() {}, setContextMenu: next => { menu = next; } };
  const electron = {
    app: { isPackaged: true, getVersion: () => '0.3.0', requestSingleInstanceLock: () => false, quit() {}, on() {} },
    Menu: { buildFromTemplate: items => items },
    nativeImage: { createFromPath: () => ({}) },
    dialog: { showMessageBox: () => Promise.resolve({ response: 0 }) },
    Tray: class { constructor() {} isDestroyed() { return false; } destroy() {} on() {} setToolTip() {} setContextMenu(next) { menu = next; } },
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

test('capture exclusion and native state stay synchronized', () => {
  const f = fixture();
  vm.runInContext('setContentProtection(false)', f.context);
  assert.deepEqual(f.protections, [false]);
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
  assert.equal(f.menu().find(item => item.label === 'Open').label, 'Open');
  f.menu().find(item => item.label === 'Open').click();
  assert.equal(f.window.isVisible(), true);
  assert.equal(f.window.top, true);
  assert.equal(vm.runInContext('tray', f.context), null);
});

test('hide and tray restore preserve active audio and keep Stop available', () => {
  const f = fixture();
  vm.runInContext('captureActive = true; hide();', f.context);
  assert.equal(f.window.isVisible(), false);
  assert.equal(f.sends.at(-1)[1].captureActive, true);
  assert.equal(f.menu().some(item => item.label === 'Open'), true);
  f.menu().find(item => item.label === 'Open').click();
  assert.equal(f.window.isVisible(), true);
  assert.equal(vm.runInContext('captureActive', f.context), true);
});

test('unsupported platform does not offer capture exclusion', () => {
  const f = fixture('linux');
  vm.runInContext('setContentProtection(true)', f.context);
  assert.equal(vm.runInContext('state().contentProtection', f.context), false);
});

test('minimize collapses inside the same window and the tray is only for a hidden window', () => {
  const f = fixture();
  vm.runInContext('setCollapsed(true);', f.context);
  assert.equal(f.window.isVisible(), true);
  assert.equal(f.window.bounds.width, 72);
  assert.equal(f.window.bounds.height, 72);
  vm.runInContext('onHotkey({ id: "hideShow", forward: false });', f.context);
  assert.equal(f.window.bounds.width, 800);
  vm.runInContext('hide();', f.context);
  assert.equal(f.window.isVisible(), false);
  assert.equal(f.menu().some(item => item.label === 'Quit'), true);
  const main = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8');
  assert.match(main, /setMinimumSize\?\.\(72, 72\)/);
  assert.match(main, /setCollapsed\(true\)/);
  assert.match(main, /tray\.on\('click', show\)/);
  assert.match(main, /skipTaskbar: true/);
  assert.match(main, /type: 'toolbar'/);
  assert.match(main, /title: 'Sonora'/);
  assert.match(main, /hiddenInMissionControl: true/);
  assert.match(main, /setInterval\(\(\) => holdOnTop\(\), 1000\)/);
  assert.doesNotMatch(main, /page-title-updated/);
  assert.doesNotMatch(main, /createEmpty\(\)/);
});

test('failed native protection change does not falsely update requested state', () => {
  const f = fixture();
  f.window.setContentProtection = () => { throw new Error('native failure'); };
  assert.throws(() => vm.runInContext('setContentProtection(false)', f.context), /native failure/);
  assert.equal(vm.runInContext('state().contentProtection', f.context), true);
});
