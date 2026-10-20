const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const path = require('node:path');
const { buildSync } = require('esbuild');
function client(fetcher) {
  const context = vm.createContext({ fetch: fetcher, TextDecoder });
  vm.runInContext(buildSync({
    entryPoints: [path.resolve(__dirname, '../../src/lib/answer-stream.ts')],
    bundle: true, write: false, format: 'iife', globalName: 'subject', platform: 'node',
    define: { 'import.meta.env.BASE_URL': '"/"' },
  }).outputFiles[0].text, context);
  return context.subject.requestAnswer;
}
const frame = value => `data: ${JSON.stringify(value)}\n\n`;
function streamed(parts) {
  return new Response(new ReadableStream({
    start(controller) { parts.forEach(part => controller.enqueue(new TextEncoder().encode(part))); controller.close(); },
  }), { headers: { 'Content-Type': 'text/event-stream' } });
}

test('client decodes split stream frames progressively and requires a matching completion', async () => {
  const chunks = [], requests = [];
  const text = frame({ content: 'First ' }) + frame({ content: 'answer' }) + frame({ done: true, answer: 'First answer', model: 'gemini-test' });
  const request = client(async (url, init) => { requests.push({ url, init }); return streamed([text.slice(0, 17), text.slice(17, 36), text.slice(36)]); });
  const result = await request('session-id', { question: 'Question', action: 'again' }, new AbortController().signal, t => chunks.push(t));
  assert.deepEqual(chunks, ['First ', 'First answer']);
  assert.equal(result.answer, 'First answer');
  assert.equal(requests[0].url, '/api/sessions/session-id/answer');
  assert.equal(JSON.parse(requests[0].init.body).stream, true);
});
test('stream interruption, malformed completion and provider errors cannot masquerade as completed answers', async () => {
  for (const parts of [
    [frame({ content: 'Partial' })],
    [frame({ content: 'Partial' }), frame({ error: 'Provider failed' })],
    [frame({ content: 'Partial' }), frame({ done: true, answer: 'Other', model: 'test' })],
  ]) {
    const seen = [];
    await assert.rejects(client(async () => streamed(parts))('id', { question: 'Q' }, new AbortController().signal, t => seen.push(t)));
    assert.equal(seen[0], 'Partial');
  }
});
test('legacy JSON fallback and expired-auth errors remain explicit', async () => {
  const answer = await client(async () => Response.json({ answer: 'Full answer', model: 'test' }))('id', { question: 'Q' }, new AbortController().signal, () => {});
  assert.equal(answer.answer, 'Full answer');
  await assert.rejects(client(async () => Response.json({ error: 'Unauthorized' }, { status: 401 }))('id', { question: 'Q' }, new AbortController().signal, () => {}), /Sign-in expired/);
});
