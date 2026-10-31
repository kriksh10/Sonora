const { contextBridge, ipcRenderer } = require('electron');

const stateListeners = new Set();

ipcRenderer.on('overlay:state-changed', (_event, state) => {
  stateListeners.forEach((listener) => listener(state));
});

contextBridge.exposeInMainWorld('sonoraDesktop', {
  isDesktop: true,
  platform: process.platform,
  shortcut: 'Ctrl+Shift+Space',
  show: () => ipcRenderer.invoke('overlay:show'),
  hide: () => ipcRenderer.invoke('overlay:hide'),
  toggle: () => ipcRenderer.invoke('overlay:toggle'),
  quit: () => ipcRenderer.invoke('overlay:quit'),
  getState: () => ipcRenderer.invoke('overlay:get-state'),
  retryConnection: () => ipcRenderer.invoke('desktop:retry-connection'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-updates'),
  updateStatus: () => ipcRenderer.invoke('desktop:update-status'),
  installUpdate: () => ipcRenderer.invoke('desktop:install-update'),
  setFontScale: value => ipcRenderer.invoke('overlay:set-font-scale', value),
  setTranscriptOpen: value => ipcRenderer.invoke('overlay:set-transcript-open', Boolean(value)),
  setClickThrough: value => ipcRenderer.invoke('overlay:set-click-through', Boolean(value)),
  setControlsHover: value => ipcRenderer.invoke('overlay:set-controls-hover', Boolean(value)),
  setOpenAtLogin: value => ipcRenderer.invoke('overlay:set-open-at-login', Boolean(value)),
  setHotkeys: value => ipcRenderer.invoke('overlay:set-hotkeys', value),
  resetHotkeys: () => ipcRenderer.invoke('overlay:reset-hotkeys'),
  getDiagnostics: () => ipcRenderer.invoke('desktop:diagnostics'),
  exportDiagnostics: () => ipcRenderer.invoke('desktop:export-diagnostics'),
  setBackgroundOpacity: value => ipcRenderer.invoke('overlay:set-background-opacity', value),
  startBrowserSignIn: () => ipcRenderer.invoke('auth:start'),
  pollBrowserSignIn: id => ipcRenderer.invoke('auth:poll', id),
  cancelBrowserSignIn: id => ipcRenderer.invoke('auth:cancel', id),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('overlay:set-always-on-top', Boolean(value)),
  setContentProtection: (value) => ipcRenderer.invoke('overlay:set-content-protection', Boolean(value)),
  setCaptureActive: (value) => ipcRenderer.invoke('overlay:set-capture-active', Boolean(value)),
  startNativeCapture: (captureId, source, deviceName, referenceDevice) => ipcRenderer.invoke('audio:start', captureId, source, deviceName, referenceDevice),
  listAudioDevices: source => ipcRenderer.invoke('audio:devices', source),
  captureScreen: () => ipcRenderer.invoke('desktop:capture-screen'),
  stopNativeCapture: captureId => ipcRenderer.invoke('audio:stop', captureId),
  stopAllCapture: () => ipcRenderer.invoke('audio:stop-all'),
  onNativeAudio: listener => {
    const handler = (_event, message) => listener(message);
    ipcRenderer.on('audio:event', handler);
    return () => ipcRenderer.removeListener('audio:event', handler);
  },
  onStopCapture: (listener) => {
    const handler = () => listener();
    ipcRenderer.on('overlay:stop-capture', handler);
    return () => ipcRenderer.removeListener('overlay:stop-capture', handler);
  },
  onStateChange: (listener) => {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  },
  onCommand: listener => {
    const handler = (_event, message) => listener(message?.action);
    ipcRenderer.on('overlay:command', handler);
    return () => ipcRenderer.removeListener('overlay:command', handler);
  },
  onUpdate: listener => {
    const handler = (_event, status) => listener(status);
    ipcRenderer.on('desktop:update', handler);
    return () => ipcRenderer.removeListener('desktop:update', handler);
  },
});