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

const stubFetch = () => {
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (url.startsWith('/api/quotes')) {
      const symbols = String(url).split('symbols=')[1]!.split(',');
      return Promise.resolve({ ok: true, json: async () => symbols.map((s) => quote(s, feed[s] ?? 100)) } as any);
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

    // Straight up to the sell zone: the book holds, so this must flash.
    feed = { NVDA: 148 };
    await app.poll();
    expect(app.flash?.zone).toBe('sell');
    await app.onGesture('click'); // sell
    expect(app.book.positions.NVDA!.qty).toBe(0);
    expect(app.trades[0]?.side).toBe('SELL');
    expect(app.trades[0]!.pnl).toBeGreaterThan(0);
  });

  it('never flashes a sell zone on a flat book', async () => {
    const app = newApp();
    feed = { NVDA: 148 };
    await app.poll();
    expect(app.screen).toBe('watch');
    expect(app.flash).toBeNull();
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

  it('long-press opens the portfolio, then the journal', async () => {
    const app = newApp();
    app.book = buy(emptyBook(START_CASH), 'NVDA', 2, 90, 'zone', new Date()).book;
    await app.poll();
    await app.onGesture('long');
    expect(app.screen).toBe('portfolio');
    await app.onGesture('long');
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
