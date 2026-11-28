import { defineConfig, type Plugin } from 'vite';
import { handle } from './src/server/handler.ts';
import { createStore } from './src/server/store.ts';
import { startTelegram } from './src/server/telegram.ts';

/**
 * The quote service runs inside the dev server, so the app and its API share one
 * origin: no CORS, no second port, nothing to forget before a demo.
 */
function api(): Plugin {
  const store = createStore();
  startTelegram(store);
  return {
    name: 'targetglance-api',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
        if (!url.pathname.startsWith('/api') && url.pathname !== '/health') return next();
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          const out = await handle(
            { method: req.method ?? 'GET', pathname: url.pathname, query: url.searchParams, body },
            store,
          );
          res.writeHead(out.status, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(out.json));
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [api()],
  server: { host: '0.0.0.0', port: 5173, strictPort: false, allowedHosts: true },
  build: {
    rollupOptions: { input: { index: 'index.html', companion: 'companion.html' } },
    target: 'es2022',
  },
});
