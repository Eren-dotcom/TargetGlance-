import { describe, expect, it } from 'vitest';
import { getTextWidth, measureTextWrap } from '@evenrealities/pretext';
import { buildFrame, visibleSymbols, type ViewState } from '../src/g2/frame.ts';
import { emptyBook, buy } from '../src/core/paper.ts';
import { defaultTargets } from '../src/core/targets.ts';
import { bar, rungMarks } from '../src/g2/bar.ts';
import { BOLD, NORMAL, hardwareFrame, looksUrgent } from '../src/g2/look.ts';

/**
 * The glasses font is proportional and a fullwidth glyph (`─ ● █`) is a hard 20 px.
 * A line wider than the container wraps and shreds the layout, so every screen is
 * measured here with the same library the firmware is calibrated against.
 */
const WIDTH = 576;

const base = (): ViewState => ({
  screen: 'watch',
  quotes: [
    { symbol: 'NVDA', price: 138.2, changePct: 4.23, session: 'AH', stale: false, mock: false, ts: new Date().toISOString() },
    { symbol: 'SOL', price: 142.5, changePct: -2.1, session: '24-7', stale: false, mock: false, ts: new Date().toISOString() },
    { symbol: 'BTC', price: 97400, changePct: 0.8, session: '24-7', stale: true, mock: true, ts: new Date().toISOString() },
    { symbol: 'RELIANCE.NS', price: 1284, changePct: 1.2, session: 'LIVE', stale: false, mock: false, ts: new Date().toISOString() },
  ],
  targets: {
    NVDA: defaultTargets(138.2),
    SOL: defaultTargets(142.5),
    BTC: defaultTargets(97400),
    'RELIANCE.NS': defaultTargets(1284),
  },
  book: buy(emptyBook(), 'NVDA', 10, 119.4, 'zone', new Date()).book,
  watchlist: ['NVDA', 'SOL', 'BTC', 'RELIANCE.NS'],
  filter: 'ALL',
  sel: 0,
  field: 0,
  flash: null,
  toast: null,
  trades: [
    { symbol: 'NVDA', side: 'BUY', qty: 4, price: 119.4, pnl: 0, ts: new Date().toISOString() },
    { symbol: 'SOL', side: 'SELL', qty: 5, price: 181.2, pnl: 127.2, ts: new Date().toISOString() },
  ],
  now: Date.now(),
});

const screens: ViewState['screen'][] = ['watch', 'portfolio', 'journal', 'edit'];

describe('layout fits 576×288', () => {
  for (const screen of screens) {
    it(`${screen} never wraps a line`, () => {
      const frame = buildFrame({ ...base(), screen });
      for (const line of frame.lines) {
        const width = getTextWidth(line.text);
        expect(width, `"${line.text}" is ${width}px`).toBeLessThanOrEqual(WIDTH);
        // An empty line measures as zero lines; it still occupies its 8 px spacer row.
        expect(measureTextWrap(line.text, WIDTH).lineCount).toBeLessThanOrEqual(1);
      }
    });
  }

  it('flash screen stays inside the glass', () => {
    const frame = buildFrame({
      ...base(),
      screen: 'flash',
      flash: { symbol: 'NVDA', zone: 'buy', price: 119.4, changePct: -13.8, qty: 4, cost: 477.6, pctCash: 5 },
    });
    for (const line of frame.lines) expect(getTextWidth(line.text)).toBeLessThanOrEqual(WIDTH);
  });

  it('fits the vertical budget at the firmware line height of 27 px', () => {
    // Every physical line — blank spacers included — is 27 px tall, so 10 lines is the max.
    const fiveTrades = Array.from({ length: 5 }, (_, i) => ({
      symbol: 'NVDA', side: i % 2 ? ('SELL' as const) : ('BUY' as const), qty: 4, price: 119.4, pnl: i ? 127.2 : 0, ts: new Date().toISOString(),
    }));
    const cases: ViewState[] = [
      { ...base(), screen: 'watch' },
      { ...base(), screen: 'watch', toast: 'Bought 4 NVDA @ 119.4 · Undo' },
      { ...base(), screen: 'portfolio' },
      { ...base(), screen: 'journal', trades: fiveTrades },
      { ...base(), screen: 'edit' },
      { ...base(), screen: 'flash', flash: { symbol: 'NVDA', zone: 'buy', price: 119.4, changePct: -13.8, qty: 4, cost: 477.6, pctCash: 5 } },
    ];
    for (const c of cases) {
      const lines = buildFrame(c).lines.length;
      expect(lines, `${c.screen}: ${lines} lines`).toBeLessThanOrEqual(10);
    }
  });

  it('survives a very long ticker without overflowing', () => {
    const s = base();
    s.watchlist = ['RELIANCE.NS'];
    s.sel = 0;
    expect(visibleSymbols(s)).toEqual(['RELIANCE.NS']);
    for (const line of buildFrame(s).lines) expect(getTextWidth(line.text)).toBeLessThanOrEqual(WIDTH);
  });
});

