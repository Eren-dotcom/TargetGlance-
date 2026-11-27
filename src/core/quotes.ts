/** One quote for one symbol, as the UI and the alert engine see it. */
export interface Quote {
  symbol: string;
  price: number;
  prevClose: number;
  changePct: number;
  source: 'binance' | 'yahoo' | 'mock';
  /** True when the price came from a live source but is older than the staleness window. */
  stale: boolean;
  /** True when no upstream answered and this is the deterministic fallback. */
  mock: boolean;
  /** Judge Mode simulated move, percent. */
  simPct?: number;
  ts: string;
}

export interface Ticker {
  price: number;
  prevClose: number;
  /** Yahoo's own label, when the source has an opinion the clock does not. */
  marketState?: string;
}

export const BINANCE = 'https://api.binance.com/api/v3/ticker/24hr?symbol=';
export const YAHOO = 'https://query1.finance.yahoo.com/v8/finance/chart/';
export const BINANCE_KLINES = 'https://api.binance.com/api/v3/klines?symbol=';

const json = async (url: string) => {
  const r = await fetch(url, { signal: AbortSignal.timeout(4000) });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return (await r.json()) as any;
};

export async function binanceTicker(pair: string): Promise<Ticker> {
  const d = await json(BINANCE + pair);
  const price = Number(d.lastPrice);
  const prevClose = Number(d.prevClosePrice) || price - Number(d.priceChange || 0) || price;
  if (!Number.isFinite(price) || price <= 0) throw new Error('binance: no price');
  return { price, prevClose };
}

/** Yahoo's chart endpoint doubles as a quote endpoint and needs no key. */
export async function yahooTicker(symbol: string): Promise<Ticker> {
  const d = await json(`${YAHOO}${encodeURIComponent(symbol)}?range=1d&interval=5m`);
  const meta = d?.chart?.result?.[0]?.meta;
  const price = Number(meta?.regularMarketPrice);
  const prevClose = Number(meta?.chartPreviousClose ?? meta?.previousClose) || price;
  if (!Number.isFinite(price) || price <= 0) throw new Error('yahoo: no price');
  return { price, prevClose, marketState: meta?.marketState };
}

/** Yahoo's state maps onto our four labels; anything unknown falls back to the clock. */
export function sessionFromMarketState(state?: string): 'LIVE' | 'PRE' | 'AH' | 'CLOSED' | undefined {
  switch ((state ?? '').toUpperCase()) {
    case 'REGULAR':
      return 'LIVE';
    case 'PRE':
    case 'PREPRE':
      return 'PRE';
    case 'POST':
    case 'POSTPOST':
      return 'AH';
    case 'CLOSED':
      return 'CLOSED';
    default:
      return undefined;
  }
}

export function withSim(base: Ticker, pct?: number): Ticker {
  if (!pct) return base;
  const price = round(base.price * (1 + pct / 100));
  return { ...base, price, prevClose: base.prevClose };
}

/** Prices keep the precision a trader reads, not float noise. */
export function round(n: number): number {
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 1 : abs >= 1 ? 2 : 6;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

export interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

/**
 * Bars from Binance klines: `[openTime, open, high, low, close, …]` per row.
 * `soFar` is the rarer cap on rows the vendor is willing to return; `wanted` is what the
 * chart asked for, so the tail is always the part that reaches the newest bar.
 */
export async function binanceKlines(pair: string, interval: string, wanted: number): Promise<Bar[]> {
  const d = await json(`${BINANCE_KLINES}${pair}&interval=${interval}&limit=${wanted}`);
  if (!Array.isArray(d)) throw new Error('binance: no klines');
  return d.map((r: unknown[]) => ({
    t: Number(r[0]),
    o: Number(r[1]),
    h: Number(r[2]),
    l: Number(r[3]),
    c: Number(r[4]),
  }));
}

/** Bars from Yahoo's chart endpoint; `null` entries are the gaps between sessions. */
export async function yahooCandles(symbol: string, range: string, interval: string): Promise<Bar[]> {
  const d = await json(`${YAHOO}${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`);
  const result = d?.chart?.result?.[0];
  const stamps: unknown[] = result?.timestamp ?? [];
  const quote = result?.indicators?.quote?.[0] ?? {};
  const out: Bar[] = [];
  stamps.forEach((t, i) => {
    const bar = {
      t: Number(t) * 1000,
      o: Number(quote.open?.[i]),
      h: Number(quote.high?.[i]),
      l: Number(quote.low?.[i]),
      c: Number(quote.close?.[i]),
    };
    // Yahoo pads holidays and halts with nulls; those rows are not bars.
    if ([bar.o, bar.h, bar.l, bar.c].every((n) => Number.isFinite(n) && n > 0) && bar.h >= bar.l) out.push(bar);
  });
  if (!out.length) throw new Error('yahoo: no bars');
  return out;
}
