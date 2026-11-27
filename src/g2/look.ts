import type { AppFrame, Line } from './frame.ts';

/**
 * The G2 draws one text container at one brightness, but the container's brightness can be
 * raised — so hierarchy is a glyph choice plus one bold step for the row that needs you:
 * `>` marks the selection, `·` marks a secondary line, `══` starts a rule.
 *
 * Every marker here is length-preserving, because the frame builder has already packed
 * each line to 576 px and one extra character would wrap it.
 */
export const HARDWARE_NOTE =
  'One container, one brightness. Bold is the only usable emphasis; more levels need updateImageRawData.';

/** Step 4 renders visibly bolder than the default; 1 and 3 are unverified on glass. */
export const BOLD = 4;
export const NORMAL = 2;

/** A frame that needs the wearer's attention: a flash, or a row sitting in a zone. */
export function looksUrgent(frame: AppFrame): boolean {
  return frame.lines.some((l) => /ZONE HIT|STOP HIT|NOW$/.test(l.text.trim()));
}

/**
 * A space is 5 px and `·` is exactly 5 px, so this marker costs nothing. Anything wider
 * (`=`, `═`, `>`) would push an already-full line past 576 and wrap it.
 */
export const DIM = '·';

const convert = (l: Line): Line => {
  const secondary = l.level === 1 || l.rule;
  return { ...l, text: secondary ? l.text.replace(/^ /, DIM) : l.text, level: 4 };
};

/** Collapse the five render levels onto what the firmware can actually show. */
export function hardwareFrame(frame: AppFrame): AppFrame {
  const lines = frame.lines.map(convert);
  return { lines, text: lines.map((l) => l.text).join('\n') };
}
