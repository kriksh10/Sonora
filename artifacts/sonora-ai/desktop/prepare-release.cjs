const fs = require('node:fs');
const path = require('node:path');
const { validateServiceUrl } = require('./security.cjs');
const { buildAssets } = require('./build-assets.cjs');
const { runtimeFiles } = require('./runtime-files.cjs');
const { verifyStagedRuntime } = require('./verify-runtime.cjs');

async function bundleUpdater(outfile) {
  const esbuild = require('esbuild');
  await esbuild.build({
    entryPoints: [path.join(__dirname, 'updater-runtime-entry.cjs')],
    bundle: true, platform: 'node', format: 'cjs', outfile, legalComments: 'none',
    external: ['electron', 'original-fs'],
  });
  const source = fs.readFileSync(outfile, 'utf8');
  if (/\brequire\s*\(\s*['"]\.\//.test(source)) throw new Error('Updater bundle still has unpackaged relative imports.');
}
const root = path.resolve(__dirname, '../../..');
const stage = path.join(root, 'generated-artifacts/desktop-app');

async function checkHostedService(value = process.env.SONORA_RELEASE_URL, fetcher = fetch) {
  // URL is a public release setting, never a credential. Do not use preview domains.
  const serviceUrl = validateServiceUrl(value);
  const checks = await Promise.all([
    fetcher(new URL('/api/healthz', serviceUrl), { signal: AbortSignal.timeout(15_000) }),
    fetcher(new URL('desktop-release.json', serviceUrl), { signal: AbortSignal.timeout(15_000) }),
  ]);
  if (!checks.every(response => response.ok)) throw new Error('Hosted Sonora health/release checks failed. Publish the service before building installers.');
  const health = await checks[0].json();
  const release = await checks[1].json();
  if (health.status !== 'ok' || release.product !== 'sonora') throw new Error('This URL did not identify a healthy Sonora service.');
  if (health.desktopAuthProtocol !== 1) throw new Error('Publish the latest Sonora browser sign-in service before building this desktop app.');
  if (health.desktopAudioProtocol !== 2) throw new Error('Publish the latest Sonora separate-channel audio service before building this desktop app.');
  if (health.desktopAnswerProtocol !== 1) throw new Error('Publish the latest Sonora streaming answer service before building this desktop app.');
  return serviceUrl;
}

async function prepare({ arch = process.arch } = {}) {
  const serviceUrl = await checkHostedService();
  const packageJson = require('../package.json');
  const binaryName = process.platform === 'win32' ? 'sonora-audio.exe' : 'sonora-audio';
  const nativeBinary = path.join(root, 'generated-artifacts/native', `${process.platform}-${arch}`, binaryName);
  if (!fs.existsSync(nativeBinary)) throw new Error('Native audio helper is missing. Run desktop:build-native for this target before packaging.');
  // Release staging is generated output, never carry files from an older target.
  fs.rmSync(stage, { recursive: true, force: true });
  fs.mkdirSync(stage, { recursive: true });
  for (const file of runtimeFiles) fs.copyFileSync(path.join(__dirname, file), path.join(stage, file));
  fs.mkdirSync(path.join(stage, 'native'), { recursive: true });
  fs.copyFileSync(nativeBinary, path.join(stage, 'native', binaryName));
  fs.chmodSync(path.join(stage, 'native', binaryName), 0o755);
  fs.copyFileSync(path.join(__dirname, 'native-audio/THIRD_PARTY_NOTICES.txt'), path.join(stage, 'THIRD_PARTY_NOTICES.txt'));
  fs.copyFileSync(path.join(__dirname, 'offline.html'), path.join(stage, 'offline.html'));
  await bundleUpdater(path.join(stage, 'updater-runtime.cjs'));
  fs.writeFileSync(path.join(stage, 'runtime-config.json'), JSON.stringify({ serviceUrl }, null, 2));
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: 'sonora-desktop', productName: 'Sonora AI', version: packageJson.version,
    description: 'Private interview and call assistant', author: 'Sonora', license: 'UNLICENSED',
    private: true, main: 'main.cjs',
  }, null, 2));
  buildAssets(path.join(stage, 'assets'));
  verifyStagedRuntime(stage);
  console.log('Desktop release staging prepared with a reachable hosted Sonora service.');
}
if (require.main === module) prepare().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepare, checkHostedService, bundleUpdater };
