import { SYMBOLS, knownSymbols } from './symbols.ts';
import type { AlertMap, AlertState } from './alerts.ts';
import { freshAlertState } from './alerts.ts';
import { validateTargets } from './targets.ts';
import { START_CASH, type Book, type Trade } from './paper.ts';
import type { Targets, Zone } from './targets.ts';

/**
 * Stored state is a trust boundary twice over: it is written by another page (the
 * companion), kept on disk between runs, and reachable with curl. One bad value used to
 * crash `load()` and leave the glasses blank, so every field is checked on the way in and
 * on the way out. Unknown or broken values fall back to a sane default; they never throw.
 */

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

const zone = (v: unknown): Zone | null => {
  if (typeof v !== 'object' || v === null) return null;
  const { low, high } = v as Record<string, unknown>;
  const a = num(low);
  const b = num(high);
  if (a === null || b === null || a <= 0 || b <= 0) return null;
  return a <= b ? { low: a, high: b } : { low: b, high: a };
};

export function asTargets(v: unknown): Targets | null {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const buy = zone(r.buy);
  const sell = zone(r.sell);
  if (!buy || !sell || buy.low >= sell.low) return null;
  const stop = num(r.stop);
  return { buy, sell, stop: stop !== null && stop > 0 ? stop : null };
}

export function asTargetMap(v: unknown): Record<string, Targets> {
  return Object.fromEntries(
    safeKeys(v).flatMap(([sym, t]) => {
      if (!(sym in SYMBOLS)) return [];
      const clean = asTargets(t);
      return clean ? [[sym, clean] as const] : [];
    }),
  );
}

const qty = (v: unknown): number => {
  const n = num(v);
  return n !== null && n >= 0 ? n : 0;
};

export function asBook(v: unknown): Book {
  const empty: Book = { cash: START_CASH, positions: {} };
  if (typeof v !== 'object' || v === null) return empty;
  const r = v as Record<string, unknown>;
  const cash = num(r.cash);
  const positions: Book['positions'] = {};
  {
    for (const [sym, raw] of safeKeys(r.positions)) {
      if (!(sym in SYMBOLS) || typeof raw !== 'object' || raw === null) continue;
      const p = raw as Record<string, unknown>;
      const held = qty(p.qty);
      if (held <= 0) continue;
      positions[sym] = {
        qty: held,
        avgCost: num(p.avgCost) ?? 0,
        realized: num(p.realized) ?? 0,
      };
    }
  }
  return { cash: cash !== null && cash >= 0 ? cash : START_CASH, positions };
}

const alertState = (v: unknown): AlertState | null => {
  if (typeof v !== 'object' || v === null) return null;
  const r = v as Record<string, unknown>;
  const zoneV = r.zone === 'buy' || r.zone === 'sell' ? r.zone : null;
  return {
    ...freshAlertState(),
    zone: zoneV,
    level: num(r.level) ?? 0,
    lastPrice: num(r.lastPrice),
    lastAlertAt: num(r.lastAlertAt),
    lastKey: typeof r.lastKey === 'string' ? r.lastKey : null,
    snoozedUntil: num(r.snoozedUntil),
    held: num(r.held) ?? 0,
    pending: r.pending === true,
  };
};

export function asAlerts(v: unknown): AlertMap {
  return Object.fromEntries(
    safeKeys(v).flatMap(([sym, s]) => {
      if (!(sym in SYMBOLS)) return [];
      const clean = alertState(s);
      return clean ? [[sym, clean] as const] : [];
    }),
  );
}

export const MAX_TRADES = 10;

