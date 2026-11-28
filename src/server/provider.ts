/**
 * Optional live-data keys.
 *
 * The app shipped keyless on purpose: every quote comes from a public endpoint the browser
 * is allowed to talk to. A key buys one thing the free endpoints cannot promise — a
 * *contract*: a documented rate limit, a documented symbol list, and an error you can tell
 * apart from a network blip. That is what this file adds, and it adds it **without making a
 * key required**: with no key set, every code path here reports "not configured" and the
 * keyless chain behaves exactly as before.
 *
 * Rules this file exists to enforce:
 * - The key is read from the environment **on the server**. It is never bundled, never
 *   returned by an API, never logged. `keyStatus()` returns a mask, not the value.
 * - A provider failing is a *downgrade*, not an outage: we fall back to the keyless chain
 *   and say why.
 * - Errors are classified, because "mock price" with no reason is how a demo lies to a judge.
 */
import { SYMBOLS, type AssetClass } from '../core/symbols.ts';
import { round, type Quote } from '../core/quotes.ts';

export type ProviderName = 'finnhub' | 'twelvedata' | 'polygon';

export interface ProviderSpec {
  name: ProviderName;
  label: string;
  /** Server-side only. Empty when the key is not configured. */
  key: string;
  /** Free-tier reality, shown in the companion so nobody expects more than they bought. */
  freeTier: string;
  quote: (symbol: string) => Promise<ProviderQuote>;
}

/** A provider's own view of a quote, before session and simulation are applied. */
export interface ProviderQuote {
  price: number;
  prevClose: number;
}

/** `UNAUTHORIZED` and `RATE_LIMITED` are the two a key is supposed to fix. */
export type FailureKind = 'no-key' | 'unauthorized' | 'rate-limited' | 'unsupported' | 'unreachable' | 'bad-payload';

