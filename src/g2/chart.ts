import { extent, type Candle, type Range } from '../core/candles.ts';
import type { Targets } from '../core/targets.ts';

/**
 * The candle bitmap that goes into the G2 image container.
 *
 * Hardware facts this is built around:
 * - The image container is capped at **288×144** and takes a grayscale byte per pixel
 *   (the SDK LZ4s it on the way out), so this renders 1× and the glass shows it at 576×288.
 * - Text cannot draw a chart: the firmware font is proportional (`█`, `│`, `●` are 20 px but
 *   `▓`, `░`, `▐` are 4 px), so a character-cell grid drifts. Pixels or nothing.
 * - 78 bars over 288 px is under 4 px a bar. That is a shape, not a candlestick you can
 *   measure — which is exactly what a 576×288 heads-up display is for.
 */

export const CHART_W = 288;
export const CHART_H = 144;

/** 0 = black, 255 = ink. Monochrome in spirit: three levels, never a gradient. */
export const INK = 255;
export const SOFT = 96;
export const FAINT = 48;

export interface ChartInput {
  candles: Candle[];
  /** The quote right now; drawn as a ruled line so the grid never lies about "now". */
  price?: number;
  targets?: Targets | null;
  range: Range;
}

export interface ChartMap {
  width: number;
  height: number;
  /** Row-major grayscale, `width * height` bytes. */
  data: Uint8Array;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * Vertical window. A zone the wearer is waiting for belongs on the chart when it is near
 * the price — "how far is my buy zone" is the question a target app exists to answer. A
 * zone far outside stretches the window until the candles are a smear, so it is pinned to
 * the edge instead, and the text legend carries the number.
 */
export function chartWindow(candles: Candle[], targets?: Targets | null): { low: number; high: number } {
  const base = extent(candles);
  if (!targets || !(base.high > base.low)) return base;
  const span = base.high - base.low;
  const reach = span * 0.45;
  const wanted = [targets.buy.low, targets.buy.high, targets.sell.low, targets.sell.high, targets.stop ?? 0].filter(
    (p) => Number.isFinite(p) && p > 0,
  );
  let low = base.low;
  let high = base.high;
  for (const p of wanted) {
    if (p < low && low - p <= reach) low = p;
    if (p > high && p - high <= reach) high = p;
  }
  // Pinning keeps the ink honest: the padding is only worth it when something moved.
  const pad = (high - low) * 0.04;
  return { low: Math.max(0, low - pad), high: high + pad };
}

/**
 * Pure: same candles in, same bytes out. No dates, no fonts, no bridge — so the layout
 * test can measure it and the mirror can show exactly what the glasses get.
 */
export function renderCandles(input: ChartInput): ChartMap {
  const { candles, targets } = input;
  const width = CHART_W;
  const height = CHART_H;
  const data = new Uint8Array(width * height);

  const window = chartWindow(candles, targets);
  const { low, high } = window;
  const span = high - low || 1;
  // Inset by a row top and bottom: a line drawn on the edge is the same ink as the bezel.
  const yOf = (price: number) => clamp(Math.round(1 + ((high - price) / span) * (height - 3)), 1, height - 2);
  const atEdge = (price: number) => price > high || price < low;

  const plot = (x: number, y: number, v: number) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const i = y * width + x;
    if (data[i]! < v) data[i] = v;
  };

  /**
   * A dashed horizontal rule. The phase is an argument because the same dash on every row
   * lines up into vertical hatching, which is how a "dotted band" turns into a solid block
   * of ink and drowns the candles.
   */
  const rule = (y: number, v: number, on = 2, gap = 6, phase = 0) => {
    for (let x = phase; x < width; x += on + gap) for (let d = 0; d < on; d++) plot(x + d, y, v);
  };

  /** A screen-door tint: one pixel per cell, so a zone shades a region without competing. */
  const tint = (top: number, bottom: number, v: number, cell = 4) => {
    for (let y = top; y <= bottom; y += cell)
      for (let x = (y / cell) % 2 === 0 ? 0 : cell / 2; x < width; x += cell) plot(x, y, v);
  };

