import { describe, expect, it } from 'vitest';
import { barPct, defaultTargets, point, stepFor, validateTargets, zoneOf } from '../src/core/targets.ts';
import { stockSession, sessionFor } from '../src/core/session.ts';
import { parseTargets } from '../src/core/voice.ts';
import { SYMBOLS } from '../src/core/symbols.ts';

const utc = (s: string) => new Date(s);

describe('range bar', () => {
  const t = { buy: point(120), sell: point(150), stop: null };

  it('clamps below the buy target and above the sell target', () => {
    expect(barPct(t, 100)).toBe(0);
    expect(barPct(t, 120)).toBe(0);
    expect(barPct(t, 150)).toBe(1);
    expect(barPct(t, 400)).toBe(1);
  });

  it('sits in the middle at the midpoint', () => {
    expect(barPct(t, 135)).toBeCloseTo(0.5, 6);
  });

  it('never divides by zero when the zones collapse', () => {
    expect(barPct({ buy: point(100), sell: point(100), stop: null }, 100)).toBe(0);
  });

  it('labels the zones at their edges', () => {
    expect(zoneOf(t, 119.99)).toBe('buy');
    expect(zoneOf(t, 130)).toBeNull();
    expect(zoneOf(t, 150)).toBe('sell');
  });
});

describe('sessions', () => {
  it('reads New York hours, not the local clock', () => {
    // 14:00 UTC in winter is 09:00 New York: pre-market.
    expect(stockSession(utc('2026-01-15T14:00:00Z'))).toBe('PRE');
    // 15:00 UTC = 10:00 EST: open.
    expect(stockSession(utc('2026-01-15T15:00:00Z'))).toBe('LIVE');
    // 21:00 UTC = 16:00 EST: after hours.
    expect(stockSession(utc('2026-01-15T21:00:00Z'))).toBe('AH');
    // 01:00 UTC = 20:00 EST: closed.
    expect(stockSession(utc('2026-01-16T01:00:00Z'))).toBe('CLOSED');
  });

  it('handles the DST shift without a fixed offset', () => {
    // Same wall-clock hour, one in January (EST) and one in July (EDT).
    expect(stockSession(utc('2026-01-15T15:00:00Z'))).toBe('LIVE');
    expect(stockSession(utc('2026-07-15T14:00:00Z'))).toBe('LIVE');
  });

  it('closes on the weekend', () => {
    expect(stockSession(utc('2026-01-17T15:00:00Z'))).toBe('CLOSED');
  });

  it('trades crypto around the clock and honours the judge override', () => {
    expect(sessionFor('crypto', utc('2026-01-17T03:00:00Z'))).toBe('24-7');
    expect(sessionFor('stock', utc('2026-01-17T15:00:00Z'), 'AH')).toBe('AH');
  });
});

describe('target validation', () => {
  it('accepts a sane pair and defaults', () => {
    expect(validateTargets(defaultTargets(100))).toEqual([]);
  });

  it('rejects a buy above a sell', () => {
    expect(validateTargets({ buy: point(160), sell: point(150), stop: null })).toContain('buy must sit below sell');
  });

  it('rejects zero and negative prices', () => {
    expect(validateTargets({ buy: point(0), sell: point(10), stop: null })).toContain('prices must be positive');
  });

  it('rejects a stop above the buy zone and warns about far targets', () => {
    expect(validateTargets({ buy: point(120), sell: point(150), stop: 130 })).toContain('stop must sit below the buy zone');
    expect(validateTargets(defaultTargets(100), 200)).toContain('a target sits more than 30% away');
  });

  it('picks a swipe step a human can read', () => {
    expect(stepFor(138.2)).toBe(1);
    expect(stepFor(97400)).toBe(1000);
    expect(stepFor(0.382)).toBeGreaterThan(0);
  });
});

describe('voice parser', () => {
  const symbols = Object.keys(SYMBOLS);

  it('parses the documented phrases', () => {
    expect(parseTargets('SOL buy 140 sell 180', symbols)).toEqual({
      symbol: 'SOL',
      buy: point(140),
      sell: point(180),
    });
    expect(parseTargets('BTC buy 92k sell 105k', symbols)).toEqual({
      symbol: 'BTC',
      buy: point(92000),
      sell: point(105000),
    });
  });

  it('parses zones and stops', () => {
    const r = parseTargets('NVDA buy 118-122 sell 148 to 152 stop 110', symbols);
    expect(r?.buy).toEqual({ low: 118, high: 122 });
    expect(r?.sell).toEqual({ low: 148, high: 152 });
    expect((r as any).stop).toBe(110);
  });

  it('is case-insensitive and tolerates punctuation and decimals', () => {
    expect(parseTargets('nvda, buy $119.40 sell $151.20', symbols)?.buy).toEqual(point(119.4));
  });

  it('handles a dotted ticker', () => {
    expect(parseTargets('RELIANCE.NS buy 1200 sell 1400', symbols)?.symbol).toBe('RELIANCE.NS');
  });

  it('returns null rather than guessing', () => {
    expect(parseTargets('buy 140 sell 180', symbols)).toBeNull();
    expect(parseTargets('SOL looks strong', symbols)).toBeNull();
    expect(parseTargets('DOGE buy 0.30 sell 0.45', symbols)?.buy).toEqual(point(0.3));
  });
});
