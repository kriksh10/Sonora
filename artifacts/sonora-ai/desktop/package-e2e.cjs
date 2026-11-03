const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { prepare } = require('./prepare-release.cjs');

(async () => {
  if (process.platform !== 'win32') throw new Error('The packaged Windows e2e build runs on windows-latest.');
  await prepare({ arch: 'x64', skipServiceCheck: true });
  const result = spawnSync(process.execPath, [
    require.resolve('electron-builder/out/cli/cli.js'),
    '--projectDir', path.resolve(__dirname, '../../../generated-artifacts/desktop-app'),
    '--config', path.join(__dirname, 'electron-builder.cjs'),
    '--win', '--x64', '--dir', '--publish', 'never',
    '-c.win.signAndEditExecutable=false',
  ], { stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' } });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
