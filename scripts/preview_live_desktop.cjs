// Visual-only SSR fixture of the real component; not an authenticated test route.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const root = path.resolve(__dirname, '..');
const appRequire = createRequire(path.join(root, 'artifacts/sonora-ai/package.json'));
const { buildSync } = appRequire('esbuild');
const React = appRequire('react');
const { renderToStaticMarkup } = appRequire('react-dom/server');
const context = { module: { exports: {} }, exports: {}, require: appRequire, window: {} };
vm.runInNewContext(buildSync({
  entryPoints: [path.join(root, 'artifacts/sonora-ai/src/components/live-session-view.tsx')],
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic',
  alias: { '@': path.join(root, 'artifacts/sonora-ai/src') },
  external: ['react', 'react/jsx-runtime'], loader: { '.css': 'empty' },
}).outputFiles[0].text, context);
const View = context.module.exports.default;
const noop = () => {};
const html = renderToStaticMarkup(React.createElement(View, {
  session: { id: 'fictional-visual-check', title: 'Preview interview', company: 'Example team', sessionType: 'interview',
    status: 'active', transcript: [], saveTranscript: false, autoAnswer: true,
    answerPreferences: { length: 'balanced', format: 'full_script', tone: 'simple', starMethod: false, fillerWords: false } },
  answer: 'I would start by clarifying the expected workload and the most important reliability requirements.\n\nFor a read-heavy service, I would keep the primary data in a relational database and introduce caching only where measurements show a benefit. That keeps the initial design understandable and easy to operate.\n\nI would then measure latency, error rates and cache hit rate, and test the behavior when a dependency becomes unavailable. The final choice should follow the actual workload rather than adding complexity in advance.',
  latestQuestion: 'How would you approach designing a reliable read-heavy service?',
  answerState: 'complete', busy: false, listening: true, requestingAudio: false, interimTranscript: '',
  duration: '02:35', notice: '', error: '', audioSource: 'both', remoteConfirmed: true, supportsDualAudio: true,
  levels: { microphone: .1, system: .36 }, channelStatus: { microphone: 'Audio activity', system: 'Audio activity' },
  pipelineStatus: 'Answer complete', question: '', onQuestionChange: noop, onAsk: noop, onUseTranscript: noop,
  onAudioSourceChange: noop, onRemoteConfirmedChange: noop, onToggleAudio: noop, onEnd: noop, onBack: noop,
  onPreferences: noop, onAutoAnswerChange: noop, onLengthChange: noop, onAnswerAction: noop, onReadiness: noop,
}));
const css = fs.readFileSync(path.join(root, 'artifacts/sonora-ai/src/components/live-session-view.css'), 'utf8');
fs.mkdirSync(path.join(root, 'generated-artifacts'), { recursive: true });
fs.writeFileSync(path.join(root, 'generated-artifacts/desktop-live-preview.html'), `<!doctype html><html lang="en"><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Sonora live layout verification</title><style>*{box-sizing:border-box}body{margin:0;background:#101113;font-family:Arial,sans-serif}button,textarea,select{font:inherit}button{cursor:pointer}${css}</style><body data-visual-fixture="fictional-session-controls-inactive">${html}</body></html>`);
console.log('Rendered real live component with fictional data; controls are inactive. No authentication or native capture tested.');
