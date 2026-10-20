// No renderer-supplied URLs or arbitrary diagnostic fields cross this boundary.
function versionParts(value) {
  if (typeof value !== 'string' || !/^\d{1,5}\.\d{1,5}\.\d{1,5}$/.test(value)) throw new Error('Invalid release version.');
  return value.split('.').map(Number);
}
function newer(a, b) {
  const x = versionParts(a), y = versionParts(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
function validateRelease(manifest, { serviceUrl, version, platform, arch }) {
  versionParts(version);
  if (manifest?.product !== 'sonora' || !Array.isArray(manifest.builds)) throw new Error('Invalid Sonora release manifest.');
  versionParts(manifest.version);
  const build = manifest.builds.find(b => b.platform === ({ win32: 'windows', darwin: 'mac' })[platform] && b.architecture === arch);
  if (!build || build.status !== 'available') throw new Error('No compatible installer is published yet. Check again after the publisher uploads a release.');
  const url = new URL(build.url);
  const origin = new URL(serviceUrl).origin;
  if (url.protocol !== 'https:' || url.origin !== origin || url.username || url.password || url.search || url.hash ||
      !url.pathname.toLowerCase().endsWith(platform === 'win32' ? '.exe' : '.dmg') ||
      !/^[a-f0-9]{64}$/i.test(build.sha256 ?? '') || typeof build.signing !== 'string' || build.signing.length > 160) {
    throw new Error('Release download metadata failed validation.');
  }
  return { available: newer(manifest.version, version), version: manifest.version, url: url.href, sha256: build.sha256, signing: build.signing };
}
function createMaintenance({ serviceUrl, version, platform, arch, fetcher = fetch }) {
  let approvedRelease;
  async function verifyDownload(url) {
    const response = await fetcher(url, { method: 'HEAD', redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('The installer download is unavailable. Try again later.');
    const type = response.headers?.get('content-type')?.toLowerCase().split(';')[0].trim();
    // In particular, reject SPA fallbacks which return 200 HTML for missing files.
    if (!['application/octet-stream', 'binary/octet-stream', 'application/x-msdownload',
      'application/x-msdos-program', 'application/vnd.microsoft.portable-executable',
      'application/x-executable', 'application/x-apple-diskimage', 'application/x-diskimage'].includes(type)) {
      throw new Error('The download is not served as an installer. Ask the publisher to fix the release.');
    }
  }
  return {
    async check() {
      approvedRelease = undefined;
      const response = await fetcher(new URL('desktop-release.json', serviceUrl), {
        redirect: 'error', signal: AbortSignal.timeout(10000), cache: 'no-store',
      });
      if (!response.ok) throw new Error('Release service unavailable. Your installed version has not changed.');
      const text = await response.text();
      if (text.length > 32000) throw new Error('Release manifest is too large.');
      const release = validateRelease(JSON.parse(text), { serviceUrl, version, platform, arch });
      if (release.available) {
        await verifyDownload(release.url);
        approvedRelease = release;
      }
      return release;
    },
    async download(confirm, open) {
      if (!approvedRelease) throw new Error('Check for an available update first.');
      const release = approvedRelease;
      if (await confirm(release)) {
        // Re-check availability immediately before handing the URL to the regular browser.
        await verifyDownload(release.url);
        await open(release.url);
      }
    },
  };
}
function diagnosticReport({ version, platform, arch, captureActive, shortcutRegistered, audioProtocol }) {
  return {
    product: 'sonora', version, platform, architecture: arch,
    nativeAudioProtocol: audioProtocol, captureActive: Boolean(captureActive),
    showHideShortcutRegistered: Boolean(shortcutRegistered),
    hostedCompatibility: 'Not checked in native report; check hosted health separately.',
    excludes: 'No audio, transcript, question, answer, account, credentials, file paths or device identifiers.',
  };
}
module.exports = { validateRelease, newer, createMaintenance, diagnosticReport };
