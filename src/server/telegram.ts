/**
 * Telegram alerts — the second screen for a glasses app.
 *
 * The G2 can only alert while the app is open; a Telegram bot can reach the wearer any
 * time. Same read-and-write loop in both places: the bot pushes a zone hit the moment
 * the server's poll sees the crossing, and a reply like "NVDA buy 118-122 sell 148-152"
 * is parsed by the same regex parser the companion and the glasses use, then saved to
 * the same server store — so the glasses show the new zones on their next poll.
 *
 * Setup: create a bot with @BotFather, set TARGETGLANCE_TG_TOKEN on the server, message
 * the bot once (that chat pairs). Optional TARGETGLANCE_TG_CHAT pre-pairs a chat id.
 * The token is server-only: it is never returned by an API, never logged, never bundled.
 * shortcut: pairing and alert state live in module memory — a server restart re-pairs on
 * the next message and re-baselines alerts. Upgrade to persisted pairing if this ships.
 */
import { freshAlertState, pollAlert, type Alert, type AlertMap } from '../core/alerts.ts';
import { ladderFor } from '../core/paper.ts';
import { asBook, asTargetMap, asWatchlist } from '../core/state.ts';
import { SYMBOLS } from '../core/symbols.ts';
import { defaultTargets, validateTargets, type Targets } from '../core/targets.ts';
import { describeIntent, parseTargets } from '../core/voice.ts';
import { quotesNow } from './quotes.ts';
import type { Store } from './store.ts';

const env = (name: string): string => {
  try {
    return (globalThis.process?.env?.[name] ?? '').trim();
  } catch {
    return '';
  }
};

const token = () => env('TARGETGLANCE_TG_TOKEN');

let pairedChat: string | null = null;
let updateOffset = 0;
const alertStates: AlertMap = {};
let baselined = false;

/** Test hook: forget pairing, offsets and alert state between cases. */
export const resetTelegram = () => {
  pairedChat = null;
  updateOffset = 0;
  baselined = false;
  for (const k of Object.keys(alertStates)) delete alertStates[k];
};

export const tgStatus = () => ({ configured: Boolean(token()), paired: Boolean(pairedChat ?? env('TARGETGLANCE_TG_CHAT')) });

const chat = (): string | null => pairedChat ?? (env('TARGETGLANCE_TG_CHAT') || null);

async function api(method: string, body: Record<string, unknown>): Promise<any> {
  const r = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!r.ok) throw new Error(`telegram ${method}: ${r.status}`);
  return r.json();
}

export const sendTelegram = (chatId: string, text: string) => api('sendMessage', { chat_id: chatId, text });

const zoneText = (z: { low: number; high: number }) => (z.low === z.high ? `${z.low}` : `${z.low}-${z.high}`);

function alertText(a: Alert, t: Targets): string {
  if (a.stop) return `■ STOP HIT · ${a.symbol} @ ${a.price}\nStop was ${t.stop} · paper position only — open TargetGlance to act. Paper only, no real orders.`;
  if (a.zone === 'buy')
    return `● BUY ZONE HIT · ${a.symbol} @ ${a.price}\nYour buy zone ${zoneText(t.buy)} · open TargetGlance on G2 to paper-buy in one tap.`;
  return `● SELL ZONE HIT · ${a.symbol} @ ${a.price}\nRung ${a.level} · your sell zone ${zoneText(t.sell)} · open TargetGlance on G2 to paper-sell.`;
}

const HELP =
  'TargetGlance alerts. I message you the moment a price crosses one of your zones.\n' +
  'Set zones by replying, e.g. "NVDA buy 118-122 sell 148-152 stop 110".\n' +
  '/status — watchlist prices and zones · /zones — your targets · Paper trading only, no real orders.';

