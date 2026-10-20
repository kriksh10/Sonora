function opacity(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0.15 || value > 1) {
    throw new Error('Background opacity must be between 15% and 100%.');
  }
  return value;
}

function safeBounds(saved, displays) {
  const areas = displays.map(display => display.workArea);
  if (!areas.length) throw new Error('No connected display.');
  const valid = saved && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(saved[key]));
  const area = valid && areas.find(a => saved.x + saved.width > a.x + 40 &&
    saved.x < a.x + a.width - 40 && saved.y + saved.height > a.y + 40 &&
    saved.y < a.y + a.height - 40) || areas[0];
  const width = Math.min(area.width, Math.max(390, valid ? saved.width : 780));
  // Below this, wrapped call controls leave almost no room to read an answer.
  const height = Math.min(area.height, Math.max(620, valid ? saved.height : 720));
  return {
    width: Math.round(width), height: Math.round(height),
    x: Math.round(Math.max(area.x, Math.min(valid ? saved.x : area.x + (area.width - width) / 2, area.x + area.width - width))),
    y: Math.round(Math.max(area.y, Math.min(valid ? saved.y : area.y + (area.height - height) / 2, area.y + area.height - height))),
  };
}
module.exports = { opacity, safeBounds };
