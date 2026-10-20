const { parentPort, workerData } = require('node:worker_threads');
const WordExtractor = require('word-extractor');
const yauzl = require('yauzl');

// Inspect ZIP expansion metadata before the DOCX parser allocates its contents.
async function validateZip(bytes) {
  await new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (error, zip) => {
      if (error) return reject(error);
      let total = 0, count = 0;
      const fail = error => { zip.close(); reject(error); };
      zip.on('error', fail);
      zip.on('entry', entry => {
        total += entry.uncompressedSize;
        if (++count > 4096 || total > 32 * 1024 * 1024 || entry.generalPurposeBitFlag & 1) {
          fail(new Error('Encrypted or expanded document is too large.')); return;
        }
        zip.readEntry();
      });
      zip.on('end', resolve);
      zip.readEntry();
    });
  });
}
(async () => {
  const bytes = Buffer.from(workerData);
  if (bytes.length > 12 * 1024 * 1024) throw new Error('File too large.');
  const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const ole = bytes.subarray(0, 8).equals(Buffer.from('d0cf11e0a1b11ae1', 'hex'));
  if (!zip && !ole) throw new Error('Not a Word document.');
  if (zip) await validateZip(bytes);
  const doc = await new WordExtractor().extract(bytes);
  const text = [doc.getBody(), doc.getHeaders?.(), doc.getFootnotes?.(), doc.getEndnotes?.()].filter(Boolean).join('\n').trim();
  if (!text) throw new Error('Document contains no readable text.');
  if (text.length > 2_000_000) throw new Error('Expanded text too large.');
  parentPort.postMessage({ text });
})().catch(() => parentPort.postMessage({ error: 'Could not read Word document. It may be damaged, password-protected, image-only or too large after expansion. Use an unencrypted DOC/DOCX or paste its text.' }));
