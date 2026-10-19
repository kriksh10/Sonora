const fs = require('node:fs');
const path = require('node:path');

function prepareInstall(directory, userAgent, remove = fs.rmSync) {
  if (!userAgent?.startsWith('pnpm/')) throw new Error('Use pnpm instead.');
  for (const name of ['package-lock.json', 'yarn.lock']) {
    remove(path.join(directory, name), { force: true });
  }
}

if (require.main === module) {
  try { prepareInstall(path.resolve(__dirname, '..'), process.env.npm_config_user_agent); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepareInstall };
