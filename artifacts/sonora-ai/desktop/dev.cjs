const { spawn } = require('node:child_process');
const http = require('node:http');
const path = require('node:path');

const appRoot = path.resolve(__dirname, '..');
const port = Number(process.env.SONORA_WEB_PORT || 5173);
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const electronCommand = process.platform === 'win32' ? 'electron.cmd' : 'electron';
const environment = {
  ...process.env,
  PORT: String(port),
  BASE_PATH: '/',
  NODE_ENV: 'development',
};

const vite = spawn(pnpmCommand, ['run', 'dev'], {
  cwd: appRoot,
  env: environment,
  stdio: 'inherit',
});

function checkServer() {
  return new Promise((resolve) => {
    const request = http.get(`http://127.0.0.1:${port}/`, (response) => {
      response.resume();
      resolve(response.statusCode >= 200 && response.statusCode < 500);
    });
    request.on('error', () => resolve(false));
    request.setTimeout(700, () => {
      request.destroy();
      resolve(false);
    });
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    if (await checkServer()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Sonora web server did not start on port ${port}.`);
}

async function launch() {
  try {
    await waitForServer();
    const electron = spawn(electronCommand, ['desktop/main.cjs', '--dev'], {
      cwd: appRoot,
      env: { ...environment, SONORA_DESKTOP_URL: `http://127.0.0.1:${port}/` },
      stdio: 'inherit',
    });

    const shutdown = () => {
      vite.kill('SIGTERM');
      if (!electron.killed) electron.kill('SIGTERM');
    };
    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);
    electron.on('exit', (code) => {
      vite.kill('SIGTERM');
      process.exit(code ?? 0);
    });
  } catch (error) {
    vite.kill('SIGTERM');
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

vite.on('error', (error) => {
  console.error('Unable to start Sonora web server:', error.message);
});

launch();