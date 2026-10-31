const fs = require('node:fs');
const path = require('node:path');
const { runtimeFiles } = require('./runtime-files.cjs');

function verifyRuntimeFiles(entries, readFile) {
  const files = new Set(entries.map(name => name.replace(/\\/g, '/').replace(/^\/+/, '')));
  for (const name of [...runtimeFiles, 'runtime-config.json', 'package.json']) {
    if (!files.has(name)) throw new Error(`Desktop archive is incomplete: missing ${name}. No installer may be released.`);
  }
  // Audit the shell modules only. The updater bundle is generated and is not a hand-written import graph.
  for (const name of runtimeFiles) {
    const source = readFile(name).toString('utf8');
    for (const match of source.matchAll(/\brequire\s*\(\s*(['"])(\.[^'"]+)\1\s*\)/g)) {
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(name), match[2]));
      const candidates = [dependency, `${dependency}.cjs`, `${dependency}.js`, `${dependency}.json`, `${dependency}/index.js`];
      if (!candidates.some(candidate => files.has(candidate))) {
        throw new Error(`Desktop archive is incomplete: ${name} requires missing ${match[2]}. No installer may be released.`);
      }
    }
  }
}

function verifyStagedRuntime(directory) {
  const files = fs.readdirSync(directory).filter(name => fs.statSync(path.join(directory, name)).isFile());
  verifyRuntimeFiles(files, name => fs.readFileSync(path.join(directory, name)));
}

function verifyArchive(archive) {
  const asar = require('@electron/asar');
  verifyRuntimeFiles(asar.listPackage(archive), name => asar.extractFile(archive, name));
}

async function verifyPackedRuntime(context) {
  const resources = context.electronPlatformName === 'darwin'
    ? path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : path.join(context.appOutDir, 'resources');
  verifyArchive(path.join(resources, 'app.asar'));
  console.log('Verified packaged desktop runtime: required modules and local imports are present in app.asar.');
}

module.exports = { verifyRuntimeFiles, verifyStagedRuntime, verifyArchive, verifyPackedRuntime };
