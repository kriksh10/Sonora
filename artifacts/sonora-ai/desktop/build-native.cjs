const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '../../..');
const targets = {
  'win32-x64': 'x86_64-pc-windows-msvc',
  'darwin-arm64': 'aarch64-apple-darwin',
  'darwin-x64': 'x86_64-apple-darwin',
};
const arch = process.argv[2] || process.arch;
const key = `${process.platform}-${arch}`;
const target = targets[key];
if (!target) throw new Error('Build the audio helper on a supported Mac or Windows runner.');
const targetDir = path.join(root, 'generated-artifacts/native-target');
const result = spawnSync('cargo', [
  'build', '--release', '--locked', '--target', target,
  '--manifest-path', path.join(__dirname, 'native-audio/Cargo.toml'),
], { stdio: 'inherit', env: { ...process.env, CARGO_TARGET_DIR: targetDir, MACOSX_DEPLOYMENT_TARGET: '14.4' } });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
const name = process.platform === 'win32' ? 'sonora-audio.exe' : 'sonora-audio';
const out = path.join(root, 'generated-artifacts/native', key);
fs.mkdirSync(out, { recursive: true });
fs.copyFileSync(path.join(targetDir, target, 'release', name), path.join(out, name));
fs.chmodSync(path.join(out, name), 0o755);
console.log(`Built native audio helper for ${key}.`);
