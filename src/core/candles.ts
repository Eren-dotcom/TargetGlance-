/**
 * OHLC history for the detail view. A quote is a point; a chart is the shape around it,
 * and the shape is what tells you whether your buy zone is realistic.
 *
 * No key, no vendor: Yahoo's chart endpoint already returns the bars it draws, and
 * Binance klines are public. Both are the same hosts the quotes already use.
 */
export type Range = '1D' | '5D' | '1M';

export interface Candle {
  /** Bar open time, ms. */
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
}

export interface History {
  symbol: string;
  range: Range;
  /** Interval label the source actually returned: `5m`, `1h`, `1d`. */
  step: string;
  candles: Candle[];
  source: 'binance' | 'coinbase' | 'yahoo' | 'mock';
  mock: boolean;
}

export const RANGES: Range[] = ['1D', '5D', '1M'];

/** Bars per range, chosen so one G2 pixel column is still one bar at the widest. */
export const RANGE_SPEC: Record<Range, { interval: string; bars: number }> = {
  '1D': { interval: '5m', bars: 78 },
  '5D': { interval: '30m', bars: 65 },
  '1M': { interval: '1d', bars: 22 },
};

const STEP_LABEL: Record<string, string> = { '5m': '5 MIN', '30m': '30 MIN', '1d': '1 DAY' };
export const stepLabel = (step: string): string => STEP_LABEL[step] ?? step.toUpperCase();

export const nextRange = (r: Range): Range => RANGES[(RANGES.indexOf(r) + 1) % RANGES.length]!;

/** A bar is only worth drawing if it is finite and internally consistent. */
export const isCandle = (c: unknown): c is Candle => {
  const b = c as Candle;
  return (
    !!b &&
    [b.t, b.o, b.h, b.l, b.c].every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    b.o > 0 &&
    b.c > 0 &&
    b.l > 0 &&
    b.h >= b.l &&
    // The body has to sit inside its own wick, or the chart draws a candle that could
    // never have traded.
    b.o >= b.l &&
    b.o <= b.h &&
    b.c >= b.l &&
    b.c <= b.h
  );
};

/** Keep the tail: the newest bars are the ones the price is standing on. */
export function normalizeCandles(raw: unknown, limit: number): Candle[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isCandle).slice(-limit);
}

/** Low/high of the window, padded so the extreme wicks never touch the frame edge. */
export function extent(candles: Candle[]): { low: number; high: number } {
  if (!candles.length) return { low: 0, high: 0 };
  let low = Infinity;
  let high = -Infinity;
  for (const c of candles) {
    if (c.l < low) low = c.l;
    if (c.h > high) high = c.h;
  }
  if (!(low > 0) || !(high > low)) {
    // A perfectly flat window still needs a height, or every bar divides by zero.
    const pad = Math.max(low * 0.005, 0.01);
    return { low: low - pad, high: low + pad };
  }
  const pad = (high - low) * 0.06;
  return { low: Math.max(0, low - pad), high: high + pad };
}

/**
 * Deterministic history for the demo. Two ends are pinned: the first bar opens at the
 * previous close and the last bar closes on the live price, so the chart's own % move is
 * the day change printed on the row above it. A pure random walk drifts far enough that a
 * 1D window looks like a five-day trend, so the walk is bridged between the two ends.
 */
export function mockCandles(symbol: string, last: number, bars: number, now = Date.now(), prevClose?: number): Candle[] {
  let seed = 2166136261;
  for (let i = 0; i < symbol.length; i++) seed = Math.imul(seed ^ symbol.charCodeAt(i), 16777619);
  const rnd = () => {
    seed = Math.imul(seed ^ (seed >>> 15), 2246822507);
    seed = Math.imul(seed ^ (seed >>> 13), 3266489909);
    return ((seed >>> 0) % 10_000) / 10_000;
  };
  const start = prevClose && prevClose > 0 && last > 0 ? prevClose : last;
  const n = Math.max(2, bars);
  // Mean-reverting noise, then a geometric bridge so bar 0 is `start` and bar n-1 is `last`.
  const noise: number[] = [0];
  let drift = 0;
  for (let i = 1; i < n; i++) {
    drift = drift * 0.82 + (rnd() - 0.5) * 0.004;
    noise.push((noise[i - 1] ?? 0) + drift);
  }
  const total = noise[n - 1] ?? 0;
  // The correction is spread linearly and multiplied in log space: both ends land exactly.
  const need = start > 0 ? last / start : 1;
  const closes = noise.map((cum, i) => {
    const t = i / (n - 1);
    const walked = start * (1 + cum - total * t);
    const bridge = need > 0 ? Math.exp(Math.log(need) * t) : 1;
    return Math.max(walked * bridge, start * 0.5);
  });
  closes[n - 1] = last;
  return closes.map((c, i) => {
    const o = i === 0 ? start : closes[i - 1]!;
    const wick = Math.abs(c - o) * 0.6 + c * 0.0015;
    return {
      t: now - (n - i) * 5 * 60_000,
      o: round(o),
      h: round(Math.max(o, c) + wick * rnd()),
      l: round(Math.min(o, c) - wick * rnd()),
      c: round(c),
    };
  });
}

const round = (n: number): number => {
  const abs = Math.abs(n);
  const dp = abs >= 1000 ? 1 : abs >= 1 ? 2 : 6;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/** Which candles sit inside a zone, for the legend: what the chart says about the targets. */
export const zoneHits = (candles: Candle[], low: number, high: number): number =>
  candles.filter((c) => c.l <= high && c.h >= low).length;
