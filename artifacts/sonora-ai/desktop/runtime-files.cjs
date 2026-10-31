// Single source of truth for staging AND electron-builder's archive allowlist.
const runtimeFiles = Object.freeze([
  'main.cjs', 'preload.cjs', 'security.cjs', 'native-audio-host.cjs',
  'audio-devices.cjs', 'browser-auth.cjs', 'window-preferences.cjs', 'maintenance.cjs',
  'hotkeys.cjs', 'auto-update.cjs',
]);
module.exports = { runtimeFiles };
