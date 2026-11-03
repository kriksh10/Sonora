import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] || 'dist');
const port = Number(process.env.E2E_PORT || 4173);
const sessions = [];
let mode = 'ok';
let signedIn = false;

function send(res, status, body, headers = {}) {
  const payload = typeof body === 'string' ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': typeof body === 'string' ? 'text/html; charset=utf-8' : 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch (error) { reject(error); }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1');
  console.log(`${req.method} ${url.pathname}`);
  req.on('error', () => {});
  res.on('error', () => {});
  const cookie = req.headers.cookie || '';
  const authed = signedIn && cookie.includes('sonora_e2e=1');
  try {
    if (url.pathname === '/api/e2e/health') return send(res, 200, { ok: true });
    if (url.pathname === '/api/e2e/sign-in' && req.method === 'POST') {
      signedIn = true;
      return send(res, 200, { ok: true }, { 'Set-Cookie': 'sonora_e2e=1; Path=/' });
    }
    if (url.pathname === '/api/e2e/mode' && req.method === 'POST') {
      const body = await readBody(req);
      mode = body.mode || 'ok';
      return send(res, 200, { mode });
    }
    if (url.pathname === '/api/sessions' && req.method === 'GET') {
      if (!authed) return send(res, 401, { error: 'Sign-in expired. Reconnect by signing in again; your current answer stays visible.' });
      return send(res, 200, sessions);
    }
    if (url.pathname === '/api/sessions' && req.method === 'POST') {
      if (!authed) return send(res, 401, { error: 'Sign in first.' });
      const body = await readBody(req);
      const session = {
        id: `s${sessions.length + 1}`, sessionType: body.sessionType || 'interview', title: body.title || 'Untitled',
        company: body.company || null, description: body.description || '', resumeText: body.resumeText || '',
        documentsText: body.documentsText || '', instructions: '', answerPreference: 'balanced', model: 'e2e',
        language: 'English', autoAnswer: true, saveTranscript: true, status: 'ready', transcript: [],
        createdAt: new Date().toISOString(), startedAt: null, endedAt: null,
      };
      sessions.unshift(session);
      return send(res, 200, session);
    }
    const answer = url.pathname.match(/^\/api\/sessions\/([^/]+)\/answer$/);
    if (answer && req.method === 'POST') {
      if (mode === '401') return send(res, 401, { error: 'Sign-in expired. Reconnect by signing in again; your current answer stays visible.' });
      if (mode === '500') return send(res, 500, { error: 'Answer service failed.' });
      if (mode === 'offline') { req.socket.on('error', () => {}); req.socket.destroy(); return; }
      if (mode === 'timeout') return;
      const body = await readBody(req);
      return send(res, 200, { answer: `Heard: ${body.question}`, model: 'e2e' });
    }
    const live = url.pathname.match(/^\/api\/sessions\/([^/]+)\/live-audio$/);
    if (live) {
      if (mode === 'speechmatics') return send(res, 503, { error: 'Speechmatics unavailable' });
      return send(res, 200, { ok: true });
    }
    if (url.pathname === '/api/billing/balance') return send(res, 200, { balance: 12, freeRemaining: 10, unlimitedUntil: null, bypass: false, checkout: false });
    if (url.pathname === '/api/answer-preferences/defaults') return send(res, 200, { format: 'full_script', length: 'balanced', tone: 'simple', starMethod: false, fillerWords: false });
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const filePath = path.normalize(path.join(dist, relative));
    if (!filePath.startsWith(dist)) return send(res, 403, { error: 'Forbidden' });
    const resolved = fs.existsSync(filePath) && fs.statSync(filePath).isFile() ? filePath : path.join(dist, 'index.html');
    const ext = path.extname(resolved);
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };
    if (ext === '.html' || ext === '.css') {
      const text = fs.readFileSync(resolved, 'utf8')
        .replace(/@import\s+url\((['"]?)https:\/\/fonts\.googleapis\.com[^)]+\)\1;?/g, '')
        .replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>/gi, '');
      res.writeHead(200, { 'Content-Type': types[ext] || 'text/plain', 'Cache-Control': 'no-store' });
      res.end(text);
      return;
    }
    res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
    fs.createReadStream(resolved).pipe(res);
  } catch (error) {
    send(res, 500, { error: error instanceof Error ? error.message : 'Mock failed' });
  }
});

server.on('clientError', () => {});
server.listen(port, '127.0.0.1', () => {
  console.log(`e2e mock listening on http://127.0.0.1:${port}`);
});