export function asTrades(v: unknown): Trade[] {
  if (!Array.isArray(v)) return [];
  return v
    .flatMap((t) => {
      if (typeof t !== 'object' || t === null) return [];
      const r = t as Record<string, unknown>;
      const symbol = typeof r.symbol === 'string' ? r.symbol : '';
      const side = r.side === 'SELL' ? 'SELL' : r.side === 'BUY' ? 'BUY' : null;
      const price = num(r.price);
      const q = num(r.qty);
      const ts = typeof r.ts === 'string' ? r.ts : '';
      if (!(symbol in SYMBOLS) || !side || price === null || q === null) return [];
      const reason = r.reason === 'stop' || r.reason === 'manual' ? r.reason : 'zone';
      return [{ symbol, side, qty: q, price, reason, pnl: num(r.pnl) ?? 0, ts } as Trade];
    })
    .slice(0, MAX_TRADES);
}

/** `__proto__` and friends must never reach an object literal built from user input. */
const FORBIDDEN = new Set(['__proto__', 'constructor', 'prototype']);

/** Keys we would ever store: symbol-like, or the field names inside a symbol's row. */
const KEY_OK = /^[A-Za-z0-9._-]{1,24}$/;

const safeKeys = (v: unknown): [string, unknown][] => {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return [];
  return Object.entries(v as Record<string, unknown>).filter(
    ([k]) => !FORBIDDEN.has(k) && KEY_OK.test(k),
  );
};

/**
 * A watchlist is symbols we know, de-duplicated, capped at the allowlist's own size — which
 * is the real bound. It used to stop at 12, so the Megacap preset, which contains RELIANCE.NS
 * as its twelfth entry, could never be applied whole.
 */
export function asWatchlist(v: unknown, fallback: string[]): string[] {
  if (!Array.isArray(v)) return fallback;
  const clean = [...new Set(knownSymbols(v.filter((s): s is string => typeof s === 'string')))].slice(0, Object.keys(SYMBOLS).length);
  return clean.length ? clean : fallback;
}

/** Depth beyond this is not a shape we write, and parsing it costs the server for nothing. */
export function depthWithin(v: unknown, max = 8): boolean {
  const walk = (x: unknown, d: number): boolean => {
    if (d > max) return false;
    if (Array.isArray(x)) return x.every((i) => walk(i, d + 1));
    if (typeof x === 'object' && x !== null)
      return Object.entries(x as Record<string, unknown>).every(([k, i]) => !FORBIDDEN.has(k) && walk(i, d + 1));
    return true;
  };
  return walk(v, 0);
}

/** Used by the API to reject a bad write instead of storing it. Returns null when valid. */
/**
 * Shape checks alone are not enough: `{"NVDA":{"buy":"nope"}}` is an object, passes, and then
 * makes the app render a row whose zones cannot be drawn. A bad target is rejected at the
 * door with a message that says which symbol and what is wrong.
 */
export function badTargets(value: unknown): string | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return 'targets must be an object';
  for (const [sym, t] of Object.entries(value as Record<string, unknown>)) {
    if (!(sym in SYMBOLS)) continue; // unknown symbols are dropped on read, not an error
    const v = t as Targets;
    const zones = [v?.buy, v?.sell];
    if (!zones.every((z) => z && Number.isFinite(z.low) && Number.isFinite(z.high))) {
      return `${sym}: buy and sell must each have a numeric low and high`;
    }
    if (v.stop !== null && v.stop !== undefined && !Number.isFinite(Number(v.stop))) {
      return `${sym}: stop must be a number or null`;
    }
    const problems = validateTargets(v, undefined);
    if (problems.length) return `${sym}: ${problems[0]}`;
  }
  return null;
}

export function validateWrite(key: string, value: unknown): string | null {
  if (!depthWithin(value)) return 'value is too deeply nested, or contains a forbidden key';
  switch (key) {
    case 'watchlist':
      return Array.isArray(value) && value.length ? null : 'watchlist must be a non-empty array';
    case 'targets':
      return badTargets(value);
    case 'book':
      return typeof value === 'object' && value !== null && num((value as Book).cash) !== null
        ? null
        : 'book needs a numeric cash';
    case 'alerts':
      return typeof value === 'object' && value !== null && !Array.isArray(value) ? null : 'alerts must be an object';
    case 'trades':
      return Array.isArray(value) ? null : 'trades must be an array';
    default:
      return `unknown state key: ${key}`;
  }
}
