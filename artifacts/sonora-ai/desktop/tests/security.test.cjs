const test = require('node:test');
const assert = require('node:assert/strict');
const { validateServiceUrl, isAllowedNavigation, isTrustedFrame } = require('../security.cjs');

test('release URL rejects preview, insecure URLs, credentials, query and fragment', () => {
  for (const value of [null, '', 'file:///tmp/app', 'http://example.com', 'https://a.replit.dev',
    'https://user:password@example.com', 'https://example.com?token=x', 'https://example.com/#fragment',
    'http://localhost:5173']) assert.throws(() => validateServiceUrl(value));
  assert.equal(validateServiceUrl('https://sonora.example/'), 'https://sonora.example/');
  assert.equal(validateServiceUrl('http://127.0.0.1:5173', true), 'http://127.0.0.1:5173/');
  assert.throws(() => validateServiceUrl('file://localhost/secret', true));
});
test('navigation rejects lookalike origins, protocols and malformed URLs', () => {
  const target = 'https://sonora.example';
  assert.equal(isAllowedNavigation('https://sonora.example/sign-in', target), true);
  for (const value of ['https://sonora.example.evil.test', 'http://sonora.example', 'javascript:alert(1)', 'invalid']) {
    assert.equal(isAllowedNavigation(value, target), false);
  }
});
test('native IPC only accepts the hosted main frame in the correct webContents', () => {
  const frame = { url: 'https://sonora.example/' };
  const contents = { mainFrame: frame };
  assert.equal(isTrustedFrame({ sender: contents, senderFrame: frame }, contents, frame.url), true);
  assert.equal(isTrustedFrame({ sender: {}, senderFrame: frame }, contents, frame.url), false);
  assert.equal(isTrustedFrame({ sender: contents, senderFrame: { url: frame.url } }, contents, frame.url), false);
  frame.url = 'https://external.example/';
  assert.equal(isTrustedFrame({ sender: contents, senderFrame: frame }, contents, 'https://sonora.example'), false);
});
