/**
 * One place that decides how a number looks. The glasses, the companion and the tests all
 * read from here, so a price cannot be `97k` in one screen and `97400` in the next.
 */
const whole = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const cents = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Prices at the precision a trader reads: 97k · 1,284 · 142.50 · 0.3821 */
export function px(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 10_000) return `${Math.round(n / 1000)}k`;
  if (a >= 1000) return whole.format(n);
  if (a >= 10) return cents.format(n);
  if (a >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

/** Compact price for a table cell: `18.30` keeps its cents, a big number does not. */
export function fmt(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1000) return whole.format(n);
  if (a >= 0.01) return cents.format(n);
  return n.toPrecision(3).replace(/0+$/, '').replace(/\.$/, '');
}

/** Targets read as `118-122`, not `118.00-122.00`: cents are noise on a target. */
const trim = (s: string) => s.replace(/\.00$/, '');

/** Zones read as one token when tight, a range when wide. */
export function zoneText(low: number, high: number): string {
  return low === high ? trim(px(low)) : `${trim(px(low))}-${trim(px(high))}`;
}

export const signed = (n: number, dp = 1): string => `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(dp)}`;

export const money = (n: number): string => `${n < 0 ? '-' : ''}$${cents.format(Math.abs(n))}`;

export const money0 = (n: number): string => `${n < 0 ? '-' : ''}$${whole.format(Math.abs(n))}`;

/** Signed cash without cents: `+$318` fits a row that `+$318.00` would push out. */
export const signedMoney = (n: number): string => `${n < 0 ? '-' : '+'}$${whole.format(Math.abs(n))}`;

export const pctText = (n: number): string => `${signed(n)}%`;

/** `●` live · `○` stale · `◌` mock: shape plus a word elsewhere, never colour alone. */
export const freshDot = (q: { stale: boolean; mock: boolean }): string =>
  q.mock ? '◌' : q.stale ? '○' : '●';

export const ago = (tsIso: string, now = Date.now()): string => {
  const s = Math.max(0, Math.round((now - Date.parse(tsIso)) / 1000));
  return s < 2 ? 'now' : s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
};

export const moveMark = (n: number): string => (n > 0 ? '▲' : n < 0 ? '▼' : '=');