  // 1. The zones the wearer set, behind the price.
  if (targets) {
    const band = (a: number, b: number) => {
      const high = Math.max(a, b);
      const low = Math.min(a, b);
      const top = yOf(high);
      const bottom = yOf(low);
      // Entirely above or below the window: one marker row at the edge and no interior.
      // A band drawn here would claim the price is somewhere it is not.
      if (high > window.high || low < window.low) {
        // Two rows in from the frame edge: a marker on row 0 reads as the bezel, not ink.
        rule(high > window.high ? 2 : height - 3, INK, 3, 5);
        return;
      }
      if (bottom - top < 1) return rule(top, INK, 3, 5);
      // Interior as a sparse tint, edges as dashed rules: the zone is a region, not a wall.
      tint(top + 1, bottom - 1, FAINT);
      if (!atEdge(high)) rule(top, INK, 3, 5);
      if (!atEdge(low)) rule(bottom, INK, 3, 5, 4);
    };
    band(targets.buy.low, targets.buy.high);
    band(targets.sell.low, targets.sell.high);
    if (targets.stop !== null && targets.stop > 0) {
      // The stop gets the finest line of all: it is a level, not a zone.
      if (targets.stop >= window.low && targets.stop <= window.high) rule(yOf(targets.stop), SOFT, 1, 3);
    }
  }

  // 2. Candles: wick = low..high, body = open..close. Closed down is solid, closed up is
  // hollow, so direction survives a display with one ink colour.
  const step = width / Math.max(1, candles.length);
  const bodyW = Math.max(1, Math.floor(step * 0.6));
  candles.forEach((c, i) => {
    const x = clamp(Math.floor(i * step + step / 2), 0, width - 1);
    const yHigh = yOf(c.h);
    const yLow = yOf(c.l);
    const yTop = yOf(Math.max(c.o, c.c));
    const yBottom = yOf(Math.min(c.o, c.c));
    const x0 = x - Math.floor(bodyW / 2);
    for (let y = yHigh; y <= yLow; y++) plot(x, y, SOFT);
    if (c.c >= c.o) {
      // Hollow: outline the body, wick showing through the middle.
      for (let dx = 0; dx < bodyW; dx++) {
        plot(x0 + dx, yTop, INK);
        plot(x0 + dx, yBottom, INK);
        plot(x0, yTop + Math.floor((yBottom - yTop) / 2), INK);
        plot(x0 + bodyW - 1, yTop + Math.floor((yBottom - yTop) / 2), INK);
      }
    } else {
      for (let dx = 0; dx < bodyW; dx++) for (let y = yTop; y <= yBottom; y++) plot(x0 + dx, y, INK);
    }
  });

  // 3. Last price: a solid full-width line, the one thing the eye finds first.
  if (input.price && input.price > 0) {
    const y = yOf(input.price);
    for (let x = 0; x < width; x++) plot(x, y, INK);
  }

  return { width, height, data };
}

/** The `imageData` shape the bridge takes: plain bytes, not a typed array. */
export const toImageData = (map: ChartMap): number[] => Array.from(map.data);

/** ASCII preview for the browser mirror and the tests: same map, no bridge. */
export function ascii(map: ChartMap, cols = 72, rows = 18): string {
  const out: string[] = [];
  for (let r = 0; r < rows; r++) {
    let line = '';
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor((c * map.width) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((c + 1) * map.width) / cols));
      const y0 = Math.floor((r * map.height) / rows);
      const y1 = Math.max(y0 + 1, Math.floor(((r + 1) * map.height) / rows));
      let peak = 0;
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) peak = Math.max(peak, map.data[y * map.width + x]!);
      line += peak > 200 ? '#' : peak > 80 ? '+' : peak > 20 ? '.' : ' ';
    }
    out.push(line);
  }
  return out.join('\n');
}
