process.stdout._handle?.setBlocking?.(true);
process.stderr._handle?.setBlocking?.(true);
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '../../..');
const dist = path.join(root, 'artifacts/sonora-ai/dist/public');
const shots = path.join(root, 'generated-artifacts/e2e-screenshots');
const resultsFile = path.join(shots, 'results.json');
const port = Number(process.env.E2E_PORT || 4173);
const serviceUrl = `http://127.0.0.1:${port}/`;
const userData = path.join(root, 'generated-artifacts/e2e-user-data');
const scenarios = [];
let server;

function exePath() {
  const unpacked = path.join(root, 'generated-artifacts/installers/win-unpacked');
  const hit = fs.readdirSync(unpacked).find(name => name.toLowerCase().endsWith('.exe') && !name.toLowerCase().includes('unins'));
  if (!hit) throw new Error(`Packaged exe not found in ${unpacked}`);
  return path.join(unpacked, hit);
}

const answerButton = page => page.getByRole('button', { name: 'Answer Ctrl+Enter' });

async function click(page, locator) {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`No clickable box for ${locator}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.waitForTimeout(80);
  await page.mouse.click(x, y);
}

async function shot(name) {
  const file = path.join(shots, name);
  // Do not wait on the grab. CopyFromScreen and child.kill can both stall the
  // Windows runner, and Playwright's own screenshot APIs never return here.
  if (process.platform !== 'win32') {
    fs.writeFileSync(`${file}.txt`, 'Desktop capture runs on the Windows runner.');
    return;
  }
  const child = spawn('powershell.exe', ['-NoProfile', '-Command', `
$ErrorActionPreference = 'Stop'
try {
  Add-Type -AssemblyName System.Windows.Forms
  Add-Type -AssemblyName System.Drawing
  $bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
  $bmp.Save($env:E2E_SHOT, [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
} catch {
  Set-Content -Path ($env:E2E_SHOT + '.log') -Value $_.Exception.Message
  exit 1
}
`], { env: { ...process.env, E2E_SHOT: file }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; });
  child.stderr.on('data', chunk => { log += chunk; });
  await new Promise(resolve => {
    const timer = setTimeout(() => resolve(), 4000);
    child.on('exit', code => { log += `\nexit ${code}\n`; clearTimeout(timer); resolve(); });
    child.on('error', error => { log += `\n${error}\n`; clearTimeout(timer); resolve(); });
  });
  if (!fs.existsSync(file) && log.trim()) fs.writeFileSync(`${file}.log`, log);
  if (child.exitCode === null) {
    child.stdout.destroy();
    child.stderr.destroy();
    child.unref();
  }
}

async function pageDump(page) {
  const bootFile = path.join(userData, 'e2e-boot.txt');
  const external = path.join(shots, 'boot.txt');
  const boot = [bootFile, external].filter(file => fs.existsSync(file)).map(file => fs.readFileSync(file, 'utf8')).join('\n');
  let body = '';
  try { body = await page.locator('body').innerText({ timeout: 3000 }); } catch (error) { body = String(error); }
  return `url=${page.url()}\nboot:\n${boot || '(no boot log)'}\nbody:\n${body.slice(0, 800)}`;
}

async function flags(app) {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    return { focused: win.isFocused(), alwaysOnTop: win.isAlwaysOnTop(), visible: win.isVisible() };
  });
}

async function scenario(name, fn) {
  console.log(`START ${name}`);
  try {
    await fn();
    scenarios.push({ name, pass: true });
    console.log(`PASS ${name}`);
  } catch (error) {
    scenarios.push({ name, pass: false, error: error instanceof Error ? error.message : String(error) });
    console.error(`FAIL ${name}: ${error instanceof Error ? error.stack : error}`);
  }
}

function startServer() {
  const child = spawn(process.execPath, [path.join(__dirname, 'server.mjs'), dist], {
    env: { ...process.env, E2E_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', chunk => { log += chunk; process.stdout.write(`[mock] ${chunk}`); });
  child.stderr.on('data', chunk => { log += chunk; process.stderr.write(`[mock] ${chunk}`); });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Mock server did not start.\n${log}`)), 10000);
    child.stdout.on('data', () => {
      if (log.includes('e2e mock listening')) { clearTimeout(timer); resolve(child); }
    });
    child.on('exit', code => reject(new Error(`Mock server exited ${code}\n${log}`)));
  });
}

