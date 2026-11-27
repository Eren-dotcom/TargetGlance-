const str = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const str1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const str2 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Prices at the precision a trader reads: 97k · 1,284 · 142.50 · 0.3821 */
export function px(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 10_000) return `${Math.round(n / 1000)}k`;
  if (a >= 1000) return str.format(n);
  if (a >= 10) return str2.format(n);
  if (a >= 1) return n.toFixed(2);
  return n.toFixed(4);
}

/** Targets read as `118-122`, not `118.00-122.00`: cents are noise on a target. */
const trim = (s: string) => s.replace(/\.00$/, '');

/** Zones read as one token when tight, a range when wide. */
export function zoneText(low: number, high: number): string {
  return low === high ? trim(px(low)) : `${trim(px(low))}-${trim(px(high))}`;
}

export const signed = (n: number, dp = 1): string =>
  `${n >= 0 ? '+' : '-'}${Math.abs(n).toFixed(dp)}`;

export const money = (n: number): string =>
  `${n < 0 ? '-' : ''}$${str2.format(Math.abs(n))}`;

export const money0 = (n: number): string =>
  `${n < 0 ? '-' : ''}$${str.format(Math.abs(n))}`;

/** One-decimal signed cash: `+$318.0` is longer than `+$318`, so drop the cents. */
export const signedMoney = (n: number): string =>
  `${n < 0 ? '-' : '+'}$${str.format(Math.abs(n))}`;

export const pctText = (n: number): string => `${signed(n)}%`;

/** `●` live · `○` stale · `◌` mock: shape plus a word elsewhere, never colour alone. */
export const freshDot = (q: { stale: boolean; mock: boolean }): string =>
  q.mock ? '◌' : q.stale ? '○' : '●';

export const ago = (tsIso: string, now = Date.now()): string => {
  const s = Math.max(0, Math.round((now - Date.parse(tsIso)) / 1000));
  return s < 2 ? 'now' : s < 60 ? `${s}s` : `${Math.round(s / 60)}m`;
};

/** ASCII caret would be cheaper, but `≥` exists at this weight and reads better. */
export const moveMark = (n: number): string => (n > 0 ? '▲' : n < 0 ? '▼' : '=');
