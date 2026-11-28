import { PRESETS, SYMBOLS, knownSymbols } from '../core/symbols.ts';
import { describeIntent, parseTargets } from '../core/voice.ts';
import { defaultTargets, validateTargets, type Targets } from '../core/targets.ts';
import { START_CASH, emptyBook, buy, ladderFor, type Book } from '../core/paper.ts';
import { fmt as fmtPrice } from '../core/format.ts';
import { RANGES, stepLabel, type History, type Range } from '../core/candles.ts';
import { renderCandles } from '../g2/chart.ts';

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
  renderTargets();
  renderChartSymbols();
  void renderChart();
  void renderProviders();
  void renderTelegram();
  renderSim();
  renderToggles();
}

/** One row per symbol: what the glasses would alert on, and where the ladder sits. */
function renderTargets() {
  const targets = state.targets as Record<string, Targets>;
  const book = state.book as Book;
  $('targets').replaceChildren(
    ...(state.watchlist as string[]).map((sym) => {
      const t = targets[sym];
      const pos = book?.positions[sym];
      const rungs = t && pos && pos.qty > 0 ? ladderFor(pos.avgCost, t.sell.low) : [];
      const tr = document.createElement('tr');
      tr.innerHTML = t
        ? `<td>${sym}</td><td>${fmtPrice(t.buy.low)}-${fmtPrice(t.buy.high)}</td><td>${fmtPrice(t.sell.low)}-${fmtPrice(t.sell.high)}</td><td>${t.stop === null ? '<span class="dim">off</span>' : fmtPrice(t.stop)}</td><td>${rungs.length ? rungs.map(fmtPrice).join(' · ') : '<span class="dim">no position</span>'}</td>`
        : `<td>${sym}</td><td colspan="4" class="dim">defaults on first quote</td>`;
      return tr;
    }),
  );
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

/**
 * Simulate a move that lands just inside the target, so the demo does not depend on
 * guessing a percentage: "NVDA dip to 121.4 (-8.1%)".
 */
function moveTo(sym: string, zone: 'buy' | 'sell'): number | null {
  const q = quotes.find((x) => x.symbol === sym);
  const t = (state.targets as Record<string, Targets>)[sym];
  if (!q || !t || !q.price) return null;
  const dest = zone === 'buy' ? t.buy.high * 0.995 : t.sell.low * 1.005;
  return Math.round(((dest / q.price - 1) * 100) * 10) / 10;
}

/**
 * Keys are optional, so this table must read as information, not as a setup warning. It
 * shows a mask and the free-tier limit, because the limit is the reason a key exists.
 */
async function renderProviders() {
  let s: any = null;
  try {
    s = await fetch('/api/providers').then((r) => r.json());
  } catch {
    s = null;
  }
  const body = $('providers');
  if (!s) {
    body.replaceChildren(Object.assign(document.createElement('tr'), { innerHTML: '<td colspan="4" class="dim">provider status unavailable</td>' }));
    return;
  }
  body.replaceChildren(
    ...(s.providers as any[]).map((p) => {
      const tr = document.createElement('tr');
      const state = p.configured
        ? '<span class="good">key loaded</span>'
        : '<span class="dim">keyless</span>';
      tr.innerHTML = `<td>${p.label}${s.provider === p.name ? ' <span class="tag">preferred</span>' : ''}</td><td>${p.mask ?? '<span class="dim">—</span>'}</td><td class="dim">${p.freeTier}</td><td>${state}</td>`;
      return tr;
    }),
  );
}

/** Telegram bot status: booleans from the server, never the token. */
async function renderTelegram() {
  let s: any = null;
  try {
    s = await fetch('/api/telegram/status').then((r) => r.json());
  } catch {
    s = null;
  }
  $('tgStatus').innerHTML = !s
    ? '<span class="bad">status unavailable</span>'
    : s.configured
      ? s.paired
        ? '<span class="good">bot live · chat paired · alerts on</span>'
        : '<span class="good">bot live</span> · message the bot once to pair this chat'
      : '<span class="dim">not configured</span> — create a bot with @BotFather, set <code>TARGETGLANCE_TG_TOKEN</code> on the server, restart, then message the bot.';
}

/**
 * The big chart. It paints the exact byte map the glasses' image container gets, at 3×, so
 * "does my buy zone look realistic" can be answered on a laptop and trusted on glass.
 */
let chartRange: Range = '1D';

async function renderChart() {
  const canvas = $('chart') as HTMLCanvasElement;
  const sym = ($('chartSym') as HTMLSelectElement).value || (state.watchlist as string[])[0];
  if (!sym) return;
  for (const r of RANGES) $(`r${r}`).classList.toggle('on', r === chartRange);
  let h: History | null = null;
  try {
    const r = await fetch(`/api/candles?symbols=${encodeURIComponent(sym)}&range=${chartRange}`);
    if (r.ok) h = ((await r.json()) as History[])[0] ?? null;
  } catch {
    h = null;
  }
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  if (!h || !h.candles.length) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    $('chartMeta').textContent = 'no history for this symbol';
    return;
  }
  const q = quotes.find((x) => x.symbol === sym);
  const targets = (state.targets as Record<string, Targets>)[sym] ?? null;
  const map = renderCandles({ candles: h.candles, price: q?.price, targets, range: h.range });
  const img = ctx.createImageData(map.width, map.height);
  for (let i = 0; i < map.data.length; i++) {
    const v = map.data[i]!;
    img.data[i * 4] = v * 0.36;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v * 0.55;
    img.data[i * 4 + 3] = 255;
  }
  // Paint at 1× into an offscreen canvas, then blow it up without smoothing: the pixels
  // must stay pixels, exactly as they will look at 2× on the glass.
  const off = document.createElement('canvas');
  off.width = map.width;
  off.height = map.height;
  off.getContext('2d')?.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(off, 0, 0, canvas.width, canvas.height);
  const last = h.candles.at(-1)!;
  const first = h.candles[0]!;
  const pct = first.c > 0 ? ((last.c - first.c) / first.c) * 100 : 0;
  $('chartMeta').textContent = `${h.candles.length} bars · ${stepLabel(h.step)} · ${first.c > 0 ? `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%` : ''} · ${h.mock ? 'mock' : h.source}`;
}

