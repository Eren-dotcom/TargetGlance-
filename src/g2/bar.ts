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
