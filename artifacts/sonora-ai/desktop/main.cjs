const { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage, screen, dialog, desktopCapturer, shell } = require('electron');
const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const { validateServiceUrl, isAllowedNavigation } = require('./security.cjs');
const { createNativeAudioManager } = require('./native-audio-host.cjs');
const { listAudioDevices } = require('./audio-devices.cjs');
const { createBrowserAuth } = require('./browser-auth.cjs');
const { pathToFileURL } = require('node:url');
const { opacity, initialOpacity, fontScale, initialFontScale, flag, safeBounds } = require('./window-preferences.cjs');
const { diagnosticReport } = require('./maintenance.cjs');
const { isBundledOfflineNavigation, desktopRequestAllowed } = require('./security.cjs');
const { resolveHotkeys, registerHotkeys, snapBounds, hotkeySummary } = require('./hotkeys.cjs');
const { createAutoUpdate } = require('./auto-update.cjs');

let win;
let tray;
let quitting = false;
let alwaysOnTop = true;
let collapsed = false;
let expandedBounds = null;
let expandedMinimum = null;
let collapsedDrag = null;
let collapsedAt = 0;
const COLLAPSED = 72;
let snapPlace = { col: 1, row: 0 };
let liveShortcuts = false;
let trayMenu = [];
let contentProtection = ['win32', 'darwin'].includes(process.platform);
let captureActive = false;
let shortcutRegistered = false;
let target;
let nativeAudio;
let nativeAudioBinary;
let browserAuth;
let backgroundOpacity = 0.45;
let fontScaleValue = 1;
let transcriptOpen = false;
let clickThrough = false;
let controlsHover = false;
let openAtLogin = false;
let hotkeyOverrides = {};
let hotkeyState = [];
let preferencesPath;
let preferencesError = '';
let saveTimer;
let updates = createAutoUpdate({ isPackaged: false });
let stopUpdates = () => {};
const offlineFileUrl = pathToFileURL(path.join(__dirname, 'offline.html')).href;
const development = !app.isPackaged && process.argv.includes('--dev');
const e2e = process.env?.SONORA_E2E === '1' && process.argv.includes('--e2e');
let localE2E = e2e;
let ignoringMouse = false;
let serviceLoadAttempts = 0;

