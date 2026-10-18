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
module.exports = { validateServiceUrl, isAllowedNavigation, isTrustedFrame };
