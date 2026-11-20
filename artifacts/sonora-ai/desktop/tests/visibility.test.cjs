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
    setPosition(x, y) { this.bounds.x = x; this.bounds.y = y; },
    setMinimumSize(w, h) { this.min = [w, h]; },
    setMaximumSize(w, h) { this.max = [w, h]; },
    getMinimumSize() { return this.min || [390, 620]; },
    setResizable() {}, setSkipTaskbar(value) { this.skip = value; },
    isMinimized: () => false, restore() {},
    webContents: { send: (...args) => sends.push(args) },
  };
  const tray = { isDestroyed: () => false, destroy() { this.destroyed = true; }, destroyed: false, on() {}, setToolTip() {}, setContextMenu: next => { menu = next; } };
  const cursor = { x: 40, y: 50 };
  const area = { x: 0, y: 0, width: 1920, height: 1080 };
  const electron = {
    screen: {
      getCursorScreenPoint: () => ({ x: cursor.x, y: cursor.y }),
      getPrimaryDisplay: () => ({ scaleFactor: 1, workArea: area, size: { width: 1920, height: 1080 } }),
      getAllDisplays: () => [{ workArea: area, bounds: area, scaleFactor: 1, size: { width: 1920, height: 1080 } }],
      on() {},
    },
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
  return { context, window, cursor, protections, sends, menu: () => vm.runInContext('trayMenu', context) };
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
  assert.equal(f.menu().find(item => item.label === 'Open Sonora').label, 'Open Sonora');
  assert.equal(f.menu().some(item => String(item.label).startsWith('Version ')), true);
  f.menu().find(item => item.label === 'Open Sonora').click();
  assert.equal(f.window.isVisible(), true);
  assert.equal(f.window.top, true);
  assert.equal(vm.runInContext('tray', f.context), null);
});

test('hide and tray restore preserve active audio and keep Stop available', () => {
  const f = fixture();
  vm.runInContext('captureActive = true; hide();', f.context);
  assert.equal(f.window.isVisible(), false);
  assert.equal(f.sends.at(-1)[1].captureActive, true);
  assert.equal(f.menu().some(item => item.label === 'Open Sonora'), true);
  f.menu().find(item => item.label === 'Open Sonora').click();
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
  assert.match(main, /holdOnTop\(\);\r?\n\s*if \(hitRepairPending\) scheduleHitRepair\(\);\r?\n\s*\}, 1000\)/);
  assert.doesNotMatch(main, /page-title-updated/);
  assert.doesNotMatch(main, /createEmpty\(\)/);
});