function bootLog(line) {
  const text = `${new Date().toISOString()} ${line}`;
  if (!localE2E) return;
  console.log(`[sonora-e2e] ${text}`);
  const destinations = [process.env?.SONORA_E2E_LOG, process.env?.SONORA_BOOT_LOG].filter(Boolean);
  try { destinations.push(path.join(app.getPath('userData'), 'e2e-boot.txt')); } catch { /* userData is ready only after app.ready */ }
  for (const file of destinations) {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${text}\n`);
    } catch { /* diagnostics must not take the shell down */ }
  }
}

function allowLocalE2ENetwork() {
  if (!localE2E || typeof app.commandLine?.appendSwitch !== 'function') return;
  // A runner proxy or Chromium HTTPS upgrade turns the mock http://127.0.0.1 into a failed load.
  app.commandLine.appendSwitch('no-proxy-server');
  app.commandLine.appendSwitch('proxy-bypass-list', '<-loopback>');
  app.commandLine.appendSwitch('disable-features', 'HttpsUpgrades,HttpsFirstBalancedModeAutoEnable,BlockInsecurePrivateNetworkRequests,PrivateNetworkAccessSendPreflights');
  // Packaged Electron skips the accessibility tree unless a screen reader is present, so role locators never match.
  app.commandLine.appendSwitch('force-renderer-accessibility');
}

function state() {
  return { visible: win?.isVisible() ?? false, collapsed, alwaysOnTop, contentProtection, captureActive, shortcutRegistered, platform: process.platform,
    audioProtocol: 2, nativeAudioProtocol: 2, version: app.getVersion(), backgroundOpacity, backgroundOpacityMin: 0.15, backgroundOpacityMax: 0.95, preferencesError,
    fontScale: fontScaleValue, transcriptOpen, clickThrough, openAtLogin, hotkeys: hotkeySummary(hotkeyState),
    update: updates.status() };
}
function boundsToSave() {
  if (!win || win.isDestroyed()) return null;
  if (collapsed && expandedBounds) {
    const icon = win.getBounds();
    try {
      return safeBounds({ x: icon.x, y: icon.y, width: expandedBounds.width, height: expandedBounds.height }, screen.getAllDisplays());
    } catch { return { ...expandedBounds, x: icon.x, y: icon.y }; }
  }
  return win.getBounds();
}
function persistWindow() {
  if (!preferencesPath || !win || win.isDestroyed()) return;
  try {
    fs.writeFileSync(`${preferencesPath}.tmp`, JSON.stringify({
      bounds: boundsToSave(), backgroundOpacity, opacityVersion: 3, fontScale: fontScaleValue,
      transcriptOpen, clickThrough, openAtLogin, hotkeys: hotkeyOverrides,
    }), { mode: 0o600 });
    fs.renameSync(`${preferencesPath}.tmp`, preferencesPath);
    preferencesError = '';
  } catch { preferencesError = 'Window preferences could not be saved. Changes apply for this launch only.'; }
}
function holdOnTop() {
  if (!win || win.isDestroyed() || !alwaysOnTop || !win.isVisible()) return;
  win.setAlwaysOnTop(true, 'screen-saver');
  win.setVisibleOnAllWorkspaces?.(true, { visibleOnFullScreen: true });
  if (process.platform === 'win32') win.moveTop?.();
}
function applyAlwaysOnTop(enabled) {
  if (!win || win.isDestroyed()) return;
  alwaysOnTop = enabled;
  if (enabled) holdOnTop();
  else {
    win.setAlwaysOnTop(false);
    win.setVisibleOnAllWorkspaces?.(false);
  }
}
function applyPassthrough() {
  if (!win || win.isDestroyed() || typeof win.setIgnoreMouseEvents !== 'function') return;
  // One toggle. Mouse moves never call into the main process, so the renderer cannot
  // stall inside sendSync while the window is deciding whether to take the click.
  const pass = clickThrough === true;
  ignoringMouse = pass;
  win.setIgnoreMouseEvents(pass);
}
function applyOpenAtLogin(enabled) {
  openAtLogin = Boolean(enabled);
  try {
    if (typeof app.setLoginItemSettings === 'function') app.setLoginItemSettings({ openAtLogin, openAsHidden: false });
  } catch { preferencesError = 'Start at login could not be changed on this system.'; }
}
function snap(direction) {
  if (!win || win.isDestroyed()) return;
  const next = snapBounds(win.getBounds(), direction, screen.getAllDisplays(), snapPlace);
  snapPlace = { col: next.col, row: next.row };
  win.setBounds({ x: next.x, y: next.y, width: next.width, height: next.height });
  persistWindow();
}
function onHotkey(binding) {
  if (binding.id === 'hideShow') { setCollapsed(!collapsed); return; }
  if (binding.id.startsWith('snap')) { snap(binding.id); return; }
  if (!binding.forward || !win || win.isDestroyed()) return;
  if (binding.id === 'screenshot' && !win.isVisible()) show();
  win.webContents.send('overlay:command', { action: binding.id });
}
function activateHotkeys() {
  globalShortcut.unregisterAll();
  if (!liveShortcuts) { hotkeyState = []; shortcutRegistered = false; broadcast(); return; }
  try { hotkeyState = registerHotkeys(globalShortcut, resolveHotkeys(hotkeyOverrides), onHotkey); }
  catch (error) {
    preferencesError = error instanceof Error ? error.message : 'Shortcuts could not be registered.';
    hotkeyState = [];
  }
  shortcutRegistered = hotkeyState.some(binding => binding.registered);
}
function loadAutoUpdater() {
  const bundled = path.join(__dirname, 'updater-runtime.cjs');
  if (fs.existsSync(bundled)) return require(bundled).autoUpdater;
  return require('electron-updater').autoUpdater;
}
function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('overlay:state-changed', state());
  updateTray();
}
function syncCollapsedClass() {
  // The state event can be dropped while Windows is iconic. Paint the class
  // directly once the page can run script again.
  if (!win || win.isDestroyed() || typeof win.webContents?.executeJavaScript !== 'function') return;
  const flag = collapsed ? 'true' : 'false';
  try {
    const pending = win.webContents.executeJavaScript(
      `document.documentElement.classList.toggle('sonora-collapsed', ${flag}); document.documentElement.classList.toggle('sonora-force-collapsed', ${flag}); var leaked = document.getElementById('sonora-collapsed-style'); if (leaked) leaked.remove();`,
      false,
    );
    if (pending && typeof pending.catch === 'function') pending.catch(() => {});
  } catch { /* the state event still updates a live page */ }
}
let collapsedPaint = null;
function holdCollapsedPaint() {
  if (collapsedPaint) { clearInterval(collapsedPaint); collapsedPaint = null; }
  syncCollapsedClass();
  // A later renderer state can clear the class while the window stays 72px.
  // Keep painting it until the window is expanded again.
  if (!collapsed || typeof win?.webContents?.executeJavaScript !== 'function') return;
  collapsedPaint = setInterval(() => {
    if (!collapsed) { clearInterval(collapsedPaint); collapsedPaint = null; return; }
    syncCollapsedClass();
  }, 200);
  collapsedPaint.unref?.();
}
const WINDOW_CLEAR = '#00000000';
function clearWindowPlate() {
  if (!win || win.isDestroyed()) return;
  // The window plate and material are fixed at creation. Touching either
  // afterward paints an opaque white sheet on Windows.
}
function placeReachable(box) {
  // A frameless window flush with the top of the screen does not receive
  // title-bar clicks on Windows. Keep the minus button below that edge.
  let area;
  try {
    const areas = screen.getAllDisplays().map(display => display.workArea).filter(Boolean);
    area = areas.find(item => box.x < item.x + item.width && box.x + box.width > item.x) || areas[0];
  } catch { return box; }
  if (!area) return box;
  const y = Math.max(area.y + 40, Math.min(box.y, area.y + area.height - Math.min(box.height, area.height)));
  return y === box.y ? box : { ...box, y };
}
function refreshHitTesting() {
  if (!win || win.isDestroyed() || collapsed || clickThrough) return;
  // Hide/show on a transparent frameless window leaves the Windows drag-region
  // map covering the title-bar buttons. Toggling mouse capture and nudging the
  // size forces Chromium to rebuild those rectangles.
  if (typeof win.setIgnoreMouseEvents === 'function') {
    try {
      win.setIgnoreMouseEvents(true);
      win.setIgnoreMouseEvents(false);
      ignoringMouse = false;
    } catch { /* the nudge below still rebuilds the drag map */ }
  }
  const box = win.getBounds();
  try {
    win.setBounds({ x: box.x, y: box.y, width: box.width, height: box.height + 1 });
    win.setBounds(box);
  } catch { /* the buttons stay clickable if the map was already current */ }
}
function show() {
  if (!win || win.isDestroyed()) return;
  clearWindowPlate();
  win.setSkipTaskbar?.(true);
  win.show();
  win.focus();
  win.setSkipTaskbar?.(true);
  if (!collapsed) {
    const placed = placeReachable(win.getBounds());
    if (placed.y !== win.getBounds().y) win.setBounds(placed);
  }
  if (alwaysOnTop) holdOnTop();
  refreshHitTesting();
  syncTray();
  broadcast();
}
let enforcingCollapsed = false;
function enforceCollapsedSize() {
  if (enforcingCollapsed || !collapsed || !win || win.isDestroyed()) return;
  const box = win.getBounds();
  if (box.width === COLLAPSED && box.height === COLLAPSED) return;
  // Echoing getBounds() here is what blew the icon up: Windows reports the old
  // minimum (a tall overlay) as soon as a drag starts. Always write the icon size.
  enforcingCollapsed = true;
  try {
    win.setMinimumSize?.(72, 72);
    win.setMaximumSize?.(COLLAPSED, COLLAPSED);
    win.setBounds({ x: box.x, y: box.y, width: COLLAPSED, height: COLLAPSED });
  } finally { enforcingCollapsed = false; }
}
function placeCollapsed(x, y) {
  if (!win || win.isDestroyed()) return;
  const nextX = Math.round(x);
  const nextY = Math.round(y);
  // setPosition leaves the size alone. setBounds with a stored width is what grew the icon.
  if (typeof win.setPosition === 'function') win.setPosition(nextX, nextY);
  else win.setBounds({ x: nextX, y: nextY, width: COLLAPSED, height: COLLAPSED });
  enforceCollapsedSize();
}
function setCollapsed(value) {
  if (!win || win.isDestroyed()) return;
  bootLog(`setCollapsed request=${value} current=${collapsed}`);
  const next = Boolean(value);
  if (next === collapsed) { broadcast(); holdCollapsedPaint(); return; }
  // Flip first so a resize event during the bounds change cannot restore the tall size.
  collapsed = next;
  collapsedDrag = null;
  if (next) {
    expandedBounds = win.getBounds();
    try { expandedMinimum = win.getMinimumSize?.() || [390, 620]; } catch { expandedMinimum = [390, 620]; }
    // The normal answer pane cannot shrink below 620px. The listening icon can.
    win.setMinimumSize?.(72, 72);
    win.setMaximumSize?.(COLLAPSED, COLLAPSED);
    win.setBounds({ x: expandedBounds.x, y: expandedBounds.y, width: COLLAPSED, height: COLLAPSED });
    win.setResizable?.(false);
    // setResizable(false) on Windows reapplies the previous minimum. Lock the icon again.
    win.setMinimumSize?.(72, 72);
    win.setMaximumSize?.(COLLAPSED, COLLAPSED);
    enforceCollapsedSize();
    clearWindowPlate();
    collapsedAt = Date.now();
  } else if (expandedBounds) {
    const icon = win.getBounds();
    const minimum = expandedMinimum || [390, 620];
    win.setResizable?.(true);
    win.setMaximumSize?.(10000, 10000);
    win.setMinimumSize?.(minimum[0], minimum[1]);
    clearWindowPlate();
    let restored = placeReachable({ x: icon.x, y: icon.y, width: expandedBounds.width, height: expandedBounds.height });
    try { restored = safeBounds(restored, screen.getAllDisplays()); } catch { /* keep the icon anchor */ }
    restored = placeReachable(restored);
    win.setBounds(restored);
    expandedBounds = restored;
  }
  broadcast();
  holdCollapsedPaint();
}
function expandFromIcon() {
  if (!win || win.isDestroyed()) return;
  const icon = win.getBounds();
  const saved = expandedBounds && expandedBounds.width > COLLAPSED && expandedBounds.height > COLLAPSED ? expandedBounds : null;
  const minimum = expandedMinimum || [390, 620];
  collapsed = false;
  collapsedDrag = null;
  win.setResizable?.(true);
  win.setMaximumSize?.(10000, 10000);
  win.setMinimumSize?.(minimum[0], minimum[1]);
  clearWindowPlate();
  let restored = placeReachable({ x: icon.x, y: icon.y, width: saved?.width || 780, height: saved?.height || 720 });
  try { restored = safeBounds(restored, screen.getAllDisplays()); } catch { /* keep the icon anchor */ }
  restored = placeReachable(restored);
  win.setBounds(restored);
  expandedBounds = restored;
  broadcast();
  holdCollapsedPaint();
}
function conceal() {
  if (!win || win.isDestroyed()) return;
  // Windows leaves a screen-saver-level always-on-top window visible if hide()
  // runs while that level is still set. Drop the level, keep the preference.
  win.setAlwaysOnTop(false);
  // A minimized window grows a taskbar button and an Alt+Tab entry. Hide it instead.
  try { if (win.isMinimized?.()) win.restore(); } catch { /* hide still removes it */ }
  win.setSkipTaskbar?.(true);
  win.hide();
  win.setSkipTaskbar?.(true);
  syncTray();
  broadcast();
}
function hide() {
  if (!win || win.isDestroyed() || !win.isVisible()) return;
  conceal();
}
function minimizeToTray() {
  setCollapsed(true);
}
function toggle() { if (win?.isVisible()) hide(); else show(); }
function setContentProtection(value) {
  if (typeof value !== 'boolean') throw new Error('Expected boolean.');
  const requested = value && ['win32', 'darwin'].includes(process.platform);
  win.setContentProtection(requested);
  contentProtection = requested;
  broadcast();
  return state();
}
function stopCapture() {
  nativeAudio?.stop();
  win?.webContents.send('overlay:stop-capture');
  // Renderer reports inactive only after releasing the tracks.
  show();
}
function updateTray() {
  if (!tray || tray.isDestroyed()) return;
  trayMenu = [
    { label: 'Open Sonora', click: show },
    { label: `Version ${app.getVersion()}`, enabled: false },
    { label: 'Quit', click: () => {
      dialog.showMessageBox({ type: 'question', buttons: ['Cancel', 'Quit'], defaultId: 0, cancelId: 0,
        title: 'Quit Sonora', message: 'Quit Sonora?', detail: 'Quitting stops listening and closes the window.' }).then(result => {
        if (result.response === 1) { quitting = true; app.quit(); }
      }).catch(() => {});
    } },
  ];
  tray.setToolTip('Sonora');
  const built = Menu.buildFromTemplate(trayMenu);
  // Windows turns a context menu into the left-click action, so the icon click never restores the window.
  if (process.platform === 'win32') {
    try { tray.setContextMenu(null); } catch { /* left click stays a click */ }
  } else tray.setContextMenu(built);
}
function moveCollapsed(dx, dy) {
  if (!collapsed || !win || win.isDestroyed()) return state();
  if (typeof dx !== 'number' || typeof dy !== 'number' || !Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('Expected a move.');
  const box = win.getBounds();
  // Deltas are DIP. Do not pass width or height: that reapplied the expanded size.
  placeCollapsed(box.x + dx, box.y + dy);
  return state();
}
function dragCollapsed(phase) {
  if (!collapsed || !win || win.isDestroyed()) return { moved: false };
  if (phase !== 'start' && phase !== 'move' && phase !== 'end') throw new Error('Expected a drag.');
  const cursor = screen.getCursorScreenPoint();
  if (phase === 'start' || !collapsedDrag) {
    const box = win.getBounds();
    collapsedDrag = {
      grabX: cursor.x - box.x, grabY: cursor.y - box.y,
      startX: cursor.x, startY: cursor.y, moved: false,
    };
    if (phase === 'start') return { moved: false };
  }
  const distance = Math.hypot(cursor.x - collapsedDrag.startX, cursor.y - collapsedDrag.startY);
  if (distance >= 4) collapsedDrag.moved = true;
  if (phase === 'move' && collapsedDrag.moved) placeCollapsed(cursor.x - collapsedDrag.grabX, cursor.y - collapsedDrag.grabY);
  const moved = collapsedDrag.moved === true;
  if (phase === 'end') collapsedDrag = null;
  return { moved };
}
let windowDrag = null;
function dragWindow(phase) {
  if (!win || win.isDestroyed() || collapsed) return { moved: false };
  if (phase !== 'start' && phase !== 'move' && phase !== 'end') throw new Error('Expected a drag.');
  const cursor = screen.getCursorScreenPoint();
  if (phase === 'start' || !windowDrag) {
    const box = win.getBounds();
    windowDrag = { grabX: cursor.x - box.x, grabY: cursor.y - box.y, startX: cursor.x, startY: cursor.y, moved: false };
    if (phase === 'start') return { moved: false };
  }
  const distance = Math.hypot(cursor.x - windowDrag.startX, cursor.y - windowDrag.startY);
  if (distance >= 4) windowDrag.moved = true;
  if (phase === 'move' && windowDrag.moved && typeof win.setPosition === 'function') {
    win.setPosition(Math.round(cursor.x - windowDrag.grabX), Math.round(cursor.y - windowDrag.grabY));
  }
  const moved = windowDrag.moved === true;
  if (phase === 'end') windowDrag = null;
  return { moved };
}
function destroyTray() {
  if (tray && !tray.isDestroyed?.()) tray.destroy?.();
  tray = null;
}
function ensureTray() {
  if (tray && !tray.isDestroyed?.()) { updateTray(); return; }
  const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
  tray = new Tray(icon);
  tray.on('click', show);
  tray.on('double-click', show);
  tray.on('right-click', () => {
    if (!tray || tray.isDestroyed?.()) return;
    tray.popUpContextMenu?.(Menu.buildFromTemplate(trayMenu));
  });
  updateTray();
}
function syncTray() {
  if (win && !win.isDestroyed() && win.isVisible()) destroyTray();
  else ensureTray();
}
function registerIpc() {
  const handle = (name, fn) => ipcMain.handle(name, (event, ...args) => {
    if (!desktopRequestAllowed(event, win?.webContents, target, name, offlineFileUrl)) throw new Error('Untrusted desktop request.');
    return fn(...args);
  });
  handle('overlay:get-state', state);
  const diagnostics = () => diagnosticReport({ version: app.getVersion(), platform: process.platform,
    arch: process.arch, captureActive, shortcutRegistered, audioProtocol: 2 });
  handle('desktop:diagnostics', diagnostics);
  handle('desktop:export-diagnostics', async () => {
    const result = await dialog.showSaveDialog(win, { title: 'Export privacy-safe diagnostics',
      defaultPath: 'sonora-diagnostics.json', filters: [{ name: 'JSON report', extensions: ['json'] }] });
    if (result.canceled || !result.filePath) return false;
    await fs.promises.writeFile(result.filePath, JSON.stringify(diagnostics(), null, 2), { mode: 0o600 });
    return true;
  });
  handle('desktop:update-status', () => updates.status());
  handle('desktop:check-updates', async () => { await updates.check(); return updates.status(); });
  handle('desktop:install-update', () => { updates.install(); return true; });
  handle('desktop:retry-connection', () => { void win.loadURL(target).catch(() => {}); return true; });
  handle('auth:start', () => browserAuth.start());
  handle('auth:poll', id => browserAuth.poll(id));
  handle('auth:cancel', id => {
    if (typeof id !== 'string') throw new Error('Expected an authorization request id.');
    return browserAuth.cancel(id);
  });
  handle('audio:start', (id, source, deviceName, referenceDevice) => nativeAudio.start(id, source, deviceName, referenceDevice));
  handle('e2e:window-flags', () => {
    if (!localE2E) throw new Error('E2E flags are unavailable.');
    return { transparent: true, frameless: true, alwaysOnTop: Boolean(win?.isAlwaysOnTop?.()), clickThrough, ignoringMouse, backgroundMaterial: 'none' };
  });
  handle('desktop:capture-screen', async () => {
    if (localE2E) return 'e2e-screenshot';
    const choice = await dialog.showMessageBox(win, {
      type: 'question', title: 'Send one screenshot?', buttons: ['Cancel', 'Send screenshot'],
      defaultId: 0, cancelId: 0,
      message: 'Send the current screen with your question?',
      detail: 'Sonora sends that image to Gemini for this answer and does not store the picture.',
    });
    if (choice.response !== 1 || win.isDestroyed()) return null;
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1280, height: 720 } });
    const image = sources[0]?.thumbnail;
    if (!image || image.isEmpty()) return null;
    const jpeg = image.toJPEG(70);
    return jpeg.length > 500_000 ? null : jpeg.toString('base64');
  });
  handle('audio:devices', source => {
    if (process.platform !== 'win32') throw new Error('Device selection is supported on Windows only.');
    if (nativeAudio.isActive()) throw new Error('Stop audio before refreshing devices.');
    return listAudioDevices(nativeAudioBinary, source);
  });
  handle('audio:stop-all', stopCapture);
  handle('audio:stop', id => {
    if (typeof id !== 'string') throw new Error('Expected a capture identifier.');
    return nativeAudio.stop(id);
  });
  handle('overlay:show', () => { show(); return state(); });
  handle('overlay:hide', () => { hide(); return state(); });
  handle('overlay:minimize', () => {
    const box = win?.getBounds?.() || { width: 0, height: 0 };
    const atIcon = box.width <= COLLAPSED + 2 && box.height <= COLLAPSED + 2;
    if (atIcon && Date.now() - collapsedAt < 800) return state();
    if (atIcon) expandFromIcon();
    else {
      // A tray restore can leave the flag true while the window is still tall.
      // Minimize always collapses that window; it does not toggle it open.
      if (collapsed) collapsed = false;
      setCollapsed(true);
    }
    return state();
  });
  handle('overlay:move-collapsed', (dx, dy) => moveCollapsed(dx, dy));
  handle('overlay:drag-collapsed', phase => dragCollapsed(phase));
  handle('overlay:drag-window', phase => dragWindow(phase));
  handle('overlay:set-live-shortcuts', value => {
    liveShortcuts = value === true;
    activateHotkeys();
    return state();
  });
  handle('overlay:toggle', () => { toggle(); return state(); });
  handle('overlay:set-always-on-top', value => {
    if (typeof value !== 'boolean') throw new Error('Expected boolean.');
    applyAlwaysOnTop(value); broadcast(); return state();
  });
  handle('overlay:set-font-scale', value => {
    fontScaleValue = fontScale(value); persistWindow(); broadcast(); return state();
  });
  handle('overlay:set-transcript-open', value => {
    if (typeof value !== 'boolean') throw new Error('Expected boolean.');
    transcriptOpen = value; persistWindow(); broadcast(); return state();
  });
  handle('overlay:set-click-through', value => {
    if (typeof value !== 'boolean') throw new Error('Expected boolean.');
    clickThrough = value; if (!clickThrough) controlsHover = false; applyPassthrough(); persistWindow(); broadcast(); return state();
  });
  handle('overlay:set-controls-hover', value => {
    if (typeof value !== 'boolean') throw new Error('Expected boolean.');
    if (controlsHover === value) return state();
    controlsHover = value; applyPassthrough(); return state();
  });
  ipcMain.on('overlay:set-pointer-capture', event => {
    // Answer immediately. A synchronous mouse-move message must never wait on this process.
    event.returnValue = false;
  });
  handle('overlay:set-open-at-login', value => {
    if (typeof value !== 'boolean') throw new Error('Expected boolean.');
    applyOpenAtLogin(value); persistWindow(); broadcast(); return state();
  });
  handle('overlay:set-hotkeys', update => {
    if (!update || typeof update !== 'object' || Array.isArray(update)) throw new Error('Expected shortcut settings.');
    const next = { ...hotkeyOverrides, ...update };
    resolveHotkeys(next);
    hotkeyOverrides = next;
    persistWindow();
    activateHotkeys();
    broadcast();
    return state();
  });
  handle('overlay:reset-hotkeys', () => {
    hotkeyOverrides = {};
    persistWindow();
    activateHotkeys();
    broadcast();
    return state();
  });
  handle('overlay:set-content-protection', setContentProtection);
  handle('overlay:set-background-opacity', value => {
    backgroundOpacity = opacity(value);
    persistWindow();
    broadcast();
    return state();
  });
  handle('overlay:set-capture-active', value => {
    if (typeof value !== 'boolean') throw new Error('Expected boolean.');
    if (nativeAudio?.isActive()) return state();
    captureActive = value; broadcast(); return state();
  });
  handle('overlay:quit', () => { quitting = true; app.quit(); });
}
function configurePermissions() {
  const ses = win.webContents.session;
  ses.setPermissionCheckHandler((contents, permission, origin, details) => {
    if (contents !== win.webContents || !isAllowedNavigation(origin, target)) return false;
    if (permission === 'display-capture') return true;
    return permission === 'media' && details.mediaType === 'audio';
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    const trusted = contents === win.webContents && isAllowedNavigation(details.requestingUrl, target);
    if (!trusted || permission !== 'media' || !details.mediaTypes?.length ||
        details.mediaTypes.some(type => type !== 'audio')) { callback(false); return; }
    dialog.showMessageBox(win, {
      type: 'question', title: 'Allow microphone?', buttons: ['Cancel', 'Allow microphone'],
      defaultId: 0, cancelId: 0,
      message: 'Allow Sonora to transcribe your microphone?',
      detail: 'Sonora streams audio to Speechmatics for live transcription. If that service is unavailable, audio clips are transcribed by Gemini instead. Answers are generated by Gemini. You can stop capture from the assistant or tray.',
    }).then(result => callback(result.response === 1), () => callback(false));
  });
  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (request.frame !== win.webContents.mainFrame || !isAllowedNavigation(request.securityOrigin, target) ||
          !request.audioRequested || !['win32', 'darwin'].includes(process.platform)) { callback({}); return; }
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
      if (!sources.length) { callback({}); return; }
      const choices = sources.slice(0, 8);
      const result = await dialog.showMessageBox(win, {
        type: 'question', title: 'Share system audio with Sonora',
        message: 'Transcribe audio playing on this computer?',
        detail: 'System audio can include other applications, not just your interview. Screen access is used to establish the stream, but Sonora sends only audio to its transcription service. Stop capture from the app or tray. On Mac, allow system-audio access when prompted.',
        buttons: ['Cancel', ...choices.map(source => `Share audio · ${source.name}`)],
        defaultId: 0, cancelId: 0,
      });
      if (!result.response || win.isDestroyed()) { callback({}); return; }
      callback({ video: choices[result.response - 1], audio: 'loopback' });
    } catch { callback({}); }
  }, { useSystemPicker: false });
}
function createWindow() {
  preferencesPath = path.join(app.getPath('userData'), 'window-preferences.json');
  let saved;
  let migrateOpacity = false;
  try {
    saved = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
    backgroundOpacity = initialOpacity(saved);
    fontScaleValue = initialFontScale(saved);
    transcriptOpen = flag(saved?.transcriptOpen, false);
    clickThrough = flag(saved?.clickThrough, false);
    openAtLogin = flag(saved?.openAtLogin, false);
    hotkeyOverrides = saved?.hotkeys && typeof saved.hotkeys === 'object' ? saved.hotkeys : {};
    migrateOpacity = saved.opacityVersion !== 3;
  } catch (error) {
    if (error.code !== 'ENOENT') preferencesError = 'Saved window preferences were invalid; safe defaults were restored.';
  }
  const bounds = safeBounds(saved?.bounds, screen.getAllDisplays());
  win = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(390, bounds.width), minHeight: Math.min(620, bounds.height), show: false,
    // thickFrame, rounded corners, and Win11 Mica paint an opaque backing behind a frameless window.
    frame: false, thickFrame: false, roundedCorners: false,
    transparent: true, backgroundColor: WINDOW_CLEAR, resizable: true, alwaysOnTop: true,
    // toolbar sets WS_EX_TOOLWINDOW on Windows, so the window stays out of the taskbar, Alt+Tab, and Task View.
    hiddenInMissionControl: true,
    ...(process.platform === 'win32' ? { type: 'toolbar' } : {}),
    title: 'Sonora', skipTaskbar: true, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), partition: 'persist:sonora',
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, backgroundThrottling: false,
    },
  });
  win.setIgnoreMouseEvents(false);
  win.setSkipTaskbar(true);
  clearWindowPlate();
  if (process.platform === 'win32') {
    const topTimer = setInterval(() => holdOnTop(), 1000);
    win.on('closed', () => clearInterval(topTimer));
  }
  if (migrateOpacity) persistWindow();
  applyAlwaysOnTop(alwaysOnTop);
  applyOpenAtLogin(openAtLogin);
  applyPassthrough();
  nativeAudioBinary = app.isPackaged
      ? path.join(process.resourcesPath, 'native', process.platform === 'win32' ? 'sonora-audio.exe' : 'sonora-audio')
      : path.resolve(__dirname, '../../../generated-artifacts/native', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'sonora-audio.exe' : 'sonora-audio');
  nativeAudio = createNativeAudioManager({
    binary: nativeAudioBinary,
    confirm: async source => {
      const result = await dialog.showMessageBox(win, {
        type: 'question', title: 'Allow native audio capture?',
        message: source === 'system' ? 'Transcribe audio playing on this computer?' : 'Transcribe your microphone?',
        detail: 'Sonora sends each finished phrase, up to 4.5 seconds, to its hosted Gemini transcription service. System audio can include other apps. No screen video is captured by this helper. Capture continues while hidden; stop it from Sonora or the tray.',
        buttons: ['Cancel', 'Allow audio capture'], defaultId: 0, cancelId: 0,
      });
      return result.response === 1 && !win.isDestroyed();
    },
    emit: event => { if (!win.isDestroyed()) win.webContents.send('audio:event', event); },
    onActive: value => { captureActive = value; broadcast(); },
  });
  win.setContentProtection(contentProtection);
  const remember = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(persistWindow, 300);
  };
  win.on('minimize', () => {
    try { if (win.isMinimized?.()) win.restore(); } catch { /* stay expanded in the window */ }
    setCollapsed(true);
    // restore() lands after this handler and can wake the page after the
    // collapsed event was dropped. Push the icon class again once it is awake.
    setTimeout(() => {
      if (!win || win.isDestroyed()) return;
      if (!collapsed) setCollapsed(true);
      else { enforceCollapsedSize(); holdCollapsedPaint(); }
    }, 400);
  });
  win.on('restore', () => {
    if (!collapsed) return;
    enforceCollapsedSize();
    syncCollapsedClass();
    broadcast();
  });
  win.on('will-resize', (event, newBounds) => {
    if (!collapsed || !newBounds) return;
    if (newBounds.width === COLLAPSED && newBounds.height === COLLAPSED) return;
    event.preventDefault();
  });
  win.on('moved', remember);
  win.on('resized', () => { if (collapsed) enforceCollapsedSize(); else remember(); });
  const recoverPosition = () => {
    if (win.isDestroyed()) return;
    if (collapsed) { enforceCollapsedSize(); return; }
    win.setBounds(safeBounds(win.getBounds(), screen.getAllDisplays()));
  };
  screen.on('display-removed', recoverPosition);
  screen.on('display-metrics-changed', recoverPosition);
  win.setMenuBarVisibility(false);
  const allowedPage = url => isAllowedNavigation(url, target) || isBundledOfflineNavigation(url, offlineFileUrl);
  win.webContents.on('will-navigate', (event, url) => {
    if (!allowedPage(url)) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!allowedPage(url)) event.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    // OAuth in embedded browsers is not assumed to work. Never attach the native bridge to external pages.
    if (url.startsWith('https://')) {
      dialog.showMessageBox(win, { type: 'question', message: 'Open this link in your browser?', detail: url,
        buttons: ['Cancel', 'Open browser'], defaultId: 0, cancelId: 0,
      }).then(result => { if (result.response === 1) void shell.openExternal(url); });
    }
    return { action: 'deny' };
  });
  win.on('close', event => { if (!quitting && !localE2E) { event.preventDefault(); hide(); } });
  win.on('show', () => { win.setSkipTaskbar?.(true); if (alwaysOnTop) applyAlwaysOnTop(true); syncTray(); broadcast(); refreshHitTesting(); });
  // A frameless window at the top of the screen reports the minus click as a
  // caption drag. The page never sees it, so collapse from that message.
  if (process.platform === 'win32' && typeof win.hookWindowMessage === 'function') {
    win.hookWindowMessage(0x00A1, wParam => {
      let code = -1;
      try { code = typeof wParam?.readInt32LE === 'function' ? wParam.readInt32LE(0) : Number(wParam); } catch { return; }
      if (code !== 2 || !win || win.isDestroyed() || collapsed) return;
      const cursor = screen.getCursorScreenPoint();
      const box = win.getBounds();
      const localX = cursor.x - box.x;
      const localY = cursor.y - box.y;
      const fromRight = box.width - localX;
      if (localY < 0 || localY > 44 || fromRight < 130 || fromRight > 175) return;
      bootLog(`caption-minimize x=${Math.round(localX)} y=${Math.round(localY)}`);
      setCollapsed(true);
    });
  }
  win.on('hide', () => { syncTray(); broadcast(); });
  win.on('blur', () => { holdOnTop(); });
  win.webContents.on('render-process-gone', () => { nativeAudio.stop(); if (!nativeAudio.isActive()) captureActive = false; broadcast(); });
  win.webContents.on('unresponsive', () => bootLog('unresponsive'));
  win.webContents.on('responsive', () => bootLog('responsive'));
  win.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) { nativeAudio.stop(); if (!nativeAudio.isActive()) captureActive = false; broadcast(); }
  });
  win.webContents.on('did-fail-load', async (_event, code, description, url, mainFrame) => {
    if (!mainFrame || code === -3 || isBundledOfflineNavigation(url, offlineFileUrl)) return;
    bootLog(`did-fail-load code=${code} ${description} url=${url} attempt=${serviceLoadAttempts}`);
    if (!isAllowedNavigation(url, target)) return;
    if (localE2E && serviceLoadAttempts < 8) {
      serviceLoadAttempts += 1;
      await new Promise(resolve => setTimeout(resolve, 400));
      if (!win.isDestroyed()) void loadService();
      return;
    }
    try { await win.loadFile(path.join(__dirname, 'offline.html')); }
    catch {
      const result = await dialog.showMessageBox(win, { type: 'error', message: 'Sonora could not connect.',
        detail: 'Check your internet connection and that the hosted Sonora service is available.',
        buttons: ['Quit', 'Retry'], defaultId: 1, cancelId: 0,
      });
      if (result.response === 1) void win.loadURL(target).catch(() => {});
      else { quitting = true; app.quit(); }
    }
  });
  win.webContents.on('did-finish-load', () => {
    try { app.setAccessibilitySupportEnabled(true); } catch (error) { bootLog(`accessibility ${error}`); }
    bootLog(`did-finish-load ${win.webContents.getURL()} scale=${screen.getPrimaryDisplay?.().scaleFactor ?? 1}`);
  });
  configurePermissions();
  win.once('ready-to-show', show);
  void loadService();
}

function startVisualProofCapture() {
  if (!localE2E || !process.argv.includes('--visual-proof')) return;
  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith('/window') && win && !win.isDestroyed()) {
        const image = await win.webContents.capturePage();
        if (!image || image.isEmpty()) { res.writeHead(503); res.end(); return; }
        const png = image.toPNG();
        const bounds = win.getBounds();
        const scale = screen.getPrimaryDisplay().scaleFactor || 1;
        const size = image.getSize();
        const bitmap = image.toBitmap();
        const px = Math.max(0, Math.min(size.width - 1, Math.floor(size.width / 2)));
        const py = Math.max(0, Math.min(size.height - 1, Math.floor(size.height / 2)));
        const alpha = bitmap[(py * size.width + px) * 4 + 3] ?? 0;
        res.writeHead(200, {
          'Content-Type': 'image/png', 'Content-Length': png.length,
          'X-Win-X': String(Math.round(bounds.x * scale)),
          'X-Win-Y': String(Math.round(bounds.y * scale)),
          'X-Win-W': String(Math.round(bounds.width * scale)),
          'X-Win-H': String(Math.round(bounds.height * scale)),
          'X-Center-Alpha': String(alpha),
        });
        res.end(png);
        return;
      }
      const display = screen.getPrimaryDisplay();
      const width = Math.max(1, Math.round(display.size.width * (display.scaleFactor || 1)));
      const height = Math.max(1, Math.round(display.size.height * (display.scaleFactor || 1)));
      const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
      const image = sources[0]?.thumbnail;
      if (!image || image.isEmpty()) { res.writeHead(503); res.end(); return; }
      const png = image.toPNG();
      res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': png.length });
      res.end(png);
    } catch (error) {
      res.writeHead(500);
      res.end(String(error));
    }
  });
  server.listen(4181, '127.0.0.1');
}

async function loadService() {
  if (!win || win.isDestroyed()) return;
  if (localE2E) {
    try { await win.webContents.session.setProxy({ mode: 'direct' }); }
    catch (error) { bootLog(`setProxy failed ${error}`); }
    win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
      let local = false;
      try {
        const parsed = new URL(details.url);
        local = parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost' ||
          parsed.protocol === 'file:' || parsed.protocol === 'data:' || parsed.protocol === 'devtools:';
      } catch { local = false; }
      callback({ cancel: !local });
    });
    // A hidden transparent window can fail the first navigation on Windows.
    if (!win.isVisible()) win.show();
    win.focus();
    if (process.platform === 'win32') win.moveTop?.();
  }
  bootLog(`loadURL ${target}`);
  try { await win.loadURL(target); }
  catch (error) { bootLog(`loadURL rejected ${error}`); }
}

try {
  const early = JSON.parse(fs.readFileSync(path.join(__dirname, 'runtime-config.json'), 'utf8'));
  if (early.e2e === true) localE2E = true;
} catch { /* The ready handler reports a missing release configuration. */ }
if (e2e) localE2E = true;
allowLocalE2ENetwork();
const forcedScale = process.argv.find(arg => arg.startsWith('--force-device-scale-factor='));
if (forcedScale && typeof app.commandLine?.appendSwitch === 'function') {
  app.commandLine.appendSwitch('force-device-scale-factor', forcedScale.split('=')[1] || '1');
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.whenReady().then(async () => {
    try {
      app.setAccessibilitySupportEnabled(true);
      if (process.env?.SONORA_BOOT_LOG) fs.appendFileSync(process.env.SONORA_BOOT_LOG, 'accessibility=on\n');
    } catch (error) {
      if (process.env?.SONORA_BOOT_LOG) fs.appendFileSync(process.env.SONORA_BOOT_LOG, `accessibility=${error}\n`);
    }
    try {
      const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, 'runtime-config.json'), 'utf8'));
      localE2E = e2e || bundled.e2e === true;
      if (development || localE2E) target = validateServiceUrl(process.env?.SONORA_DESKTOP_URL || bundled.serviceUrl, true);
      else target = validateServiceUrl(bundled.serviceUrl, false);
      bootLog(`target=${target} packaged=${app.isPackaged} argvE2E=${process.argv.includes('--e2e')} envE2E=${process.env?.SONORA_E2E === '1'} bundledE2E=${bundled.e2e === true}`);
      if (process.env?.SONORA_BOOT_LOG) {
        try { fs.appendFileSync(process.env.SONORA_BOOT_LOG, `target=${target} localE2E=${localE2E} argv=${process.argv.join(' ')}\n`); } catch { /* diagnostic only */ }
      }
    } catch (error) {
      bootLog(`config rejected ${error}`);
      dialog.showErrorBox('Sonora release configuration missing', 'This build has no valid hosted Sonora URL. Ask the publisher for a configured release. A local development server is not a production service.');
      app.quit(); return;
    }
    if (localE2E) contentProtection = false;
    registerIpc();
    try {
      updates = createAutoUpdate({
        updater: loadAutoUpdater(), isPackaged: app.isPackaged && !localE2E, dialog,
        getWindow: () => (win && !win.isDestroyed() ? win : undefined),
        send: payload => { if (win && !win.isDestroyed()) win.webContents.send('desktop:update', payload); },
      });
    } catch { updates = createAutoUpdate({ isPackaged: false }); }
    browserAuth = createBrowserAuth({ serviceUrl: target, openExternal: url => shell.openExternal(url) });
    createWindow();
    startVisualProofCapture();
    activateHotkeys();
    syncTray();
    stopUpdates = updates.start();
    updateTray();
    app.on('activate', show);
  });
}
app.on('before-quit', () => { quitting = true; stopUpdates(); clearTimeout(saveTimer); persistWindow(); void browserAuth?.cancel(); nativeAudio?.shutdown(); win?.destroy(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (quitting || localE2E) app.quit(); });
