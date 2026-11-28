/**
 * Vercel host for the same framework-free router the dev server and the standalone
 * proxy mount — a third host, not a second implementation. Static files come from
 * `dist/` (vercel.json outputDirectory); every /api/* request lands here.
 *
 * Serverless reality, stated plainly: the store and the judge state live in this
 * function's memory (the store's disk write lands in /tmp and is a bonus, exactly as
 * its own comment says). A cold start resets Judge Mode simulations and any state
 * that was never written through — acceptable for the hosted demo; `npm run dev` or
 * `npm run proxy` remain the full-fidelity hosts, and Telegram alert pushes run on
 * those (the bot's webhook half — /start, phrases, /status — works here).
 */
import { handle } from '../src/server/handler.ts';
import { createStore } from '../src/server/store.ts';

const store = createStore();

export default async function vercelHandler(req: any, res: any): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // vercel.json rewrites /health to /api/health so this catch-all can serve it.
  const pathname = url.pathname === '/api/health' ? '/health' : url.pathname;
  let body = '';
  for await (const chunk of req) body += chunk;
  const out = await handle(
    { method: req.method ?? 'GET', pathname, query: url.searchParams, body },
    store,
  );
  res.statusCode = out.status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(out.json));
}