function renderChartSymbols() {
  const sel = $('chartSym') as HTMLSelectElement;
  const keep = sel.value;
  sel.replaceChildren(
    ...(state.watchlist as string[]).map((sym) => {
      const o = document.createElement('option');
      o.value = sym;
      o.textContent = sym;
      return o;
    }),
  );
  if (keep && (state.watchlist as string[]).includes(keep)) sel.value = keep;
}

function renderSim() {
  const bySymbol = (state.watchlist as string[]).flatMap((sym) => {
    const dip = moveTo(sym, 'buy');
    const spike = moveTo(sym, 'sell');
    const mk = (label: string, pct: number | null) => {
      const b = document.createElement('button');
      b.textContent = pct === null ? `${sym} ${label}` : `${sym} ${label} ${pct > 0 ? '+' : ''}${pct}%`;
      b.disabled = pct === null;
      b.title = pct === null ? 'No target set — set a zone first' : `Force this symbol to ${label} into its zone`;
      b.onclick = async () => {
        judge.sim = { ...judge.sim, [sym]: pct! };
        await postJudge({ sim: judge.sim });
        await refreshQuotes();
        renderSim();
      };
      return b;
    };
    return [mk('dip to', dip), mk('spike to', spike)];
  });
  const clear = document.createElement('button');
  clear.textContent = 'Clear sim';
  clear.onclick = async () => {
    judge.sim = {};
    await postJudge({ sim: {} });
    await refreshQuotes();
    renderSim();
  };
  $('sim').replaceChildren(...bySymbol, clear);
}

function renderToggles() {
  $('mock').classList.toggle('on', judge.mock);
  $('stale').classList.toggle('on', judge.forceStale);
  ($('session') as HTMLSelectElement).value = judge.session;
}

async function refreshQuotes() {
  state.targets = (await get('targets')) ?? state.targets;
  state.book = (await get('book')) ?? state.book;
  renderTargets();
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
  const [trades, alerts, book] = await Promise.all([get('trades'), get('alerts'), get('book')]);
  $('log').textContent = JSON.stringify({ alerts, positions: book?.positions ?? {}, trades: (trades ?? []).slice(0, 5) }, null, 1);
}

/** clipboard is blocked in some frames, so fall back to selecting the text. */
async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    const range = document.createRange();
    const pre = $('log');
    range.selectNodeContents(pre);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
    return 'selected — press Ctrl/Cmd+C';
  }
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
    // A `stop 110` phrase used to parse and then be thrown away by this spread.
    const next = {
      ...base,
      ...(intent.buy ? { buy: intent.buy } : {}),
      ...(intent.sell ? { sell: intent.sell } : {}),
      ...(intent.stop !== undefined ? { stop: intent.stop } : {}),
    };
    const problems = validateTargets(next as Targets, price);
    if (problems.length) {
      $('parseOut').textContent = `${describeIntent(intent)} — rejected: ${problems.join(', ')}`;
      return;
    }
    targets[intent.symbol] = next as Targets;
    await put('targets', targets);
    $('parseOut').textContent = `saved ${describeIntent(intent)}`;
  };

  // Voice in: the browser's own speech recognition fills the phrase box, then the exact
  // same parser path as typing runs. No key, no server, no audio leaves the browser.
  const SR = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
  $('mic').onclick = () => {
    if (!SR) {
      $('parseOut').textContent = 'voice is not supported in this browser — Chrome (desktop/Android) has it built in; typing works everywhere';
      return;
    }
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    const btn = $('mic') as HTMLButtonElement;
    btn.textContent = '🎤 Listening…';
    rec.onresult = (e: any) => {
      const said = e.results[0][0].transcript as string;
      ($('phrase') as HTMLInputElement).value = said;
      $('parseOut').textContent = `heard: "${said}"`;
      ($('parse') as HTMLButtonElement).click();
    };
    rec.onerror = () => {
      $('parseOut').textContent = 'voice did not catch that — try again or type it';
    };
    rec.onend = () => (btn.textContent = '🎤 Speak');
    rec.start();
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

  for (const r of RANGES) {
    $(`r${r}`).onclick = () => {
      chartRange = r;
      void renderChart();
    };
  }
  ($('chartSym') as HTMLSelectElement).onchange = () => void renderChart();

  $('refreshLog').onclick = () => void refreshLog();
  $('copyLog').onclick = async () => {
    $('probeOut').textContent = await copyText($('log').textContent ?? '');
  };
  $('copyJournal').onclick = async () => {
    $('probeOut').textContent = await copyText(JSON.stringify((await get('trades')) ?? [], null, 2));
  };
  $('export').onclick = async () => {
    const trades = (await get('trades')) ?? [];
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), trades }, null, 2)], {
      type: 'application/json',
    });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'targetglance-journal.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
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
  // The chart follows the quote (last bar = live price), on the same cadence.
  setInterval(() => void renderChart(), 15_000);
  setInterval(() => void refreshLog(), 10000);
}

void boot();
