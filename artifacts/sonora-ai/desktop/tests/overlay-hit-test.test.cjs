const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildSync } = require('esbuild');
const vm = require('node:vm');

const code = buildSync({
  entryPoints: [path.resolve(__dirname, '../../src/lib/overlay-hit-test.ts')],
  bundle: true, write: false, platform: 'node', format: 'cjs',
}).outputFiles[0].text;

const context = { module: { exports: {} } };
context.Element = class FakeElement {
  constructor(selector, parent) {
    this.selector = selector;
    this.parent = parent;
  }
  closest(query) {
    const parts = query.split(',').map(part => part.trim());
    for (let node = this; node; node = node.parent) {
      if (parts.includes(node.selector)) return node;
    }
    return null;
  }
};
vm.runInNewContext(code, context);
const { overlayPointerCaptures, liveAnswerQuestion } = context.module.exports;
const { Element } = context;
const button = new Element('button', new Element('.dp-glass', new Element('.dp-overlay', null)));
const gap = new Element('.dp-overlay', new Element('.dp-app', null));
const card = new Element('.dp-glass', new Element('.dp-overlay', null));

test('clicks on glass and buttons stay in Sonora; empty gaps do not', () => {
  assert.equal(overlayPointerCaptures(button), true);
  assert.equal(overlayPointerCaptures(card), true);
  assert.equal(overlayPointerCaptures(gap), false);
  assert.equal(overlayPointerCaptures(null), false);
});

test('Answer uses the live transcript when the chat box is empty', () => {
  assert.equal(liveAnswerQuestion({ typed: '', latest: 'already asked', interim: 'how does auth', spoken: 'older line' }), 'how does auth');
  assert.equal(liveAnswerQuestion({ typed: '', latest: 'already asked', spoken: 'What is a queue?' }), 'What is a queue?');
  assert.equal(liveAnswerQuestion({ typed: '  typed question ', spoken: 'heard' }), 'typed question');
  assert.equal(liveAnswerQuestion({ spoken: 'Tell me about scaling' }), 'Tell me about scaling');
  assert.equal(liveAnswerQuestion({ typed: '???', spoken: '' }), '');
});

test('packaged shell keeps visible UI clickable and stays above other windows', () => {
  const main = fs.readFileSync(path.resolve(__dirname, '../main.cjs'), 'utf8');
  const preload = fs.readFileSync(path.resolve(__dirname, '../preload.cjs'), 'utf8');
  const css = fs.readFileSync(path.resolve(__dirname, '../../src/desktop-parakeet.css'), 'utf8');
  const overlay = fs.readFileSync(path.resolve(__dirname, '../../src/components/desktop-live-overlay.tsx'), 'utf8');
  assert.match(main, /const pass = clickThrough && !pointerOverUi && !controlsHover/);
  assert.match(main, /setIgnoreMouseEvents\(pass, \{ forward: pass \}\)/);
  assert.match(main, /overlay:set-pointer-capture/);
  assert.match(main, /process\.env\?\.SONORA_E2E === '1' && process\.argv\.includes\('--e2e'\)/);
  assert.match(main, /no-proxy-server/);
  assert.match(main, /force-renderer-accessibility/);
  assert.match(main, /callback\(\{ cancel: !local \}\)/);
  assert.match(main, /setProxy\(\{ mode: 'direct' \}\)/);
  assert.match(main, /win\.on\('blur', \(\) => \{ holdOnTop\(\); \}\)/);
  assert.match(preload, /sendSync\('overlay:set-pointer-capture'/);
  assert.match(css, /-webkit-app-region: no-drag/);
  assert.match(css, /background: rgba\(0, 0, 0, \.02\)/);
  assert.match(overlay, /liveAnswerQuestion/);
  assert.match(overlay, /onClick=\{\(\) => ask\(askText\)\}/);
  assert.doesNotMatch(main, /setIgnoreMouseEvents\(true/);
});
