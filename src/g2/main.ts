import { PRESETS } from '../core/symbols.ts';
import { asAlerts, asBook, asTargetMap, asTrades, asWatchlist } from '../core/state.ts';
import { defaultTargets, nudge, quickBuy, quickSell, quickSets, QUICK_STEPS, stepFor, validateTargets, type Targets } from '../core/targets.ts';
import { freshAlertState, pollAlert, snooze, type Alert, type AlertMap } from '../core/alerts.ts';
import { START_CASH, emptyBook, fmtQty, ladderFor, sizeQty, sell, buy, trancheQty, type Book, type Trade } from '../core/paper.ts';
import { buildFrame, visibleSymbols, type Flash, type Filter, type ViewState, type ViewQuote } from './frame.ts';
import { BOLD, NORMAL, hardwareFrame, looksUrgent } from './look.ts';
import { connect, listen, render, type Gesture, type MenuAction } from './sdk.ts';
import { mountMirror } from './mirror.ts';

const POLL_MS = 5000;
/** `?look=preview` shades lines; the default is the hardware's single brightness. */
const lookFromUrl = (): boolean => {
  try {
    return new URLSearchParams(globalThis.location?.search ?? '').get('look') !== 'preview';
  } catch {
    return true;
  }
};
const UNDO_MS = 5000;
const STATE_KEYS = ['targets', 'book', 'alerts', 'trades', 'watchlist'] as const;

type StoreKey = (typeof STATE_KEYS)[number];

