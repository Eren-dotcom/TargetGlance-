import { zoneOf, type Targets } from './targets.ts';

export interface AlertState {
  /** Zone we were last inside, null when price sits between the zones. */
  zone: 'buy' | 'sell' | null;
  lastPrice: number | null;
  lastAlertAt: number | null;
  /** Zone of the last alert: the cooldown is per zone, so a buy→sell crossing is news. */
  lastZone: 'buy' | 'sell' | null;
  snoozedUntil: number | null;
  /** Consecutive polls spent inside the current zone. */
  held: number;
  /** Inside a zone whose alert was suppressed (hold or cooldown) and may still fire. */
  pending: boolean;
}

export type AlertMap = Record<string, AlertState>;

export interface Alert {
  symbol: string;
  zone: 'buy' | 'sell';
  price: number;
  /** Percent move on the day, so the flash can warn about a falling knife. */
  changePct: number;
  at: number;
}

/**
 * Re-alert guard, scoped per zone: crossing-only already stops repeats inside a zone,
 * and a buy→sell crossing is new information, not a repeat.
 */
export const COOLDOWN_MS = 60_000;
export const SNOOZE_MS = 3_600_000;
/** A tick falls out of the buy zone only past this buffer, which kills edge flicker. */
export const HYSTERESIS = 0.0025;
/** Beyond this daily move, one tick is not enough: the price must hold a second poll. */
export const WILD_PCT = 7;
export const MAX_QUEUE = 3;

export const freshAlertState = (): AlertState => ({
  zone: null,
  lastPrice: null,
  lastAlertAt: null,
  lastZone: null,
  snoozedUntil: null,
  held: 0,
  pending: false,
});

export interface PollInput {
  symbol: string;
  price: number;
  changePct: number;
  targets: Targets;
  /** Something to sell: a sell-zone flash on a flat book would be a dud screen. */
  holds: boolean;
  now: number;
  /** Judge Mode trigger: ignores cooldown and snooze so a rehearsal is one tap. */
  force?: boolean;
}

export interface PollResult {
  state: AlertState;
  alert: Alert | null;
}

/**
 * Crossing-only alerting. The single rule that also gives auto-arm for free:
 * buy alerts fire while flat, sell alerts fire while holding. After a paper buy the
 * book holds, so the sell alert is armed by definition — no extra flag to desync.
 */
export function pollAlert(prev: AlertState, i: PollInput): PollResult {
  const raw = zoneOf(i.targets, i.price);
  // Sticky exit: leaving a zone needs a real move past its edge, not a hair.
  const zone =
    prev.zone === 'buy' && raw === null && i.price < i.targets.buy.high * (1 + HYSTERESIS)
      ? 'buy'
      : prev.zone === 'sell' && raw === null && i.price > i.targets.sell.low * (1 - HYSTERESIS)
        ? 'sell'
        : raw;

  if (!zone) return { state: { ...prev, zone: null, lastPrice: i.price, held: 0, pending: false }, alert: null };

  const crossing = zone !== prev.zone;
  // `held` keeps counting inside the zone so a suppressed first tick can still fire on
  // the next poll — that is exactly the falling-knife hold.
  const state: AlertState = crossing
    ? { ...prev, zone, lastPrice: i.price, held: prev.held + 1, pending: true }
    : { ...prev, lastPrice: i.price, held: prev.held + 1 };

  if (!crossing && !state.pending) return { state, alert: null };
  if (!i.force) {
    if (zone === 'sell' && !i.holds) return { state, alert: null };
    if (prev.snoozedUntil && i.now < prev.snoozedUntil) return { state, alert: null };
    if (prev.lastZone === zone && prev.lastAlertAt && i.now - prev.lastAlertAt < COOLDOWN_MS)
      return { state, alert: null };
    const needed = Math.abs(i.changePct) >= WILD_PCT ? 2 : 1;
    if (state.held < needed) return { state, alert: null };
  }

  return {
    state: { ...state, lastAlertAt: i.now, lastZone: zone, pending: false },
    alert: { symbol: i.symbol, zone, price: i.price, changePct: i.changePct, at: i.now },
  };
}

export function snooze(state: AlertState, now: number, ms = SNOOZE_MS): AlertState {
  return { ...state, snoozedUntil: now + ms };
}

/**
 * One flash at a time; the rest wait. A same-symbol repeat replaces the queued one
 * instead of stacking, and the oldest is dropped past the cap.
 */
export function enqueue(queue: Alert[], a: Alert): Alert[] {
  const without = queue.filter((q) => q.symbol !== a.symbol);
  return [...without, a].slice(-MAX_QUEUE);
}

/** Judge Mode "reset" must not leave a stale crossing behind that fires on first poll. */
export function resetAlertStates(): AlertMap {
  return {};
}
