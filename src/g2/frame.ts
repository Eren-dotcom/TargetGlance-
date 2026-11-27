import { getTextWidth, pxTruncate } from '@evenrealities/pretext';
import { assetClass } from '../core/symbols.ts';
import { barPct, zoneOf, type Targets } from '../core/targets.ts';
import { fmtQty, ladderFor, marketValue, realizedTotal, unrealized, type Book } from '../core/paper.ts';
import type { Session } from '../core/session.ts';
import { ago, freshDot, money, money0, moveMark, pctText, px, signed, signedMoney, zoneText } from '../core/format.ts';
import { bar, rungMarks } from './bar.ts';
import { extent, stepLabel, type Candle, type Range } from '../core/candles.ts';


export const W = 576;
export const H = 288;

export type Screen = 'watch' | 'flash' | 'edit' | 'portfolio' | 'journal' | 'detail';
export type Filter = 'ALL' | 'STOCKS' | 'CRYPTO';

export interface ViewQuote {
  symbol: string;
  price: number;
  changePct: number;
  session: Session;
  stale: boolean;
  mock: boolean;
  ts: string;
  /** Judge Mode forced this price: the crossing is deliberate, so it must fire now. */
  simPct?: number;
  /** Why a row is not live (key rejected, rate limit, unreachable) — short and human. */
  reason?: string;
}

export interface Flash {
  symbol: string;
  zone: 'buy' | 'sell';
  price: number;
  changePct: number;
  qty: number;
  cost: number;
  pctCash: number;
  /** Take-profit rung that fired, when the alert came from the ladder. */
  rung?: number;
  /** Stop-zone breach: the action is exit the paper position, not a target trade. */
  stop?: boolean;
  /** Final ladder rung: sell what is left. */
  final?: boolean;
}

