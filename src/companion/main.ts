import { PRESETS, SYMBOLS, knownSymbols } from '../core/symbols.ts';
import { describeIntent, parseTargets } from '../core/voice.ts';
import { defaultTargets, validateTargets, type Targets } from '../core/targets.ts';
import { START_CASH, emptyBook, buy } from '../core/paper.ts';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const state: Record<'targets' | 'book' | 'alerts' | 'trades' | 'watchlist', unknown> = {
  targets: {}, book: null, alerts: {}, trades: [], watchlist: PRESETS.Mixed!,
};
let judge = { mock: false, forceStale: false, session: 'auto', sim: {} as Record<string, number> };
let quotes: any[] = [];

const get = async (key: string) => {
  const r = await fetch(`/api/state/${key}`);
  return r.ok ? r.json() : null;
};
const put = (key: string, value: unknown) =>
  fetch(`/api/state/${key}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
const postJudge = (patch: unknown) => fetch('/api/judge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) });

async function loadAll() {
  const [watchlist, targets, book, alerts, trades, j] = await Promise.all([
    get('watchlist'), get('targets'), get('book'), get('alerts'), get('trades'), fetch('/api/judge').then((r) => r.json()),
  ]);
  state.watchlist = knownSymbols(watchlist ?? PRESETS.Mixed!);
  state.targets = targets ?? {};
  state.book = book ?? emptyBook(START_CASH);
  state.alerts = alerts ?? {};
  state.trades = trades ?? [];
  judge = j;
  renderChips();
  renderSim();
  renderToggles();
}

function renderChips() {
  const list = state.watchlist as string[];
  $('chips').replaceChildren(
    ...list.map((sym) => {
      const b = document.createElement('button');
      b.textContent = `${sym} ✕`;
      b.title = 'Remove from watchlist';
      b.onclick = async () => {
        state.watchlist = list.filter((s) => s !== sym);
        await put('watchlist', state.watchlist);
        renderChips();
      };
      return b;
    }),
  );
  if (!list.length) $('chips').textContent = 'empty';
}

function renderSim() {
  $('sim').replaceChildren(
    ...(state.watchlist as string[]).flatMap((sym) => {
      const mk = (label: string, pct: number) => {
        const b = document.createElement('button');
        b.textContent = `${sym} ${pct > 0 ? '+' : ''}${pct}%`;
        b.onclick = async () => {
          judge.sim = { ...judge.sim, [sym]: pct };
          await postJudge({ sim: judge.sim });
          void refreshQuotes();
        };
        return b;
      };
      return [mk('dip', -13), mk('spike', 27)];
    }),
  );
}

function renderToggles() {
  $('mock').classList.toggle('on', judge.mock);
  $('stale').classList.toggle('on', judge.forceStale);
  ($('session') as HTMLSelectElement).value = judge.session;
}

async function refreshQuotes() {
  const syms = (state.watchlist as string[]).join(',');
  quotes = syms ? await fetch(`/api/quotes?symbols=${syms}`).then((r) => r.json()) : [];
  const now = Date.now();
  $('quotes').replaceChildren(
    ...quotes.map((q) => {
      const tr = document.createElement('tr');
      const age = Math.round((now - Date.parse(q.ts)) / 1000);
      tr.innerHTML = `<td>${q.symbol}</td><td>${q.price}</td><td class="${q.changePct >= 0 ? 'good' : 'bad'}">${q.changePct >= 0 ? '+' : ''}${q.changePct}%</td><td>${q.session}</td><td><span class="tag ${q.mock ? 'mock' : q.stale ? 'stale' : ''}">${q.mock ? 'MOCK' : q.stale ? 'STALE' : q.source.toUpperCase()}</span></td><td class="dim">${age}s</td>`;
      return tr;
    }),
  );
}

async function refreshLog() {
  const trades = (await get('trades')) ?? [];
  const alerts = (await get('alerts')) ?? {};
  $('log').textContent = JSON.stringify({ alerts, trades: trades.slice(0, 5) }, null, 1);
}

function wire() {
  $('add').onclick = async () => {
    const raw = ($('sym') as HTMLInputElement).value;
    const next = knownSymbols([...(state.watchlist as string[]), ...raw.split(',')]);
    if (next.length === (state.watchlist as string[]).length) {
      $('parseOut').textContent = `unknown symbol: ${raw}`;
      return;
    }
    state.watchlist = next;
    await put('watchlist', next);
    ($('sym') as HTMLInputElement).value = '';
    renderChips();
    renderSim();
    void refreshQuotes();
  };

  $('presets').replaceChildren(
    ...Object.entries(PRESETS).map(([name, syms]) => {
      const b = document.createElement('button');
      b.textContent = name;
      b.onclick = async () => {
        state.watchlist = syms;
        await put('watchlist', syms);
        renderChips();
        renderSim();
        void refreshQuotes();
      };
      return b;
    }),
  );

  $('parse').onclick = async () => {
    const phrase = ($('phrase') as HTMLInputElement).value;
    const intent = parseTargets(phrase, Object.keys(SYMBOLS));
    if (!intent) {
      $('parseOut').textContent = 'no symbol or price found — try "SOL buy 140 sell 180"';
      return;
    }
    const targets = state.targets as Record<string, Targets>;
    const price = quotes.find((q) => q.symbol === intent.symbol)?.price;
    const base = targets[intent.symbol] ?? defaultTargets(price ?? SYMBOLS[intent.symbol]!.mock);
    const next = { ...base, ...(intent.buy ? { buy: intent.buy } : {}), ...(intent.sell ? { sell: intent.sell } : {}) };
    const problems = validateTargets(next as Targets, price);
    if (problems.length) {
      $('parseOut').textContent = `${describeIntent(intent)} — rejected: ${problems.join(', ')}`;
      return;
    }
    targets[intent.symbol] = next as Targets;
    await put('targets', targets);
    $('parseOut').textContent = `saved ${describeIntent(intent)}`;
  };

  $('mock').onclick = async () => {
    judge.mock = !judge.mock;
    await postJudge({ mock: judge.mock });
    renderToggles();
    void refreshQuotes();
  };
  $('stale').onclick = async () => {
    judge.forceStale = !judge.forceStale;
    await postJudge({ forceStale: judge.forceStale });
    renderToggles();
    void refreshQuotes();
  };
  ($('session') as HTMLSelectElement).onchange = async (e) => {
    judge.session = (e.target as HTMLSelectElement).value as typeof judge.session;
    await postJudge({ session: judge.session });
  };
  $('clearSim').onclick = async () => {
    judge.sim = {};
    await postJudge({ sim: {} });
    void refreshQuotes();
  };

  $('seed').onclick = async () => {
    // Deterministic book so the portfolio screen has something to show on stage.
    let book = emptyBook(START_CASH);
    const prices = Object.fromEntries(quotes.map((q) => [q.symbol, q.price]));
    for (const sym of ['NVDA', 'SOL']) {
      const price = prices[sym] ?? (SYMBOLS[sym]?.mock ?? 100);
      const qty = sym === 'NVDA' ? 10 : 5;
      if (qty * price < book.cash) book = buy(book, sym, qty, round2(price * 0.92), 'manual', new Date()).book;
    }
    await put('book', book);
    await refreshLog();
  };

  $('resetAlerts').onclick = async () => {
    await put('alerts', {});
    await refreshLog();
  };
  $('reset').onclick = async () => {
    await postJudge({ reset: true, resetState: true });
    state.watchlist = PRESETS.Mixed!;
    await put('watchlist', PRESETS.Mixed!);
    await loadAll();
    await refreshQuotes();
    await refreshLog();
  };

  $('probe').onclick = async () => {
    $('probeOut').textContent = 'probing…';
    const r = await fetch('/api/probe').then((x) => x.json());
    $('probeOut').textContent = Object.entries(r)
      .map(([k, v]) => `${k}: ${v}`)
      .join('  ·  ');
  };

  $('refreshLog').onclick = () => void refreshLog();
  $('export').onclick = async () => {
    const trades = (await get('trades')) ?? [];
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), trades }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'targetglance-journal.json';
    a.click();
    URL.revokeObjectURL(a.href);
  };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function boot() {
  wire();
  await loadAll();
  await refreshQuotes();
  await refreshLog();
  const health = await fetch('/health').then((r) => r.json()).catch(() => null);
  $('health').textContent = health?.ok ? 'service ok' : 'service offline';
  setInterval(() => void refreshQuotes(), 5000);
  setInterval(() => void refreshLog(), 10000);
}

void boot();
