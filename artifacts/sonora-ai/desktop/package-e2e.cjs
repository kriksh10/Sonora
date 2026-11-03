const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { prepare } = require('./prepare-release.cjs');

(async () => {
  if (process.platform !== 'win32') throw new Error('The packaged Windows e2e build runs on windows-latest.');
  await prepare({ arch: 'x64', skipServiceCheck: true });
  const stage = path.resolve(__dirname, '../../../generated-artifacts/desktop-app');
  fs.writeFileSync(path.join(stage, 'runtime-config.json'), JSON.stringify({
    serviceUrl: 'http://127.0.0.1:4173/', e2e: true,
  }, null, 2));
  const stagedConfig = fs.readFileSync(path.join(stage, 'runtime-config.json'), 'utf8');
  console.log(`Staged runtime-config.json ${stagedConfig}`);
  const nsis = process.env.SONORA_E2E_NSIS === '1';
  const result = spawnSync(process.execPath, [
    require.resolve('electron-builder/out/cli/cli.js'),
    '--projectDir', path.resolve(__dirname, '../../../generated-artifacts/desktop-app'),
    '--config', path.join(__dirname, 'electron-builder.cjs'),
    '--win', '--x64', ...(nsis ? [] : ['--dir']), '--publish', 'never',
    '-c.win.signAndEditExecutable=false',
  ], { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  if (result.error) throw result.error;
  if ((result.status ?? 1) !== 0) { process.exitCode = result.status ?? 1; return; }
  const asar = require('@electron/asar');
  const archive = path.resolve(__dirname, '../../../generated-artifacts/installers/win-unpacked/resources/app.asar');
  const packed = JSON.parse(asar.extractFile(archive, 'runtime-config.json').toString('utf8'));
  console.log(`Packed runtime-config.json ${JSON.stringify(packed)}`);
  if (packed.e2e !== true || packed.serviceUrl !== 'http://127.0.0.1:4173/') {
    throw new Error(`Packaged runtime-config does not point at the mock server: ${JSON.stringify(packed)}`);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