export interface ViewChart {
  range: Range;
  /** Interval the source returned: `5m`, `30m`, `1d`. */
  step: string;
  candles: Candle[];
  mock: boolean;
  /**
   * Text fallback drawn on the glass itself: eight levels of block glyph, one per bar
   * bucket. The bitmap in the image container is the real chart; this is what the wearer
   * sees when the image path is unavailable, so the screen never depends on a bitmap.
   */
  spark: string;
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
  /** Detail view: the chart for the selected symbol, when one has been fetched. */
  chart?: ViewChart | null;
  /** `✓ Bought 4 NVDA @ $119.40 — Undo` for 5 s after a trade. */
  toast: string | null;
  trades: ViewTrade[];
  now: number;
  /**
   * Hardware draws one text container at one brightness, and the step is coarse
   * (LVL0 normal, LVL2 boldest). The mirror shows the same five steps, so the preview
   * cannot look better than the glasses.
   */
  mono?: boolean;
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

/**
 * A fallback price must say why, in the four characters a 576 px row has left. The full
 * sentence lives in Judge Mode; the glass shows the one word that matters.
 */
export const shortWhy = (reason?: string): string => {
  const r = (reason ?? '').toLowerCase();
  if (!r) return 'mock';
  if (r.includes('rate') || r.includes('429')) return 'limit';
  if (r.includes('401') || r.includes('403') || r.includes('key')) return 'key';
  if (r.includes('last known')) return 'stale';
  if (r.includes('unreach') || r.includes('network')) return 'off';
  return 'mock';
};

/** The `n` rows around `sel`, clamped to the list, so the marked row is always visible. */
export function windowOf<T>(all: T[], sel: number, n: number): T[] {
  if (all.length <= n) return all;
  const start = Math.max(0, Math.min(sel - Math.floor(n / 2), all.length - n));
  return all.slice(start, start + n);
}

const pricesOf = (s: ViewState): Record<string, number> =>
  Object.fromEntries(s.quotes.map((q) => [q.symbol, q.price]));

function watch(s: ViewState): Line[] {
  const prices = pricesOf(s);
  const total = s.book.cash + marketValue(s.book, prices);
  const open = unrealized(s.book, prices);
  // The selector can reach every symbol, so the three rows shown are a window around it:
  // a `>` marker on a row that is not rendered is an edit aimed at nothing.
  const all = visible(s);
  const rows = windowOf(all, s.sel, 3);
  const lines: Line[] = [
    {
      text: spread(`TARGETGLANCE  PAPER ${money0(total)}   ${signedMoney(open)} open`, s.filter),
      level: 4,
    },
    { text: '', level: 0 },
  ];

  rows.forEach((sym) => {
    const i = all.indexOf(sym);
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
    const ladder = pos && pos.qty > 0 ? ladderFor(pos.avgCost, t.sell.low) : [];
    const reached = ladder.filter((r) => q.price >= r).length;
    // The row above already shouts the zone when it is hit; repeat it only when it is news.
    const parts = [
      inZone === 'buy' ? '' : `buy ${zoneText(t.buy.low, t.buy.high)}`,
      pos && pos.qty > 0 ? `hold ${fmtQty(sym, pos.qty)} ${signedMoney((q.price - pos.avgCost) * pos.qty)}` : pos ? 'flat' : '',
      // The dot says stale at a glance; this says by how much, which is what judges ask.
      q.mock
        ? shortWhy(q.reason)
        : `${q.stale ? 'stale' : 'live'} ${ago(q.ts, s.now)}`,
    ].filter(Boolean);
    lines.push({
      text: spread(`   ${parts.join(' · ')}`, ladder.length ? rungMarks(reached, ladder.length) : ''),
      level: 1,
    });
  });

  if (!rows.length) lines.push({ text: 'No symbols in this filter', level: 2 });

  if (s.toast) lines.push({ text: '', level: 0 }, { text: clip(`✓ ${s.toast}`), level: 4, rule: true });
  else lines.push({ text: '', level: 0 }, { text: clip('SWIPE select   TAP edit   LONG chart'), level: 1, rule: true });
  return lines;
}

function flash(s: ViewState): Line[] {
  const f = s.flash!;
  const buy = f.zone === 'buy';
  const target = s.targets[f.symbol];
  const wild = Math.abs(f.changePct) >= 7;
  const head = f.stop ? `▼ STOP HIT · ${f.symbol} @ ${px(f.price)}` : `${buy ? '▼' : '▲'} ${buy ? 'BUY' : 'SELL'} ${f.rung ? `RUNG ${f.rung} ` : ''}ZONE HIT · ${f.symbol} @ ${px(f.price)}`;
  return [
    { text: clip(head), level: 4 },
    { text: '', level: 0 },
    {
      text: clip(
        f.stop
          ? `Stop ${px(target?.stop ?? f.price)} · ${pctText(f.changePct)} today · paper only`
          : buy
            ? `Target ${zoneText(target?.buy.low ?? f.price, target?.buy.high ?? f.price)} · ${pctText(f.changePct)} today${wild ? ' · high vol' : ''}`
            : `Holding ${fmtQty(f.symbol, s.book.positions[f.symbol]?.qty ?? 0)} ${f.symbol} · ${pctText(f.changePct)} today`,
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
  const ladder = pos && pos.qty > 0 ? ladderFor(pos.avgCost, t.sell.low) : [];
  const rows = [
    `Buy zone   ${zoneText(t.buy.low, t.buy.high)}`,
    `Sell zone  ${zoneText(t.sell.low, t.sell.high)}`,
    `Stop       ${t.stop === null ? 'off' : px(t.stop)}`,
    ladder.length ? `Rungs      ${ladder.map(px).join('-')}` : 'Rungs      none (no position)',
  ];
  return [
    { text: clip(`EDIT · ${sym} ${px(q.price)} ${moveMark(q.changePct)} ${pctText(q.changePct)} ${q.session}`), level: 4 },
    { text: '', level: 0 },
    ...rows.map((r, i) => ({ text: clip(`${i === s.field ? '>' : ' '} ${r}`), level: i === s.field ? 4 : 2 })),
    { text: '', level: 0 },
    { text: clip('SWIPE -/+   TAP next   HOLD save + back'), level: 1, rule: true },
  ];
}

/**
 * Detail: the numbers the watchlist compresses, plus the chart. The top 144 px is text and
 * the bottom 144 px is the candle bitmap (`CHART_Y`), so the legend never sits on the ink.
 */
function detail(s: ViewState): Line[] {
  const sym = visible(s)[s.sel] ?? s.watchlist[0] ?? '';
  const q = s.quotes.find((x) => x.symbol === sym);
  const t = s.targets[sym];
  if (!q || !t) return [{ text: 'Nothing to detail' }];
  const pos = s.book.positions[sym];
  const ladder = pos && pos.qty > 0 ? ladderFor(pos.avgCost, t.sell.low) : [];
  const chart = s.chart;
  const window = chart?.candles.length ? extent(chart.candles) : null;
  const head = `DETAIL · ${sym} ${px(q.price)} ${moveMark(q.changePct)}${pctText(q.changePct)} ${freshDot(q)} ${q.session}`;
  const lines: Line[] = [
    { text: clip(head), level: 4 },
    {
      text: spread(
        ` ${chart ? `${chart.range} · ${stepLabel(chart.step)}` : 'No chart yet'}`,
        chart ? (chart.mock ? 'mock bars' : `${px(window!.low)} - ${px(window!.high)} range`) : '',
      ),
      level: 1,
    },
    { text: clip(`  buy ${zoneText(t.buy.low, t.buy.high)}   sell ${zoneText(t.sell.low, t.sell.high)}`), level: 3 },
    ...(q.reason ? [{ text: clip(`  ${q.reason.slice(0, 64)}`), level: 1 as const }] : []),
    {
      text: spread(
        `  ${pos && pos.qty > 0 ? `hold ${fmtQty(sym, pos.qty)} avg ${px(pos.avgCost)}` : 'flat'}${t.stop === null ? '' : `   stop ${px(t.stop)}`}`,
        pos && pos.qty > 0 ? rungMarks(ladder.filter((r) => q.price >= r).length, ladder.length) : '',
      ),
      level: 2,
    },
    // The sparkline is the fallback chart: same shape, drawn with text, so a screen with
    // no image container still shows more than a number.
    { text: clip(`  ${chart?.spark ?? ''}`), level: 4 },
  ];
  lines.push({ text: '', level: 0 }, { text: clip('SWIPE range   TAP back   LONG edit targets'), level: 1, rule: true });
  return lines;
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
  if (!rows.length)
    lines.push({ text: realizedTotal(s.book) ? '  Flat — every paper trade is closed' : '  No paper positions yet', level: 2 });
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
            : s.screen === 'detail'
              ? detail(s)
              : watch(s);
  return { lines, text: lines.map((l) => l.text).join('\n') };
}

export const visibleSymbols = visible;
