import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '../src/g2/main.ts';
import { START_CASH, emptyBook, buy } from '../src/core/paper.ts';

/**
 * Drives the real controller the way the glasses do: poll, gesture, poll.
 * fetch is stubbed, so this covers the wiring between alerts, sizing, the book,
 * undo and the screens — the part a unit test of each module cannot see.
 */
const quote = (symbol: string, price: number, changePct = 0) => ({
  symbol, price, changePct, session: '24-7', stale: false, mock: false, ts: new Date().toISOString(),
});

let feed: Record<string, number> = {};
const posts: Record<string, unknown> = {};

const stubFetch = (simPct?: number) => {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/quotes')) {
      const symbols = String(url).split('symbols=')[1]!.split(',');
      return Promise.resolve({
        ok: true,
        json: async () => symbols.map((s) => ({ ...quote(s, feed[s] ?? 100), ...(simPct !== undefined ? { simPct } : {}) })),
      } as any);
    }
    if (url.startsWith('/api/state/') && init?.method === 'PUT') {
      posts[url.split('/').pop()!] = JSON.parse(String(init.body));
      return Promise.resolve({ ok: true, json: async () => ({}) } as any);
    }
    return Promise.resolve({ ok: true, json: async () => null } as any);
  });
};

const newApp = (): App => Object.assign(new App(), {
  watchlist: ['NVDA'],
  book: emptyBook(START_CASH),
  quotes: [quote('NVDA', 100)],
  targets: { NVDA: { buy: { low: 90, high: 95 }, sell: { low: 140, high: 150 }, stop: 80 } },
  alerts: {},
  trades: [],
});

describe('app wiring', () => {
  beforeEach(() => {
    feed = { NVDA: 100 };
    for (const k of Object.keys(posts)) delete posts[k];
    stubFetch();
  });

  it('flashes a buy-zone hit on the poll that sees it', async () => {
    const app = newApp();
    await app.poll();
    expect(app.screen).toBe('watch');
    feed = { NVDA: 92 };
    await app.poll();
    expect(app.screen).toBe('flash');
    expect(app.flash?.zone).toBe('buy');
  });

  it('sizes a paper buy and only alerts a sell once a position exists', async () => {
    const app = newApp();
    feed = { NVDA: 92 };
    await app.poll();
    expect(app.flash?.qty).toBeGreaterThan(0);
    await app.onGesture('click'); // buy
    expect(app.book.positions.NVDA!.qty).toBeGreaterThan(0);
    expect(app.screen).toBe('watch');
    expect(posts.book).toBeTruthy();

    // Straight up to the sell zone: the book holds, so this must flash. Reaching the
    // user's own sell zone is the last rung, so the whole remainder is the trade.
    feed = { NVDA: 148 };
    await app.poll();
    expect(app.flash?.zone).toBe('sell');
    expect(app.flash?.final).toBe(true);
    await app.onGesture('click'); // sell
    expect(app.book.positions.NVDA!.qty).toBe(0);
    expect(app.trades[0]?.side).toBe('SELL');
    expect(app.trades[0]!.pnl).toBeGreaterThan(0);
  });

  it('fires immediately on a judge-simulated move, without waiting out a wild tick', async () => {
    const app = newApp();
    await app.poll();
    // -13.8% would normally need a second poll (falling-knife hold); a sim is deliberate.
    feed = { NVDA: 92 };
    stubFetch(-13.8);
    await app.poll();
    expect(app.screen).toBe('flash');
    expect(app.flash?.zone).toBe('buy');
  });

  it('never flashes a sell zone on a flat book', async () => {
    const app = newApp();
    feed = { NVDA: 148 };
    await app.poll();
    expect(app.screen).toBe('watch');
    expect(app.flash).toBeNull();
  });

  it('never averages up: a buy-zone flash is dropped while the book already holds', async () => {
    const app = newApp();
    await app.poll();
    feed = { NVDA: 92 };
    await app.poll();
    await app.onGesture('click'); // start the position
    const held = app.book.positions.NVDA!.qty;
    expect(held).toBeGreaterThan(0);
    app.undo = null; // the 5 s undo would otherwise answer the next tap instead of the market

    // Price leaves the zone (above buy.high, below the first +15% rung) and falls back in.
    feed = { NVDA: 100 };
    await app.poll();
    feed = { NVDA: 92 };
    await app.poll();
    expect(app.flash, 'a buy-zone flash while long would average up').toBeNull();
    expect(app.screen).toBe('watch');
    expect(app.book.positions.NVDA!.qty).toBe(held);
    expect(app.trades.filter((t) => t.side === 'BUY')).toHaveLength(1);
  });

  it('never flashes a tranche of zero on a one-share lot', async () => {
    const app = newApp();
    app.book = buy(emptyBook(START_CASH), 'NVDA', 1, 100, 'zone', new Date()).book;
    feed = { NVDA: 100 };
    await app.poll();
    // The first rung of a one-share lot is +15%.
    feed = { NVDA: 116 };
    await app.poll();
    expect(app.screen).toBe('flash');
    expect(app.flash?.zone).toBe('sell');
    expect(app.flash!.qty).toBe(1);
  });

  it('dismissing snoozes instead of trading', async () => {
    const app = newApp();
    feed = { NVDA: 92 };
    await app.poll();
    await app.onGesture('down');
    expect(app.book.cash).toBe(START_CASH);
    expect(app.alerts.NVDA!.snoozedUntil).toBeGreaterThan(Date.now());
  });

  it('undo restores the book and journal exactly', async () => {
    const app = newApp();
    feed = { NVDA: 92 };
    await app.poll();
    const before = structuredClone(app.book);
    await app.onGesture('click');
    expect(app.book.cash).not.toBe(before.cash);
    await app.undoLast();
    expect(app.book).toEqual(before);
    expect(app.trades).toEqual([]);
  });

  it('refuses to trade with no cash and says so', async () => {
    const app = newApp();
    app.book = emptyBook(0);
    feed = { NVDA: 92 };
    await app.poll();
    await app.onGesture('click');
    expect(app.book.cash).toBe(0);
    expect(app.toast).toMatch(/cash/i);
  });

  it('swaps the filter on a double tap and opens the editor on a tap', async () => {
    const app = newApp();
    await app.poll();
    await app.onGesture('double');
    expect(app.filter).toBe('STOCKS');
    await app.onGesture('click');
    expect(app.screen).toBe('edit');
    // Swipe down nudges the buy zone up by one readable step.
    const low = app.targets.NVDA!.buy.low;
    await app.onGesture('down');
    expect(app.targets.NVDA!.buy.low).toBeGreaterThan(low);
    await app.onGesture('long'); // long = save and back
    expect(app.screen).toBe('watch');
    expect(posts.targets).toBeTruthy();
  });

  it('long-press opens the chart, and the menu still reaches the portfolio then the journal', async () => {
    const app = newApp();
    app.book = buy(emptyBook(START_CASH), 'NVDA', 2, 90, 'zone', new Date()).book;
    await app.poll();
    // Long-press is the fastest path to "more detail"; Portfolio/Journal sit in the menu.
    await app.onGesture('long');
    expect(app.screen).toBe('detail');
    await app.onMenu('portfolio');
    expect(app.screen).toBe('portfolio');
    await app.onMenu('journal');
    expect(app.screen).toBe('journal');
  });

  it('does not double-alert on later polls in the same zone', async () => {
    const app = newApp();
    feed = { NVDA: 92 };
    await app.poll();
    await app.onGesture('down'); // dismiss
    await app.poll();
    await app.poll();
    expect(app.screen).toBe('watch');
    expect(app.alerts.NVDA!.zone).toBe('buy');
    expect(app.alerts.NVDA!.lastPrice).toBe(92);
    expect(app.alerts.NVDA!.pending).toBe(false);
  });
});

