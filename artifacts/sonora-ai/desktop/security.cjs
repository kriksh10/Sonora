function validateServiceUrl(value, development = false) {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Set SONORA_RELEASE_URL to the published HTTPS Sonora URL before building.');
  const url = new URL(value);
  const local = development && ['localhost', '127.0.0.1'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password ||
      url.search || url.hash || (!local && (url.hostname.endsWith('.replit.dev') || ['localhost', '127.0.0.1'].includes(url.hostname)))) {
    throw new Error('A published HTTPS Sonora URL is required.');
  }
  return url.href;
}
function isAllowedNavigation(value, target) {
  try { return new URL(value).origin === new URL(target).origin; } catch { return false; }
}
function isTrustedFrame(event, contents, target) {
  return Boolean(contents && event.sender === contents && event.senderFrame === contents.mainFrame &&
    isAllowedNavigation(event.senderFrame.url, target));
}
function isBundledOfflineNavigation(url, offlineFileUrl) {
  try {
    const parsed = new URL(url);
    const expected = new URL(offlineFileUrl);
    return parsed.protocol === 'file:' && expected.protocol === 'file:' &&
      parsed.pathname === expected.pathname && !parsed.search && !parsed.hash &&
      !parsed.username && !parsed.password;
  } catch { return false; }
}
const OFFLINE_CHANNELS = new Set(['desktop:retry-connection', 'overlay:quit']);
function desktopRequestAllowed(event, contents, target, channel, offlineFileUrl) {
  if (!contents || event.sender !== contents || event.senderFrame !== contents.mainFrame) return false;
  const url = event.senderFrame.url;
  if (offlineFileUrl && isBundledOfflineNavigation(url, offlineFileUrl)) return OFFLINE_CHANNELS.has(channel);
  return isAllowedNavigation(url, target);
}
module.exports = {
  validateServiceUrl, isAllowedNavigation, isTrustedFrame, isBundledOfflineNavigation, desktopRequestAllowed, OFFLINE_CHANNELS,
};
