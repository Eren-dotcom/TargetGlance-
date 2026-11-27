import { getTextWidth, pxTruncate } from '@evenrealities/pretext';
import { assetClass } from '../core/symbols.ts';
import { barPct, zoneOf, type Targets } from '../core/targets.ts';
import { fmtQty, marketValue, realizedTotal, unrealized, type Book } from '../core/paper.ts';
import type { Session } from '../core/session.ts';
import { freshDot, money, money0, moveMark, pctText, px, signed, signedMoney, zoneText } from './fmt.ts';
import { bar } from './bar.ts';

export const W = 576;
export const H = 288;

export type Screen = 'watch' | 'flash' | 'edit' | 'portfolio' | 'journal';
export type Filter = 'ALL' | 'STOCKS' | 'CRYPTO';

export interface ViewQuote {
  symbol: string;
  price: number;
  changePct: number;
  session: Session;
  stale: boolean;
  mock: boolean;
  ts: string;
}

export interface Flash {
  symbol: string;
  zone: 'buy' | 'sell';
  price: number;
  changePct: number;
  qty: number;
  cost: number;
  pctCash: number;
}

export interface ViewTrade {
  symbol: string;
  side: 'BUY' | 'SELL';
  qty: number;
  price: number;
  pnl: number;
  ts: string;
}

export interface ViewState {
  screen: Screen;
  quotes: ViewQuote[];
  targets: Record<string, Targets>;
  book: Book;
  watchlist: string[];
  filter: Filter;
  sel: number;
  /** Row index inside the editor. */
  field: number;
  flash: Flash | null;
  /** `✓ Bought 4 NVDA @ $119.40 — Undo` for 5 s after a trade. */
  toast: string | null;
  trades: ViewTrade[];
  now: number;
}

export interface Line {
  text: string;
  /** 0 = dim, 4 = full brightness. */
  level?: number;
  /** Draw a divider rule above this line. */
  rule?: boolean;
}

export interface AppFrame {
  lines: Line[];
  /** Flat text for the browser mirror. */
  text: string;
}

const clip = (s: string) => pxTruncate(s, W);

/** Left label, right value, gap measured in 5 px spaces. The finance-table look. */
function spread(left: string, right: string): string {
  const gap = W - getTextWidth(left) - getTextWidth(right);
  if (gap < 10) return clip(`${left} ${right}`);
  return left + ' '.repeat(Math.floor(gap / 5)) + right;
}
const pad = (s: string, n: number) => (s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length));
/** Rows keep a 5-character handle; the editor always shows the full symbol. */
const disp = (sym: string) => pad(sym.split('.')[0]!.slice(0, 5), 5);

function visible(s: ViewState): string[] {
  return s.watchlist.filter((sym) =>
    s.filter === 'ALL' ? true : s.filter === 'CRYPTO' ? assetClass(sym) === 'crypto' : assetClass(sym) === 'stock',
  );
}

const pricesOf = (s: ViewState): Record<string, number> =>
  Object.fromEntries(s.quotes.map((q) => [q.symbol, q.price]));

function watch(s: ViewState): Line[] {
  const prices = pricesOf(s);
  const total = s.book.cash + marketValue(s.book, prices);
  const open = unrealized(s.book, prices);
  const rows = visible(s).slice(0, 3);
  const lines: Line[] = [
    {
      text: spread(`TARGETGLANCE  PAPER ${money0(total)}   ${signedMoney(open)} open`, s.filter),
      level: 4,
    },
    { text: '', level: 0 },
  ];

  rows.forEach((sym, i) => {
    const q = s.quotes.find((x) => x.symbol === sym);
    const t = s.targets[sym];
    if (!q || !t) return;
    const inZone = zoneOf(t, q.price);
    const pos = s.book.positions[sym];
    const zone = inZone
      ? `${inZone === 'buy' ? 'BUY' : 'SELL'} ${zoneText(inZone === 'buy' ? t.buy.low : t.sell.low, inZone === 'buy' ? t.buy.high : t.sell.high)} NOW`
      : `${bar(barPct(t, q.price), 8)} ${zoneText(t.sell.low, t.sell.high)}`;
    lines.push({
      text: spread(`${i === s.sel ? '>' : ' '}${disp(sym)} ${moveMark(q.changePct)}${pad(pctText(q.changePct), 6)} ${pad(px(q.price), 7)} ${freshDot(q)} ${q.session}`, zone),
      level: i === s.sel ? 4 : 3,
    });
    lines.push({
      text: clip(
        `   buy ${zoneText(t.buy.low, t.buy.high)}${pos && pos.qty > 0 ? `   hold ${fmtQty(sym, pos.qty)} ${signedMoney((q.price - pos.avgCost) * pos.qty)}` : pos ? '   flat' : ''}`,
      ),
      level: 1,
    });
  });

  if (!rows.length) lines.push({ text: 'No symbols in this filter', level: 2 });

  if (s.toast) lines.push({ text: '', level: 0 }, { text: clip(`✓ ${s.toast}`), level: 4, rule: true });
  else lines.push({ text: '', level: 0 }, { text: clip('SWIPE select   TAP edit   LONG portfolio'), level: 1, rule: true });
  return lines;
}

