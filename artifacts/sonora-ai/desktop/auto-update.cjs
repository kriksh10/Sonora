// electron-updater wrapper. The updater object is injected so tests never touch the network.
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function emptyStatus(phase, message) {
  return { phase, version: null, percent: null, message: message || '' };
}

function safeMessage(error) {
  const text = error instanceof Error ? error.message : String(error || 'Update check failed.');
  return text.replace(/\s+/g, ' ').slice(0, 180);
}

function createAutoUpdate({
  updater,
  isPackaged,
  dialog,
  getWindow,
  send,
  intervalMs = CHECK_INTERVAL_MS,
  schedule = setInterval,
  clear = clearInterval,
} = {}) {
  let status = emptyStatus(isPackaged && updater ? 'idle' : 'disabled',
    isPackaged && updater ? '' : 'Automatic updates run in the installed Windows app.');
  let downloaded = false;

  function publish(next) {
    status = next;
    try { send?.(status); } catch { /* The renderer may already be gone. */ }
  }

  function install() {
    if (!downloaded || !updater) throw new Error('No downloaded update is ready to install.');
    updater.quitAndInstall(true, true);
  }

  async function promptRestart(version) {
    if (!dialog?.showMessageBox) return;
    const result = await dialog.showMessageBox(getWindow?.() ?? undefined, {
      type: 'info',
      title: 'Sonora update ready',
      message: `Sonora ${version} has been downloaded.`,
      detail: 'Restart to finish installing. If you choose Later, Sonora installs the update when you quit.',
      buttons: ['Later', 'Restart now'],
      defaultId: 1,
      cancelId: 0,
      noLink: true,
    });
    if (result?.response === 1) install();
  }

  function attach() {
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.on('checking-for-update', () => publish(emptyStatus('checking', 'Checking for updates…')));
    updater.on('update-available', info => publish({ phase: 'downloading', version: info?.version ?? null, percent: 0, message: 'Downloading update…' }));
    updater.on('update-not-available', () => { downloaded = false; publish(emptyStatus('current', 'Sonora is up to date.')); });
    updater.on('download-progress', progress => publish({
      phase: 'downloading', version: status.version, percent: Math.round(progress?.percent ?? 0), message: 'Downloading update…',
    }));
    updater.on('update-downloaded', info => {
      downloaded = true;
      const version = info?.version ?? status.version;
      publish({ phase: 'ready', version, percent: 100, message: `Sonora ${version} will install when you restart or quit.` });
      void promptRestart(version);
    });
    updater.on('error', error => publish(emptyStatus('error', safeMessage(error))));
  }

  async function check() {
    if (!isPackaged || !updater) return status;
    try { await updater.checkForUpdates(); }
    catch (error) { publish(emptyStatus('error', safeMessage(error))); }
    return status;
  }

  function start() {
    if (!isPackaged || !updater) {
      publish(status);
      return () => {};
    }
    attach();
    const timer = schedule(() => { void check(); }, intervalMs);
    void check();
    return () => clear(timer);
  }

  return { start, check, install, status: () => status };
}

module.exports = { createAutoUpdate, CHECK_INTERVAL_MS };
