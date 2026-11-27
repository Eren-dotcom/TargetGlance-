import { describe, expect, it } from 'vitest';
import {
  START_CASH,
  buy,
  canAfford,
  emptyBook,
  equity,
  fmtQty,
  realizedTotal,
  sell,
  sizeQty,
  unrealized,
  ladderFor,
  LADDER_SHARE,
  trancheQty,
} from '../src/core/paper.ts';

const now = new Date('2026-11-27T12:00:00Z');

describe('position sizing', () => {
  it('takes 5% of cash, whole shares for stocks', () => {
    expect(sizeQty('NVDA', 10_000, 119.4)).toBe(4); // 500 / 119.4 = 4.18 -> 4
    expect(sizeQty('NVDA', 100, 119.4)).toBe(0);
  });

  it('allows fractions for crypto, still capped by the 5% budget', () => {
    expect(sizeQty('SOL', 10_000, 142.5)).toBeCloseTo(3.508771, 6);
    expect(sizeQty('BTC', 10_000, 97_400)).toBeCloseTo(0.005133, 6);
    expect(sizeQty('SOL', 10_000, 142.5) * 142.5).toBeLessThanOrEqual(500);
  });

  it('refuses a zero price instead of dividing by it', () => {
    expect(sizeQty('SOL', 10_000, 0)).toBe(0);
  });

  it('never sizes an order the cash cannot cover', () => {
    // 5% of $1000 is $50: less than one $119 share, so the correct answer is zero shares.
    expect(sizeQty('NVDA', 1000, 119.4)).toBe(0);
    expect(canAfford('NVDA', 0, 119.4, emptyBook(1000))).toBe(false);
    expect(canAfford('NVDA', 4, 119.4, emptyBook(10_000))).toBe(true);
  });
});

describe('paper book', () => {
  it('buys at cost and averages a second lot', () => {
    let book = emptyBook();
    book = buy(book, 'NVDA', 4, 100, 'zone', now).book;
    book = buy(book, 'NVDA', 4, 120, 'zone', now).book;
    expect(book.positions.NVDA!.qty).toBe(8);
    expect(book.positions.NVDA!.avgCost).toBe(110);
    expect(book.cash).toBe(START_CASH - 400 - 480);
  });

  it('books realised PnL on a sell and keeps it after the position closes', () => {
    let book = buy(emptyBook(), 'NVDA', 4, 100, 'zone', now).book;
    const r = sell(book, 'NVDA', 4, 150, 'zone', now);
    expect(r.trade.pnl).toBe(200);
    expect(r.book.positions.NVDA!.qty).toBe(0);
    expect(realizedTotal(r.book)).toBe(200);
    expect(r.book.cash).toBe(START_CASH + 200);
  });

  it('refuses to overspend or oversell', () => {
    expect(() => buy(emptyBook(100), 'NVDA', 10, 119.4, 'zone', now)).toThrow(/cash/);
    expect(() => sell(emptyBook(), 'NVDA', 1, 100, 'zone', now)).toThrow(/position/);
  });

  it('computes unrealised and total equity', () => {
    const book = buy(emptyBook(), 'SOL', 2, 100, 'zone', now).book;
    expect(unrealized(book, { SOL: 150 })).toBe(100);
    expect(equity(book, { SOL: 150 })).toBe(10_100);
  });

  it('formats quantities the way each asset class trades', () => {
    expect(fmtQty('NVDA', 4)).toBe('4');
    expect(fmtQty('SOL', 0.350877)).toBe('0.3509');
  });

  it('spreads a ladder over thirds of the original lot without overselling', () => {
    expect(ladderFor(100)).toEqual([115, 130, 150]);
    // The user's sell target becomes the last rung instead of a guessed third step.
    expect(ladderFor(100, 145)).toEqual([115, 130, 145]);
    // Never step past the exit: a rung above the sell zone would never be reached.
    expect(ladderFor(100, 120)).toEqual([115, 120]);
    expect(ladderFor(100, 105)).toEqual([105]);
    let book = buy(emptyBook(), 'NVDA', 12, 100, 'zone', now).book;
    const tranche = Math.floor(12 * LADDER_SHARE); // 4 shares per rung
    expect(tranche).toBe(4);
    for (const price of ladderFor(100)) book = sell(book, 'NVDA', tranche, price, 'zone', now).book;
    expect(book.positions.NVDA!.qty).toBe(0);
    // 4*(15) + 4*(30) + 4*(50)
    expect(realizedTotal(book)).toBe(380);
    expect(book.cash).toBeGreaterThan(START_CASH);
  });

  it('sells a ladder tranche in the asset own lot size, never a phantom fraction', () => {
    // The mock run printed `Paper sell 1 NVDA` and then the book held 2.6667 shares,
    // which the watch row rounded up to `hold 3`.
    expect(trancheQty('NVDA', 4)).toBe(1);
    expect(trancheQty('NVDA', 12)).toBe(4);
    // One or two shares cannot be split by three; one whole share is the smallest honest lot.
    expect(trancheQty('NVDA', 2)).toBe(1);
    expect(trancheQty('NVDA', 1)).toBe(1);
    // Crypto keeps its fractions, and a dust position still exits whole.
    expect(trancheQty('SOL', 3)).toBe(1);
    expect(trancheQty('SOL', 0.0004)).toBeCloseTo(0.0004 / 3, 6);
    expect(trancheQty('NVDA', 0)).toBe(0);

    let book = buy(emptyBook(), 'NVDA', 4, 100, 'zone', now).book;
    book = sell(book, 'NVDA', trancheQty('NVDA', book.positions.NVDA!.qty), 120, 'zone', now).book;
    expect(book.positions.NVDA!.qty).toBe(3);
  });

  it('clears the cost basis when a position is closed, so a rebuy starts clean', () => {
    let book = buy(emptyBook(), 'NVDA', 2, 100, 'zone', now).book;
    book = sell(book, 'NVDA', 2, 120, 'zone', now).book;
    expect(book.positions.NVDA!.avgCost).toBe(0);
    book = buy(book, 'NVDA', 1, 500, 'zone', now).book;
    expect(book.positions.NVDA!.avgCost).toBe(500);
    expect(realizedTotal(book)).toBe(40);
  });
});
