const { contextBridge, ipcRenderer } = require('electron');

const stateListeners = new Set();

ipcRenderer.on('overlay:state-changed', (_event, state) => {
  stateListeners.forEach((listener) => listener(state));
});

contextBridge.exposeInMainWorld('sonoraDesktop', {
  isDesktop: true,
  platform: process.platform,
  shortcut: 'Ctrl/Cmd + Shift + Space',
  show: () => ipcRenderer.invoke('overlay:show'),
  hide: () => ipcRenderer.invoke('overlay:hide'),
  toggle: () => ipcRenderer.invoke('overlay:toggle'),
  quit: () => ipcRenderer.invoke('overlay:quit'),
  getState: () => ipcRenderer.invoke('overlay:get-state'),
  setAlwaysOnTop: (value) => ipcRenderer.invoke('overlay:set-always-on-top', Boolean(value)),
  setContentProtection: (value) => ipcRenderer.invoke('overlay:set-content-protection', Boolean(value)),
  setCaptureActive: (value) => ipcRenderer.invoke('overlay:set-capture-active', Boolean(value)),
  startNativeCapture: (captureId, source) => ipcRenderer.invoke('audio:start', captureId, source),
  stopNativeCapture: captureId => ipcRenderer.invoke('audio:stop', captureId),
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
});