/** Server is the source of truth (the phone and the glasses are different origins). */
const api = {
  async get<T>(key: StoreKey): Promise<T | null> {
    try {
      const r = await fetch(`/api/state/${key}`);
      return r.ok ? ((await r.json()) as T | null) : null;
    } catch {
      return null;
    }
  },
  async put(key: StoreKey, value: unknown): Promise<void> {
    try {
      localStorage.setItem(`targetglance_${key}`, JSON.stringify(value)); // offline cache
    } catch {
      // Storage can be full or blocked; the server copy is the source of truth.
    }
    try {
      await fetch(`/api/state/${key}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(value),
      });
    } catch {
      // Server unreachable: the cache still holds, the next successful read repairs it.
    }
  },
};

const local = <T>(key: StoreKey): T | null => {
  try {
    const raw = localStorage.getItem(`targetglance_${key}`);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

interface Snapshot {
  book: Book;
  trades: Trade[];
  alerts: AlertMap;
  until: number;
}

export class App {
  bridge: Awaited<ReturnType<typeof connect>> = null;
  watchlist: string[] = PRESETS.Mixed!;
  targets: Record<string, Targets> = {};
  book: Book = emptyBook(START_CASH);
  alerts: AlertMap = {};
  trades: Trade[] = [];
  quotes: ViewQuote[] = [];
  queue: Alert[] = [];
  flash: Flash | null = null;
  toast: string | null = null;
  toastUntil = 0;
  screen: ViewState['screen'] = 'watch';
  filter: Filter = 'ALL';
  sel = 0;
  field = 0;
  undo: Snapshot | null = null;
  busy = false;
  mono = lookFromUrl();
  /** Quick-set ladder index, so repeated taps cycle instead of resetting to the same place. */
  quickIdx = 1;
  /**
   * Set by `load()`: the first poll after a wake-up records where each price is instead of
   * announcing it. A price already inside a zone has been there for a while, and greeting the
   * wearer with a confirm button for a move they never saw is a phantom trade waiting to happen.
   */
  baseline = false;

  async boot() {
    // Each step is guarded: a dead bridge or a slow quote service must still leave a screen.
    await this.load().catch(() => undefined);
    this.bridge = await connect({
      gesture: (g) => void this.onGesture(g),
      menu: (a) => void this.onMenu(a),
      hold: (on) => void this.onHold(on),
    }).catch(() => null);
    // Keys drive the glasses gestures when no simulator is attached.
    try {
      mountMirror(() => this.frame(), this.mirrorHost(), (g) => void this.onGesture(g));
    } catch {
      // No #glass in the host page: the glasses are the only display, which is fine.
    }
    await this.draw().catch(() => undefined);
    await this.poll(true).catch(() => undefined);
    setInterval(() => void this.poll(), POLL_MS);
    setInterval(() => void this.tick(), 1000);
    setInterval(() => void this.syncConfig(), 2000);
  }

  mirrorHost() {
    return document.getElementById('glass')!;
  }

  async load() {
    // Keyed by name, never positional: a destructure once paired each payload with the
    // wrong parser, so saved state silently loaded as defaults.
    const stored = Object.fromEntries(
      await Promise.all(STATE_KEYS.map(async (k) => [k, await api.get<unknown>(k)] as const)),
    );
    const pick = (key: StoreKey) => stored[key] ?? local<unknown>(key);
    // Every field is checked: a malformed value must fall back, never blank the display.
    this.watchlist = asWatchlist(pick('watchlist'), asWatchlist(PRESETS.Mixed!, PRESETS.Mixed!));
    this.targets = asTargetMap(pick('targets'));
    this.book = asBook(pick('book'));
    this.alerts = asAlerts(pick('alerts'));
    this.trades = asTrades(pick('trades'));
    this.baseline = true;
  }

  /** Judge Mode owns the watchlist too, so it can preset-switch during a demo. */
  async syncConfig() {
    const next = asWatchlist(await api.get<unknown>('watchlist'), this.watchlist);
    if (next.join() !== this.watchlist.join()) {
      this.watchlist = next;
      this.sel = Math.min(this.sel, Math.max(0, next.length - 1));
      await this.poll(true);
    }
  }

  /** Transient message; the glasses have one toast line, so it expires instead of sticking. */
  say(text: string, ms = UNDO_MS) {
    this.toast = text;
    this.toastUntil = Date.now() + ms;
  }

  targetFor(sym: string): Targets {
    const q = this.quotes.find((x) => x.symbol === sym);
    if (!this.targets[sym]) this.targets[sym] = defaultTargets(q?.price ?? 100);
    return this.targets[sym]!;
  }


  async poll(silent = false) {
    if (this.busy) return;
    this.busy = true;
    try {
      const r = await fetch(`/api/quotes?symbols=${this.watchlist.join(',')}`);
      if (!r.ok) throw new Error(String(r.status));
      this.quotes = (await r.json()) as ViewQuote[];
      for (const q of this.quotes) this.targetFor(q.symbol);
      // A judge simulation is the operator asking for this price on purpose: it is never a
      // wake-up snapshot, even on the very first poll.
      const baseline = this.baseline && !this.quotes.some((q) => q.simPct !== undefined);
      this.baseline = false;
      this.runAlerts(baseline);
    } catch {
      if (!silent) this.say('Quote service offline — is the dev server up?', 8000);
    } finally {
      this.busy = false;
      // A zone hit must reach the glasses on the poll that saw it, not on the next tap.
      this.nextFlash();
      await this.draw();
    }
  }

  /** Crossing-only: each symbol's previous zone decides whether this tick is news. */
  runAlerts(baseline = false) {
    const now = Date.now();
    let dirty = false;
    for (const q of this.quotes) {
      const t = this.targets[q.symbol];
      if (!t) continue;
      const prev = this.alerts[q.symbol] ?? freshAlertState();
      const pos = this.book.positions[q.symbol];
      const heldQty = pos?.qty ?? 0;
      const holds = heldQty > 0;
      const { state, alert } = pollAlert(prev, {
        symbol: q.symbol,
        price: q.price,
        changePct: q.changePct,
        targets: t,
        holds,
        held: heldQty,
        // A paper position's ladder steps off its average cost, so rungs survive a restart.
        rungs: holds && pos ? ladderFor(pos.avgCost, t.sell.low) : [],
        stop: holds ? t.stop : null,
        // A simulated move is the judge asking for this price, not a wild tick to wait out.
        force: q.simPct !== undefined,
        baseline,
        now,
      });
      this.alerts[q.symbol] = state;
      // Persist only real transitions: the saved zones are what stop a restart from
      // re-alerting on a price it has been sitting inside for an hour.
      dirty ||= alert !== null || state.zone !== prev.zone;
      if (alert) this.queue.push(alert);
    }
    if (dirty) void api.put('alerts', this.alerts);
  }

  plan(a: Alert) {
    const price = a.price;
    if (a.zone === 'sell') {
      const held = this.book.positions[a.symbol]?.qty ?? 0;
      // Stop or the last rung exits the lot; an earlier rung takes one tranche.
      const qty = a.stop || a.final ? held : trancheQty(a.symbol, held);
      const cost = qty * price;
      return {
        qty,
        cost,
        pctCash: this.book.cash > 0 ? Math.round((cost / this.book.cash) * 100) : 100,
      };
    }
    const sized = sizeQty(a.symbol, this.book.cash, price);
    // 5% of a small book can be less than one share; one affordable share beats nothing.
    const qty = sized > 0 ? sized : Math.floor(this.book.cash / price);
    const cost = qty * price;
    return { qty, cost, pctCash: this.book.cash > 0 ? Math.round((cost / this.book.cash) * 100) : 100 };
  }

  nextFlash() {
    if (this.flash || !this.queue.length) return;
    const a = this.queue.shift()!;
    // A buy-zone tap while already long would average up into a losing position, not start
    // a trade. The buy side means "start a position"; while holding, the ladder owns the row.
    if (a.zone === 'buy' && (this.book.positions[a.symbol]?.qty ?? 0) > 0) {
      this.nextFlash();
      return;
    }
    // A trade of zero is not a decision; a stale alert for a position that is already
    // closed would show a confirm button that does nothing.
    if (a.zone === 'sell' && !a.stop && (this.book.positions[a.symbol]?.qty ?? 0) <= 0) {
      this.nextFlash();
      return;
    }
    this.flash = {
      symbol: a.symbol,
      zone: a.zone,
      price: a.price,
      changePct: a.changePct,
      ...this.plan(a),
      ...(a.rung ? { rung: a.rung } : {}),
      ...(a.stop ? { stop: true } : {}),
      ...(a.final ? { final: true } : {}),
    };
    this.screen = 'flash';
  }

  snapshot(): Snapshot {
    return { book: structuredClone(this.book), trades: structuredClone(this.trades), alerts: structuredClone(this.alerts), until: Date.now() + UNDO_MS };
  }

  async execute(side: 'BUY' | 'SELL', symbol: string, qty: number, price: number, reason: Trade['reason']) {
    if (!(qty > 0)) {
      this.say(side === 'BUY' ? 'Not enough paper cash' : 'Nothing to sell');
      this.screen = 'watch';
      return;
    }
    this.undo = this.snapshot();
    try {
      const r = side === 'BUY' ? buy(this.book, symbol, qty, price, reason, new Date()) : sell(this.book, symbol, qty, price, reason, new Date());
      this.book = r.book;
      this.trades = [r.trade, ...this.trades].slice(0, 10);
      this.say(`${side === 'BUY' ? 'Bought' : 'Sold'} ${fmtQty(symbol, qty)} ${symbol} @ ${price.toFixed(2)} · Undo`, UNDO_MS);
      await Promise.all([api.put('book', this.book), api.put('trades', this.trades)]);
      if (side === 'BUY') this.armSell(symbol);
    } catch (e) {
      this.say((e as Error).message);
    }
    this.flash = null;
    this.screen = 'watch';
  }

  /**
   * Auto-arm needs no state: after a paper buy the book holds, so the sell-zone rule
   * fires on the next upward crossing by itself. Only the confirmation text changes.
   */
  armSell(symbol: string) {
    const t = this.targets[symbol];
    if (t) this.say(`${this.toast ?? ''} · sell armed ${t.sell.low}-${t.sell.high}`, UNDO_MS);
  }

  async undoLast() {
    if (!this.undo || Date.now() > this.undo.until) return;
    this.book = this.undo.book;
    this.trades = this.undo.trades;
    this.alerts = this.undo.alerts;
    this.undo = null;
    this.say('Undone', 2000);
    await Promise.all([api.put('book', this.book), api.put('trades', this.trades), api.put('alerts', this.alerts)]);
    await this.draw();
  }

  async saveTargets(symbol: string) {
    const t = this.targets[symbol];
    if (t) {
      const problems = validateTargets(t, this.quotes.find((q) => q.symbol === symbol)?.price);
      this.say(problems[0] ?? `${symbol} targets saved`, problems.length ? 4000 : 2000);
      if (!problems.length) this.alerts[symbol] = freshAlertState();
      await Promise.all([api.put('targets', this.targets), api.put('alerts', this.alerts)]);
    }
  }

  rows() {
    return visibleSymbols({ ...this.view(), filter: this.filter });
  }

  view(): ViewState {
    return {
      screen: this.screen,
      quotes: this.quotes,
      targets: this.targets,
      book: this.book,
      watchlist: this.watchlist,
      filter: this.filter,
      sel: this.sel,
      field: this.field,
      flash: this.flash,
      toast: this.toast,
      trades: this.trades.map(({ symbol, side, qty, price, pnl, ts }) => ({ symbol, side, qty, price, pnl, ts })),
      now: Date.now(),
      mono: this.mono,
    };
  }

  frame() {
    const f = buildFrame(this.view());
    return this.mono ? hardwareFrame(f) : f;
  }

  async draw() {
    const f = this.frame();
    // Brightness is a whole-container property, so it marks the moment, not a row.
    if (this.bridge) await render(this.bridge, f, looksUrgent(f) ? BOLD : NORMAL);
  }

  async tick() {
    if (this.undo && Date.now() > this.undo.until) this.undo = null;
    if (this.toast && Date.now() > this.toastUntil) this.toast = null;
    await this.draw();
  }

  async onGesture(g: Gesture) {
    const rows = this.rows();
    switch (this.screen) {
      case 'flash':
        if (g === 'click')
          await this.execute(
            this.flash!.zone === 'buy' ? 'BUY' : 'SELL',
            this.flash!.symbol,
            this.flash!.qty,
            this.flash!.price,
            this.flash!.stop ? 'stop' : 'zone',
          );
        else if (g === 'down' || g === 'up' || g === 'double') this.dismiss();
        break;

      case 'edit': {
        const sym = rows[this.sel];
        if (!sym) break;
        const t = this.targetFor(sym);
        const q = this.quotes.find((x) => x.symbol === sym);
        if (g === 'up' || g === 'down') {
          const step = stepFor(q?.price ?? 100) * (g === 'up' ? -1 : 1);
          if (this.field === 0) t.buy = nudge(t.buy, step);
          else if (this.field === 1) t.sell = nudge(t.sell, step);
          else if (this.field === 2)
            t.stop = t.stop === null ? Math.round(t.buy.low * 0.9 * 100) / 100 : Math.max(0.01, Math.round((t.stop + step) * 100) / 100);
          await this.draw();
        } else if (g === 'click') {
          // On a target row, a tap applies the next quick-set and stays on the row; the
          // last row has nothing to quick-set, so a tap there wraps back to the buy zone.
          if (this.field === 3) this.field = 0;
          else {
            this.quickIdx = (this.quickIdx + 1) % QUICK_STEPS.length;
            const pct = QUICK_STEPS[this.quickIdx]!;
            if (this.field === 0 && pct < 0) t.buy = quickBuy(q?.price ?? t.buy.high, pct);
            else if (this.field === 1 && pct > 0) t.sell = quickSell(q?.price ?? t.sell.low, pct);
            else {
              if (this.field === 0) t.buy = quickBuy(q?.price ?? t.buy.high, -6);
              else t.sell = quickSell(q?.price ?? t.sell.low, 6);
            }
            this.say(`${this.field === 0 ? 'Buy' : 'Sell'} ${pct > 0 ? '+' : ''}${pct}% from ${q ? q.price.toFixed(2) : 'price'}`);
          }
          await this.draw();
        } else if (g === 'long') {
          await this.saveTargets(sym);
          this.screen = 'watch';
        } else if (g === 'double') this.screen = 'watch';
        break;
      }

      case 'portfolio':
      case 'journal':
        if (g === 'long' && this.screen === 'portfolio') this.screen = 'journal';
        else this.screen = 'watch';
        break;

      default:
        if (g === 'up' || g === 'down') {
          const step = g === 'down' ? 1 : -1;
          this.sel = (this.sel + step + rows.length) % Math.max(1, rows.length);
        } else if (g === 'click') {
          if (this.toast && this.undo) await this.undoLast();
          else if (rows[this.sel]) {
            const sym = rows[this.sel]!;
            const q = this.quotes.find((x) => x.symbol === sym);
            const t = this.targetFor(sym);
            const quick = quickSets(q?.price ?? 100);
            if (t.buy.high >= t.sell.low) Object.assign(t, quick);
            this.field = 0;
            this.screen = 'edit';
          }
        } else if (g === 'long') {
          this.screen = 'portfolio';
        } else if (g === 'double') {
          this.filter = this.filter === 'ALL' ? 'STOCKS' : this.filter === 'STOCKS' ? 'CRYPTO' : 'ALL';
          this.sel = 0;
        }
    }
    this.nextFlash();
    await this.draw();
  }

  /** Contextual menu: the same three things the gestures reach, one level less buried. */
  async onMenu(action: MenuAction) {
    if (action === 'portfolio') this.screen = 'portfolio';
    else if (action === 'journal') this.screen = 'journal';
    else {
      this.screen = 'watch';
      this.filter = 'ALL';
      this.sel = 0;
      this.say('View reset', 2000);
    }
    this.nextFlash();
    await this.draw();
  }

  /**
   * Temple held: open the glasses mic for the duration and tell the wearer what to say.
   * shortcut: audio is captured but not transcribed — speech-to-text needs a key or a local
   * Whisper, so the regex parser takes typed phrases instead (PLAN.md §3). Upgrade when a
   * keyless STT exists on the host.
   */
  async onHold(on: boolean) {
    if (!this.bridge) return;
    const live = await listen(this.bridge, on);
    if (on) {
      this.say(live ? 'Listening... say "SOL buy 140 sell 180"' : 'Mic unavailable', 3000);
    } else if (this.toast?.startsWith('Listening')) {
      this.say('Heard nothing — type it in Judge Mode', 3000);
    }
    await this.draw();
  }

  dismiss() {
    const f = this.flash;
    if (f) this.alerts[f.symbol] = snooze(this.alerts[f.symbol] ?? freshAlertState(), Date.now());
    this.flash = null;
    this.screen = 'watch';
    void api.put('alerts', this.alerts);
  }
}

/** The host decides where the app runs: the Even WebView or a plain browser mirror. */
export const start = () => new App().boot();

if (typeof document !== 'undefined') void start();
