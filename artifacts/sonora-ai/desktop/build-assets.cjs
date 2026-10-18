const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const value of bytes) {
    crc ^= value;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type);
  const result = Buffer.alloc(12 + data.length);
  result.writeUInt32BE(data.length, 0); name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return result;
}
function png(size) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const offset = y * (size * 4 + 1) + 1 + x * 4;
      const nx = x / size, ny = y / size;
      const bar = (nx > .44 && nx < .56 && ny > .22 && ny < .78) ||
        ((nx > .22 && nx < .34 || nx > .66 && nx < .78) && ny > .34 && ny < .66);
      const color = bar ? [25, 55, 58, 255] : [117, 200, 83, 255];
      pixels.set(color, offset);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4);
  header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
function buildAssets(directory = path.join(__dirname, 'assets')) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'icon.png'), png(512));
  fs.writeFileSync(path.join(directory, 'tray.png'), png(32));
}
if (require.main === module) buildAssets();
module.exports = { buildAssets };
