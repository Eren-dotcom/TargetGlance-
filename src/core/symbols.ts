/**
 * Symbol universe. The allowlist is also the trust boundary: nothing outside it is
 * ever fetched or stored, so a crafted `?symbols=` cannot turn the proxy into a
 * general-purpose fetcher.
 */
export type AssetClass = 'stock' | 'crypto';

export interface SymbolDef {
  class: AssetClass;
  /** Deterministic fallback price when every upstream is unreachable. */
  mock: number;
  /** Binance spot pair, crypto only. */
  binance?: string;
  /** Yahoo chart symbol; defaults to the symbol itself. */
  yahoo?: string;
}

export const SYMBOLS: Record<string, SymbolDef> = {
  NVDA: { class: 'stock', mock: 119.4, yahoo: 'NVDA' },
  AAPL: { class: 'stock', mock: 228.5 },
  TSLA: { class: 'stock', mock: 246.8 },
  MSFT: { class: 'stock', mock: 428.9 },
  AMD: { class: 'stock', mock: 138.2 },
  SPY: { class: 'stock', mock: 592.1 },
  'RELIANCE.NS': { class: 'stock', mock: 1284.0 },
  BTC: { class: 'crypto', mock: 97400, binance: 'BTCUSDT' },
  ETH: { class: 'crypto', mock: 3420, binance: 'ETHUSDT' },
  SOL: { class: 'crypto', mock: 142.5, binance: 'SOLUSDT' },
  XRP: { class: 'crypto', mock: 2.31, binance: 'XRPUSDT' },
  DOGE: { class: 'crypto', mock: 0.382, binance: 'DOGEUSDT' },
};

export const PRESETS: Record<string, string[]> = {
  Megacap: ['NVDA', 'AAPL', 'TSLA'],
  'Crypto majors': ['BTC', 'ETH', 'SOL'],
  Mixed: ['NVDA', 'SOL', 'BTC'],
};

export const assetClass = (symbol: string): AssetClass => SYMBOLS[symbol]?.class ?? 'stock';

/** Unknown symbols are dropped here, once, and the caller sees the survivors. */
export const knownSymbols = (raw: string[]): string[] =>
  raw.map((s) => s.trim().toUpperCase()).filter((s) => s in SYMBOLS);
