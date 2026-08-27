const { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage, screen } = require('electron');
const path = require('node:path');

const isDevelopment = process.argv.includes('--dev') || !app.isPackaged;
const developmentUrl = process.env.SONORA_DESKTOP_URL || 'http://127.0.0.1:5173/';

let overlayWindow = null;
let tray = null;
let isQuitting = false;
let alwaysOnTop = true;

function getProductionUrl() {
  return `file://${path.join(__dirname, '..', 'dist', 'public', 'index.html')}`;
}

function broadcastState() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.webContents.send('overlay:state-changed', {
    visible: overlayWindow.isVisible(),
    alwaysOnTop,
  });
}

function showOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (!overlayWindow.isVisible()) {
    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    const [width, height] = overlayWindow.getSize();
    overlayWindow.setPosition(
      Math.max(display.bounds.x + 24, display.bounds.x + display.bounds.width - width - 24),
      Math.max(display.bounds.y + 24, display.bounds.y + display.bounds.height - height - 72),
      false,
    );
  }
  overlayWindow.show();
  overlayWindow.focus();
  broadcastState();
}

function hideOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  overlayWindow.hide();
  broadcastState();
}

function toggleOverlay() {
  if (!overlayWindow || overlayWindow.isDestroyed()) return;
  if (overlayWindow.isVisible()) hideOverlay();
  else showOverlay();
}

function setPinState(value) {
  alwaysOnTop = value;
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    overlayWindow.setAlwaysOnTop(alwaysOnTop, 'floating');
    broadcastState();
  }
}

function createTray() {
  const iconSvg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <rect width="32" height="32" rx="9" fill="#f0c76c"/>
      <rect x="14.5" y="8" width="3" height="16" rx="1.5" fill="#19373a"/>
      <rect x="8.5" y="11" width="3" height="10" rx="1.5" fill="#19373a" fill-opacity=".7"/>
      <rect x="20.5" y="11" width="3" height="10" rx="1.5" fill="#19373a" fill-opacity=".7"/>
    </svg>
  `;
  const icon = nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(iconSvg).toString('base64')}`,
  );
  tray = new Tray(icon);
  tray.setToolTip('Sonora AI');
  tray.on('click', toggleOverlay);
  tray.setContextMenu(Menu.buildFromTemplate([
    {
      label: 'Show Sonora',
      click: showOverlay,
    },
    {
      label: 'Hide Sonora',
      click: hideOverlay,
    },
    { type: 'separator' },
    {
      label: 'Keep on top',
      type: 'checkbox',
      checked: alwaysOnTop,
      click: (item) => setPinState(item.checked),
    },
    { type: 'separator' },
    {
      label: 'Quit Sonora',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
}

function createOverlayWindow() {
  overlayWindow = new BrowserWindow({
    width: 430,
    height: 360,
    minWidth: 360,
    minHeight: 300,
    show: false,
    frame: false,
    transparent: true,
    resizable: true,
    movable: true,
    hasShadow: false,
    skipTaskbar: true,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  overlayWindow.setAlwaysOnTop(true, 'floating');
  overlayWindow.setMenuBarVisibility(false);
  overlayWindow.on('close', (event) => {
    if (!isQuitting) {
      event.preventDefault();
      hideOverlay();
    }
  });
  overlayWindow.on('show', broadcastState);
  overlayWindow.on('hide', broadcastState);

  const target = isDevelopment ? developmentUrl : getProductionUrl();
  if (isDevelopment) overlayWindow.loadURL(target);
  else overlayWindow.loadFile(path.join(__dirname, '..', 'dist', 'public', 'index.html'));
}

function registerDesktopIpc() {
  ipcMain.handle('overlay:show', () => {
    showOverlay();
    return { visible: true, alwaysOnTop };
  });
  ipcMain.handle('overlay:hide', () => {
    hideOverlay();
    return { visible: false, alwaysOnTop };
  });
  ipcMain.handle('overlay:toggle', () => {
    toggleOverlay();
    return { visible: overlayWindow?.isVisible() ?? false, alwaysOnTop };
  });
  ipcMain.handle('overlay:get-state', () => ({
    visible: overlayWindow?.isVisible() ?? false,
    alwaysOnTop,
  }));
  ipcMain.handle('overlay:set-always-on-top', (_event, value) => {
    setPinState(Boolean(value));
    return { visible: overlayWindow?.isVisible() ?? false, alwaysOnTop };
  });
  ipcMain.handle('overlay:quit', () => {
    isQuitting = true;
    app.quit();
  });
}

app.whenReady().then(() => {
  createOverlayWindow();
  registerDesktopIpc();
  createTray();

  globalShortcut.register('CommandOrControl+Shift+Space', toggleOverlay);

  app.on('activate', showOverlay);
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  // The tray keeps Sonora alive on macOS and the overlay is intentionally
  // hidden rather than closed when users click its close control.
  if (process.platform !== 'darwin') app.quit();
});