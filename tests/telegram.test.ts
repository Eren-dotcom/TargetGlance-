import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type Store } from '../src/server/store.ts';
import { checkTelegramAlerts, handleTelegramUpdate, resetTelegram, tgStatus } from '../src/server/telegram.ts';
import { judge, clearCache } from '../src/server/quotes.ts';

/**
 * Round eight: the Telegram bot. Telegram itself is stubbed at fetch (the way the
 * providers suite stubs vendors); quotes are stubbed per host too, so no test here
 * touches a network. The token lives in env and must never appear in a status reply.
 */
const env = globalThis.process.env;
let sent: { chat: string; text: string }[] = [];
let store: Store;

const stubAll = (quoteHosts: Record<string, (url: string) => any> = {}) => {
  sent = [];
  vi.stubGlobal('fetch', (url: string, init?: any) => {
    const u = String(url);
    if (u.includes('api.telegram.org')) {
      const body = JSON.parse(init?.body ?? '{}');
      if (u.includes('sendMessage')) sent.push({ chat: String(body.chat_id), text: String(body.text) });
      return Promise.resolve({ ok: true, json: async () => ({ ok: true, result: [] }) } as any);
    }
    const host = Object.keys(quoteHosts).find((h) => u.includes(h));
    if (!host) return Promise.reject(new Error('offline'));
    const out = quoteHosts[host]!(u);
    if (out instanceof Error) return Promise.resolve({ ok: false, status: Number(out.message) } as any);
    return Promise.resolve({ ok: true, status: 200, json: async () => out } as any);
  });
};

const msg = (text: string, chatId = 42) => ({ message: { chat: { id: chatId }, text } });
const solAt = (price: number) => ({ 'api.binance.com': () => ({ lastPrice: String(price), prevClosePrice: '145' }) });

describe('telegram bot', () => {
  beforeEach(() => {
    env.TARGETGLANCE_TG_TOKEN = 'test-token-9999';
    delete env.TARGETGLANCE_TG_CHAT;
    judge.mock = false;
    judge.sim = {};
    clearCache();
    resetTelegram();
    store = createStore('/tmp/targetglance-tg-test.json');
    store.reset();
    store.set('watchlist', ['SOL']);
    store.set('targets', { SOL: { buy: { low: 135, high: 140 }, sell: { low: 178, high: 182 }, stop: 120 } });
    stubAll(solAt(142.5));
  });

  it('reports configured without ever exposing the token', () => {
    expect(tgStatus()).toEqual({ configured: true, paired: false });
    expect(JSON.stringify(tgStatus())).not.toContain('test-token');
  });

  it('pairs the first chat, then refuses a second one', async () => {
    await handleTelegramUpdate(msg('/start'), store);
    expect(sent.at(-1)?.text).toContain('TargetGlance alerts');
    await handleTelegramUpdate(msg('/start', 77), store);
    expect(sent.at(-1)?.chat).toBe('77');
    expect(sent.at(-1)?.text).toContain('already paired');
  });

  it('sets targets from a plain phrase reply, through the same parser as the glasses', async () => {
    await handleTelegramUpdate(msg('SOL buy 130-135 sell 190'), store);
    expect(sent.at(-1)?.text).toContain('Saved');
    const targets = store.get('targets') as any;
    expect(targets.SOL.buy).toEqual({ low: 130, high: 135 });
    expect(targets.SOL.sell).toEqual({ low: 190, high: 190 });
    expect(targets.SOL.stop).toBe(120); // untouched fields survive the merge
  });

  it('answers /status with live prices and zone state', async () => {
    await handleTelegramUpdate(msg('/start'), store);
    await handleTelegramUpdate(msg('/status'), store);
    expect(sent.at(-1)?.text).toContain('SOL 142.5');
    expect(sent.at(-1)?.text).toContain('binance');
  });

  it('pushes a zone hit once when the price crosses in, and not again while it sits there', async () => {
    await handleTelegramUpdate(msg('/start'), store);
    // First pass is the baseline: a price already somewhere is not news.
    expect(await checkTelegramAlerts(store)).toBe(0);
    stubAll(solAt(139)); // crossed into the buy zone
    clearCache();
    expect(await checkTelegramAlerts(store)).toBe(1);
    expect(sent.at(-1)?.text).toContain('BUY ZONE HIT · SOL @ 139');
    // Still in the zone on the next pass: crossing-only means silence.
    expect(await checkTelegramAlerts(store)).toBe(0);
  });

  it('does nothing at all without a token', async () => {
    delete env.TARGETGLANCE_TG_TOKEN;
    expect(tgStatus().configured).toBe(false);
    expect(await checkTelegramAlerts(store)).toBe(0);
    expect(sent).toHaveLength(0);
  });
});
