export interface Zone {
  low: number;
  high: number;
}

export interface Targets {
  buy: Zone;
  sell: Zone;
  /** Paper-only invalidation price. */
  stop: number | null;
}

export const point = (v: number): Zone => ({ low: v, high: v });
export const mid = (z: Zone): number => (z.low + z.high) / 2;
export const pctOff = (zone: Zone, price: number): number => {
  const m = mid(zone);
  return m > 0 ? ((price - m) / m) * 100 : 0;
};

export function validateTargets(t: Targets, price?: number): string[] {
  const p: string[] = [];
  if (!(t.buy.low > 0) || !(t.buy.high > 0) || !(t.sell.low > 0) || !(t.sell.high > 0))
    p.push('prices must be positive');
  if (t.buy.high < t.buy.low) p.push('buy zone is inverted');
  if (t.sell.high < t.sell.low) p.push('sell zone is inverted');
  if (t.buy.high >= t.sell.low) p.push('buy must sit below sell');
  if (t.stop !== null && t.stop >= t.buy.low) p.push('stop must sit below the buy zone');
  if (price && price > 0) {
    const far = [t.buy.high, t.sell.low].some((v) => Math.abs(pctOff(point(v), price)) > 30);
    if (far) p.push('a target sits more than 30% away');
  }
  return p;
}

/** Swipe step for the editor: ~1% of price, snapped to something a human can read. */
export function stepFor(price: number): number {
  const raw = price * 0.01;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = Math.max(mag, Math.round(raw / mag) * mag);
  return Number(step.toPrecision(2));
}

export function nudge(z: Zone, by: number): Zone {
  return { low: roundMoney(z.low + by), high: roundMoney(z.high + by) };
}

export const roundMoney = (n: number): number => Math.round(n * 100) / 100;

export function quickSets(price: number): { buy: Zone; sell: Zone } {
  const at = (pct: number) => roundMoney(price * (1 + pct / 100));
  return { buy: { low: at(-6), high: at(-4) }, sell: { low: at(4), high: at(6) } };
}

/** Default zones: buy a little under price, sell a little above. */
export function defaultTargets(price: number): Targets {
  const { buy, sell } = quickSets(price);
  return { buy, sell, stop: roundMoney(price * 0.9) };
}

export const zoneOf = (t: Targets, price: number): 'buy' | 'sell' | null =>
  price <= t.buy.high ? 'buy' : price >= t.sell.low ? 'sell' : null;

/** 0 = at the buy target, 1 = at the sell target, clamped outside. */
export function barPct(t: Targets, price: number): number {
  const a = t.buy.high;
  const b = t.sell.low;
  if (b <= a) return 0;
  return Math.min(1, Math.max(0, (price - a) / (b - a)));
}
