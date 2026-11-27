import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handle } from '../src/server/handler.ts';
import { createStore } from '../src/server/store.ts';
import { judge, clearCache } from '../src/server/quotes.ts';

const store = () => createStore('/tmp/targetglance-test-state.json');
const call = (method: string, path: string, body = '') => {
  const url = new URL(path, 'http://local');
  return handle({ method, pathname: url.pathname, query: url.searchParams, body }, store());
};

describe('api', () => {
  beforeEach(async () => {
    await call('POST', '/api/judge', JSON.stringify({ reset: true, resetState: true }));
    clearCache();
    vi.unstubAllGlobals();
  });

  it('answers health', async () => {
    const r = await call('GET', '/health');
    expect(r.status).toBe(200);
    expect((r.json as any).ok).toBe(true);
  });

  it('rejects a request without symbols and one with only unknown symbols', async () => {
    expect((await call('GET', '/api/quotes')).status).toBe(400);
    expect((await call('GET', '/api/quotes?symbols=FAKE,ALSOFAKE')).status).toBe(400);
  });

  it('falls back to a mock quote when every upstream is unreachable', async () => {
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')));
    const r = await call('GET', '/api/quotes?symbols=BTC,NVDA');
    expect(r.status).toBe(200);
    const quotes = r.json as any[];
    expect(quotes).toHaveLength(2);
    for (const q of quotes) {
      expect(q.mock).toBe(true);
      expect(q.price).toBeGreaterThan(0);
      expect(['24-7', 'LIVE', 'PRE', 'AH', 'CLOSED']).toContain(q.session);
    }
  });

  it('uses a live Binance answer for crypto and labels the source', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({
        ok: true,
        json: async () => ({ lastPrice: '142.55', prevClosePrice: '145.00', priceChange: '-2.45' }),
      } as any),
    );
    const [q] = (await call('GET', '/api/quotes?symbols=SOL')).json as any[];
    expect(q.source).toBe('binance');
    expect(q.price).toBe(142.55);
    expect(q.mock).toBe(false);
    expect(q.changePct).toBeCloseTo(-1.69, 1);
  });

  it('layers a judge simulation over the live price', async () => {
    vi.stubGlobal('fetch', () =>
      Promise.resolve({ ok: true, json: async () => ({ lastPrice: '142.55', prevClosePrice: '145' }) } as any),
    );
    await call('POST', '/api/judge', JSON.stringify({ sim: { SOL: -13 } }));
    const [q] = (await call('GET', '/api/quotes?symbols=SOL')).json as any[];
    expect(q.price).toBeCloseTo(124.02, 1);
    expect(q.simPct).toBe(-13);
  });

  it('ignores junk keys in the judge simulation', async () => {
    await call('POST', '/api/judge', JSON.stringify({ sim: { NOTREAL: 5, SOL: 'x' } }));
    expect(judge.sim).toEqual({});
  });

  it('stores and reads state, and rejects unknown keys and non-JSON', async () => {
    expect((await call('PUT', '/api/state/book', '{"cash":5}')).status).toBe(200);
    expect((await call('GET', '/api/state/book')).json).toEqual({ cash: 5 });
    expect((await call('GET', '/api/state/nope')).status).toBe(400);
    expect((await call('PUT', '/api/state/book', 'not json')).status).toBe(400);
  });

  it('caps oversized bodies', async () => {
    const big = JSON.stringify({ x: 'a'.repeat(70_000) });
    expect((await call('PUT', '/api/state/trades', big)).status).toBe(413);
  });
});