export class ProviderError extends Error {
  // Assigned in the body, not as a parameter property: `npm run proxy` runs this file under
  // `node --experimental-strip-types`, which refuses parameter properties outright.
  readonly kind: FailureKind;
  constructor(kind: FailureKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const env = (name: string): string => {
  try {
    return (globalThis.process?.env?.[name] ?? '').trim();
  } catch {
    return '';
  }
};

/** Provider order: an explicit choice first, then whatever keys happen to exist. */
const ORDER: ProviderName[] = ['finnhub', 'twelvedata', 'polygon'];

const ENV_KEY: Record<ProviderName, string> = {
  finnhub: 'TARGETGLANCE_KEY_FINNHUB',
  twelvedata: 'TARGETGLANCE_KEY_TWELVEDATA',
  polygon: 'TARGETGLANCE_KEY_POLYGON',
};

export const FREE_TIER: Record<ProviderName, string> = {
  finnhub: '60 req/min free, US + major listings',
  twelvedata: '8 req/min free, global incl. NSE/BSE (.NS / .BO)',
  polygon: '5 req/min free, US only, delayed',
};

/** Yahoo can want a crumb; Binance geo-blocks some regions. Those are not the key's fault. */
function classifyStatus(status: number): FailureKind {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate-limited';
  if (status === 402) return 'unauthorized';
  if (status === 404 || status === 400) return 'unsupported';
  return 'unreachable';
}

async function call(url: string, limitMs = 4000): Promise<any> {
  let r: Response;
  try {
    r = await fetch(url, { signal: AbortSignal.timeout(limitMs) });
  } catch (e) {
    throw new ProviderError('unreachable', (e as Error).message);
  }
  if (!r.ok) throw new ProviderError(classifyStatus(r.status), `HTTP ${r.status}`);
  try {
    return await r.json();
  } catch {
    throw new ProviderError('bad-payload', 'not JSON');
  }
}

const positive = (...ns: unknown[]): number => {
  for (const n of ns) {
    const v = Number(n);
    if (Number.isFinite(v) && v > 0) return v;
  }
  return 0;
};

const build = (name: ProviderName): ProviderSpec => {
  const key = env(ENV_KEY[name]);
  const spec: ProviderSpec = {
    name,
    label: { finnhub: 'Finnhub', twelvedata: 'Twelve Data', polygon: 'Polygon.io' }[name],
    key,
    freeTier: FREE_TIER[name],
    quote: async (symbol: string) => {
      if (!key) throw new ProviderError('no-key', `${ENV_KEY[name]} is not set`);
      const def = SYMBOLS[symbol];
      if (!def) throw new ProviderError('unsupported', 'symbol not in the allowlist');
      // Polygon does not serve crypto on the free stock plan; Binance already covers it.
      if (name === 'polygon' && def.class === 'crypto') throw new ProviderError('unsupported', 'crypto is not on this plan');

      if (name === 'finnhub') {
        const d = await call(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`);
        const price = positive(d?.c);
        const prevClose = positive(d?.pc) || price;
        if (!price) throw new ProviderError('bad-payload', 'no price');
        return { price, prevClose };
      }
      if (name === 'twelvedata') {
        const d = await call(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`);
        // Twelve Data answers 200 with `{status:"error"}` for a bad key; that is an auth error.
        if (d?.status === 'error') {
          const msg = String(d?.message ?? 'error');
          throw new ProviderError(/api key|apikey|invalid/i.test(msg) ? 'unauthorized' : 'bad-payload', msg.slice(0, 80));
        }
        const price = positive(d?.close, d?.price);
        const prevClose = positive(d?.previous_close) || price;
        if (!price) throw new ProviderError('bad-payload', 'no price');
        return { price, prevClose };
      }
      // polygon
      const d = await call(
        `https://api.polygon.io/v2/aggs/ticker/${encodeURIComponent(symbol)}/prev?adjusted=true&apiKey=${encodeURIComponent(key)}`,
      );
      const bar = d?.results?.[0];
      const price = positive(bar?.c);
      const prevClose = positive(bar?.o) || price;
      if (!price) throw new ProviderError('unsupported', 'no result for this ticker');
      return { price, prevClose };
    },
  };
  return spec;
};

/** Every key that is set, in preference order. Empty means keyless mode, which is fine. */
export function providers(): ProviderSpec[] {
  const all = ORDER.map(build);
  const configured = all.filter((p) => p.key);
  const forced = env('TARGETGLANCE_PROVIDER').toLowerCase();
  const first = configured.find((p) => p.name === forced);
  return first ? [first, ...configured.filter((p) => p !== first)] : configured;
}

/** Never returns the key itself: send this to a browser. */
export function keyStatus() {
  const all = ORDER.map(build);
  return {
    /** True when at least one key is set; the app works without one. */
    configured: all.some((p) => p.key),
    provider: providers()[0]?.name ?? null,
    providers: all.map((p) => ({
      name: p.name,
      label: p.label,
      configured: Boolean(p.key),
      /** Last four only, so a human can tell which key is loaded without leaking it. */
      mask: p.key ? `••••${p.key.slice(-4)}` : null,
      env: ENV_KEY[p.name],
      freeTier: p.freeTier,
      /** Providers that cannot serve this asset class, so the companion does not promise it. */
      classes: (p.name === 'polygon' ? ['stock'] : ['stock', 'crypto']) as AssetClass[],
    })),
  };
}

/** Test hook: the mask rule, isolated. */
export const mask = (key: string): string | null => (key ? `••••${key.slice(-4)}` : null);

/** One line a human reads instead of a stack trace. */
export const explain = (e: unknown): string => {
  const kind = e instanceof ProviderError ? e.kind : 'unreachable';
  switch (kind) {
    case 'no-key':
      return 'no key configured — keyless mode';
    case 'unauthorized':
      return 'key rejected (401/403) — check the key or the plan';
    case 'rate-limited':
      return 'free-tier limit hit (429) — keyless fallback';
    case 'unsupported':
      return 'provider does not serve this symbol';
    case 'bad-payload':
      return 'provider answered without a usable price';
    default:
      return 'provider unreachable';
  }
};

export type { Quote };
