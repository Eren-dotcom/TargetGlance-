/** Glyph-safe drawing for the G2 font. `●` and `─` measure a hard 20 px each (pretext). */
export const CELL = 20;
export const RULE = '─';
export const KNOB = '●';

/**
 * `BUY 118──────●──148 SELL` style bar, `dots` cells wide including the knob.
 * Below the range the knob sits in the first cell, above it in the last.
 */
export function bar(pct: number, dots = 8): string {
  const n = Math.max(2, dots);
  const idx = Math.min(n - 1, Math.max(0, Math.round(pct * (n - 1))));
  return RULE.repeat(idx) + KNOB + RULE.repeat(n - 1 - idx);
}