test('dragging the collapsed icon keeps the collapsed size and a click-sized nudge does not count as a drag', () => {
  const f = fixture();
  vm.runInContext('setCollapsed(true);', f.context);
  assert.equal(f.window.bounds.width, 72);
  assert.equal(f.window.bounds.height, 72);
  assert.deepEqual(f.window.max, [72, 72]);
  vm.runInContext('dragCollapsed("start")', f.context);
  f.cursor.x = 43; f.cursor.y = 52;
  assert.equal(vm.runInContext('dragCollapsed("move").moved', f.context), false);
  assert.equal(f.window.bounds.width, 72);
  f.cursor.x = 340; f.cursor.y = 50;
  assert.equal(vm.runInContext('dragCollapsed("move").moved', f.context), true);
  assert.deepEqual({ w: f.window.bounds.width, h: f.window.bounds.height, x: f.window.bounds.x, y: f.window.bounds.y }, { w: 72, h: 72, x: 310, y: 20 });
  f.cursor.y = 350;
  vm.runInContext('dragCollapsed("move")', f.context);
  assert.equal(f.window.bounds.width, 72);
  assert.equal(f.window.bounds.height, 72);
  assert.equal(vm.runInContext('dragCollapsed("end").moved', f.context), true);
  vm.runInContext('moveCollapsed(300, -300)', f.context);
  assert.equal(f.window.bounds.width, 72);
  assert.equal(f.window.bounds.height, 72);
  vm.runInContext('setCollapsed(false)', f.context);
  assert.equal(f.window.bounds.width, 800);
  assert.ok(f.window.bounds.height >= 620);
  assert.ok(f.window.bounds.x >= 0 && f.window.bounds.y >= 0);
  const main = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8');
  assert.match(main, /setMaximumSize\?\.\(COLLAPSED, COLLAPSED\)/);
  assert.match(main, /placeCollapsed/);
  assert.doesNotMatch(main, /setBounds\(\{ x: Math\.round\(box\.x \+ dx\)/);
});

test('hovering does not move the window, and a button release ends the drag', () => {
  const f = fixture();
  const origin = { ...f.window.bounds };
  f.cursor.x = 400; f.cursor.y = 300;
  assert.equal(vm.runInContext('dragWindow("move").moved', f.context), false);
  f.cursor.x = 900; f.cursor.y = 700;
  assert.equal(vm.runInContext('dragWindow("move").moved', f.context), false);
  assert.deepEqual(f.window.bounds, origin);

  vm.runInContext('dragWindow("start")', f.context);
  f.cursor.x = 902; f.cursor.y = 701;
  assert.equal(vm.runInContext('dragWindow("move").moved', f.context), false);
  assert.equal(f.window.bounds.x, origin.x);
  assert.equal(f.window.bounds.y, origin.y);
  f.cursor.x = 1020; f.cursor.y = 760;
  assert.equal(vm.runInContext('dragWindow("move").moved', f.context), true);
  const dragged = { x: f.window.bounds.x, y: f.window.bounds.y };
  assert.notDeepEqual(dragged, { x: origin.x, y: origin.y });
  assert.equal(f.window.bounds.width, origin.width);
  assert.equal(f.window.bounds.height, origin.height);

  // Release outside the window. The page may never see this pointerup.
  f.cursor.x = -2400; f.cursor.y = -1800;
  vm.runInContext('notePrimaryButton("up")', f.context);
  const parked = { x: f.window.bounds.x, y: f.window.bounds.y };
  f.cursor.x = -1800; f.cursor.y = -1200;
  assert.equal(vm.runInContext('dragWindow("move").moved', f.context), false);
  assert.equal(vm.runInContext('dragWindow("move").moved', f.context), false);
  assert.equal(f.window.bounds.x, parked.x);
  assert.equal(f.window.bounds.y, parked.y);
  assert.equal(vm.runInContext('dragWindow("end").moved', f.context), false);
  // The press message arrived after the button was already up. Moving must not resume.
  vm.runInContext('dragWindow("start")', f.context);
  f.cursor.x = parked.x + 500; f.cursor.y = parked.y + 500;
  assert.equal(vm.runInContext('dragWindow("move").moved', f.context), false);
  assert.equal(vm.runInContext('dragWindow("move").moved', f.context), false);
  assert.equal(f.window.bounds.x, parked.x);
  assert.equal(f.window.bounds.y, parked.y);

  // A later real press still drags, and "end" stops it even if the cursor stays outside.
  f.cursor.x = 30; f.cursor.y = 40;
  vm.runInContext('notePrimaryButton("down"); dragWindow("start")', f.context);
  f.cursor.x = -3000; f.cursor.y = 800;
  assert.equal(vm.runInContext('dragWindow("move").moved', f.context), true);
  const outside = { x: f.window.bounds.x, y: f.window.bounds.y };
  assert.equal(vm.runInContext('dragWindow("end").moved', f.context), true);
  f.cursor.x = -200; f.cursor.y = 900;
  assert.equal(vm.runInContext('dragWindow("move").moved', f.context), false);
  assert.equal(f.window.bounds.x, outside.x);
  assert.equal(f.window.bounds.y, outside.y);

  vm.runInContext('setCollapsed(true)', f.context);
  const icon = { x: f.window.bounds.x, y: f.window.bounds.y, width: f.window.bounds.width, height: f.window.bounds.height };
  f.cursor.x = icon.x + 400; f.cursor.y = icon.y + 400;
  assert.equal(vm.runInContext('dragCollapsed("move").moved', f.context), false);
  assert.equal(vm.runInContext('dragCollapsed("move").moved', f.context), false);
  assert.deepEqual({ x: f.window.bounds.x, y: f.window.bounds.y, width: f.window.bounds.width, height: f.window.bounds.height }, icon);
});

test('failed native protection change does not falsely update requested state', () => {
  const f = fixture();
  f.window.setContentProtection = () => { throw new Error('native failure'); };
  assert.throws(() => vm.runInContext('setContentProtection(false)', f.context), /native failure/);
  assert.equal(vm.runInContext('state().contentProtection', f.context), true);
});

function growingPosition(window, scale) {
  window.scale = scale;
  window.positionCalls = 0;
  window.setPosition = (x, y) => {
    window.positionCalls += 1;
    // Electron implements setPosition as setBounds(position, getSize()).
    // At a fractional scale that read-back rounds up, so every call grows.
    const bump = scale === 1 ? 0 : 1;
    window.bounds = { x, y, width: window.bounds.width + bump, height: window.bounds.height + bump };
  };
}

test('many drag moves keep the expanded and collapsed size at every display scale', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8');
  assert.doesNotMatch(main, /setPosition\s*\(/);
  for (const scale of [1, 1.25, 1.5, 1.75]) {
    const expanded = fixture();
    growingPosition(expanded.window, scale);
    const before = { width: expanded.window.bounds.width, height: expanded.window.bounds.height };
    vm.runInContext('dragWindow("start")', expanded.context);
    for (let step = 0; step < 40; step += 1) {
      expanded.cursor.x += 17;
      expanded.cursor.y += 5;
      vm.runInContext('dragWindow("move")', expanded.context);
    }
    assert.equal(expanded.window.positionCalls, 0, `expanded setPosition at ${scale}`);
    assert.equal(expanded.window.bounds.width, before.width, `expanded width at ${scale}`);
    assert.equal(expanded.window.bounds.height, before.height, `expanded height at ${scale}`);
    assert.notEqual(expanded.window.bounds.x, 10, `expanded moved at ${scale}`);
    vm.runInContext('dragWindow("end")', expanded.context);
    expanded.cursor.x += 80;
    assert.equal(vm.runInContext('dragWindow("move").moved', expanded.context), false);
    assert.equal(expanded.window.bounds.width, before.width);
    assert.equal(expanded.window.bounds.height, before.height);

    const collapsed = fixture();
    growingPosition(collapsed.window, scale);
    vm.runInContext('setCollapsed(true)', collapsed.context);
    const icon = { x: collapsed.window.bounds.x, y: collapsed.window.bounds.y, width: collapsed.window.bounds.width, height: collapsed.window.bounds.height };
    assert.equal(icon.width, 72);
    assert.equal(icon.height, 72);
    vm.runInContext('dragCollapsed("start")', collapsed.context);
    for (let step = 0; step < 40; step += 1) {
      collapsed.cursor.x += 15;
      collapsed.cursor.y += 4;
      vm.runInContext('dragCollapsed("move")', collapsed.context);
    }
    assert.equal(collapsed.window.positionCalls, 0, `collapsed setPosition at ${scale}`);
    assert.equal(collapsed.window.bounds.width, 72, `collapsed width at ${scale}`);
    assert.equal(collapsed.window.bounds.height, 72, `collapsed height at ${scale}`);
    assert.notEqual(collapsed.window.bounds.x, icon.x, `collapsed moved at ${scale}`);
    vm.runInContext('notePrimaryButton("up")', collapsed.context);
    const parked = { x: collapsed.window.bounds.x, y: collapsed.window.bounds.y };
    collapsed.cursor.x += 200;
    assert.equal(vm.runInContext('dragCollapsed("move").moved', collapsed.context), false);
    assert.equal(collapsed.window.bounds.x, parked.x);
    assert.equal(collapsed.window.bounds.width, 72);
    assert.equal(collapsed.window.bounds.height, 72);
  }
});

test('windows drags move through the watcher and never rewrite the size', () => {
  const scales = [1, 1.25, 1.5, 1.75];
  for (const scale of scales) {
    const f = fixture();
    f.context.nativeLines = [];
    f.window.getNativeWindowHandle = () => {
      const raw = Buffer.alloc(8);
      raw.writeBigUInt64LE(0x1234n);
      return raw;
    };
    f.window.setPosition = () => { throw new Error(`setPosition grew the window at ${scale}`); };
    const writes = [];
    const assign = f.window.setBounds.bind(f.window);
    f.window.setBounds = next => { writes.push(next); assign(next); };
    vm.runInContext(`titleClickWatcher = {
      killed: false,
      stdin: { destroyed: false, writable: true, write(line) { nativeLines.push(line); return true; } },
    };`, f.context);
    const before = { ...f.window.bounds };
    vm.runInContext('dragWindow("start")', f.context);
    for (let step = 0; step < 30; step += 1) {
      f.cursor.x += 20;
      f.cursor.y += 6;
      vm.runInContext('dragWindow("move")', f.context);
    }
    assert.deepEqual(f.window.bounds, before, `watcher drag left bounds alone at ${scale}`);
    assert.deepEqual(writes, [], `watcher drag did not setBounds at ${scale}`);
    const lines = vm.runInContext('nativeLines.join("|")', f.context);
    assert.match(lines, /drag-start 4660/);
    assert.match(lines, /drag-on/);
    vm.runInContext('notePrimaryButton("up")', f.context);
    f.cursor.x += 300;
    assert.equal(vm.runInContext('dragWindow("move").moved', f.context), false);
    const afterRelease = vm.runInContext('nativeLines.join("|")', f.context);
    assert.match(afterRelease, /drag-end/);
    assert.equal(afterRelease.match(/drag-on/g).length, 1, `one apply at ${scale}`);
    assert.deepEqual(f.window.bounds, before);
  }
});