async function launch(appPath) {
  fs.mkdirSync(userData, { recursive: true });
  const app = await electron.launch({
    executablePath: appPath,
    args: ['--e2e', `--user-data-dir=${userData}`],
    timeout: 90000,
    env: { ...process.env, SONORA_E2E: '1', SONORA_DESKTOP_URL: serviceUrl, SONORA_E2E_LOG: path.join(shots, 'boot.txt') },
  });
  const child = app.process();
  child.stdout?.on('data', chunk => process.stdout.write(`[electron] ${chunk}`));
  child.stderr?.on('data', chunk => process.stderr.write(`[electron] ${chunk}`));
  const page = await app.firstWindow({ timeout: 90000 });
  page.setDefaultTimeout(20000);
  console.log(await pageDump(page));
  return { app, page };
}

async function setMode(mode) {
  const response = await fetch(`${serviceUrl}api/e2e/mode`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }) });
  if (!response.ok) throw new Error(`Could not set mock mode ${mode}`);
}

function requireApp(name) {
  if (scenarios.some(item => item.name.startsWith('launch:') && item.pass)) return;
  throw new Error(`${name} skipped because the packaged window did not show the signed-out screen.`);
}

(async () => {
  fs.mkdirSync(shots, { recursive: true });
  const watchdog = setTimeout(() => {
    console.error('e2e watchdog: stopping after 10 minutes');
    try { fs.writeFileSync(resultsFile, JSON.stringify({ scenarios, fatal: 'watchdog' }, null, 2)); } catch { /* results are best effort */ }
    process.exit(1);
  }, 10 * 60 * 1000);
  watchdog.unref();
  if (!fs.existsSync(path.join(dist, 'index.html'))) throw new Error(`E2E renderer is missing ${path.join(dist, 'index.html')}`);
  server = await startServer();
  const errors = [];
  let app;
  let page;
  try {
    ({ app, page } = await launch(exePath()));
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => {
      if (message.type() !== 'error') return;
      errors.push(`${message.text()} ${message.location().url || ''}`);
    });

    await scenario('launch: visible, frameless, transparent, always on top, no console errors', async () => {
      if (page.url().includes('offline.html')) throw new Error(`Packaged app opened the offline page.\n${await pageDump(page)}`);
      try {
        await page.getByRole('heading', { name: 'You are signed out' }).waitFor();
      } catch (error) {
        throw new Error(`${error instanceof Error ? error.message : error}\n${await pageDump(page)}\nconsole:\n${errors.join('\n')}`);
      }
      const windowFlags = await page.evaluate(() => window.sonoraDesktop.e2eFlags());
      const live = await flags(app);
      if (!live.visible || !live.alwaysOnTop || !live.focused) throw new Error(JSON.stringify(live));
      if (!windowFlags.transparent || !windowFlags.frameless || windowFlags.backgroundMaterial !== 'none' || windowFlags.ignoringMouse) throw new Error(JSON.stringify(windowFlags));
      const noisy = errors.filter(line => !/favicon|Download the React DevTools|fonts\.(google|gstatic)/i.test(line));
      if (noisy.length) throw new Error(noisy.join('\n'));
      await shot('01-signed-out.png').catch(() => {});
    });

    await scenario('signed-out state and sign-in', async () => {
      requireApp('signed-out state and sign-in');
      if (await page.getByRole('button', { name: 'Call Sessions' }).count()) throw new Error('Sessions visible before sign-in');
      await click(page, page.getByTestId('button-sign-in'));
      await page.getByRole('heading', { name: 'Call Sessions' }).waitFor();
      await shot('02-home.png');
    });

    await scenario('home empty state and every sidebar action', async () => {
      requireApp('home empty state and every sidebar action');
      await page.getByText('No active sessions.').waitFor();
      for (const name of ['Resumes', 'Documents', 'Call Sessions']) await click(page, page.getByRole('button', { name }));
      await click(page, page.getByRole('button', { name: 'Dark' }));
      await click(page, page.getByRole('button', { name: 'Light' }));
      if (!await page.getByRole('link', { name: 'Upgrade' }).count()) throw new Error('Upgrade missing');
    });

    await scenario('Create Session invalid, cancel, then valid', async () => {
      requireApp('Create Session invalid, cancel, then valid');
      await click(page, page.getByRole('button', { name: 'Create session' }).first());
      await page.getByRole('dialog', { name: 'Create session' }).waitFor();
      await click(page, page.getByRole('button', { name: 'Create session' }).last());
      await page.getByRole('alert').filter({ hasText: 'Add a company' }).waitFor();
      await click(page, page.getByRole('button', { name: 'Cancel' }));
      if (await page.getByRole('dialog', { name: 'Create session' }).count()) throw new Error('Dialog stayed open');
      await click(page, page.getByRole('button', { name: 'Mock Interview' }));
      await page.getByLabel('Company').fill('Northwind');
      await click(page, page.getByRole('button', { name: 'Create session' }).last());
      await page.getByText('Northwind interview').waitFor();
      await shot('03-session-created.png');
    });

    await scenario('live Listen, transcript, Answer, history, Clear, Screenshot, Chat, menu, End', async () => {
      requireApp('live Listen, transcript, Answer, history, Clear, Screenshot, Chat, menu, End');
      await click(page, page.getByRole('button', { name: 'Start' }));
      await page.getByRole('button', { name: 'Listen', exact: true }).waitFor();
      await click(page, page.getByRole('button', { name: 'Listen', exact: true }));
      await page.getByText('Speechmatics is connected').waitFor();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('sonora-e2e-transcript', { detail: { text: 'How does caching work?' } })));
      await click(page, answerButton(page));
      await page.getByText('Heard: How does caching work?', { exact: true }).waitFor();
      await click(page, page.getByRole('button', { name: 'Chat' }));
      await page.getByLabel('Question', { exact: true }).fill('Typed from chat');
      await click(page, answerButton(page));
      await page.getByText('Heard: Typed from chat', { exact: true }).waitFor();
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('sonora-e2e-transcript', { detail: { text: 'Explain indexes' } })));
      await click(page, page.getByRole('button', { name: 'Expand transcript' }));
      await click(page, page.getByRole('button', { name: 'Explain indexes' }));
      await page.getByText('Heard: Explain indexes', { exact: true }).waitFor();
      await click(page, page.getByRole('button', { name: 'Previous answer' }));
      await page.getByText('Heard: Typed from chat', { exact: true }).waitFor();
      await click(page, page.getByRole('button', { name: 'Next answer' }));
      await page.getByText('Heard: Explain indexes', { exact: true }).waitFor();
      await click(page, page.getByRole('button', { name: 'Clear', exact: true }).first());
      await click(page, page.getByRole('button', { name: 'Screenshot' }));
      await page.getByText('Screenshot attached.').waitFor();
      await click(page, page.getByRole('button', { name: 'Chat' }));
      await click(page, page.locator('summary[aria-label="Overlay menu"]'));
      await click(page, page.getByRole('button', { name: 'Answer settings' }));
      await page.getByRole('status').filter({ hasText: 'Answer settings' }).waitFor();
      await shot('04-live.png');
      await click(page, page.getByRole('button', { name: 'End' }));
      await page.getByRole('heading', { name: 'Call Sessions' }).waitFor();
    });

    await scenario('answer errors stay visible and the app stays usable', async () => {
      requireApp('answer errors stay visible and the app stays usable');
      await click(page, page.getByRole('button', { name: 'Start' }));
      for (const [mode, text] of [['401', 'Sign-in expired'], ['500', 'Answer service failed'], ['timeout', 'timed out'], ['offline', 'Network offline']]) {
        await setMode(mode);
        await page.evaluate(() => window.dispatchEvent(new CustomEvent('sonora-e2e-transcript', { detail: { text: 'How does retry work?' } })));
        await click(page, answerButton(page));
        await page.getByText(new RegExp(text, 'i')).first().waitFor();
      }
      await setMode('speechmatics');
      await click(page, page.getByRole('button', { name: 'Listen', exact: true }));
      await page.getByRole('status').filter({ hasText: 'Using Gemini fallback' }).waitFor();
      await setMode('ok');
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('sonora-e2e-transcript', { detail: { text: 'What is a queue?' } })));
      await click(page, answerButton(page));
      await page.getByText('Heard: What is a queue?', { exact: true }).waitFor();
      await click(page, page.getByRole('button', { name: 'End' }));
    });

    await scenario('glass, sidebar, transcript, and edges keep focus; gaps pass through only when enabled', async () => {
      requireApp('glass, sidebar, transcript, and edges keep focus; gaps pass through only when enabled');
      const side = await page.locator('.dp-side').boundingBox();
      await page.mouse.move(side.x + 20, side.y + 90);
      await page.waitForTimeout(80);
      await page.mouse.click(side.x + 20, side.y + 90);
      let state = await page.evaluate(() => window.sonoraDesktop.e2eFlags());
      if (state.ignoringMouse) throw new Error('Sidebar click enabled click-through');
      await click(page, page.getByRole('button', { name: 'Start' }));
      const card = await page.locator('.dp-card').boundingBox();
      await page.mouse.move(card.x + 8, card.y + 8);
      await page.waitForTimeout(100);
      await page.mouse.click(card.x + 8, card.y + 8);
      state = await page.evaluate(() => window.sonoraDesktop.e2eFlags());
      let live = await flags(app);
      if (state.ignoringMouse || !live.focused || !live.alwaysOnTop) throw new Error(`Glass click lost the window ${JSON.stringify({ state, live })}`);
      const bar = await page.locator('.dp-bar').boundingBox();
      const strip = await page.locator('.dp-strip').boundingBox();
      const gapY = bar.y + bar.height + Math.max(2, (strip.y - (bar.y + bar.height)) / 2);
      await page.mouse.move(bar.x + 30, gapY);
      await page.waitForTimeout(100);
      state = await page.evaluate(() => window.sonoraDesktop.e2eFlags());
      if (state.ignoringMouse) throw new Error('Gap passed through before click-through was enabled');
      await click(page, page.locator('summary[aria-label="Window settings"]'));
      const clickThroughBox = page.getByRole('checkbox', { name: 'Click through the overlay' });
      await clickThroughBox.click();
      await page.waitForFunction(async () => (await window.sonoraDesktop.e2eFlags()).clickThrough);
      await page.evaluate(() => {
        const summary = document.querySelector('summary[aria-label="Window settings"]');
        if (summary && summary.parentElement) summary.parentElement.open = false;
      });
      const gap = await page.evaluate(({ x, top, bottom }) => {
        for (let y = top + 1; y < bottom; y += 1) {
          const el = document.elementFromPoint(x, y);
          if (!el) return { x, y, hit: 'none' };
          if (!el.closest('.dp-glass,.dp-dialog,.dp-chat,.sonora-window-bar,.sonora-window-popover,button,a,input,textarea,select,summary,label')) return { x, y, hit: el.className || el.tagName };
        }
        return null;
      }, { x: bar.x + 24, top: bar.y + bar.height, bottom: strip.y });
      if (!gap) throw new Error(`No empty gap between the live bar and the transcript ${JSON.stringify({ bar, strip })}`);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(100);
      await page.mouse.move(gap.x, gap.y);
      for (let i = 0; i < 10 && !(state.ignoringMouse && state.clickThrough); i += 1) {
        await page.waitForTimeout(100);
        state = await page.evaluate(() => window.sonoraDesktop.e2eFlags());
      }
      if (!state.ignoringMouse || !state.clickThrough) throw new Error(`Gap did not pass through ${JSON.stringify(state)} at ${JSON.stringify(gap)}`);
      await page.mouse.move(bar.x + Math.min(80, bar.width / 3), bar.y + bar.height / 2);
      await page.waitForTimeout(150);
      state = await page.evaluate(() => window.sonoraDesktop.e2eFlags());
      if (state.ignoringMouse) throw new Error('Button stayed click-through');
      await page.evaluate(() => {
        const summary = document.querySelector('summary[aria-label="Window settings"]');
        if (summary && summary.parentElement) summary.parentElement.open = true;
      });
      await clickThroughBox.click();
      await page.waitForFunction(async () => !(await window.sonoraDesktop.e2eFlags()).clickThrough);
      await page.locator('summary[aria-label="Window settings"]').click();
    });

    await scenario('pin, blur, opacity, resize, and restart', async () => {
      requireApp('pin, blur, opacity, resize, and restart');
      const before = await page.evaluate(() => window.sonoraDesktop.e2eFlags());
      await click(page, page.getByRole('button', { name: 'Keep on top' }));
      let state = await page.evaluate(() => window.sonoraDesktop.e2eFlags());
      if (state.alwaysOnTop) throw new Error('Unpin left the window on top');
      await click(page, page.getByRole('button', { name: 'Keep on top' }));
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].blur());
      await page.waitForTimeout(300);
      state = await page.evaluate(() => window.sonoraDesktop.e2eFlags());
      if (!state.alwaysOnTop || !before.alwaysOnTop) throw new Error('Blur dropped the pinned window');
      const slider = page.getByRole('slider', { name: 'Overlay opacity' });
      const box = await slider.boundingBox();
      for (const [ratio, label] of [[0.02, 'min'], [0.5, 'mid'], [0.98, 'max']]) {
        await page.mouse.click(box.x + box.width * ratio, box.y + box.height / 2);
        await page.waitForTimeout(100);
        const value = Number(await slider.inputValue());
        if (label === 'min' && value > 30) throw new Error(`Min slider stayed ${value}`);
        if (label === 'max' && value < 80) throw new Error(`Max slider stayed ${value}`);
      }
      await page.evaluate(() => document.documentElement.style.setProperty('--sonora-background-opacity', '0'));
      await click(page, page.getByRole('button', { name: 'Keep on top' }));
      await page.evaluate(() => document.documentElement.style.setProperty('--sonora-background-opacity', '1'));
      await click(page, page.getByRole('button', { name: 'Keep on top' }));
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setBounds({ x: 30, y: 30, width: 1020, height: 700 }));
      await page.waitForTimeout(500);
      await shot('05-resized.png');
    });
  } finally {
    if (app) await app.close().catch(() => {});
    await new Promise(resolve => setTimeout(resolve, 500));
  }

  await scenario('restart clamps off-screen bounds and keeps opacity', async () => {
    requireApp('restart clamps off-screen bounds and keeps opacity');
    const prefs = path.join(userData, 'window-preferences.json');
    const saved = fs.existsSync(prefs) ? JSON.parse(fs.readFileSync(prefs, 'utf8')) : {};
    saved.bounds = { x: 50000, y: 50000, width: 900, height: 640 };
    saved.opacityVersion = 2;
    saved.backgroundOpacity = saved.backgroundOpacity || 1;
    fs.writeFileSync(prefs, JSON.stringify(saved));
    const relaunched = await launch(exePath());
    try {
      if (relaunched.page.url().includes('offline.html')) throw new Error(`Restart opened the offline page.\n${await pageDump(relaunched.page)}`);
      await relaunched.page.getByRole('heading', { name: 'You are signed out' }).waitFor();
      const bounds = await relaunched.app.evaluate(({ BrowserWindow, screen }) => {
        const win = BrowserWindow.getAllWindows()[0];
        const area = screen.getPrimaryDisplay().workArea;
        const box = win.getBounds();
        return { box, area, inside: box.x >= area.x - 20 && box.x < area.x + area.width && box.y >= area.y - 20 && box.y < area.y + area.height };
      });
      if (!bounds.inside) throw new Error(`Off-screen window survived restart ${JSON.stringify(bounds)}`);
      const restored = await relaunched.page.evaluate(() => window.sonoraDesktop.getState());
      if (Math.abs(restored.backgroundOpacity - saved.backgroundOpacity) > 0.02) throw new Error(`Opacity was not restored ${JSON.stringify(restored)}`);
      await shot('06-restart.png');
    } finally {
      await relaunched.app.close().catch(() => {});
    }
  });

  await new Promise(resolve => setTimeout(resolve, 3000));
  server.kill();
  fs.writeFileSync(resultsFile, JSON.stringify({ scenarios }, null, 2));
  const failed = scenarios.filter(item => !item.pass);
  console.log(JSON.stringify(scenarios, null, 2));
  process.exit(failed.length ? 1 : 0);
})().catch(error => {
  server?.kill();
  console.error(error);
  fs.mkdirSync(shots, { recursive: true });
  fs.writeFileSync(resultsFile, JSON.stringify({ scenarios, fatal: String(error) }, null, 2));
  process.exit(1);
});
