import { beforeEach, describe, expect, it, vi } from 'vitest';
import { candlesFor, clearCache, clearHistoryCache, judge, quoteFor } from '../src/server/quotes.ts';

/**
 * Round seven: the keyless crypto chain. Binance geo-blocks whole regions (HTTP 451,
 * verified live), so a single-source crypto feed went straight to mock there. These
 * tests stub each host the way the providers suite does and walk the chain down.
 */
const stubUpstreams = (handlers: Record<string, (url: string) => any>) => {
  vi.stubGlobal('fetch', (url: string) => {
    const host = Object.keys(handlers).find((h) => String(url).includes(h));
    if (!host) return Promise.reject(new Error('no such host'));
    try {
      const out = handlers[host]!(String(url));
      if (out instanceof Error) return Promise.resolve({ ok: false, status: Number(out.message) } as any);
      return Promise.resolve({ ok: true, status: 200, json: async () => out } as any);
    } catch (e) {
      return Promise.reject(e);
    }
  });
};

const binanceDown = () => new Error('451');
const coinbaseOk = () => ({ open: '61548.59', high: '61748.76', low: '58700', last: '59557.66' });

describe('keyless live chain', () => {
  beforeEach(() => {
    judge.mock = false;
    judge.forceStale = false;
    judge.sim = {};
    clearCache();
    clearHistoryCache();
    vi.unstubAllGlobals();
  });

  it('falls from a geo-blocked Binance to Coinbase and says so', async () => {
    stubUpstreams({ 'api.binance.com': binanceDown, 'api.exchange.coinbase.com': coinbaseOk });
    const q = await quoteFor('BTC');
    expect(q.source).toBe('coinbase');
    expect(q.mock).toBe(false);
    expect(q.price).toBe(59557.7); // quoteOf rounds ≥1000 to 1dp, the app's display rule
    expect(q.changePct).toBeCloseTo(-3.23, 1);
    expect(q.reason).toContain('Binance');
    expect(q.reason).toContain('Coinbase live');
  });

  it('walks past Coinbase to OKX, then to Kraken', async () => {
    stubUpstreams({
      'api.binance.com': binanceDown,
      'api.exchange.coinbase.com': () => new Error('503'),
      'okx.com': () => ({ code: '0', data: [{ last: '71.10', open24h: '73.49' }] }),
    });
    const okx = await quoteFor('SOL');
    expect(okx.source).toBe('okx');
    expect(okx.price).toBe(71.1);

    clearCache();
    stubUpstreams({
      'api.binance.com': binanceDown,
      'api.exchange.coinbase.com': () => new Error('503'),
      'okx.com': () => new Error('503'),
      // Kraken renames the pair in its reply; the parser must not depend on the key.
      'api.kraken.com': () => ({ error: [], result: { XDGUSD: { c: ['0.0568', '1'], o: '0.0584' } } }),
    });
    const kraken = await quoteFor('DOGE');
    expect(kraken.source).toBe('kraken');
    expect(kraken.price).toBe(0.0568);
    expect(kraken.changePct).toBeLessThan(0);
  });

  it('serves Coinbase candles, oldest first, when Binance klines are blocked', async () => {
    const bars = Array.from({ length: 90 }, (_, i) => {
      const t = 1_795_800_000 + i * 300;
      const c = 100 + i * 0.1;
      // Coinbase wire shape: [time(s), low, high, open, close, volume], newest first.
      return [t, c - 0.4, c + 0.4, c - 0.1, c, 1];
    }).reverse();
    stubUpstreams({
      'api.binance.com': binanceDown,
      'api.exchange.coinbase.com': (url) => (url.includes('/candles') ? bars : coinbaseOk()),
    });
    const h = await candlesFor('BTC', '1D');
    expect(h.source).toBe('coinbase');
    expect(h.mock).toBe(false);
    expect(h.candles.length).toBeGreaterThan(10);
    expect(h.candles[0]!.t).toBeLessThan(h.candles.at(-1)!.t);
    for (const c of h.candles) {
      expect(c.h).toBeGreaterThanOrEqual(c.l);
      expect(c.o).toBeGreaterThan(0);
    }
  });
});
