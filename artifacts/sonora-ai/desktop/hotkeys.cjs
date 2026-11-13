// Live-session shortcuts. They are registered only while a session is live,
// so they do not take keys from other apps the rest of the time.
const STEP = 48;
const ACTIONS = Object.freeze([
  { id: 'answer', label: 'Answer', accelerator: 'CommandOrControl+Enter', forward: true },
  { id: 'screenshot', label: 'Screenshot', accelerator: 'CommandOrControl+Shift+Enter', forward: true },
  { id: 'scrollUp', label: 'Scroll up', accelerator: 'CommandOrControl+Up', forward: true },
  { id: 'scrollDown', label: 'Scroll down', accelerator: 'CommandOrControl+Down', forward: true },
  { id: 'previous', label: 'Previous answer', accelerator: 'CommandOrControl+Left', forward: true },
  { id: 'next', label: 'Next answer', accelerator: 'CommandOrControl+Right', forward: true },
  { id: 'clearAnswers', label: 'Clear answers', accelerator: 'CommandOrControl+Backspace', forward: true },
  { id: 'clearTranscript', label: 'Clear transcript', accelerator: 'CommandOrControl+Shift+Backspace', forward: true },
  { id: 'hideShow', label: 'Collapse overlay', accelerator: 'CommandOrControl+H', forward: false },
  { id: 'chat', label: 'Chat', accelerator: 'CommandOrControl+Shift+Space', forward: true },
  { id: 'snapUp', label: 'Snap up', accelerator: 'CommandOrControl+Shift+Up', forward: false },
  { id: 'snapDown', label: 'Snap down', accelerator: 'CommandOrControl+Shift+Down', forward: false },
  { id: 'snapLeft', label: 'Snap left', accelerator: 'CommandOrControl+Shift+Left', forward: false },
  { id: 'snapRight', label: 'Snap right', accelerator: 'CommandOrControl+Shift+Right', forward: false },
]);

const MODIFIERS = Object.freeze({
  ctrl: 'CommandOrControl', control: 'CommandOrControl', cmd: 'CommandOrControl', command: 'CommandOrControl',
  commandorcontrol: 'CommandOrControl', alt: 'Alt', option: 'Alt', shift: 'Shift', super: 'Super', meta: 'Meta',
});
const MODIFIER_ORDER = ['CommandOrControl', 'Alt', 'Shift', 'Super', 'Meta'];
const KEYS = new Set(['Space', 'Tab', 'Backspace', 'Delete', 'Insert', 'Enter', 'Return', 'Up', 'Down', 'Left', 'Right',
  'Home', 'End', 'PageUp', 'PageDown', 'Escape', 'Plus', 'Minus',
  ...Array.from({ length: 24 }, (_, index) => `F${index + 1}`)]);

function canonicalKey(value) {
  const token = String(value || '').trim();
  if (/^[a-z0-9]$/i.test(token)) return token.toUpperCase();
  const named = token.length ? token[0].toUpperCase() + token.slice(1).toLowerCase() : '';
  const aliases = { Pageup: 'PageUp', Pagedown: 'PageDown', Esc: 'Escape' };
  const key = aliases[named] || (token.toLowerCase() === 'space' ? 'Space' : named);
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(token)) return token.toUpperCase();
  return KEYS.has(key) ? key : null;
}

function normalizeAccelerator(value) {
  if (value === '' || value === null) return '';
  if (typeof value !== 'string' || value.length > 80) throw new Error('Invalid shortcut.');
  const parts = value.split('+').map(part => part.trim()).filter(Boolean);
  if (parts.length < 2 || parts.length > 4) throw new Error('Use at least one modifier and a key.');
  const key = canonicalKey(parts.pop());
  if (!key) throw new Error('Invalid shortcut key.');
  const mods = [];
  for (const part of parts) {
    const mod = MODIFIERS[part.toLowerCase()];
    if (!mod || mods.includes(mod)) throw new Error('Invalid shortcut modifier.');
    mods.push(mod);
  }
  mods.sort((a, b) => MODIFIER_ORDER.indexOf(a) - MODIFIER_ORDER.indexOf(b));
  return [...mods, key].join('+');
}

function resolveHotkeys(saved) {
  const overrides = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  const resolved = ACTIONS.map(action => {
    const raw = Object.prototype.hasOwnProperty.call(overrides, action.id) ? overrides[action.id] : action.accelerator;
    return { ...action, accelerator: normalizeAccelerator(raw) };
  });
  const seen = new Map();
  for (const item of resolved) {
    if (!item.accelerator) continue;
    if (seen.has(item.accelerator)) throw new Error(`Shortcut ${item.accelerator} is already used by ${seen.get(item.accelerator)}.`);
    seen.set(item.accelerator, item.label);
  }
  return resolved;
}

function registerHotkeys(globalShortcut, bindings, onFire) {
  return bindings.map(binding => {
    if (!binding.accelerator) return { ...binding, registered: false };
    let registered = false;
    try { registered = Boolean(globalShortcut.register(binding.accelerator, () => onFire(binding))); }
    catch { registered = false; }
    return { ...binding, registered };
  });
}

function nudgeBounds(bounds, direction, displays) {
  const delta = { moveUp: [0, -STEP], moveDown: [0, STEP], moveLeft: [-STEP, 0], moveRight: [STEP, 0] }[direction];
  if (!delta) throw new Error('Unknown move.');
  const areas = (displays || []).map(display => display.workArea).filter(Boolean);
  if (!areas.length) throw new Error('No connected display.');
  const width = Number(bounds?.width) || 0;
  const height = Number(bounds?.height) || 0;
  const currentX = Number(bounds?.x) || 0;
  const currentY = Number(bounds?.y) || 0;
  const area = areas.find(item => currentX + width > item.x + 40 && currentX < item.x + item.width - 40 &&
    currentY + height > item.y + 40 && currentY < item.y + item.height - 40) || areas[0];
  const maxX = area.x + Math.max(0, area.width - Math.min(width || area.width, area.width));
  const maxY = area.y + Math.max(0, area.height - Math.min(Math.max(height, 80), area.height));
  return {
    x: Math.round(Math.max(area.x, Math.min(currentX + delta[0], maxX))),
    y: Math.round(Math.max(area.y, Math.min(currentY + delta[1], maxY))),
  };
}

function snapBounds(bounds, direction, displays, place) {
  const area = (displays || []).map(display => display.workArea).find(Boolean);
  if (!area) throw new Error('No connected display.');
  const at = place || { col: 1, row: 0 };
  const rowBase = at.row > 0 ? 1 : 0;
  const col = direction === 'snapLeft' ? (at.col + 2) % 3 : direction === 'snapRight' ? (at.col + 1) % 3 : at.col;
  const row = direction === 'snapUp' || direction === 'snapDown' ? (rowBase === 0 ? 1 : 0) : rowBase;
  const width = Math.min(area.width, Math.max(72, Number(bounds?.width) || 780));
  const height = Math.min(area.height, Math.max(72, Number(bounds?.height) || 720));
  const x = area.x + (col === 0 ? 0 : col === 2 ? area.width - width : Math.round((area.width - width) / 2));
  const y = area.y + (row === 0 ? 0 : area.height - height);
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height), col, row };
}

function hotkeySummary(bindings) {
  return bindings.map(({ id, label, accelerator, registered }) => ({ id, label, accelerator, registered: Boolean(registered) }));
}

module.exports = {
  ACTIONS, STEP, normalizeAccelerator, resolveHotkeys, registerHotkeys, nudgeBounds, snapBounds, hotkeySummary,
};
