const path = require('node:path');
const { createRequire } = require('node:module');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'artifacts/api-server');
const requireApp = createRequire(path.join(app, 'package.json'));
(async () => {
await requireApp('esbuild').build({
  entryPoints: [path.join(app, 'tests/features.ts')], outfile: path.join(app, 'dist/feature-check.mjs'),
  bundle: true, platform: 'node', format: 'esm',
  plugins: [{
    name: 'private-test-identities',
    setup(build) {
      build.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: 'fake-clerk', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
        export const getAuth = req => ({userId:req.headers['x-test-user']});
        export const clerkClient = { users: { getUser: async id => ({
          id,primaryEmailAddressId:'primary',emailAddresses:[{id:'primary',emailAddress:id.endsWith('newowner')?'fixtureowner@example.invalid':'newuser@example.invalid',verification:{status:'verified'}}]
        })}};
      ` }));
      build.onResolve({ filter: /^@workspace\/(db|api-zod)$/ }, args => ({
        path: path.join(root, 'lib', args.path.split('/')[1], 'src/index.ts'),
      }));
    },
  }],
  banner: { js: "import {createRequire} from 'node:module'; const require=createRequire(import.meta.url);" },
});
const result = spawnSync(process.execPath, [path.join(app, 'dist/feature-check.mjs')], { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_ENV: 'production' } });
process.exitCode = result.status ?? 1;
})().catch(error => { console.error(error.message); process.exitCode = 1; });
