import { SYMBOLS, knownSymbols } from '../core/symbols.ts';
import { MAX_BODY, isStateKey, type Store } from './store.ts';
import { RESET_JUDGE, judge, probe, quotesNow, type JudgeState } from './quotes.ts';
import type { SessionOverride } from '../core/session.ts';

export interface Req {
  method: string;
  pathname: string;
  query: URLSearchParams;
  body: string;
}

export interface Res {
  status: number;
  json: unknown;
}

const ok = (json: unknown, status = 200): Res => ({ status, json });
const bad = (message: string, status = 400): Res => ({ status, json: { error: message } });

/**
 * Framework-free router, mounted by Vite middleware in dev and by a 20-line Node
 * server for anyone who wants the proxy on its own port. One implementation, two hosts.
 */
export async function handle(req: Req, store: Store): Promise<Res> {
  const { method, pathname, query } = req;

  if (pathname === '/health') return ok({ ok: true, ts: new Date().toISOString() });

  if (pathname === '/api/quotes' && method === 'GET') {
    const raw = (query.get('symbols') ?? '').split(',').filter(Boolean);
    if (!raw.length) return bad('symbols is required');
    const symbols = knownSymbols(raw);
    if (!symbols.length) return bad(`no known symbols in: ${raw.join(',')}`);
    return ok(await quotesNow(symbols));
  }

  if (pathname === '/api/symbols') return ok(SYMBOLS);

  if (pathname === '/api/probe' && method === 'GET') return ok(await probe());

  if (pathname.startsWith('/api/state/')) {
    const key = pathname.slice('/api/state/'.length);
    if (!isStateKey(key)) return bad(`unknown state key: ${key}`);
    if (method === 'GET') return ok(store.get(key) ?? null);
    if (method === 'PUT') {
      if (req.body.length > MAX_BODY) return bad('body too large', 413);
      try {
        return ok(store.set(key, JSON.parse(req.body || 'null')));
      } catch {
        return bad('body must be JSON');
      }
    }
    return bad('method not allowed', 405);
  }

  if (pathname === '/api/judge') {
    if (method === 'GET') return ok(judge);
    if (method !== 'POST') return bad('method not allowed', 405);
    if (req.body.length > MAX_BODY) return bad('body too large', 413);
    let patch: Partial<JudgeState> & { reset?: boolean; resetState?: boolean };
    try {
      patch = JSON.parse(req.body || '{}');
    } catch {
      return bad('body must be JSON');
    }
    if (patch.reset) Object.assign(judge, RESET_JUDGE());
    if (patch.resetState) store.reset();
    if (typeof patch.mock === 'boolean') judge.mock = patch.mock;
    if (typeof patch.forceStale === 'boolean') judge.forceStale = patch.forceStale;
    if (patch.session) judge.session = patch.session as SessionOverride;
    if (patch.sim) {
      // Only allowlisted symbols, only finite numbers: the sim table is another trust boundary.
      judge.sim = Object.fromEntries(
        Object.entries(patch.sim).filter(([s, v]) => s in SYMBOLS && Number.isFinite(Number(v))),
      ) as Record<string, number>;
    }
    return ok(judge);
  }

  return bad('not found', 404);
}