function flash(s: ViewState): Line[] {
  const f = s.flash!;
  const buy = f.zone === 'buy';
  const target = s.targets[f.symbol];
  const wild = Math.abs(f.changePct) >= 7;
  return [
    { text: clip(`${buy ? '▼' : '▲'} ${buy ? 'BUY' : 'SELL'} ZONE HIT · ${f.symbol} @ ${px(f.price)}`), level: 4 },
    { text: '', level: 0 },
    {
      text: clip(
        buy
          ? `Target ${zoneText(target?.buy.low ?? f.price, target?.buy.high ?? f.price)} · ${pctText(f.changePct)} today${wild ? ' · high vol' : ''}`
          : `Holding ${fmtQty(f.symbol, s.book.positions[f.symbol]?.qty ?? 0)} · ${pctText(f.changePct)} today`,
      ),
      level: 3,
    },
    {
      text: clip(`Paper ${buy ? 'buy' : 'sell'} ${fmtQty(f.symbol, f.qty)} ${f.symbol} · ${money(f.cost)} (${f.pctCash}% cash)`),
      level: 3,
    },
    { text: '', level: 0 },
    { text: clip(`[TAP = ${buy ? 'BUY' : 'SELL'}]      [SWIPE = DISMISS]`), level: 4, rule: true },
  ];
}

function edit(s: ViewState): Line[] {
  const sym = visible(s)[s.sel] ?? s.watchlist[s.sel] ?? '';
  const q = s.quotes.find((x) => x.symbol === sym);
  const t = s.targets[sym];
  if (!q || !t) return [{ text: 'Nothing to edit' }];
  const pos = s.book.positions[sym];
  const rows = [
    `Buy zone   ${zoneText(t.buy.low, t.buy.high)}`,
    `Sell zone  ${zoneText(t.sell.low, t.sell.high)}`,
    `Stop       ${t.stop === null ? 'none' : px(t.stop)}`,
    `Held       ${pos && pos.qty > 0 ? `${fmtQty(sym, pos.qty)} · ${signed((q.price - pos.avgCost) * pos.qty, 0)}` : 'none'}`,
  ];
  return [
    { text: clip(`EDIT · ${sym} ${px(q.price)} ${moveMark(q.changePct)} ${pctText(q.changePct)} ${q.session}`), level: 4 },
    { text: '', level: 0 },
    ...rows.map((r, i) => ({ text: clip(`${i === s.field ? '>' : ' '} ${r}`), level: i === s.field ? 4 : 2 })),
    { text: '', level: 0 },
    { text: clip('SWIPE: -/+    TAP: next field    LONG: save + back'), level: 1, rule: true },
  ];
}

function portfolio(s: ViewState): Line[] {
  const prices = pricesOf(s);
  const rows = Object.entries(s.book.positions).filter(([, p]) => p.qty > 0);
  const total = s.book.cash + marketValue(s.book, prices);
  const lines: Line[] = [
    { text: clip(`PAPER PORTFOLIO  ${money0(total)}  ${pctText(((total - 10000) / 10000) * 100)}`), level: 4 },
    { text: '', level: 0 },
  ];
  rows.slice(0, 3).forEach(([sym, p]) => {
    const last = prices[sym] ?? p.avgCost;
    lines.push({
      text: spread(`  ${disp(sym)} ${pad(fmtQty(sym, p.qty), 5)} avg ${px(p.avgCost)}`, `${signedMoney((last - p.avgCost) * p.qty)}`),
      level: 3,
    });
  });
  if (!rows.length) lines.push({ text: '  No paper positions yet', level: 2 });
  lines.push(
    { text: '', level: 0 },
    { text: spread(`  Cash ${money(s.book.cash)}`, `realised ${money(realizedTotal(s.book))}`), level: 2 },
    { text: clip('TAP: back    LONG: journal'), level: 1, rule: true },
  );
  return lines;
}

function journal(s: ViewState): Line[] {
  const lines: Line[] = [{ text: 'TRADE LOG (last 5)', level: 4 }, { text: '', level: 0 }];
  if (!s.trades.length) lines.push({ text: '  No trades yet — tap a zone alert to trade', level: 2 });
  s.trades.slice(0, 5).forEach((t) => {
    const time = new Date(t.ts).toISOString().slice(11, 16);
    lines.push({
      text: spread(
        `  ${pad(t.side, 5)}${pad(t.symbol.split('.')[0]!, 6)}${pad(fmtQty(t.symbol, t.qty), 7)}@ ${px(t.price)}`,
        `${t.side === 'SELL' ? money(t.pnl) : '—'} ${time}`,
      ),
      level: 3,
    });
  });
  lines.push({ text: '', level: 0 }, { text: 'TAP: back   (export JSON in Judge Mode)', level: 1, rule: true });
  return lines;
}

/** Everything the glasses show is decided here, so the browser mirror cannot drift. */
export function buildFrame(s: ViewState): AppFrame {
  const lines =
    s.screen === 'flash' && s.flash
      ? flash(s)
      : s.screen === 'edit'
        ? edit(s)
        : s.screen === 'portfolio'
          ? portfolio(s)
          : s.screen === 'journal'
            ? journal(s)
            : watch(s);
  return { lines, text: lines.map((l) => l.text).join('\n') };
}

export const visibleSymbols = visible;
