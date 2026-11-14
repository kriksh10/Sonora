import fs from 'node:fs';

const file = process.argv[2];
if (!file) {
  console.error('usage: node patch-server.mjs <server.mjs>');
  process.exit(1);
}
let source = fs.readFileSync(file, 'utf8');

function replaceOnce(label, from, to) {
  const index = source.indexOf(from);
  if (index < 0) throw new Error(`Patch point missing: ${label}`);
  if (source.indexOf(from, index + from.length) !== -1) throw new Error(`Patch point not unique: ${label}`);
  source = source.slice(0, index) + to + source.slice(index + from.length);
}

replaceOnce(
  'demo state',
  'let signedIn = false;\n',
  `let signedIn = false;
const demoLines = [];
const demoAnswer = 'We can keep the current scope on track for the end of next month. If review and handoff need one extra month, plan for the same team and no new tools. I will send a short written split of that budget after this call.';
function demoParts(text) {
  const words = text.split(' ');
  const parts = [];
  for (let i = 0; i < words.length; i += 3) {
    const slice = words.slice(i, i + 3).join(' ');
    parts.push(i + 3 < words.length ? slice + ' ' : slice);
  }
  return parts;
}
function isDemoQuestion(question) {
  const asked = String(question || '').toLowerCase();
  return asked.includes('extra month') || (asked.includes('budget') && asked.includes('timeline'));
}
const demoFeedScript = '<script>(function(){var seen=0;setInterval(function(){fetch("/api/e2e/demo-lines",{cache:"no-store",credentials:"same-origin"}).then(function(r){return r.json()}).then(function(data){var lines=(data&&data.lines)||[];while(seen<lines.length){var text=lines[seen++];window.dispatchEvent(new CustomEvent("sonora-e2e-transcript",{detail:{text:text}}))}}).catch(function(){})},200)})();</script>';
`,
);

replaceOnce(
  'demo routes',
  "  const authed = signedIn && cookie.includes('sonora_e2e=1');\n",
  `  const authed = signedIn && cookie.includes('sonora_e2e=1');
    if (url.pathname === '/api/e2e/demo-lines' && req.method === 'GET') return send(res, 200, { lines: demoLines });
    if (url.pathname === '/api/e2e/demo-line' && req.method === 'POST') {
      const body = await readBody(req);
      const text = String(body.text || '').trim();
      if (text) demoLines.push(text);
      note('demo line ' + demoLines.length + ' ' + text);
      return send(res, 200, { count: demoLines.length });
    }
`,
);

replaceOnce(
  'demo answer',
  "      return send(res, 200, { answer: `Heard: ${body.question}`, model: 'e2e' });\n",
  `      if (process.env.SONORA_DEMO_VIDEO === '1' && isDemoQuestion(body.question)) {
        const parts = demoParts(demoAnswer);
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.socket?.setNoDelay?.(true);
        let full = '';
        for (const part of parts) {
          full += part;
          res.write('data: ' + JSON.stringify({ content: part }) + '\\n\\n');
          await new Promise(resolve => setTimeout(resolve, 200));
        }
        if (full !== demoAnswer) throw new Error('Demo answer chunks did not rejoin');
        res.write('data: ' + JSON.stringify({ done: true, answer: full, model: 'e2e' }) + '\\n\\n');
        res.end();
        note('demo answer streamed');
        return;
      }
      return send(res, 200, { answer: \`Heard: \${body.question}\`, model: 'e2e' });
`,
);

const liveFrom = "return send(res, 200, { ok: true, transcript: 'How does caching work?' });";
const liveTo = "return send(res, 200, { ok: true, transcript: process.env.SONORA_DEMO_VIDEO === '1' ? '' : 'How does caching work?' });";
const liveCount = source.split(liveFrom).length - 1;
if (liveCount < 1) throw new Error('Live transcript response missing');
source = source.split(liveFrom).join(liveTo);

replaceOnce(
  'demo feed script',
  ".replace(/<link[^>]+fonts\\.(googleapis|gstatic)\\.com[^>]*>/gi, '');",
  ".replace(/<link[^>]+fonts\\.(googleapis|gstatic)\\.com[^>]*>/gi, '')\n        .replace('</body>', demoFeedScript + '</body>');",
);

fs.writeFileSync(file, source);
console.log(`Patched ${file} for the homepage demo feed`);
