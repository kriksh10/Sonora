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
  onStateChange: (listener) => {
    stateListeners.add(listener);
    return () => stateListeners.delete(listener);
  },
});