describe('glyph set', () => {
  it('uses only glyphs the firmware actually has', () => {
    // pretext returns a 4px placeholder for a missing glyph; every glyph we draw is wider.
    const used = new Set<string>();
    for (const screen of [...screens, 'flash'] as ViewState['screen'][]) {
      const frame = buildFrame({
        ...base(),
        screen,
        flash: screen === 'flash' ? { symbol: 'SOL', zone: 'sell', price: 181, changePct: 27, qty: 5, cost: 905, pctCash: 10 } : null,
      });
      for (const ch of frame.text) if (ch !== ' ') used.add(ch);
    }
    const missing = [...used].filter((ch) => getTextWidth(ch) === 4 && !/[a-zA-Z0-9.,:;!?$%&()\-+'"\/\\]/.test(ch));
    expect(missing, `missing glyphs: ${missing.join(' ')}`).toEqual([]);
  });

  it('draws a bar of the requested width, knob inside it', () => {
    for (const pct of [0, 0.5, 1]) {
      const b = bar(pct, 6);
      expect(b).toHaveLength(6);
      expect(b).toContain('●');
      expect(getTextWidth(b)).toBe(6 * 20);
    }
  });
});

describe('hardware look', () => {
  it('keeps every line inside 576 px and inside 10 rows', () => {
    for (const screen of [...screens, 'flash'] as ViewState['screen'][]) {
      const preview = buildFrame({
        ...base(),
        screen,
        flash: screen === 'flash' ? { symbol: 'NVDA', zone: 'sell', price: 151, changePct: 27, qty: 3, cost: 453, pctCash: 5, rung: 148 } : null,
      });
      for (const line of hardwareFrame(preview).lines) {
        const w = getTextWidth(line.text);
        expect(w, `"${line.text}" is ${w}px`).toBeLessThanOrEqual(576);
      }
      expect(hardwareFrame(preview).lines.length).toBe(preview.lines.length);
    }
  });

  it('flattens to one brightness and marks secondary lines without changing width', () => {
    const preview = buildFrame({ ...base(), screen: 'watch' });
    const glass = hardwareFrame(preview);

    // Hardware shows one brightness: the mirror must not pretend to shade lines.
    expect(new Set(glass.lines.map((l) => l.level)).size).toBe(1);

    // Same width per line: the marker swaps a 5 px space for a 5 px dot.
    preview.lines.forEach((p, i) => {
      expect(getTextWidth(glass.lines[i]!.text)).toBe(getTextWidth(p.text));
    });

    // Secondary value rows lose their indent to the marker; a footer that already starts
    // at column 0 keeps its text and is separated by its rule instead.
    const marked = glass.lines.filter((l) => l.text.startsWith('·'));
    expect(marked.length).toBeGreaterThan(1);
    expect(marked.every((l) => !l.rule)).toBe(true);
    expect(glass.lines.some((l) => l.rule)).toBe(true);
  });
});

describe('emphasis', () => {
  it('asks for the bold step only when a row needs the wearer', () => {
    const calm = buildFrame({ ...base(), screen: 'watch' });
    expect(looksUrgent(calm)).toBe(false);

    const flash = buildFrame({
      ...base(),
      screen: 'flash',
      flash: { symbol: 'NVDA', zone: 'buy', price: 119.4, changePct: -13.8, qty: 4, cost: 477.6, pctCash: 5 },
    });
    expect(looksUrgent(flash)).toBe(true);

    // A row sitting in its zone is urgent even without a flash on screen.
    const inZone = buildFrame({ ...base(), quotes: [{ ...base().quotes[0]!, price: 119.4 }] });
    expect(looksUrgent(inZone)).toBe(true);
  });

  it('only ever asks for a brightness the SDK accepts', () => {
    for (const level of [NORMAL, BOLD]) {
      expect(Number.isInteger(level)).toBe(true);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(4);
    }
  });
});
