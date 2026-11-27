import { PRESETS, knownSymbols } from '../core/symbols.ts';
import { defaultTargets, nudge, quickSets, stepFor, validateTargets, type Targets } from '../core/targets.ts';
import { freshAlertState, pollAlert, snooze, type Alert, type AlertMap } from '../core/alerts.ts';
import { START_CASH, emptyBook, fmtQty, sizeQty, sell, buy, type Book, type Trade } from '../core/paper.ts';
import { buildFrame, visibleSymbols, type Flash, type Filter, type ViewState, type ViewQuote } from './frame.ts';
import { connect, render, type Gesture } from './sdk.ts';
import { mountMirror } from './mirror.ts';

const POLL_MS = 5000;
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

  async boot() {
    await this.load();
    this.bridge = await connect((g) => (this.onGesture(g)));
    // Keys drive the glasses gestures when no simulator is attached.
    mountMirror(() => this.frame(), this.mirrorHost(), (g) => void this.onGesture(g));
    await this.poll(true);
    setInterval(() => void this.poll(), POLL_MS);
    setInterval(() => void this.tick(), 1000);
    setInterval(() => void this.syncConfig(), 2000);
  }

  mirrorHost() {
    return document.getElementById('glass')!;
  }

  async load() {
    const [watchlist, targets, book, alerts, trades] = await Promise.all(STATE_KEYS.map((k) => api.get<any>(k)));
    const stored = knownSymbols(watchlist ?? local<string[]>('watchlist') ?? PRESETS.Mixed!).slice(0, 6);
    this.watchlist = stored.length ? stored : PRESETS.Mixed!;
    this.targets = targets ?? local('targets') ?? {};
    this.book = book ?? local('book') ?? emptyBook(START_CASH);
    this.alerts = alerts ?? local('alerts') ?? {};
    this.trades = trades ?? local('trades') ?? [];
  }

  /** Judge Mode owns the watchlist too, so it can preset-switch during a demo. */
  async syncConfig() {
    const next = knownSymbols((await api.get<string[]>('watchlist')) ?? []);
    if (next.length && next.join() !== this.watchlist.join()) {
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
      this.runAlerts();
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
  runAlerts() {
    const now = Date.now();
    let dirty = false;
    for (const q of this.quotes) {
      const t = this.targets[q.symbol];
      if (!t) continue;
      const prev = this.alerts[q.symbol] ?? freshAlertState();
      const { state, alert } = pollAlert(prev, {
        symbol: q.symbol,
        price: q.price,
        changePct: q.changePct,
        targets: t,
        holds: (this.book.positions[q.symbol]?.qty ?? 0) > 0,
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

  plan(symbol: string, zone: 'buy' | 'sell', price: number) {
    if (zone === 'sell') {
      const held = this.book.positions[symbol]?.qty ?? 0;
      const cost = held * price;
      return { qty: held, cost, pctCash: this.book.cash > 0 ? Math.round((cost / this.book.cash) * 100) : 100 };
    }
    const sized = sizeQty(symbol, this.book.cash, price);
    // 5% of a small book can be less than one share; one affordable share beats nothing.
    const qty = sized > 0 ? sized : Math.floor(this.book.cash / price);
    const cost = qty * price;
    return { qty, cost, pctCash: this.book.cash > 0 ? Math.round((cost / this.book.cash) * 100) : 100 };
  }

  nextFlash() {
    if (this.flash || !this.queue.length) return;
    const a = this.queue.shift()!;
    const p = this.plan(a.symbol, a.zone, a.price);
    this.flash = { symbol: a.symbol, zone: a.zone, price: a.price, changePct: a.changePct, ...p };
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
    };
  }

  frame() {
    return buildFrame(this.view());
  }

  async draw() {
    const f = this.frame();
    if (this.bridge) await render(this.bridge, f);
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
        if (g === 'click') await this.execute(this.flash!.zone === 'buy' ? 'BUY' : 'SELL', this.flash!.symbol, this.flash!.qty, this.flash!.price, 'zone');
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
          else if (this.field === 2 && t.stop !== null) t.stop = Math.max(0.01, Math.round((t.stop + step) * 100) / 100);
          await this.draw();
        } else if (g === 'click') {
          this.field = (this.field + 1) % 4;
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