/** One inbound update. Pairs the first chat that writes, then serves only that chat. */
export async function handleTelegramUpdate(update: any, store: Store): Promise<void> {
  const msg = update?.message;
  const text = String(msg?.text ?? '').trim();
  if (!msg?.chat?.id || !text) return;
  const from = String(msg.chat.id);

  if (!chat()) pairedChat = from;
  if (chat() !== from) {
    await sendTelegram(from, 'This TargetGlance bot is already paired to another chat.');
    return;
  }

  if (text === '/start' || text === '/help') {
    await sendTelegram(from, HELP);
    return;
  }
  if (text === '/zones') {
    const map = asTargetMap(store.get('targets'));
    const lines = Object.entries(map).map(([s, t]) => `${s} · buy ${zoneText(t.buy)} · sell ${zoneText(t.sell)}${t.stop ? ` · stop ${t.stop}` : ''}`);
    await sendTelegram(from, lines.length ? lines.join('\n') : 'No targets set yet. Reply e.g. "SOL buy 140 sell 180".');
    return;
  }
  if (text === '/status') {
    const watchlist = asWatchlist(store.get('watchlist'), ['NVDA', 'SOL', 'BTC']);
    const map = asTargetMap(store.get('targets'));
    const quotes = await quotesNow(watchlist);
    const lines = quotes.map((q) => {
      const t = map[q.symbol];
      const zone = t ? (q.price <= t.buy.high ? ' · IN BUY ZONE' : q.price >= t.sell.low ? ' · IN SELL ZONE' : '') : '';
      return `${q.symbol} ${q.price} (${q.changePct >= 0 ? '+' : ''}${q.changePct}%) ${q.mock ? 'MOCK' : q.source}${zone}`;
    });
    await sendTelegram(from, lines.join('\n') || 'Watchlist is empty.');
    return;
  }

  const intent = parseTargets(text, Object.keys(SYMBOLS));
  if (!intent) {
    await sendTelegram(from, 'I did not catch a target in that. Try "SOL buy 140 sell 180" or /help.');
    return;
  }
  const map = asTargetMap(store.get('targets'));
  const [q] = await quotesNow([intent.symbol]);
  const base = map[intent.symbol] ?? defaultTargets(q?.price ?? SYMBOLS[intent.symbol]!.mock);
  const next: Targets = {
    ...base,
    ...(intent.buy ? { buy: intent.buy } : {}),
    ...(intent.sell ? { sell: intent.sell } : {}),
    ...(intent.stop !== undefined ? { stop: intent.stop } : {}),
  };
  const problems = validateTargets(next, q?.price);
  if (problems.length) {
    await sendTelegram(from, `${describeIntent(intent)} — rejected: ${problems.join(', ')}`);
    return;
  }
  map[intent.symbol] = next;
  store.set('targets', map);
  await sendTelegram(from, `Saved ${describeIntent(intent)}. Your G2 watchlist uses it on the next poll.`);
}

/**
 * One alert pass over the watchlist, reusing the glasses' own crossing-only engine:
 * same hysteresis, same cooldown, same first-poll baseline, so Telegram and the G2
 * never disagree about what counts as news. Returns how many alerts were sent.
 */
export async function checkTelegramAlerts(store: Store, now = new Date()): Promise<number> {
  const to = chat();
  if (!token() || !to) return 0;
  const watchlist = asWatchlist(store.get('watchlist'), ['NVDA', 'SOL', 'BTC']);
  const map = asTargetMap(store.get('targets'));
  const symbols = watchlist.filter((s) => map[s]);
  if (!symbols.length) return 0;
  const book = asBook(store.get('book'));
  const quotes = await quotesNow(symbols, now);
  let sent = 0;
  for (const q of quotes) {
    const t = map[q.symbol]!;
    const pos = book.positions[q.symbol];
    const holds = Boolean(pos && pos.qty > 0);
    const res = pollAlert(alertStates[q.symbol] ?? freshAlertState(), {
      symbol: q.symbol,
      price: q.price,
      changePct: q.changePct,
      targets: t,
      rungs: holds ? ladderFor(pos!.avgCost, t.sell.low) : [],
      stop: holds ? t.stop : null,
      holds,
      held: pos?.qty ?? 0,
      now: now.getTime(),
      baseline: !baselined,
      force: q.simPct !== undefined,
    });
    alertStates[q.symbol] = res.state;
    if (res.alert) {
      await sendTelegram(to, alertText(res.alert, t));
      sent++;
    }
  }
  baselined = true;
  return sent;
}

let started = false;

/** Long-poll updates + a 15 s alert pass. No token → does nothing, by design. */
export function startTelegram(store: Store): void {
  if (started || !token()) return;
  started = true;
  const poll = async () => {
    try {
      const out = await api('getUpdates', { offset: updateOffset, timeout: 0 });
      for (const u of out?.result ?? []) {
        updateOffset = Math.max(updateOffset, (u.update_id ?? 0) + 1);
        await handleTelegramUpdate(u, store);
      }
    } catch {
      // A network blip is not a crash: the next tick tries again.
    }
  };
  setInterval(() => void poll(), 3_000);
  setInterval(() => void checkTelegramAlerts(store).catch(() => {}), 15_000);
  console.log('[telegram] bot polling started');
}
