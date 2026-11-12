const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSync } = require('esbuild');
const path = require('node:path');
const vm = require('node:vm');

function fixture(value = 'system') {
  let cursor = 0;
  const slots = [];
  const effects = [];
  const changed = (a, b) => !a || a.length !== b.length || a.some((v, i) => v !== b[i]);
  const react = {
    useRef(initial) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useState(initial) {
      const i = cursor++;
      if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial;
      return [slots[i], next => { slots[i] = typeof next === 'function' ? next(slots[i]) : next; }];
    },
    useEffect(fn, deps) {
      const i = cursor++;
      const old = slots[i];
      if (!old || changed(old.deps, deps)) effects.push(() => { old?.cleanup?.(); slots[i] = { deps, cleanup: fn() }; });
    },
  };
  const jsx = (type, props) => ({ type, props });
  const context = vm.createContext({
    window: {},
    require: name => name === 'react' ? react : name === 'react/jsx-runtime' ? { jsx, jsxs: jsx } : new Proxy({}, { get: () => () => null }),
  });
  vm.runInContext(buildSync({
    entryPoints: [path.resolve(__dirname, '../../src/components/desktop-select.tsx')],
    bundle: true, write: false, format: 'iife', globalName: 'subject', platform: 'node', jsx: 'automatic',
    external: ['react', 'react/jsx-runtime', 'lucide-react'],
  }).outputFiles[0].text, context);
  const chosen = [];
  const props = {
    label: 'Audio source',
    legend: 'Audio',
    value,
    disabled: false,
    options: [
      { value: 'microphone', label: 'Microphone' },
      { value: 'system', label: 'Call audio' },
      { value: 'both', label: 'Both' },
    ],
    onChange: next => { chosen.push(next); props.value = next; },
  };
  const render = () => {
    cursor = 0;
    effects.length = 0;
    const tree = context.subject.default(props);
    effects.forEach(fn => fn());
    return tree;
  };
  const walk = (tree, visit) => {
    if (!tree || typeof tree !== 'object') return;
    visit(tree);
    for (const child of [tree.props?.children].flat(Infinity)) walk(child, visit);
  };
  const find = (tree, pred) => {
    let match;
    walk(tree, node => { if (!match && pred(node)) match = node; });
    return match;
  };
  const key = (name, extra = {}) => ({ key: name, preventDefault() {}, stopPropagation() {}, ...extra });
  return { props, render, find, chosen, key };
}

test('audio picker opens in the menu flow and keyboard chooses Both', () => {
  const f = fixture();
  let tree = f.render();
  const trigger = () => f.find(tree, node => node.props?.['aria-haspopup'] === 'listbox');
  assert.equal(trigger().props['aria-label'], 'Audio source, Call audio');
  assert.equal(trigger().props['aria-expanded'], false);
  assert.equal(f.find(tree, node => node.props?.role === 'listbox'), undefined);
  trigger().props.onClick();
  tree = f.render();
  const options = [];
  const walk = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.props?.role === 'option') options.push(node);
    for (const child of [node.props?.children].flat(Infinity)) walk(child);
  };
  walk(tree);
  assert.deepEqual(options.map(option => option.props.children), ['Microphone', 'Call audio', 'Both']);
  assert.equal(options[1].props['aria-selected'], true);
  assert.equal(f.find(tree, node => node.props?.role === 'listbox').props.className.includes('is-scroll'), false);
  trigger().props.onKeyDown(f.key('ArrowDown'));
  tree = f.render();
  trigger().props.onKeyDown(f.key('Enter'));
  assert.deepEqual(f.chosen, ['both']);
  tree = f.render();
  assert.equal(trigger().props['aria-label'], 'Audio source, Both');
  assert.equal(trigger().props['aria-expanded'], false);
});

test('escape closes the list without changing the source, and a disabled picker stays closed', () => {
  const f = fixture();
  let tree = f.render();
  const trigger = () => f.find(tree, node => node.props?.['aria-haspopup'] === 'listbox');
  trigger().props.onKeyDown(f.key('ArrowDown'));
  tree = f.render();
  assert.equal(trigger().props['aria-expanded'], true);
  const event = f.key('Escape');
  trigger().props.onKeyDown(event);
  assert.equal(event.stopped, undefined);
  tree = f.render();
  assert.equal(trigger().props['aria-expanded'], false);
  assert.deepEqual(f.chosen, []);
  f.props.disabled = true;
  tree = f.render();
  trigger().props.onClick();
  trigger().props.onKeyDown(f.key('Enter'));
  tree = f.render();
  assert.equal(f.find(tree, node => node.props?.role === 'listbox'), undefined);
  assert.equal(trigger().props.disabled, true);
});

test('option keys move the highlight and typeahead lands on Microphone', () => {
  const f = fixture();
  let tree = f.render();
  const trigger = () => f.find(tree, node => node.props?.['aria-haspopup'] === 'listbox');
  trigger().props.onKeyDown(f.key('m'));
  tree = f.render();
  const options = [];
  const walk = node => {
    if (!node || typeof node !== 'object') return;
    if (node.props?.role === 'option') options.push(node);
    for (const child of [node.props?.children].flat(Infinity)) walk(child);
  };
  walk(tree);
  assert.equal(options[0].props.tabIndex, 0);
  options[0].props.onKeyDown(f.key('ArrowDown'));
  tree = f.render();
  const moved = [];
  walk(tree);
  const again = [];
  const collect = node => {
    if (!node || typeof node !== 'object') return;
    if (node.props?.role === 'option') again.push(node);
    for (const child of [node.props?.children].flat(Infinity)) collect(child);
  };
  collect(tree);
  assert.equal(again[1].props.tabIndex, 0);
  again[1].props.onKeyDown(f.key('Enter'));
  assert.deepEqual(f.chosen, ['system']);
});
