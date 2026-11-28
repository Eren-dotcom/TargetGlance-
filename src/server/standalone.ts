import { createServer } from 'node:http';
import { handle } from './handler.ts';
import { createStore } from './store.ts';
import { probe } from './quotes.ts';

/**
 * Optional second host for the same router: `npm run proxy` on :8787.
 * The dev server mounts the identical handler, so this exists only for people who
 * want the quote service apart from the app.
 */
const PORT = Number(process.env.PORT ?? 8787);

if (process.argv.includes('--probe')) {
  const out = await probe();
  console.log(JSON.stringify(out, null, 2));
  process.exit(0);
}

const store = createStore();

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  let body = '';
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 64 * 1024) break;
  }
  const out = await handle(
    { method: req.method ?? 'GET', pathname: url.pathname, query: url.searchParams, body },
    store,
  );
  res.writeHead(out.status, {
    'content-type': 'application/json; charset=utf-8',
    // The app talks to its own origin in dev; this only matters for `npm run proxy` users.
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,PUT,POST,OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(out.status === 204 ? undefined : JSON.stringify(out.json));
}).listen(PORT, '0.0.0.0', () => console.log(`TargetGlance quote proxy on http://localhost:${PORT}`));
