import { describe, expect, it, vi } from 'vitest';
import { App } from '../src/g2/main.ts';
import { renderCandles } from '../src/g2/chart.ts';

/**
 * Mock run: the demo script, end to end, against the REAL server over HTTP.
 * No stubbed quotes — the controller, the handler, the cache and the fallbacks all run.
 */
const BASE = 'http://localhost:5173';
const realFetch = globalThis.fetch;
const errors: string[] = [];

const browser = () => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  });
  vi.stubGlobal('document', {
    getElementById: () => ({ replaceChildren: () => {}, appendChild: () => {} }),
    createElement: () => ({ className: '', textContent: '', replaceChildren: () => {}, appendChild: () => {} }),
  });
  vi.stubGlobal('window', { addEventListener: () => {}, location: { search: '' } });
  vi.stubGlobal('location', { search: '' });
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    if (typeof url === 'string' && url.startsWith('/')) return realFetch(BASE + url, init);
    return realFetch(url, init);
  });
  process.on('unhandledRejection', (e) => errors.push(String(e)));
  process.on('uncaughtException', (e) => errors.push(String(e)));
};

const reset = async () => {
  await realFetch(`${BASE}/api/judge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ reset: true, resetState: true }) });
  await realFetch(`${BASE}/api/state/watchlist`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(['NVDA', 'SOL', 'BTC']) });
  await realFetch(`${BASE}/api/state/targets`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({
    NVDA: { buy: { low: 118, high: 122 }, sell: { low: 148, high: 152 }, stop: 110 },
    SOL: { buy: { low: 135, high: 140 }, sell: { low: 178, high: 182 }, stop: 120 },
    BTC: { buy: { low: 92000, high: 92000 }, sell: { low: 105000, high: 105000 }, stop: null },
  }) });
};

const judge = (body: unknown) =>
  realFetch(`${BASE}/api/judge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

/**
 * Needs the dev server (`npm run dev`). Skipped automatically when it is not answering, so
 * `npm test` stays green on a machine that only wants the unit suites.
 */
const up = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(800) }).then((r) => r.ok).catch(() => false);

describe.skipIf(!up)('mock run: the 90-second demo', () => {
  it('plays end to end without an error, a blank screen or a phantom trade', async () => {
    browser();
    await reset();
    const app = new App();

    // Boot as the app does.
    await app.load();
    await app.poll(true);
    const log: string[] = [];
    const snap = (label: string) => log.push(`${label}: ${app.frame().lines.map((l) => l.text).join(' | ').slice(0, 200)}`);

    snap('boot');
    // Saved targets came from the server, not from the defaults — this caught a positional
    // destructure that paired every stored value with the wrong parser.
    expect(app.targets.NVDA?.sell.high).toBe(152);
    expect(app.quotes.length).toBe(3);
    expect(app.screen).toBe('watch');
    expect(app.watchlist).toEqual(['NVDA', 'SOL', 'BTC']);

    // 1. Judge drops NVDA into the buy zone.
    await judge({ sim: { NVDA: -13.8 } });
    await app.poll();
    snap('dip');
    expect(app.screen, 'buy-zone flash did not appear').toBe('flash');
    expect(app.flash?.zone).toBe('buy');
    expect(app.flash!.qty).toBeGreaterThan(0);

    // 2. Tap = paper buy.
    const qty = app.flash!.qty;
    await app.onGesture('click');
    snap('bought');
    expect(app.screen).toBe('watch');
    expect(app.book.positions.NVDA?.qty).toBe(qty);
    expect(app.trades[0]?.side).toBe('BUY');
    expect(app.book.cash).toBeLessThan(10000);

    // 3. Judge spikes NVDA into the first take-profit rung.
    await judge({ sim: { NVDA: 18 } });
    await app.poll();
    snap('rung');
    expect(app.screen, 'rung flash did not appear').toBe('flash');
    expect(app.flash?.zone).toBe('sell');

    // 4. Tap = sell the tranche.
    await app.onGesture('click');
    snap('sold');
    const left = app.book.positions.NVDA?.qty ?? 0;
    expect(left).toBeLessThan(qty);
    expect(app.trades[0]?.side).toBe('SELL');

    // 5. The detail screen: real history over HTTP, a text sparkline, and the candle
    // bitmap that would go into the image container.
    await app.onGesture('long');
    snap('detail');
    expect(app.screen).toBe('detail');
    expect(app.history?.candles.length, 'no history came back from /api/candles').toBeGreaterThan(10);
    expect(app.frame().text).toContain('DETAIL · NVDA');
    const chart = renderCandles({ candles: app.history!.candles, price: 139.13, range: '1D', targets: app.targets.NVDA });
    expect(chart.data.length).toBe(288 * 144);
    expect(chart.data.some((b) => b > 0), 'the chart rendered empty').toBe(true);
    // Swipe cycles the window; the label has to move with it.
    await app.onGesture('up');
    expect(app.history?.range).toBe('5D');

    // 6. Portfolio and journal screens render with real content.
    await app.onMenu('portfolio');
    expect(app.screen).toBe('portfolio');
    expect(app.frame().text).toContain('PAPER PORTFOLIO');
    await app.onMenu('journal');
    expect(app.screen).toBe('journal');
    expect(app.frame().text).toContain('TRADE LOG');

    // 7. Undo the sale, after walking back to the watchlist.
    await app.onGesture('click');
    expect(app.screen).toBe('watch');
    await app.undoLast();
    snap('undone');
    expect(app.book.positions.NVDA?.qty).toBe(qty);

    // 8. Clear the sim: the price must return at once, not after the cache expires.
    await judge({ sim: {} });
    await app.poll();
    snap('cleared');
    expect(app.quotes.find((q) => q.symbol === 'NVDA')?.simPct).toBeUndefined();

    console.log('\n' + log.join('\n'));
    console.log('errors:', errors.length ? errors : 'none');
    expect(errors).toEqual([]);
  }, 30_000);
});