describe('take-profit ladder and stop', () => {
  beforeEach(() => {
    feed = { NVDA: 100 };
    for (const k of Object.keys(posts)) delete posts[k];
    stubFetch();
  });

  const holding = () => {
    const app = newApp();
    app.book = buy(emptyBook(START_CASH), 'NVDA', 9, 100, 'zone', new Date()).book;
    // Rungs off a $100 average cost, capped by the user's own sell zone.
    app.targets = { NVDA: { buy: { low: 90, high: 95 }, sell: { low: 150, high: 155 }, stop: 80 } };
    return app;
  };

  it('sells one third at the first rung, not the whole lot', async () => {
    const app = holding();
    feed = { NVDA: 116 }; // past the +15% rung, under the sell zone
    await app.poll();
    expect(app.flash?.zone).toBe('sell');
    expect(app.flash?.rung).toBe(115);
    expect(app.flash?.qty).toBe(3); // 9 / 3
    expect(app.flash?.final).toBeFalsy(); // undefined = not the last rung
    await app.onGesture('click');
    expect(app.book.positions.NVDA!.qty).toBe(6);

    // Walking up to the last rung (the user's sell zone) sells what is left.
    feed = { NVDA: 151 };
    await app.poll();
    expect(app.flash?.final).toBe(true);
    await app.onGesture('click');
    expect(app.book.positions.NVDA!.qty).toBe(0);
    // Fill is the live price at confirmation, not the rung: 3 * (116 - 100) then
    // 6 * (151 - 100). Journal is newest first.
    expect(app.trades[1]!.pnl).toBeCloseTo(3 * (app.trades[1]!.price - 100), 6);
    expect(app.trades[0]!.pnl).toBeCloseTo(6 * (app.trades[0]!.price - 100), 6);
  });

  it('exits the whole lot on a stop, and never on a stock you do not hold', async () => {
    const app = holding();
    feed = { NVDA: 78 };
    await app.poll();
    expect(app.flash).toMatchObject({ stop: true, zone: 'sell', qty: 9 });
    await app.onGesture('click');
    expect(app.book.positions.NVDA!.qty).toBe(0);
    expect(app.trades[0]!.reason).toBe('stop');
    expect(app.trades[0]!.pnl).toBeLessThan(0);
  });

  it('stays quiet when the price falls back toward the entry after a partial exit', async () => {
    // Probed, not assumed: a partial sell keeps the average cost, so stepping back down
    // must not re-flash a rung that was already taken on the way up.
    const app = holding();
    feed = { NVDA: 116 };
    await app.poll();
    expect(app.flash?.rung).toBe(115);
    await app.onGesture('click'); // a third goes
    await app.poll();
    feed = { NVDA: 101 };
    await app.poll();
    expect(app.flash).toBeNull();
    expect(app.screen).toBe('watch');
  });

  it('a stop does not fire while flat', async () => {
    const app = newApp();
    feed = { NVDA: 78 };
    await app.poll();
    expect(app.flash?.stop).toBeUndefined();
  });
});
