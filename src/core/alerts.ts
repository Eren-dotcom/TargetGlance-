import type { Targets } from './targets.ts';

export interface AlertState {
  /** Zone we were last inside, null when price sits between the zones. */
  zone: 'buy' | 'sell' | null;
  /** Rung inside the current zone: 1 for the buy zone, 1..3 for the take-profit ladder. */
  level: number;
  lastPrice: number | null;
  lastAlertAt: number | null;
  /** `zone` + `level` of the last alert: the cooldown is per rung, so a new rung is news. */
  lastKey: string | null;
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
  level: number;
  price: number;
  /** Percent move on the day, so the flash can warn about a falling knife. */
  changePct: number;
  /** Take-profit rung this sell alert came from, if any. */
  rung?: number;
  /** Last rung reached: the remainder is the trade, not another third. */
  final?: boolean;
  /** Stop zone breach on a paper position. */
  stop?: boolean;
  at: number;
}

/**
 * Re-alert guard, scoped per rung: crossing-only already stops repeats inside a zone,
 * and buy→sell or rung→rung is new information, not a repeat.
 */
export const COOLDOWN_MS = 60_000;
export const SNOOZE_MS = 3_600_000;
/** A tick leaves a zone only past this buffer, which kills edge flicker. */
export const HYSTERESIS = 0.0025;
/** Beyond this daily move, one tick is not enough: the price must hold a second poll. */
export const WILD_PCT = 7;
export const MAX_QUEUE = 3;

export const freshAlertState = (): AlertState => ({
  zone: null,
  level: 0,
  lastPrice: null,
  lastAlertAt: null,
  lastKey: null,
  snoozedUntil: null,
  held: 0,
  pending: false,
});

export interface PollInput {
  symbol: string;
  price: number;
  changePct: number;
  targets: Targets;
  /** Ladder prices above average cost; empty when flat. */
  rungs: number[];
  /** Invalidation price of the open paper position, if one is armed. */
  stop: number | null;
  /** Something to sell: a sell-zone flash on a flat book would be a dud screen. */
  holds: boolean;
  /** Quantity held, so a flash can never plan a sale of zero. */
  held?: number;
  now: number;
  /** Judge Mode trigger: ignores cooldown and snooze so a rehearsal is one tap. */
  force?: boolean;
  /**
   * First poll after a wake-up: record where each price is, announce nothing. A price that is
   * already inside a zone has been there a while, and a confirm button for a move the wearer
   * never saw is a phantom trade waiting to happen.
   */
  baseline?: boolean;
}

export interface PollResult {
  state: AlertState;
  alert: Alert | null;
}

/** Which rung (1-based) the price has reached; 0 when below all of them. */
export function rungLevel(rungs: number[], price: number): number {
  let level = 0;
  rungs.forEach((at, i) => {
    if (price >= at) level = i + 1;
  });
  return level;
}

/**
 * Crossing-only alerting. The rule that also gives auto-arm for free: buy alerts fire
 * while flat, sell alerts fire while holding — after a paper buy the book holds, so the
 * sell side is armed by definition. Stops are checked before zones, because getting out
 * of a broken paper position is never the moment to be clever about targets.
 */
export function pollAlert(prev: AlertState, i: PollInput): PollResult {
  if (i.holds && (i.held ?? 0) > 0 && i.stop !== null && i.price <= i.stop) {
    const key = 'stop';
    const state: AlertState = { ...prev, zone: prev.zone, lastPrice: i.price, held: prev.held + 1 };
    const suppressed =
      !i.force &&
      ((prev.lastKey === key && prev.lastAlertAt && i.now - prev.lastAlertAt < COOLDOWN_MS) ||
        (prev.snoozedUntil !== null && i.now < prev.snoozedUntil));
    if (suppressed) return { state, alert: null };
    return {
      state: { ...state, lastKey: key, lastAlertAt: i.now, pending: false },
      alert: { symbol: i.symbol, zone: 'sell', level: 0, price: i.price, changePct: i.changePct, stop: true, at: i.now },
    };
  }

  // While holding, the ladder is the sell side, and its first rung is the edge. A ladder
  // that does not exist yet (just bought, cost unknown) falls back to the user's zone.
  const sellEdge = i.holds && i.rungs.length >= 2 ? i.rungs[0]! : i.targets.sell.low;
  const raw = i.price <= i.targets.buy.high ? 'buy' : i.price >= sellEdge ? 'sell' : null;
  // Sticky exit: leaving a zone needs a real move past its edge, not a hair.
  const zone =
    prev.zone === 'buy' && raw === null && i.price < i.targets.buy.high * (1 + HYSTERESIS)
      ? 'buy'
      : prev.zone === 'sell' && raw === null && i.price > sellEdge * (1 - HYSTERESIS)
        ? 'sell'
        : raw;

  if (!zone) {
    return { state: { ...prev, zone: null, level: 0, lastPrice: i.price, held: 0, pending: false }, alert: null };
  }

  const level = zone === 'buy' ? 1 : Math.max(1, rungLevel(i.rungs, i.price));
  const triggered = zone !== prev.zone || level > prev.level;
  const key = `${zone}${level}`;
  // `held` keeps counting inside the zone so a suppressed first tick can still fire on
  // the next poll — that is exactly the falling-knife hold.
  const state: AlertState = { ...prev, zone, level, lastPrice: i.price, held: prev.held + 1, pending: true };

  // A wake-up baseline arms the zone without claiming an alert on it, so the next real move
  // (or the judge's deliberate one) is still news.
  if (i.baseline && !i.force) {
    return { state: { ...state, pending: false }, alert: null };
  }

  // Nothing new at this rung, and nothing was suppressed earlier either: stay quiet. A judge
  // simulation is an instruction, not a tick, so it bypasses the crossing gate once per rung.
  const forced = Boolean(i.force) && prev.lastKey !== key;
  if (!triggered && !prev.pending && !forced) return { state: { ...state, pending: false }, alert: null };

  if (!i.force) {
    if (zone === 'sell' && !i.holds) return { state, alert: null };
    if (prev.snoozedUntil !== null && i.now < prev.snoozedUntil) return { state, alert: null };
    if (prev.lastKey === key && prev.lastAlertAt && i.now - prev.lastAlertAt < COOLDOWN_MS)
      return { state, alert: null };
    const needed = Math.abs(i.changePct) >= WILD_PCT ? 2 : 1;
    if (state.held < needed) return { state, alert: null };
  }

  const rung = zone === 'sell' ? i.rungs[level - 1] : undefined;
  return {
    state: { ...state, lastAlertAt: i.now, lastKey: `${zone}${level}`, pending: false },
    alert: {
      symbol: i.symbol,
      zone,
      level,
      price: i.price,
      changePct: i.changePct,
      ...(rung !== undefined ? { rung } : {}),
      ...(zone === 'sell' && i.holds && level >= i.rungs.length ? { final: true } : {}),
      at: i.now,
    },
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
export const resetAlertStates = (): AlertMap => ({});
