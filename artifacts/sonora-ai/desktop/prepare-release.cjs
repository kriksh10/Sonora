const fs = require('node:fs');
const path = require('node:path');
const { validateServiceUrl } = require('./security.cjs');
const { buildAssets } = require('./build-assets.cjs');
const root = path.resolve(__dirname, '../../..');
const stage = path.join(root, 'generated-artifacts/desktop-app');

async function prepare() {
  // URL is a public release setting, never a credential. Do not use preview domains.
  const serviceUrl = validateServiceUrl(process.env.SONORA_RELEASE_URL);
  const checks = await Promise.all([
    fetch(new URL('/api/healthz', serviceUrl), { signal: AbortSignal.timeout(15_000) }),
    fetch(new URL('desktop-release.json', serviceUrl), { signal: AbortSignal.timeout(15_000) }),
  ]);
  if (!checks.every(response => response.ok)) throw new Error('Hosted Sonora health/release checks failed. Publish the service before building installers.');
  const health = await checks[0].json();
  const release = await checks[1].json();
  if (health.status !== 'ok' || release.product !== 'sonora') throw new Error('This URL did not identify a healthy Sonora service.');
  const packageJson = require('../package.json');
  fs.mkdirSync(stage, { recursive: true });
  for (const file of ['main.cjs', 'security.cjs', 'preload.cjs']) fs.copyFileSync(path.join(__dirname, file), path.join(stage, file));
  fs.writeFileSync(path.join(stage, 'runtime-config.json'), JSON.stringify({ serviceUrl }, null, 2));
  fs.writeFileSync(path.join(stage, 'package.json'), JSON.stringify({
    name: 'sonora-desktop', productName: 'Sonora AI', version: packageJson.version,
    description: 'Private interview and call assistant', author: 'Sonora', license: 'UNLICENSED',
    private: true, main: 'main.cjs',
  }, null, 2));
  buildAssets(path.join(stage, 'assets'));
  console.log('Desktop release staging prepared with a reachable hosted Sonora service.');
}
if (require.main === module) prepare().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { prepare };
