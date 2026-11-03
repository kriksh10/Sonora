const { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage, screen, dialog, desktopCapturer, shell } = require('electron');
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
const { resolveHotkeys, registerHotkeys, nudgeBounds, hotkeySummary } = require('./hotkeys.cjs');
const { createAutoUpdate } = require('./auto-update.cjs');

let win;
let tray;
let quitting = false;
let alwaysOnTop = true;
let contentProtection = ['win32', 'darwin'].includes(process.platform);
let captureActive = false;
let shortcutRegistered = false;
let target;
let nativeAudio;
let nativeAudioBinary;
let browserAuth;
let backgroundOpacity = 0.4;
let fontScaleValue = 1;
let transcriptOpen = false;
let clickThrough = false;
let controlsHover = false;
let pointerOverUi = false;
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
  return { visible: win?.isVisible() ?? false, alwaysOnTop, contentProtection, captureActive, shortcutRegistered, platform: process.platform,
    audioProtocol: 2, nativeAudioProtocol: 2, version: app.getVersion(), backgroundOpacity, backgroundOpacityMin: 0, preferencesError,
    fontScale: fontScaleValue, transcriptOpen, clickThrough, openAtLogin, hotkeys: hotkeySummary(hotkeyState),
    update: updates.status() };
}
function persistWindow() {
  if (!preferencesPath || !win || win.isDestroyed()) return;
  try {
    fs.writeFileSync(`${preferencesPath}.tmp`, JSON.stringify({
      bounds: win.getBounds(), backgroundOpacity, opacityVersion: 2, fontScale: fontScaleValue,
      transcriptOpen, clickThrough, openAtLogin, hotkeys: hotkeyOverrides,
    }), { mode: 0o600 });
    fs.renameSync(`${preferencesPath}.tmp`, preferencesPath);
    preferencesError = '';
  } catch { preferencesError = 'Window preferences could not be saved. Changes apply for this launch only.'; }
}
function holdOnTop() {
  if (!win || win.isDestroyed() || !alwaysOnTop) return;
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
  // Ignore is off unless the user explicitly turned click-through on.
  // A transparent pixel is still a hit target; Windows only passes it through when ignore is on.
  const pass = clickThrough === true && !pointerOverUi && !controlsHover;
  ignoringMouse = pass;
  win.setIgnoreMouseEvents(pass, { forward: pass });
}
function applyOpenAtLogin(enabled) {
  openAtLogin = Boolean(enabled);
  try {
    if (typeof app.setLoginItemSettings === 'function') app.setLoginItemSettings({ openAtLogin, openAsHidden: false });
  } catch { preferencesError = 'Start at login could not be changed on this system.'; }
}
function nudge(direction) {
  if (!win || win.isDestroyed()) return;
  const next = nudgeBounds(win.getBounds(), direction, screen.getAllDisplays());
  win.setBounds({ ...win.getBounds(), ...next });
  persistWindow();
}
function onHotkey(binding) {
  if (binding.id === 'toggle' || binding.id === 'hideShow') { toggle(); return; }
  if (binding.id.startsWith('move')) { nudge(binding.id); return; }
  if (!binding.forward || !win || win.isDestroyed()) return;
  if (binding.id === 'screenshot' && !win.isVisible()) show();
  win.webContents.send('overlay:command', { action: binding.id });
}
function activateHotkeys() {
  globalShortcut.unregisterAll();
  try { hotkeyState = registerHotkeys(globalShortcut, resolveHotkeys(hotkeyOverrides), onHotkey); }
  catch (error) {
    preferencesError = error instanceof Error ? error.message : 'Shortcuts could not be registered.';
    hotkeyState = [];
  }
  shortcutRegistered = hotkeyState.some(binding => binding.id === 'toggle' && binding.registered);
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
const HIT_FLOOR = '#01000000';
function clearWindowPlate() {
  if (!win || win.isDestroyed()) return;
  // Alpha 0 makes Windows treat the whole layered window as click-through.
  // 1/255 is invisible and is still a hit target.
  win.setBackgroundColor?.(HIT_FLOOR);
  if (process.platform === 'win32') win.setBackgroundMaterial?.('none');
}
function show() {
  if (!win || win.isDestroyed()) return;
  clearWindowPlate();
  win.show();
  win.focus();
  broadcast();
}
function hide() {
  win?.hide();
  broadcast();
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
  tray.setToolTip(captureActive ? 'Sonora — AUDIO CAPTURE ACTIVE' : 'Sonora AI — audio off');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: captureActive ? 'Audio capture active' : 'Audio off', enabled: false },
    { label: 'Show Sonora', click: show },
    { label: 'Hide Sonora (audio continues if active)', click: hide },
    { label: 'Stop audio capture', enabled: captureActive, click: stopCapture },
    { label: 'Hide from screen sharing (best effort)', type: 'checkbox',
      checked: contentProtection, enabled: ['win32', 'darwin'].includes(process.platform),
      click: item => {
        try { setContentProtection(item.checked); }
        catch { dialog.showErrorBox('Sonora privacy control', 'Could not change capture exclusion. Do not assume the window is excluded from sharing.'); }
      } },
    { type: 'separator' },
    { label: 'Keep on top', type: 'checkbox', checked: alwaysOnTop, click: item => {
      applyAlwaysOnTop(item.checked); broadcast();
    } },
    { label: 'Click through the overlay', type: 'checkbox', checked: clickThrough, click: item => {
      clickThrough = item.checked; if (!clickThrough) controlsHover = false; applyPassthrough(); persistWindow(); broadcast();
    } },
    { label: 'Start when I sign in', type: 'checkbox', checked: openAtLogin, click: item => {
      applyOpenAtLogin(item.checked); persistWindow(); broadcast();
    } },
    { type: 'separator' },
    { label: 'Quit Sonora and stop audio', click: () => { quitting = true; app.quit(); } },
  ]));
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
  ipcMain.on('overlay:set-pointer-capture', (event, value) => {
    if (!desktopRequestAllowed(event, win?.webContents, target, 'overlay:set-pointer-capture', offlineFileUrl)) return;
    if (typeof value !== 'boolean' || pointerOverUi === value) return;
    pointerOverUi = value;
    applyPassthrough();
    if (value) holdOnTop();
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
    migrateOpacity = saved.opacityVersion !== 2;
  } catch (error) {
    if (error.code !== 'ENOENT') preferencesError = 'Saved window preferences were invalid; safe defaults were restored.';
  }
  const bounds = safeBounds(saved?.bounds, screen.getAllDisplays());
  win = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(390, bounds.width), minHeight: Math.min(620, bounds.height), show: false,
    // thickFrame, rounded corners, and Win11 Mica paint an opaque backing behind a frameless window.
    frame: false, thickFrame: false, roundedCorners: false,
    transparent: true, backgroundColor: HIT_FLOOR, backgroundMaterial: 'none', resizable: true, alwaysOnTop: true,
    skipTaskbar: true, hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), partition: 'persist:sonora',
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, backgroundThrottling: false,
    },
  });
  win.setIgnoreMouseEvents(false);
  clearWindowPlate();
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
  win.on('moved', remember);
  win.on('resized', remember);
  const recoverPosition = () => {
    if (!win.isDestroyed()) win.setBounds(safeBounds(win.getBounds(), screen.getAllDisplays()));
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
  win.on('show', () => { win.setSkipTaskbar?.(true); if (alwaysOnTop) applyAlwaysOnTop(true); broadcast(); });
  win.on('hide', broadcast);
  win.on('blur', () => { holdOnTop(); });
  win.webContents.on('render-process-gone', () => { nativeAudio.stop(); if (!nativeAudio.isActive()) captureActive = false; broadcast(); });
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
  win.webContents.on('did-finish-load', () => bootLog(`did-finish-load ${win.webContents.getURL()}`));
  configurePermissions();
  win.once('ready-to-show', show);
  void loadService();
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

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.whenReady().then(async () => {
    try { app.setAccessibilitySupportEnabled?.(true); } catch { /* older runtimes omit this */ }
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
    // PNG avoids platform-dependent support for SVG tray images.
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
    tray = new Tray(icon);
    tray.on('click', toggle);
    activateHotkeys();
    stopUpdates = updates.start();
    updateTray();
    app.on('activate', show);
  });
}
app.on('before-quit', () => { quitting = true; stopUpdates(); clearTimeout(saveTimer); persistWindow(); void browserAuth?.cancel(); nativeAudio?.shutdown(); win?.destroy(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (quitting || localE2E) app.quit(); });
