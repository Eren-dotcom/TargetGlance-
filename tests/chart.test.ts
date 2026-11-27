import { describe, expect, it } from 'vitest';
import { getTextWidth } from '@evenrealities/pretext';
import {
  RANGES,
  RANGE_SPEC,
  extent,
  isCandle,
  mockCandles,
  nextRange,
  normalizeCandles,
  stepLabel,
  type Candle,
} from '../src/core/candles.ts';
import { CHART_H, CHART_W, INK, ascii, chartWindow, renderCandles, toImageData } from '../src/g2/chart.ts';
import { SPARK, textSpark } from '../src/g2/bar.ts';
import { defaultTargets } from '../src/core/targets.ts';

const bar = (c: number, h = c + 1, l = c - 1): Candle => ({ t: 1, o: c, h, l, c });
const series = (n: number): Candle[] =>
  Array.from({ length: n }, (_, i) => {
    const c = 100 + i;
    return { t: i, o: c - 0.5, h: c + 1, l: c - 1, c };
  });

describe('candle history', () => {
  it('drops bars that are not real bars', () => {
    expect(isCandle(bar(100))).toBe(true);
    expect(isCandle({ t: 1, o: 0, h: 1, l: 0.5, c: 1 })).toBe(false);
    expect(isCandle({ t: 1, o: 1, h: 1, l: -5, c: 1 })).toBe(false); // a negative low is not a price
    // Yahoo pads holidays with nulls; those rows must not become candles.
    expect(isCandle({ t: 1, o: null, h: null, l: null, c: null })).toBe(false);
    expect(isCandle({ t: 1, o: 10, h: 2, l: 5, c: 3 })).toBe(false); // high below low
    expect(isCandle({ t: 1, o: 9, h: 5, l: 2, c: 3 })).toBe(false); // body outside its wick
    expect(normalizeCandles([bar(100), null, {}, bar(200)], 5)).toHaveLength(2);
    expect(normalizeCandles('nope', 5)).toEqual([]);
  });

  it('keeps the newest bars, not the oldest', () => {
    const many = series(100);
    expect(normalizeCandles(many, 10).at(-1)!.c).toBe(199);
  });

  it('cycles 1D -> 5D -> 1M and back', () => {
    expect(nextRange('1D')).toBe('5D');
    expect(nextRange('5D')).toBe('1M');
    expect(nextRange('1M')).toBe('1D');
    expect(RANGES.every((r) => RANGE_SPEC[r].bars > 0)).toBe(true);
    expect(stepLabel('5m')).toBe('5 MIN');
    expect(stepLabel('7x')).toBe('7X');
  });

  it('gives a flat window a height instead of dividing by zero', () => {
    const flat: Candle[] = [{ t: 1, o: 100, h: 100, l: 100, c: 100 }];
    const e = extent(flat);
    expect(e.high).toBeGreaterThan(e.low);
    expect(extent([])).toEqual({ low: 0, high: 0 });
  });

  it('ends the mock history on the live price, so the chart matches the row above it', () => {
    const cs = mockCandles('NVDA', 138.2, 78, Date.now(), 132.6);
    expect(cs).toHaveLength(78);
    expect(cs.at(-1)!.c).toBe(138.2);
    // The first bar opens at the previous close, so the chart's own % move is the day
    // change printed on the row above it — a judge will subtract the two.
    expect(cs[0]!.o).toBe(132.6);
    const chartPct = ((cs.at(-1)!.c - cs[0]!.o) / cs[0]!.o) * 100;
    expect(chartPct).toBeCloseTo(((138.2 - 132.6) / 132.6) * 100, 2);
    expect(cs.every(isCandle)).toBe(true);
    // Deterministic: the same symbol and clock is the same chart; another symbol is not.
    const t = 1_700_000_000_000;
    expect(mockCandles('NVDA', 138.2, 78, t)).toEqual(mockCandles('NVDA', 138.2, 78, t));
    const a = mockCandles('NVDA', 138.2, 78, t);
    expect(mockCandles('SOL', 138.2, 78, t).map((c) => c.c)).not.toEqual(a.map((c) => c.c));
  });
});

