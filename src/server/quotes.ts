import { SYMBOLS, assetClass } from '../core/symbols.ts';
import { sessionFor, type Session, type SessionOverride } from '../core/session.ts';
import {
  binanceTicker,
  round,
  sessionFromMarketState,
  withSim,
  yahooTicker,
  type Quote,
} from '../core/quotes.ts';

export interface JudgeState {
  mock: boolean;
  forceStale: boolean;
  session: SessionOverride;
  /** Judge simulation as a percent move per symbol; replaces the live price until cleared. */
  sim: Record<string, number>;
}

export const judge: JudgeState = { mock: false, forceStale: false, session: 'auto', sim: {} };

export const RESET_JUDGE = (): JudgeState => ({ mock: false, forceStale: false, session: 'auto', sim: {} });

interface Entry {
  quote: Quote;
  at: number;
}

export const CACHE_MS = 10_000;
export const STALE_MS = 60_000;

const cache = new Map<string, Entry>();

/** Stable per-symbol hash, so neighbours do not move together. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967295;
}

/**
 * Deterministic mock: stable per symbol per minute, so the demo never flickers randomly
 * and two crypto majors never show the same percentage.
 */
function mockQuote(symbol: string, now: Date): Quote {
  const base = SYMBOLS[symbol]?.mock ?? 100;
  const bucket = Math.floor(now.getTime() / 60_000);
  const seed = hash(symbol) * 1000 + bucket;
  const wobble = (Math.sin(seed) / 2) * 0.05;
  const price = round(base * (1 + wobble));
  return {
    symbol,
    price,
    prevClose: base,
    changePct: round(((price - base) / base) * 100),
    source: 'mock',
    stale: false,
    mock: true,
    ts: now.toISOString(),
  };
}

async function fetchLive(symbol: string, now: Date): Promise<Quote & { marketState?: string }> {
  const def = SYMBOLS[symbol]!;
  const t = await (def.class === 'crypto' ? binanceTicker(def.binance ?? symbol) : yahooTicker(def.yahoo ?? symbol));
  const price = round(t.price);
  const prevClose = round(t.prevClose);
  return {
    symbol,
    price,
    prevClose,
    changePct: prevClose > 0 ? round(((price - prevClose) / prevClose) * 100) : 0,
    source: def.class === 'crypto' ? 'binance' : 'yahoo',
    stale: false,
    mock: false,
    ts: now.toISOString(),
    ...(t.marketState ? { marketState: t.marketState } : {}),
  };
}

/** Session comes from the clock, unless Yahoo has a better opinion that hour. */
function withSession(q: Quote, now: Date, marketState?: string): Quote & { session: Session } {
  return {
    ...q,
    session: sessionFromMarketState(marketState) ?? sessionFor(assetClass(q.symbol), now, judge.session),
  };
}

/**
 * A Judge simulation is applied at read time, not baked into the cache: clearing a sim has
 * to move the price back immediately, and a cached quote must not dodge the override.
 */
function simulate(q: Quote): Quote {
  const pct = judge.sim[q.symbol];
  if (!pct) return q;
  const price = round(withSim({ price: q.price, prevClose: q.prevClose }, pct).price);
  return {
    ...q,
    price,
    changePct: q.prevClose > 0 ? round(((price - q.prevClose) / q.prevClose) * 100) : 0,
    simPct: pct,
  };
}

/**
 * One symbol, one quote. Trust order: judge mock → cache → live → last known good →
 * deterministic mock. Never throws, never returns nothing: the caller always has a row.
 */
export async function quoteFor(symbol: string, now = new Date()): Promise<Quote & { session: Session }> {
  if (judge.mock) {
    return withSession({ ...mockQuote(symbol, now), stale: judge.forceStale }, now);
  }

  const hit = cache.get(symbol);
  if (hit && now.getTime() - hit.at < CACHE_MS) return withSession(simulate(hit.quote), now);

  try {
    const q = await fetchLive(symbol, now);
    cache.set(symbol, { quote: q, at: now.getTime() });
    return withSession(simulate(q), now, q.marketState);
  } catch {
    if (hit) {
      // Keep the last real price but say so: a stale badge beats a blank row.
      return withSession(simulate({ ...hit.quote, stale: true }), now);
    }
    return withSession(simulate({ ...mockQuote(symbol, now), stale: judge.forceStale }), now);
  }
}

/** All symbols in parallel; one slow upstream cannot stall the row set. */
export async function quotesNow(symbols: string[], now = new Date()) {
  const settled = await Promise.allSettled(symbols.map((s) => quoteFor(s, now)));
  return settled.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
}

/** Upstream health, so the demo can start on the mock path on purpose. */
export async function probe(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(
    (['binance', 'yahoo'] as const).map(async (src) => {
      try {
        await (src === 'binance' ? binanceTicker('BTCUSDT') : yahooTicker('NVDA'));
        out[src] = 'ok';
      } catch (e) {
        out[src] = `unreachable: ${(e as Error).message.slice(0, 60)}`;
      }
    }),
  );
  return out;
}

export const clearCache = () => cache.clear();
