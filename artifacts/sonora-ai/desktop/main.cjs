const { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage, screen, dialog, desktopCapturer, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs');
const { validateServiceUrl, isAllowedNavigation, isTrustedFrame } = require('./security.cjs');
const { createNativeAudioManager } = require('./native-audio-host.cjs');
const { listAudioDevices } = require('./audio-devices.cjs');
const { createBrowserAuth } = require('./browser-auth.cjs');
const { opacity, safeBounds } = require('./window-preferences.cjs');
const { createMaintenance, diagnosticReport } = require('./maintenance.cjs');

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
let backgroundOpacity = 0.85;
let preferencesPath;
let preferencesError = '';
let saveTimer;
let maintenance;
const shortcut = 'CommandOrControl+Shift+Space';
const development = !app.isPackaged && process.argv.includes('--dev');

function state() {
  return { visible: win?.isVisible() ?? false, alwaysOnTop, contentProtection, captureActive, shortcutRegistered, platform: process.platform,
    audioProtocol: 2, nativeAudioProtocol: 2, version: app.getVersion(), backgroundOpacity, backgroundOpacityMin: 0.15, preferencesError };
}
function persistWindow() {
  if (!preferencesPath || !win || win.isDestroyed()) return;
  try {
    fs.writeFileSync(`${preferencesPath}.tmp`, JSON.stringify({ bounds: win.getBounds(), backgroundOpacity }), { mode: 0o600 });
    fs.renameSync(`${preferencesPath}.tmp`, preferencesPath);
    preferencesError = '';
  } catch { preferencesError = 'Window preferences could not be saved. Changes apply for this launch only.'; }
}
function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('overlay:state-changed', state());
  updateTray();
}
function show() {
  if (!win || win.isDestroyed()) return;
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
      alwaysOnTop = item.checked; win?.setAlwaysOnTop(alwaysOnTop, 'floating'); broadcast();
    } },
    { type: 'separator' },
    { label: 'Quit Sonora and stop audio', click: () => { quitting = true; app.quit(); } },
  ]));
}
function registerIpc() {
  const handle = (name, fn) => ipcMain.handle(name, (event, ...args) => {
    if (!isTrustedFrame(event, win?.webContents, target)) throw new Error('Untrusted desktop request.');
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
  handle('desktop:check-updates', () => maintenance.check());
  handle('desktop:open-update', () => maintenance.download(async release => {
    const result = await dialog.showMessageBox(win, { type: 'question', title: 'Download Sonora update?',
      message: `Download Sonora ${release.version}?`, detail: `${release.signing}\nSHA-256: ${release.sha256}\nOpens the verified download in your browser. Installation is manual; Sonora will not restart or install automatically.`,
      buttons: ['Cancel', 'Download'], defaultId: 0, cancelId: 0 });
    return result.response === 1;
  }, url => shell.openExternal(url)));
  handle('auth:start', () => browserAuth.start());
  handle('auth:poll', id => browserAuth.poll(id));
  handle('auth:cancel', id => {
    if (typeof id !== 'string') throw new Error('Expected an authorization request id.');
    return browserAuth.cancel(id);
  });
  handle('audio:start', (id, source, deviceName) => nativeAudio.start(id, source, deviceName));
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
    alwaysOnTop = value; win.setAlwaysOnTop(value, 'floating'); broadcast(); return state();
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
      detail: 'Audio chunks will be sent to the hosted Gemini transcription service while capture is active. You can stop from the assistant or tray.',
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
  try {
    saved = JSON.parse(fs.readFileSync(preferencesPath, 'utf8'));
    backgroundOpacity = opacity(saved.backgroundOpacity);
  } catch (error) {
    if (error.code !== 'ENOENT') preferencesError = 'Saved window preferences were invalid; safe defaults were restored.';
  }
  const bounds = safeBounds(saved?.bounds, screen.getAllDisplays());
  win = new BrowserWindow({
    ...bounds,
    minWidth: Math.min(390, bounds.width), minHeight: Math.min(620, bounds.height), show: false, frame: false,
    transparent: true, backgroundColor: '#00000000', resizable: true, alwaysOnTop: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'), partition: 'persist:sonora',
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      webSecurity: true, backgroundThrottling: false,
    },
  });
  nativeAudioBinary = app.isPackaged
      ? path.join(process.resourcesPath, 'native', process.platform === 'win32' ? 'sonora-audio.exe' : 'sonora-audio')
      : path.resolve(__dirname, '../../../generated-artifacts/native', `${process.platform}-${process.arch}`, process.platform === 'win32' ? 'sonora-audio.exe' : 'sonora-audio');
  nativeAudio = createNativeAudioManager({
    binary: nativeAudioBinary,
    confirm: async source => {
      const result = await dialog.showMessageBox(win, {
        type: 'question', title: 'Allow native audio capture?',
        message: source === 'system' ? 'Transcribe audio playing on this computer?' : 'Transcribe your microphone?',
        detail: 'Sonora sends 4.5-second audio chunks to its hosted Gemini transcription service. System audio can include other apps. No screen video is captured by this helper. Capture continues while hidden; stop it from Sonora or the tray.',
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
  win.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedNavigation(url, target)) event.preventDefault();
  });
  win.webContents.on('will-redirect', (event, url) => {
    if (!isAllowedNavigation(url, target)) event.preventDefault();
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
  win.on('close', event => { if (!quitting) { event.preventDefault(); hide(); } });
  win.on('show', broadcast);
  win.on('hide', broadcast);
  win.webContents.on('render-process-gone', () => { nativeAudio.stop(); if (!nativeAudio.isActive()) captureActive = false; broadcast(); });
  win.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
    if (mainFrame && !inPlace) { nativeAudio.stop(); if (!nativeAudio.isActive()) captureActive = false; broadcast(); }
  });
  win.webContents.on('did-fail-load', async (_event, code, _description, url, mainFrame) => {
    if (!mainFrame || code === -3 || !isAllowedNavigation(url, target)) return;
    const result = await dialog.showMessageBox(win, { type: 'error', message: 'Sonora could not connect.',
      detail: 'Check your internet connection and that the hosted Sonora service is available.',
      buttons: ['Quit', 'Retry'], defaultId: 1, cancelId: 0,
    });
    if (result.response === 1) void win.loadURL(target).catch(() => {});
    else { quitting = true; app.quit(); }
  });
  configurePermissions();
  win.once('ready-to-show', show);
  void win.loadURL(target).catch(() => {});
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on('second-instance', show);
  app.whenReady().then(async () => {
    try {
      const bundled = JSON.parse(fs.readFileSync(path.join(__dirname, 'runtime-config.json'), 'utf8'));
      target = validateServiceUrl(development ? process.env.SONORA_DESKTOP_URL : bundled.serviceUrl, development);
    } catch {
      dialog.showErrorBox('Sonora release configuration missing', 'This build has no valid hosted Sonora URL. Ask the publisher for a configured release. A local development server is not a production service.');
      app.quit(); return;
    }
    registerIpc();
    maintenance = createMaintenance({ serviceUrl: target, version: app.getVersion(), platform: process.platform, arch: process.arch });
    browserAuth = createBrowserAuth({ serviceUrl: target, openExternal: url => shell.openExternal(url) });
    createWindow();
    // PNG avoids platform-dependent support for SVG tray images.
    const icon = nativeImage.createFromPath(path.join(__dirname, 'assets', 'tray.png'));
    tray = new Tray(icon);
    tray.on('click', toggle);
    shortcutRegistered = globalShortcut.register(shortcut, toggle);
    updateTray();
    app.on('activate', show);
  });
}
app.on('before-quit', () => { quitting = true; clearTimeout(saveTimer); persistWindow(); void browserAuth?.cancel(); nativeAudio?.shutdown(); win?.destroy(); });
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { if (quitting) app.quit(); });
