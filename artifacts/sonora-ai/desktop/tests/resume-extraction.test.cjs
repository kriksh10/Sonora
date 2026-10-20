const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { transformSync } = require('esbuild');
const source = path.resolve(__dirname, '../../src/lib/extract-file-text.ts');
function extractor({ pages = ['Selectable PDF resume'], fetcher, failedPdf } = {}) {
  const state = { destroyed: 0 };
  const module = { exports: {} };
  vm.runInNewContext(transformSync(fs.readFileSync(source, 'utf8'), {
    loader: 'ts', format: 'cjs', define: { 'import.meta.env.BASE_URL': '"/"', 'import.meta.url': '"file:///fixture/extract-file-text.ts"' },
  }).code, {
    module, exports: module.exports, setTimeout, clearTimeout, Uint8Array, URL, fetch: fetcher,
    require(name) {
      if (name.includes('pdf.worker')) return 'pdf-fixture-worker';
      if (name === 'pdfjs-dist') return { GlobalWorkerOptions: {}, getDocument: () => ({
        promise: failedPdf ? Promise.reject(new Error('encrypted')) : Promise.resolve({
          numPages: pages.length,
          getPage: async number => ({ getTextContent: async () => ({ items: [{ str: pages[number - 1] }] }), cleanup() {} }),
        }),
        destroy: async () => { state.destroyed++; },
      }) };
      throw new Error(`Unexpected import ${name}`);
    },
  });
  return { extract: module.exports.extractFileText, state };
}
test('TXT/Markdown preserve over-limit text for editing, reject binary and oversized files', async () => {
  const { extract } = extractor();
  const long = 'A'.repeat(40_001);
  assert.equal(await extract(new File([long], 'resume.txt')), long);
  assert.equal(await extract(new File(['# Resume\nSQL'], 'resume.md')), '# Resume\nSQL');
  await assert.rejects(extract(new File(['bad\0binary'], 'resume.txt')), /readable text/i);
  await assert.rejects(extract(new File(['x'], 'resume.rtf')), /Choose a Word/i);
  await assert.rejects(extract(new File([new Uint8Array(12 * 1024 * 1024 + 1)], 'resume.txt')), /12 MB/);
});
test('PDF text is editable without truncation; scanned, encrypted, complex and aborted reads fail explicitly', async () => {
  const f = extractor({ pages: ['PDF resume', 'B'.repeat(40_001)] });
  const text = await f.extract(new File(['synthetic bytes; PDF parser mocked'], 'resume.pdf'));
  assert.ok(text.startsWith('PDF resume')); assert.ok(text.length > 40_000); assert.equal(f.state.destroyed, 1);
  await assert.rejects(extractor({ pages: [''] }).extract(new File(['x'], 'scan.pdf')), /scanned|selectable/i);
  await assert.rejects(extractor({ failedPdf: true }).extract(new File(['x'], 'locked.pdf')), /password|unencrypted/i);
  await assert.rejects(extractor({ pages: Array(101).fill('x') }).extract(new File(['x'], 'large.pdf')), /limit/i);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.extract(new File(['x'], 'cancelled.txt'), controller.signal), { name: 'AbortError' });
});
test('both Word formats use the authenticated transient extraction endpoint and expose server failures', async () => {
  for (const extension of ['doc', 'docx']) {
    let request;
    const { extract } = extractor({ fetcher: async (url, options) => {
      request = { url, options };
      return Response.json({ text: 'Editable Word text' });
    } });
    assert.equal(await extract(new File(['word bytes'], `resume.${extension}`)), 'Editable Word text');
    assert.equal(request.url, '/api/files/extract');
    assert.equal(request.options.credentials, 'include');
    assert.equal(request.options.body.name, `resume.${extension}`);
  }
  const failing = extractor({ fetcher: async () => Response.json({ error: 'Word file is encrypted or damaged.' }, { status: 422 }) });
  await assert.rejects(failing.extract(new File(['bad'], 'broken.doc')), /encrypted or damaged/);
});
