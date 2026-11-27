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
  pollAlert(prev, {
    symbol: 'SOL',
    price,
    changePct: -2,
    targets,
    holds: false,
    rungs: [],
    stop: null,
    now: T0,
    ...extra,
  });

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

  it('arms the zone on a wake-up baseline without announcing a move nobody saw', () => {
    // Price is already inside the buy zone when the glasses wake up.
    const base = step(freshAlertState(), 138, { baseline: true });
    expect(base.alert).toBeNull();
    expect(base.state.zone, 'the baseline must still record the zone').toBe('buy');
    // Sitting there afterwards is not news either.
    expect(step(base.state, 137, { now: T0 + COOLDOWN_MS * 2 }).alert).toBeNull();
    // A real move out and back in is.
    const out = step(base.state, 145, { now: T0 + COOLDOWN_MS * 3 });
    const fresh = step(out.state, 139, { now: T0 + COOLDOWN_MS * 4 });
    expect(fresh.alert?.zone).toBe('buy');
  });

  it('lets a judge simulation fire even on the baseline poll', () => {
    const r = step(freshAlertState(), 138, { baseline: true, force: true });
    expect(r.alert?.zone).toBe('buy');
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

  it('fires once per ladder rung on the way up, never twice for the same rung', () => {
    const held = { holds: true, rungs: [150, 170, 190] };
    const first = step(freshAlertState(), 155, held);
    expect(first.alert).toMatchObject({ zone: 'sell', level: 1, rung: 150 });

    const same = step(first.state, 158, { ...held, now: T0 + 10_000 });
    expect(same.alert).toBeNull();

    const second = step(same.state, 172, { ...held, now: T0 + 20_000 });
    expect(second.alert).toMatchObject({ zone: 'sell', level: 2, rung: 170 });

    // A gap that skips a rung reports the highest one reached.
    const jump = step(freshAlertState(), 250, held);
    expect(jump.alert).toMatchObject({ level: 3, rung: 190 });
  });

  it('never fires a rung while flat, even above every rung', () => {
    const r = step(freshAlertState(), 250, { holds: false, rungs: [150, 170, 190] });
    expect(r.alert?.rung).toBeUndefined();
    expect(r.state.zone).toBe('sell'); // position remembered, so a later buy starts from here
  });

  it('fires a stop before anything else, and stops the lot', () => {
    const r = step(freshAlertState(), 108, { holds: true, held: 4, stop: 110, changePct: -12 });
    expect(r.alert).toMatchObject({ zone: 'sell', stop: true, price: 108 });
    // The same stop does not repeat inside the cooldown.
    const again = step(r.state, 105, { holds: true, held: 4, stop: 110, now: T0 + 5000 });
    expect(again.alert).toBeNull();
  });

  it('never calls a stop when there is nothing to sell', () => {
    // `holds` true with a phantom zero quantity must not flash either.
    expect(step(freshAlertState(), 108, { holds: true, held: 0, stop: 110 }).alert?.stop).toBeUndefined();
    const r = step(freshAlertState(), 108, { holds: false, stop: 110 });
    expect(r.alert?.stop).toBeUndefined();
    expect(r.alert?.zone).toBe('buy'); // still a normal buy-zone hit
  });

  it('resets to a clean map', () => {
    expect(resetAlertStates()).toEqual({});
  });

  it('keeps one flash on screen and drops the oldest past the cap', () => {
    const mk = (symbol: string) => ({ symbol, zone: 'buy' as const, level: 1, price: 1, changePct: 0, at: T0 });
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
