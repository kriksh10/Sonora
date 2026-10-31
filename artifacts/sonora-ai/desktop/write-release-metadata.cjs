const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { signingLabel } = require('./signing.cjs');

function metadataForInstaller(file, version, signing = signingLabel()) {
  const filename = path.basename(file);
  if (!/^\d+\.\d+\.\d+$/.test(version) || filename !== `Sonora-${version}-win-x64.exe`) {
    throw new Error('Installer filename does not match the app version.');
  }
  const bytes = fs.readFileSync(file);
  if (!bytes.length) throw new Error('Installer file is empty.');
  return {
    product: 'sonora',
    version,
    filename,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    sizeBytes: bytes.length,
    signing,
  };
}

function writeReleaseMetadata(directory, version, signing) {
  const metadata = metadataForInstaller(path.join(directory, `Sonora-${version}-win-x64.exe`), version, signing);
  const outfile = path.join(directory, 'sonora-desktop-release.json');
  fs.writeFileSync(outfile, `${JSON.stringify(metadata, null, 2)}\n`);
  return outfile;
}

if (require.main === module) {
  const version = require('../package.json').version;
  const directory = path.resolve(__dirname, '../../../generated-artifacts/installers');
  console.log(writeReleaseMetadata(directory, version));
}

module.exports = { metadataForInstaller, writeReleaseMetadata };
