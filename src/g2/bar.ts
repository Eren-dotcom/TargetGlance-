/** Glyph-safe drawing for the G2 font. `●` and `─` measure a hard 20 px each (pretext). */
export const CELL = 20;
export const RULE = '─';
export const KNOB = '●';
/** Position between buy and sell: a hollow dot, so it stacks with a filled rung. */
export const TRACK = '○';
/** Filled dot marks a ladder rung the price has reached; `○` is still ahead. */
export const TAKEN = '●';
export const AHEAD = '○';

/**
 * `──────●──` price position between the buy zone (left) and the sell zone (right).
 * `cells` wide including the knob; below the range the knob sits in the first cell,
 * above it in the last.
 */
export function bar(pct: number, cells = 8): string {
  const n = Math.max(2, cells);
  const idx = Math.min(n - 1, Math.max(0, Math.round(pct * (n - 1))));
  return RULE.repeat(idx) + KNOB + RULE.repeat(n - 1 - idx);
}

/**
 * Take-profit rungs under the price: `│││` reaching further right as each target is
 * passed. One cell per rung, so the row width never depends on the count.
 */
export function rungMarks(reached: number, total: number): string {
  return Array.from({ length: Math.max(1, total) }, (_, i) => (i < reached ? TAKEN : AHEAD)).join('');
}

/** Block glyphs for the text sparkline: 8 levels, all a hard 20 px in the G2 font. */
export const SPARK = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'] as const;

/**
 * A chart you can read with a font that only has full-width blocks. Each column is the
 * close of one bucket, quantised into eight steps between the window low and high — a
 * shape, honest about being coarse. The bitmap in the image container is the real chart;
 * this is the fallback that still fits a 576 px line.
 */
export function textSpark(closes: number[], cols = 32): string {
  const values = closes.filter((n) => Number.isFinite(n));
  if (!values.length) return '';
  const n = Math.max(1, Math.min(cols, values.length));
  const buckets = Array.from({ length: n }, (_, i) => {
    const from = Math.floor((i * values.length) / n);
    const to = Math.max(from + 1, Math.floor(((i + 1) * values.length) / n));
    return values.slice(from, to).at(-1)!;
  });
  const low = Math.min(...buckets);
  const high = Math.max(...buckets);
  if (!(high > low)) return SPARK[3]!.repeat(n);
  return buckets.map((v) => SPARK[Math.min(7, Math.max(0, Math.round(((v - low) / (high - low)) * 7)))]).join('');
}
