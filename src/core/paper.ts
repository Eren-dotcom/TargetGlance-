import { assetClass } from './symbols.ts';

export interface Position {
  qty: number;
  avgCost: number;
  /** Lifetime realised PnL for this symbol; survives selling down to zero. */
  realized: number;
}

export interface Book {
  cash: number;
  positions: Record<string, Position>;
}

export interface Trade {
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  reason: 'zone' | 'manual' | 'stop';
  /** Realised PnL on a sell. */
  pnl: number;
  ts: string;
}

export const START_CASH = 10_000;
export const SIZING_PCT = 5;

export const emptyBook = (cash = START_CASH): Book => ({ cash, positions: {} });

const decimals = (symbol: string) => (assetClass(symbol) === 'crypto' ? 6 : 0);

/** Whole shares for stocks, fractional for crypto, always rounded in the safe direction. */
export function sizeQty(symbol: string, cashAvailable: number, price: number, pctPct = SIZING_PCT): number {
  if (!(price > 0)) return 0;
  const budget = (cashAvailable * pctPct) / 100;
  const raw = budget / price;
  const f = 10 ** decimals(symbol);
  return Math.floor(raw * f) / f;
}

export function canAfford(symbol: string, qty: number, price: number, book: Book): boolean {
  return qty > 0 && qty * price <= book.cash + 1e-9;
}

export function buy(book: Book, symbol: string, qty: number, price: number, reason: Trade['reason'], ts: Date): { book: Book; trade: Trade } {
  if (!canAfford(symbol, qty, price, book)) throw new Error('not enough paper cash');
  const prev = book.positions[symbol];
  const held = prev?.qty ?? 0;
  const avgCost = prev && held > 0 ? (prev.avgCost * held + price * qty) / (held + qty) : price;
  const next: Book = {
    cash: round2(book.cash - price * qty),
    positions: {
      ...book.positions,
      [symbol]: { qty: round6(held + qty), avgCost, realized: prev?.realized ?? 0 },
    },
  };
  return {
    book: next,
    trade: { symbol, side: 'BUY', qty, price, reason, pnl: 0, ts: ts.toISOString() },
  };
}

export function sell(book: Book, symbol: string, qty: number, price: number, reason: Trade['reason'], ts: Date): { book: Book; trade: Trade } {
  const pos = book.positions[symbol];
  if (!pos || pos.qty < qty || qty <= 0) throw new Error('not enough paper position');
  const realized = (price - pos.avgCost) * qty;
  const left = round6(pos.qty - qty);
  const next: Book = {
    cash: round2(book.cash + price * qty),
    positions: {
      ...book.positions,
      [symbol]: { qty: left, avgCost: left > 0 ? pos.avgCost : 0, realized: round2(pos.realized + realized) },
    },
  };
  return {
    book: next,
    trade: { symbol, side: 'SELL', qty, price, reason, pnl: round2(realized), ts: ts.toISOString() },
  };
}

export function marketValue(book: Book, prices: Record<string, number>): number {
  return Object.entries(book.positions).reduce((sum, [s, p]) => sum + p.qty * (prices[s] ?? p.avgCost), 0);
}

export function unrealized(book: Book, prices: Record<string, number>): number {
  return round2(
    Object.entries(book.positions).reduce(
      (sum, [s, p]) => sum + ((prices[s] ?? p.avgCost) - p.avgCost) * p.qty,
      0,
    ),
  );
}

/** Stocks read as whole shares; crypto keeps enough decimals to be honest. */
export const fmtQty = (symbol: string, qty: number): string =>
  assetClass(symbol) === 'crypto' ? String(Number(qty.toFixed(4))) : String(Math.round(qty));

export function realizedTotal(book: Book): number {
  return round2(Object.values(book.positions).reduce((sum, p) => sum + p.realized, 0));
}

export const equity = (book: Book, prices: Record<string, number>): number =>
  round2(book.cash + marketValue(book, prices));

export const returnPct = (total: number, start = START_CASH): number =>
  start > 0 ? round2(((total - start) / start) * 100) : 0;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round6 = (n: number) => Math.round(n * 1e6) / 1e6;
