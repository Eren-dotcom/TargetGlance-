import { describe, expect, it } from 'vitest';
import { asAlerts, asBook, asTargetMap, asTrades, asWatchlist, badTargets, validateWrite } from '../src/core/state.ts';
import { PRESETS } from '../src/core/symbols.ts';
import { START_CASH } from '../src/core/paper.ts';

/**
 * Stored state is written by another page and reachable with curl, so every field is a
 * trust boundary. Nothing here may throw: a bad value falls back, it never blanks the glasses.
 */
describe('state hardening', () => {
  const junk: unknown[] = [null, undefined, 0, 'x', [], {}, [{ a: 1 }], true, NaN, { positions: 'no' }];

  it('never throws on junk, for any field', () => {
    for (const v of junk) {
      expect(() => asTargetMap(v)).not.toThrow();
      expect(() => asBook(v)).not.toThrow();
      expect(() => asAlerts(v)).not.toThrow();
      expect(() => asTrades(v)).not.toThrow();
      expect(() => asWatchlist(v, ['NVDA'])).not.toThrow();
    }
  });

  it('drops targets that are unusable instead of trusting them', () => {
    expect(asTargetMap({ NVDA: { buy: { low: 120, high: 118 }, sell: { low: 150, high: 160 } } }).NVDA!.buy).toEqual({
      low: 118,
      high: 120,
    });
    expect(asTargetMap({ NVDA: { buy: 'high', sell: 1 } })).toEqual({});
    expect(asTargetMap({ NVDA: { buy: { low: 0, high: 5 }, sell: { low: 9, high: 10 } } })).toEqual({});
    // buy at or above sell cannot be a real pair.
    expect(asTargetMap({ NVDA: { buy: { low: 150, high: 160 }, sell: { low: 150, high: 160 } } })).toEqual({});
    // unknown symbols never enter the book.
    expect(asTargetMap({ DOGE2: { buy: { low: 1, high: 2 }, sell: { low: 3, high: 4 } } })).toEqual({});
  });

  it('refuses a negative cash balance or a negative position', () => {
    const book = asBook({ cash: -500, positions: { NVDA: { qty: -4, avgCost: 100 }, SOL: { qty: 2, avgCost: 140 } } });
    expect(book.cash).toBe(START_CASH);
    expect(Object.keys(book.positions)).toEqual(['SOL']);
  });

  it('keeps only well-formed trades and caps the journal', () => {
    const good = { symbol: 'NVDA', side: 'BUY', qty: 4, price: 119.4, reason: 'zone', pnl: 0, ts: 'x' };
    expect(asTrades([good, { symbol: 'ZZZ', side: 'BUY', qty: 1, price: 1, ts: 'x' }, { side: 'BUY' }, 5])).toHaveLength(1);
    expect(asTrades(Array(50).fill(good))).toHaveLength(10);
    // A side that is not BUY/SELL is not a trade.
    expect(asTrades([{ ...good, side: 'SHORT' }])).toHaveLength(0);
  });

  it('de-duplicates and caps the watchlist, falling back when empty', () => {
    expect(asWatchlist(['nvda', 'NVDA', 'SOL', 'NOPE'], [])).toEqual(['NVDA', 'SOL']);
    expect(asWatchlist([], ['BTC'])).toEqual(['BTC']);
    expect(asWatchlist('not-an-array', ['BTC'])).toEqual(['BTC']);
    expect(asWatchlist(Array(20).fill('NVDA'), [])).toEqual(['NVDA']);
  });

  it('repairs a half-written alert row instead of dropping the symbol', () => {
    const alerts = asAlerts({ NVDA: { zone: 'buy', held: 'lots', lastPrice: 1 }, SOL: { zone: 'sideways' } });
    expect(alerts.NVDA!.zone).toBe('buy');
    expect(alerts.NVDA!.held).toBe(0);
    expect(alerts.SOL!.zone).toBeNull();
  });

  it('rejects writes that would only move the crash into the app', () => {
    expect(validateWrite('watchlist', [])).toBeTruthy();
    expect(validateWrite('watchlist', 'NVDA')).toBeTruthy();
    expect(validateWrite('book', { cash: 'lots' })).toBeTruthy();
    expect(validateWrite('trades', {})).toBeTruthy();
    expect(validateWrite('targets', [])).toBeTruthy();
    expect(validateWrite('watchlist', ['NVDA'])).toBeNull();
    expect(validateWrite('book', { cash: 100, positions: {} })).toBeNull();
    expect(validateWrite('nope', 1)).toContain('unknown');
  });

  it('accepts every preset whole, including the twelfth symbol', () => {
    // The watchlist used to cap at 12 and the Megacap preset ends with RELIANCE.NS, so the
    // preset could never be applied as listed.
    for (const [name, symbols] of Object.entries(PRESETS)) {
      expect(asWatchlist(symbols, []), name).toEqual(symbols);
    }
    expect(asWatchlist(['NVDA', 'NVDA', 'SOL'], [])).toEqual(['NVDA', 'SOL']);
  });

  it('refuses a target that is the right shape and the wrong content', () => {
    // An object with a broken zone passes a typeof check and then renders a row nobody can draw.
    expect(badTargets({ NVDA: { buy: 'nope' } })).toContain('NVDA');
    expect(badTargets({ NVDA: { buy: { low: 1, high: 2 } } })).toContain('sell');
    expect(badTargets({ NVDA: { buy: { low: 150, high: 160 }, sell: { low: 100, high: 120 }, stop: null } })).toContain(
      'buy must sit below sell',
    );
    expect(badTargets({ NVDA: { buy: { low: 90, high: 95 }, sell: { low: 140, high: 150 }, stop: 'x' } })).toContain('stop');
    expect(badTargets({ NVDA: { buy: { low: 90, high: 95 }, sell: { low: 140, high: 150 }, stop: null } })).toBeNull();
    // Unknown symbols are dropped on read, so they are not an error here.
    expect(badTargets({ EVIL: 42 })).toBeNull();
    expect(validateWrite('targets', { NVDA: { buy: 'nope' } })).toContain('NVDA');
  });
});
