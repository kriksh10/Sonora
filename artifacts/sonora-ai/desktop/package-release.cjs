const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { prepare } = require('./prepare-release.cjs');

(async () => {
  const platform = process.argv[2];
  const arch = process.argv[3] || (platform === 'mac' ? 'arm64' : 'x64');
  if (!['mac', 'win'].includes(platform) || !['arm64', 'x64'].includes(arch)) throw new Error('Usage: package-release.cjs mac|win arm64|x64');
  if ((platform === 'mac' && process.platform !== 'darwin') || (platform === 'win' && process.platform !== 'win32')) {
    throw new Error('Use a native Mac or Windows release runner. Cross-built installers are not a substitute for platform validation.');
  }
  if (platform === 'win' && arch !== 'x64') throw new Error('Windows ARM releases are not supported yet.');
  await prepare({ arch });
  const result = spawnSync(process.execPath, [
    require.resolve('electron-builder/out/cli/cli.js'),
    '--projectDir', path.resolve(__dirname, '../../../generated-artifacts/desktop-app'),
    '--config', path.join(__dirname, 'electron-builder.cjs'),
    `--${platform}`, `--${arch}`, '--publish', 'never',
  ], { stdio: 'inherit', env: process.env });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
