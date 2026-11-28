import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../src/server/handler.ts';
import { createStore } from '../src/server/store.ts';
import { clearCache, clearHistoryCache, judge, quoteFor } from '../src/server/quotes.ts';
import { FREE_TIER, ProviderError, explain, keyStatus, mask, providers } from '../src/server/provider.ts';

const env = globalThis.process.env;
const call = (path: string) => {
  const url = new URL(path, 'http://local');
  return handle({ method: 'GET', pathname: url.pathname, query: url.searchParams, body: '' }, createStore('/tmp/targetglance-provider-test.json'));
};

/** A stand-in for the vendor: answers per host, records what was asked. */
const stubUpstreams = (handlers: Record<string, (url: string) => any>) => {
  const seen: string[] = [];
  vi.stubGlobal('fetch', (url: string) => {
    seen.push(String(url));
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
  return seen;
};

const finnhubOk = () => ({ c: 138.2, pc: 132.6 });
const yahooOk = () => ({
  chart: { result: [{ meta: { regularMarketPrice: 999, chartPreviousClose: 990 } }] },
});

describe('optional live keys', () => {
  beforeEach(() => {
    delete env.TARGETGLANCE_KEY_FINNHUB;
    delete env.TARGETGLANCE_KEY_TWELVEDATA;
    delete env.TARGETGLANCE_KEY_POLYGON;
    delete env.TARGETGLANCE_PROVIDER;
    judge.mock = false;
    judge.forceStale = false;
    judge.sim = {};
    clearCache();
    clearHistoryCache();
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete env.TARGETGLANCE_KEY_FINNHUB;
    delete env.TARGETGLANCE_PROVIDER;
  });

  it('is keyless by default, and that is a working state, not an error', async () => {
    expect(providers()).toEqual([]);
    const status = keyStatus();
    expect(status.configured).toBe(false);
    expect(status.provider).toBeNull();
    stubUpstreams({ 'query1.finance.yahoo.com': yahooOk });
    const q = await quoteFor('NVDA');
    expect(q.source).toBe('yahoo');
    expect(q.mock).toBe(false);
    expect(q.reason, 'a live keyless quote needs no excuse').toBeUndefined();
  });

  it('prefers a configured key over the keyless chain', async () => {
    env.TARGETGLANCE_KEY_FINNHUB = 'test-key-1234';
    const seen = stubUpstreams({ 'finnhub.io': finnhubOk, 'query1.finance.yahoo.com': yahooOk });
    const q = await quoteFor('NVDA');
    expect(q.source).toBe('finnhub');
    expect(q.price).toBe(138.2);
    expect(q.changePct).toBeCloseTo(4.22, 1);
    // Yahoo is never asked when the key works: one call, not two.
    expect(seen.filter((u) => u.includes('yahoo'))).toHaveLength(0);
  });

  it('never returns or logs the key, only a mask of its last four', async () => {
    env.TARGETGLANCE_KEY_FINNHUB = 'super-secret-abcdef';
    const r = await call('/api/providers');
    const text = JSON.stringify(r.json);
    expect(text).not.toContain('super-secret');
    expect(text).not.toContain('abcdef');
    const status = keyStatus();
    expect(status.providers[0]!.mask).toBe('••••cdef');
    expect(mask('')).toBeNull();
    expect(status.provider).toBe('finnhub');
  });

  it('classifies a rejected key and falls back instead of lying', async () => {
    env.TARGETGLANCE_KEY_FINNHUB = 'expired';
    stubUpstreams({
      'finnhub.io': () => new Error('401'),
      'query1.finance.yahoo.com': yahooOk,
    });
    const q = await quoteFor('NVDA');
    // Fell back to the keyless chain, and said why in words a human can act on.
    expect(q.source).toBe('yahoo');
    expect(q.reason).toContain('Finnhub');
    expect(q.reason).toContain('key rejected');
    expect(q.reason).not.toContain('expired');
  });

  it('classifies a rate limit separately from an outage', async () => {
    env.TARGETGLANCE_KEY_FINNHUB = 'k';
    stubUpstreams({ 'finnhub.io': () => new Error('429'), 'query1.finance.yahoo.com': yahooOk });
    const q = await quoteFor('NVDA');
    expect(q.reason).toContain('free-tier limit');
    // The glass gets one word, not a sentence.
    const { shortWhy } = await import('../src/g2/frame.ts');
    expect(shortWhy(q.reason)).toBe('limit');
    expect(shortWhy('Finnhub: key rejected (401/403)')).toBe('key');
    expect(shortWhy('last known · timeout')).toBe('stale');
    expect(shortWhy(undefined)).toBe('mock');
  });

  it('explains each failure kind without a stack trace', () => {
    expect(explain(new ProviderError('unauthorized', 'x'))).toContain('key rejected');
    expect(explain(new ProviderError('rate-limited', 'x'))).toContain('free-tier');
    expect(explain(new ProviderError('no-key', 'x'))).toContain('keyless mode');
    expect(explain(new ProviderError('unsupported', 'x'))).toContain('does not serve');
    expect(explain(new Error('boom'))).toContain('unreachable');
  });

  it('honours TARGETGLANCE_PROVIDER when more than one key is set', async () => {
    env.TARGETGLANCE_KEY_FINNHUB = 'a';
    env.TARGETGLANCE_KEY_TWELVEDATA = 'b';
    env.TARGETGLANCE_PROVIDER = 'twelvedata';
    stubUpstreams({ 'api.twelvedata.com': () => ({ close: '250.50', previous_close: '240' }), 'finnhub.io': finnhubOk });
    const q = await quoteFor('NVDA');
    expect(q.source).toBe('twelvedata');
    expect(q.price).toBe(250.5);
  });

  it('treats a 200-with-error Twelve Data answer as an auth failure, not a price', async () => {
    env.TARGETGLANCE_KEY_TWELVEDATA = 'bad';
    stubUpstreams({
      'api.twelvedata.com': () => ({ status: 'error', message: 'Invalid API key or API key is missing' }),
      'query1.finance.yahoo.com': yahooOk,
    });
    const q = await quoteFor('NVDA');
    expect(q.source).toBe('yahoo');
    expect(q.reason).toContain('key rejected');
  });

  it('does not send crypto to a stock-only plan', async () => {
    env.TARGETGLANCE_KEY_POLYGON = 'p';
    const seen = stubUpstreams({ 'api.polygon.io': () => ({ results: [{ c: 100, o: 99 }] }), 'api.binance.com': () => ({ lastPrice: '143.10', prevClosePrice: '141' }) });
    const q = await quoteFor('SOL');
    // Polygon refuses crypto on the free plan, so Binance serves it — and says nothing went wrong.
    expect(q.source).toBe('binance');
    expect(q.price).toBe(143.1);
    expect(q.reason).toContain('does not serve');
    expect(seen.some((u) => u.includes('polygon') && u.includes('SOL'))).toBe(false);
  });

  it('keeps a bad payload from becoming a price of zero', async () => {
    env.TARGETGLANCE_KEY_FINNHUB = 'k';
    stubUpstreams({ 'finnhub.io': () => ({ c: 0, pc: 0 }), 'query1.finance.yahoo.com': () => new Error('503') });
    const q = await quoteFor('NVDA');
    expect(q.mock).toBe(true);
    expect(q.price).toBeGreaterThan(0);
    expect(q.reason).toContain('without a usable price');
  });

  it('falls back to the deterministic mock when every source is down, and names them', async () => {
    env.TARGETGLANCE_KEY_FINNHUB = 'k';
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    clearCache();
    const cold = await quoteFor('NVDA');
    expect(cold.mock).toBe(true);
    // Both the keyed provider and the keyless pair get named, in order, with no key leaked.
    expect(cold.reason).toContain('Finnhub');
    expect(cold.reason).toContain('Yahoo');
    expect(cold.reason).not.toContain('k');
    expect(cold.price).toBeGreaterThan(0);
  });

  it('lists the free-tier limit next to the key, so nobody expects more than they bought', async () => {
    env.TARGETGLANCE_KEY_FINNHUB = 'k';
    const r = await call('/api/providers');
    expect(r.status).toBe(200);
    const body = r.json as any;
    const finnhub = body.providers.find((p: any) => p.name === 'finnhub');
    expect(finnhub.freeTier).toBe(FREE_TIER.finnhub);
    expect(finnhub.env).toBe('TARGETGLANCE_KEY_FINNHUB');
    expect(body.providers.every((p: any) => typeof p.configured === 'boolean')).toBe(true);
  });
});
