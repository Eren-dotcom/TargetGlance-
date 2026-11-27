import { SYMBOLS, assetClass } from '../core/symbols.ts';
import { sessionFor, type Session, type SessionOverride } from '../core/session.ts';
import {
  binanceKlines,
  binanceTicker,
  round,
  sessionFromMarketState,
  withSim,
  yahooCandles,
  yahooTicker,
  type Quote,
} from '../core/quotes.ts';
import { RANGE_SPEC, mockCandles, normalizeCandles, type Candle, type History, type Range } from '../core/candles.ts';
import { explain, providers, type ProviderSpec } from './provider.ts';

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

const quoteOf = (symbol: string, t: { price: number; prevClose: number; marketState?: string }, source: Quote['source'], now: Date): Quote & { marketState?: string } => {
  const price = round(t.price);
  const prevClose = round(t.prevClose);
  return {
    symbol,
    price,
    prevClose,
    changePct: prevClose > 0 ? round(((price - prevClose) / prevClose) * 100) : 0,
    source,
    stale: false,
    mock: false,
    ts: now.toISOString(),
    ...(t.marketState ? { marketState: t.marketState } : {}),
  };
};

/**
 * Trust order: a configured key first (it is the one with a contract), then the keyless
 * pair. Each failure is recorded so the fallback can say *why* it is not live — a mock
 * price with no reason is how a demo lies to a judge.
 */
async function fetchLive(symbol: string, now: Date): Promise<Quote & { marketState?: string; reason?: string }> {
  const def = SYMBOLS[symbol]!;
  const reasons: string[] = [];

  for (const p of providers() as ProviderSpec[]) {
    if (!p.key) continue;
    try {
      const t = await p.quote(symbol);
      const q = quoteOf(symbol, t, p.name, now);
      return reasons.length ? { ...q, reason: `${p.label} live (after ${reasons.join('; ')})` } : q;
    } catch (e) {
      reasons.push(`${p.label}: ${explain(e)}`);
    }
  }

  try {
    const t = await (def.class === 'crypto' ? binanceTicker(def.binance ?? symbol) : yahooTicker(def.yahoo ?? symbol));
    const q = quoteOf(symbol, t, def.class === 'crypto' ? 'binance' : 'yahoo', now);
    return reasons.length ? { ...q, reason: `keyless fallback (${reasons.join('; ')})` } : q;
  } catch (e) {
    reasons.push(`${def.class === 'crypto' ? 'Binance' : 'Yahoo'}: ${explain(e)}`);
    throw Object.assign(new Error(reasons.join('; ')), { reasons });
  }
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
    // `reason` is diagnostic, not a price property: it must not outlive this response.
    const { reason, ...clean } = q;
    return withSession(reason ? { ...simulate(clean), reason } : simulate(clean), now, q.marketState);
  } catch (e) {
    const why = (e as Error).message.slice(0, 120);
    if (hit) {
      // Keep the last real price but say so: a stale badge beats a blank row.
      return withSession(simulate({ ...hit.quote, stale: true, reason: `last known · ${why}` }), now);
    }
    return withSession(simulate({ ...mockQuote(symbol, now), stale: judge.forceStale, reason: why }), now);
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
  // Keys are optional; the probe says which are loaded and whether they actually work.
  out.providers = providers().length ? providers().map((p) => p.name).join(', ') : 'none (keyless mode)';
  for (const p of providers()) {
    try {
      // Prove the key on a symbol every provider serves: a crypto pair would fail wrong.
      await p.quote('NVDA');
      out[p.name] = 'ok';
    } catch (e) {
      out[p.name] = explain(e);
    }
  }
  return out;
}

export const clearCache = () => cache.clear();

/* ------------------------------------------------------------------ *
 * History for the detail view. Same trust order as a quote: judge mock
 * → cache → live → last known good → deterministic mock.
 * ------------------------------------------------------------------ */

const historyCache = new Map<string, { at: number; candles: Candle[]; source: History['source'] }>();
export const HISTORY_CACHE_MS = 60_000;

/** The live sources take their own range labels; ours are the three the glass offers. */
const YAHOO_SPAN: Record<Range, string> = { '1D': '1d', '5D': '5d', '1M': '1mo' };

export async function candlesFor(symbol: string, range: Range, now = new Date()): Promise<History> {
  const spec = RANGE_SPEC[range];
  // The chart's last bar must be the price on the row above it, sim included, or the
  // detail view contradicts the watchlist.
  const live = await quoteFor(symbol, now);
  const endOn = (candles: Candle[]): Candle[] => {
    const last = candles[candles.length - 1];
    if (!last || !(live.price > 0)) return candles;
    const c = { ...last, c: live.price, h: Math.max(last.h, live.price), l: Math.min(last.l, live.price) };
    return [...candles.slice(0, -1), c];
  };

  if (judge.mock) {
    return {
      symbol,
      range,
      step: spec.interval,
      source: 'mock',
      mock: true,
      candles: mockCandles(symbol, live.price, spec.bars, now.getTime(), live.prevClose),
    };
  }

  const key = `${symbol}|${range}`;
  const hit = historyCache.get(key);
  if (hit && now.getTime() - hit.at < HISTORY_CACHE_MS) {
    return { symbol, range, step: spec.interval, source: hit.source, mock: false, candles: endOn(hit.candles) };
  }

  const def = SYMBOLS[symbol]!;
  try {
    const raw =
      def.class === 'crypto'
        ? await binanceKlines(def.binance ?? symbol, spec.interval, spec.bars)
        : await yahooCandles(def.yahoo ?? symbol, YAHOO_SPAN[range], spec.interval);
    const candles = normalizeCandles(raw, spec.bars);
    if (!candles.length) throw new Error('no bars');
    historyCache.set(key, { at: now.getTime(), candles, source: def.class === 'crypto' ? 'binance' : 'yahoo' });
    return { symbol, range, step: spec.interval, source: def.class === 'crypto' ? 'binance' : 'yahoo', mock: false, candles: endOn(candles) };
  } catch {
    if (hit) return { symbol, range, step: spec.interval, source: hit.source, mock: false, candles: endOn(hit.candles) };
    return {
      symbol,
      range,
      step: spec.interval,
      source: 'mock',
      mock: true,
      candles: mockCandles(symbol, live.price, spec.bars, now.getTime(), live.prevClose),
    };
  }
}

export const clearHistoryCache = () => historyCache.clear();