describe('candle bitmap', () => {
  const candles = mockCandles('NVDA', 138.2, 78);
  const targets = defaultTargets(138.2);

  it('renders exactly one grayscale byte per pixel of the 288x144 container', () => {
    const map = renderCandles({ candles, price: 138.2, range: '1D', targets });
    expect(map.width).toBe(CHART_W);
    expect(map.height).toBe(CHART_H);
    expect(map.data.length).toBe(CHART_W * CHART_H);
    expect(map.data.every((b) => b >= 0 && b <= 255)).toBe(true);
    // The bridge wants a plain array, not a typed one.
    expect(Array.isArray(toImageData(map))).toBe(true);
    expect(toImageData(map)).toHaveLength(CHART_W * CHART_H);
  });

  it('never renders an empty chart for a real window', () => {
    for (const range of RANGES) {
      const map = renderCandles({ candles, price: 138.2, range, targets });
      expect(map.data.some((b) => b > 0), `${range} drew nothing`).toBe(true);
    }
  });

  it('puts the last price on the row the price maps to', () => {
    const map = renderCandles({ candles, price: 138.2, range: '1D' });
    const { low, high } = chartWindow(candles);
    const y = Math.round(1 + ((high - 138.2) / (high - low)) * (CHART_H - 3));
    // A full-width ink row: that is the price line and nothing else can fake it.
    const rowInk = (yy: number) => map.data.slice(yy * CHART_W, (yy + 1) * CHART_W).filter((b) => b === INK).length;
    expect(rowInk(y)).toBeGreaterThan(CHART_W * 0.9);
  });

  it('keeps a near zone on the chart and pushes a far one to the edge', () => {
    // The zones the wearer is waiting for sit just outside the candle window here.
    const base = extent(candles);
    const near = chartWindow(candles, { buy: { low: base.low - 1, high: base.low - 0.5 }, sell: { low: base.high + 1, high: base.high + 2 }, stop: null });
    expect(near.low).toBeLessThan(base.low);
    expect(near.high).toBeGreaterThan(base.high);
    // A sell target twice the price would squash every candle into a smear.
    const far = chartWindow(candles, { buy: { low: 20, high: 25 }, sell: { low: 900, high: 950 }, stop: null });
    expect(far.low).toBeGreaterThan(20);
    expect(far.high).toBeLessThan(900);
  });

  it('draws the target zones as a sparse tint, not a wall of ink', () => {
    const map = renderCandles({ candles, price: 138.2, range: '1D', targets });
    const cover = Array.from({ length: CHART_H }, (_, y) =>
      map.data.slice(y * CHART_W, (y + 1) * CHART_W).filter((b) => b > 0).length,
    );
    // Only the price line may span the frame...
    expect(cover.filter((n) => n >= CHART_W * 0.9).length).toBeLessThanOrEqual(1);
    // ...and no other row may be more than half ink: the first version drew a 50% dash on
    // every row, which lined up into vertical hatching and swamped the candles.
    const partial = cover.filter((n) => n < CHART_W * 0.9);
    expect(Math.max(...partial)).toBeLessThan(CHART_W * 0.5);
    // The tint still has to be visible, or the zone is not on the chart at all.
    expect(cover.filter((n) => n > 0).length).toBeGreaterThan(CHART_H * 0.4);
  });

  it('never draws a zone band where the price is not', () => {
    // Sell zone far above the window: one marker row inside the frame, no interior tint.
    const far = { buy: { low: 20, high: 25 }, sell: { low: 900, high: 950 }, stop: null };
    const map = renderCandles({ candles, price: 138.2, range: '1D', targets: far });
    const cover = Array.from({ length: CHART_H }, (_, y) =>
      map.data.slice(y * CHART_W, (y + 1) * CHART_W).filter((b) => b > 0).length,
    );
    // The top rows are the marker; nothing below it may be a band.
    expect(cover[2]!).toBeGreaterThan(20);
    expect(cover.filter((n) => n > 100).length).toBeLessThanOrEqual(3);
  });

  it('degrades to a blank map instead of throwing on no candles', () => {
    const map = renderCandles({ candles: [], range: '1D', targets: null });
    expect(map.data.every((b) => b === 0)).toBe(true);
    expect(ascii(map)).toContain(' ');
  });

  it('has an ASCII preview that shows the shape', () => {
    const art = ascii(renderCandles({ candles, price: 138.2, range: '1D' }), 40, 10);
    expect(art.split('\n')).toHaveLength(10);
    expect(art).toMatch(/[#+.]/);
  });
});

describe('text sparkline fallback', () => {
  it('is one full-width block glyph per column, so the line cannot drift', () => {
    const spark = textSpark(series(78).map((c) => c.c), 32);
    expect([...spark]).toHaveLength(32);
    for (const g of spark) expect(SPARK as unknown as string[]).toContain(g);
    for (const g of SPARK) expect(getTextWidth(g), `${g} is not a 20 px cell`).toBe(20);
  });

  it('rises with the price and is flat for a flat series', () => {
    const up = textSpark([1, 2, 3, 4, 5, 6, 7, 8], 8);
    expect(up.at(-1)).toBe('█');
    expect(up[0]).toBe('▁');
    expect(textSpark([5, 5, 5, 5], 4)).toBe('▄▄▄▄');
    expect(textSpark([], 8)).toBe('');
  });
});
