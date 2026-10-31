const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const { createInterface } = require('node:readline/promises');
const { checkHostedService } = require('./prepare-release.cjs');
const root = path.resolve(__dirname, '../../..');
const target = 'x86_64-pc-windows-msvc';

function prerequisiteProblems(state) {
  const problems = [];
  if (state.platform !== 'win32' || state.arch !== 'x64' || /arm/i.test(state.machine || '')) {
    problems.push('Use a Windows x64 PC. This launcher does not build on Linux, Mac, or Windows ARM.');
  }
  const nodeMajor = Number(state.nodeVersion?.split('.')[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) {
    problems.push('Install Node.js 22 or newer: https://nodejs.org/');
  }
  if (state.pnpmVersion?.trim() !== '10.26.1') {
    problems.push('Install pnpm 10.26.1: npm install --global pnpm@10.26.1');
  }
  const rust = /rustc (\d+)\.(\d+)\.\d+/.exec(state.rustVersion || '');
  if (!rust || Number(rust[1]) < 1 || (Number(rust[1]) === 1 && Number(rust[2]) < 91) ||
      !state.rustVersion?.includes(target)) {
    problems.push('Install stable Rust 1.91+ with the x86_64-pc-windows-msvc toolchain: https://rustup.rs/');
  }
  if (!state.hasGit) problems.push('Install Git for Windows: https://git-scm.com/downloads/win (no GitHub account or login needed).');
  if (!state.hasCpp) problems.push('Install Visual Studio Build Tools 2022 with Desktop development with C++ and a Windows 10/11 SDK: https://visualstudio.microsoft.com/visual-cpp-build-tools/');
  if (!state.hasSdk) problems.push('Add a Windows 10/11 SDK using the Visual Studio Installer; its x64 headers and libraries are required.');
  return problems;
}

function run(command, args, options = {}) {
  const { capture = false, env = process.env } = options;
  // Only fixed build arguments go through cmd; URLs never become shell text.
  if (command === 'pnpm' && args.some(arg => !/^[\w@./:*-]+$/.test(arg))) {
    throw new Error('Unexpected package-manager argument.');
  }
  const executable = command === 'pnpm' ? 'cmd.exe' : command;
  const parameters = command === 'pnpm' ? ['/d', '/s', '/c', ['pnpm', ...args].join(' ')] : args;
  const result = spawnSync(executable, parameters, {
    cwd: root, env, windowsHide: true, encoding: 'utf8',
    timeout: capture ? 15_000 : undefined,
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (capture) return result.status === 0 ? result.stdout.trim() : '';
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (exit ${result.status ?? 'unknown'}). See the output above; no success is assumed.`);
}

function inspectPrerequisites() {
  const programFiles = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const vswhere = path.join(programFiles,
    'Microsoft Visual Studio', 'Installer', 'vswhere.exe');
  const kits = path.join(programFiles, 'Windows Kits', '10');
  let hasSdk = false;
  try {
    hasSdk = fs.readdirSync(path.join(kits, 'Include')).some(version =>
      fs.existsSync(path.join(kits, 'Include', version, 'um', 'Windows.h')) &&
      fs.existsSync(path.join(kits, 'Lib', version, 'um', 'x64', 'kernel32.lib')));
  } catch { /* Missing/unreadable SDK is reported as a prerequisite, not ignored. */ }
  return prerequisiteProblems({
    platform: process.platform, arch: process.arch, machine: os.machine(), nodeVersion: process.versions.node,
    pnpmVersion: run('pnpm', ['--version'], { capture: true }),
    rustVersion: run('rustc', ['-vV'], { capture: true }),
    hasGit: Boolean(run('git', ['--version'], { capture: true })),
    hasSdk,
    hasCpp: fs.existsSync(vswhere) && Boolean(run(vswhere, [
      '-latest', '-products', '*', '-requires', 'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property', 'installationPath',
    ], { capture: true })),
  });
}

async function buildWindows() {
  if (process.platform !== 'win32') throw new Error('Run BUILD-WINDOWS.cmd on a Windows x64 PC. No installer was created.');
  console.log('Sonora Windows local build - no GitHub account or repository required.');
  const problems = inspectPrerequisites();
  if (problems.length) throw new Error(`Install these prerequisites, reopen the launcher, and try again:\n\n- ${problems.join('\n- ')}\n\nNothing has been installed automatically.`);
  const terminal = createInterface({ input: process.stdin, output: process.stdout });
  let serviceUrl;
  try {
    let value = process.env.SONORA_RELEASE_URL;
    if (!value && process.stdin.isTTY) value = await terminal.question('Published Sonora HTTPS address (not the Replit preview): ');
    serviceUrl = await checkHostedService(value?.trim());
    if (!process.stdin.isTTY || (await terminal.question('Download build dependencies and create the local installer? [y/N] ')).trim().toLowerCase() !== 'y') {
      throw new Error('Build canceled. No installer was created.');
    }
  } finally { terminal.close(); }

  const env = { ...process.env, SONORA_RELEASE_URL: serviceUrl,
    CARGO_TARGET_DIR: path.join(root, 'generated-artifacts/native-target') };
  const started = Date.now();
  run('pnpm', ['install', '--frozen-lockfile'], { env });
  run('pnpm', ['--filter', '@workspace/sonora-ai', 'run', 'desktop:test'], { env });
  run('cargo', ['test', '--locked', '--target', target, '--manifest-path',
    path.join(__dirname, 'native-audio/Cargo.toml')], { env });
  run(process.execPath, [path.join(__dirname, 'build-native.cjs'), 'x64'], { env });
  run(process.execPath, [path.join(__dirname, 'package-release.cjs'), 'win', 'x64'], { env });
  const output = path.join(root, 'generated-artifacts/installers');
  const installers = fs.readdirSync(output).filter(name =>
    name.endsWith('-win-x64.exe') && fs.statSync(path.join(output, name)).mtimeMs >= started - 2000);
  if (!installers.length) throw new Error('No newly generated Windows installer was found. Older files are not a successful build.');
  run(process.execPath, [path.join(__dirname, 'checksums.cjs')], { env });
  console.log(`\nInstaller build succeeded:\n${installers.map(name => path.join(output, name)).join('\n')}`);
  console.log(`Checksums: ${path.join(output, 'SHA256SUMS.txt')}`);
  console.log('This is a preview, not a verified release. Test installation, sign-in, Gemini, native audio, Stop/Quit, and receiver-side screen sharing on Windows before distributing.');
  console.log('No service or installer was published. Signing is not configured by this launcher; unsigned files may trigger Windows security warnings.');
}

if (require.main === module) buildWindows().catch(error => { console.error(`\nBUILD STOPPED: ${error.message}`); process.exitCode = 1; });
module.exports = { prerequisiteProblems };
