import { describe, expect, it } from 'vitest';
import {
  COOLDOWN_MS,
  HYSTERESIS,
  enqueue,
  freshAlertState,
  pollAlert,
  resetAlertStates,
  snooze,
  type AlertState,
  type PollInput,
} from '../src/core/alerts.ts';
import { point, type Targets } from '../src/core/targets.ts';

const targets: Targets = { buy: { low: 135, high: 140 }, sell: { low: 178, high: 182 }, stop: null };
const T0 = 1_700_000_000_000;

const step = (prev: AlertState, price: number, extra: Partial<PollInput> = {}) =>
  pollAlert(prev, { symbol: 'SOL', price, changePct: -2, targets, holds: false, now: T0, ...extra });

describe('alert state machine', () => {
  it('fires once when price crosses into the buy zone', () => {
    const a = step(freshAlertState(), 142);
    expect(a.alert).toBeNull();
    const b = step(a.state, 139);
    expect(b.alert?.zone).toBe('buy');
    expect(b.alert?.price).toBe(139);
  });

  it('stays quiet on every later poll inside the zone', () => {
    const first = step(freshAlertState(), 139);
    const second = step(first.state, 138, { now: T0 + COOLDOWN_MS * 2 });
    const third = step(second.state, 137, { now: T0 + COOLDOWN_MS * 3 });
    expect(second.alert).toBeNull();
    expect(third.alert).toBeNull();
  });

  it('needs a real move out of the zone before it can fire again (hysteresis)', () => {
    const inZone = step(freshAlertState(), 139).state;
    // A hair above the zone edge is not an exit.
    const hair = step(inZone, 140 * (1 + HYSTERESIS / 2), { now: T0 + COOLDOWN_MS * 2 });
    expect(hair.state.zone).toBe('buy');
    expect(hair.alert).toBeNull();
    // A clean exit, then a fresh crossing, does fire again.
    const out = step(hair.state, 145, { now: T0 + COOLDOWN_MS * 3 });
    expect(out.state.zone).toBeNull();
    const again = step(out.state, 139, { now: T0 + COOLDOWN_MS * 4 });
    expect(again.alert?.zone).toBe('buy');
  });

  it('enforces the 60 s cooldown across crossings', () => {
    const a = step(freshAlertState(), 139);
    const out = step(a.state, 150, { now: T0 + 10_000 });
    const back = step(out.state, 138, { now: T0 + 20_000 });
    expect(back.alert).toBeNull();
  });

  it('never alerts a sell zone on a flat book', () => {
    const a = step(freshAlertState(), 180, { holds: false });
    expect(a.alert).toBeNull();
    // The zone is still recorded, so a paper buy right after does not fake a crossing.
    expect(a.state.zone).toBe('sell');
  });

  it('waits for a second poll after a wild tick', () => {
    const wild = { changePct: -9.4 };
    const first = step(freshAlertState(), 139, wild);
    expect(first.alert).toBeNull();
    const second = step(first.state, 138, { ...wild, now: T0 + 5000 });
    expect(second.alert?.zone).toBe('buy');
  });

  it('respects snooze and lets the judge trigger ignore it', () => {
    const s = snooze(freshAlertState(), T0);
    expect(step(s, 139, { now: T0 + 1000 }).alert).toBeNull();
    expect(step(s, 139, { now: T0 + 1000, force: true }).alert?.zone).toBe('buy');
  });

  it('resets to a clean map', () => {
    expect(resetAlertStates()).toEqual({});
  });

  it('keeps one flash on screen and drops the oldest past the cap', () => {
    const mk = (symbol: string) => ({ symbol, zone: 'buy' as const, price: 1, changePct: 0, at: T0 });
    let q = enqueue([], mk('A'));
    q = enqueue(q, mk('B'));
    q = enqueue(q, mk('C'));
    q = enqueue(q, mk('D'));
    expect(q.map((a) => a.symbol)).toEqual(['B', 'C', 'D']);
    // A repeat for the same symbol replaces rather than stacks.
    q = enqueue(q, mk('C'));
    expect(q.map((a) => a.symbol)).toEqual(['B', 'D', 'C']);
  });
});
