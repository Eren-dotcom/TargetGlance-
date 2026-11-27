import type { AppFrame, Line } from './frame.ts';

/**
 * The G2 draws one text container at one brightness, and the usable steps are coarse
 * (normal and boldest). Hierarchy therefore costs glyphs, not shades: `>` marks the
 * selection, `=` marks a dim value, `══` starts a rule. This is what the hardware really
 * looks like; the browser mirror must not pretend otherwise.
 *
 * Every marker here is length-preserving, because the frame builder has already packed
 * each line to 576 px and one extra character would wrap it.
 */
export const HARDWARE_NOTE =
  'One text container, one brightness. Extra levels need updateImageRawData and are unverified.';

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
