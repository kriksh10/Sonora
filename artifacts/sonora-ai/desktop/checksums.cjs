const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const directory = path.resolve(__dirname, '../../../generated-artifacts/installers');
const files = fs.readdirSync(directory).filter(name => /\.(exe|dmg)$/.test(name));
if (!files.length) throw new Error('No installers were produced.');
const rows = files.map(file => `${createHash('sha256').update(fs.readFileSync(path.join(directory, file))).digest('hex')}  ${file}`);
fs.writeFileSync(path.join(directory, 'SHA256SUMS.txt'), rows.join('\n') + '\n');
