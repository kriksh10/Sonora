const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const workspace = fs.readFileSync(path.resolve(__dirname, '../../src/pages/interview-workspace.tsx'), 'utf8');
const overlay = fs.readFileSync(path.resolve(__dirname, '../../src/components/desktop-live-overlay.tsx'), 'utf8');
const live = fs.readFileSync(path.resolve(__dirname, '../../src/lib/live-transcription.ts'), 'utf8');
const checker = fs.readFileSync(path.resolve(__dirname, '../../e2e/os-click.ps1'), 'utf8');
const e2e = fs.readFileSync(path.resolve(__dirname, '../../src/e2e/E2EApp.tsx'), 'utf8');
const end = workspace.slice(workspace.indexOf('const endSession'), workspace.indexOf('const resetRoundState'));
const pause = workspace.slice(workspace.indexOf('onPauseToggle'), workspace.indexOf('onScreenshot'));

test('End leaves the live session immediately, then saves and settles billing', () => {
  assert.match(end, /stopCapture\(\)/);
  assert.match(end, /setAudioPaused\(false\)/);
  assert.match(end, /setLiveMode\(false\)/);
  assert.ok(end.indexOf('stopCapture()') < end.indexOf('await transcriptWritesRef'));
  assert.ok(end.indexOf('setLiveMode(false)') < end.indexOf('await transcriptWritesRef'));
  assert.match(end, /status: "ended"/);
  assert.match(end, /\/billing\/settle/);
  assert.doesNotMatch(end, /confirm\(/);
});

test('Pause closes the transcription connection and Resume starts it again without ending the session', () => {
  assert.match(pause, /stopCapture\(\)/);
  assert.match(pause, /setAudioPaused\(true\)/);
  assert.match(pause, /toggleMicrophone\(\)/);
  assert.doesNotMatch(pause, /setLiveMode\(false\)/);
  assert.doesNotMatch(pause, /status: "ended"/);
  assert.match(overlay, /Paused\. Transcription is off until you resume\./);
  assert.match(overlay, /\{props\.paused \? "Resume" : "Pause"\}/);
  assert.match(live, /stop: true/);
  assert.match(live, /socket\?\.close\(\)/);
});

test('End is judged by a visible button, not the hidden click recorder', () => {
  assert.match(workspace, /window\.sonoraDesktop && liveMode && selected && liveSession \? \(/);
  assert.match(checker, /function Find-VisibleButton/);
  assert.match(checker, /\$stillLive = \[bool\]\(Find-VisibleButton 'End session'\)/);
  const probe = e2e.slice(e2e.indexOf('id="sonora-last-click"'), e2e.indexOf('id="sonora-hover"'));
  assert.match(probe, /aria-label=\{`Last click \$\{lastClick\}`\}/);
  assert.doesNotMatch(probe, /\{lastClick\}<\/p>/);
});
