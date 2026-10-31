const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildSync } = require('esbuild');
const vm = require('node:vm');
const { metadataForInstaller } = require('../write-release-metadata.cjs');

const source = buildSync({
  entryPoints: [path.resolve(__dirname, '../../src/lib/desktop-commands.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs',
}).outputFiles[0].text;
const context = { module: { exports: {} } };
vm.runInNewContext(source, context);
const { interpretDesktopCommand, neighborAnswer } = context.module.exports;

const base = {
  question: '', latestQuestion: 'What is a closure?', recentPhoneText: '', answer: 'second',
  assistantAnswers: ['first', 'second', 'third'], inputMode: 'computer',
};

test('desktop commands ask, alternate, scroll, and walk answer history', () => {
  assert.equal(JSON.stringify(interpretDesktopCommand('answer', { ...base, question: '  typed  ' })), JSON.stringify({ type: 'ask', question: 'typed', source: 'typed' }));
  assert.equal(JSON.stringify(interpretDesktopCommand('answer', base)), JSON.stringify({ type: 'ask', question: 'What is a closure?', source: 'typed' }));
  assert.equal(interpretDesktopCommand('alternate', base).type, 'again');
  assert.equal(interpretDesktopCommand('alternate', { ...base, latestQuestion: '' }).type, 'ignore');
  assert.equal(interpretDesktopCommand('scrollUp', base).top, -180);
  assert.equal(neighborAnswer(base.assistantAnswers, 'second', -1), 'first');
  assert.equal(neighborAnswer(base.assistantAnswers, 'first', -1), null);
  assert.equal(JSON.stringify(interpretDesktopCommand('next', base)), JSON.stringify({ type: 'show-answer', answer: 'third' }));
  assert.equal(interpretDesktopCommand('clearTranscript', base).type, 'clear-transcript');
  assert.equal(interpretDesktopCommand('screenshot', base).type, 'screenshot');
  assert.equal(interpretDesktopCommand('toggle', base).type, 'ignore');
});

test('release metadata records the real installer bytes', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sonora-meta-'));
  const file = path.join(directory, 'Sonora-0.9.1-win-x64.exe');
  fs.writeFileSync(file, Buffer.from('installer-bytes'));
  const metadata = metadataForInstaller(file, '0.9.1', 'Not signed');
  assert.equal(metadata.product, 'sonora');
  assert.equal(metadata.sizeBytes, Buffer.byteLength('installer-bytes'));
  assert.match(metadata.sha256, /^[a-f0-9]{64}$/);
  assert.throws(() => metadataForInstaller(file, '0.9.2', 'Not signed'), /filename/);
  fs.rmSync(directory, { recursive: true, force: true });
});

test('the shell keeps capture exclusion, skips the taskbar, and reasserts screen-saver topmost', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8');
  assert.match(main, /skipTaskbar: true/);
  assert.match(main, /hasShadow: false/);
  assert.match(main, /setAlwaysOnTop\(true, 'screen-saver'\)/);
  assert.match(main, /setIgnoreMouseEvents/);
  assert.match(main, /setContentProtection\(contentProtection\)/);
  assert.match(main, /loadFile\(path.join\(__dirname, 'offline.html'\)\)/);
  assert.match(main, /desktopRequestAllowed/);
  assert.doesNotMatch(main, /setContentProtection\(false\)/);
});
