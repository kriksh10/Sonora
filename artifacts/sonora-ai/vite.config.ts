import path from 'path';
import type { Connect } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin, type PreviewServer, type ViteDevServer } from 'vite';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

const KNOWN_PAGE = new RegExp(
  `^(?:${basePath.replace(/\/$/, '')})?(?:/|/sign-in(?:/.*)?|/sign-up(?:/.*)?|/pricing|/privacy|/terms|/dashboard|/settings|/download|/desktop-connect(?:/.*)?)$`,
);

function unknownRouteStatus(): Plugin {
  const apply = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use(((req, res, next) => {
      const pathname = (req.url || '/').split('?')[0];
      const accept = req.headers.accept || '';
      const wantsHtml = accept.length === 0 || accept.includes('text/html') || accept.includes('*/*');
      const isDocument = (req.method === 'GET' || req.method === 'HEAD') && wantsHtml;
      const isFile = pathname.includes('.');
      if (!isDocument || isFile || pathname.startsWith('/api') || KNOWN_PAGE.test(pathname)) {
        next();
        return;
      }
      const writeHead = res.writeHead.bind(res);
      res.writeHead = ((statusCode: number, ...args: unknown[]) => {
        const status = statusCode === 200 ? 404 : statusCode;
        return writeHead(status, ...(args as []));
      }) as typeof res.writeHead;
      const end = res.end.bind(res);
      res.end = ((...args: unknown[]) => {
        if (res.statusCode === 200) res.statusCode = 404;
        return end(...(args as []));
      }) as typeof res.end;
      next();
    }) as Connect.NextHandleFunction);
  };
  return {
    name: 'sonora-unknown-route-status',
    configureServer: apply,
    configurePreviewServer: apply,
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss({ optimize: false }),
    runtimeErrorOverlay(),
    unknownRouteStatus(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
