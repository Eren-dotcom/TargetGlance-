# TargetGlance

**Glanceable buy-zone / sell-zone alerts for stocks + crypto on Even Realities G2.**
Set an entry and an exit zone, read a live range bar in half a second, paper-trade with one tap.
No broker or exchange API keys, no accounts, no real orders.

Track 03 — Exchanges & Stocks · 576×288 · Even G2

```
TARGETGLANCE  PAPER $10,000   +$0 open                                 ALL
>NVDA  ▼-13.8% 119.40  ● AH                              BUY 118-122 NOW
·  hold 4 +$0 · live now                                                                    ○○
 SOL   ▼-2.1%  142.50  ○ 24-7              ●─────── 178-182
·  buy 135-140 · stale 2m                                                                        ○○○
 BTC   ▲+0.8%  97k     ◌ 24-7                     ───●──── 105k
·  buy 92k · mock                                                                                     ○○○

SWIPE select   TAP edit   LONG portfolio
```

`●` live · `○` stale · `◌` mock — and the sub-row spells it out (`live now`, `stale 2m`,
`mock`) next to the position and its ladder rungs.

---

## Run it (10 seconds)

```bash
npm i
npm run dev          # http://localhost:5173  → the G2 app
```

Open **http://localhost:5173/companion.html** for Judge Mode (simulate a dip, force mock data,
seed a portfolio, reset). Everything is one process on one port: the app and its quote service
share an origin, so there is no CORS and no second terminal.

```bash
npm test             # 105 tests: alerts, ladder, PnL, parser, API, controller, layout, SDK page,
                     #   state trust boundary — plus the 90 s demo played against the live server
npm run probe        # can this machine reach Binance and Yahoo right now?
npm run proxy        # OPTIONAL: same quote service on :8787 if you want it separate
npm run pack         # build + evenhub pack → targetglance.ehpk
```

### In the Even Hub simulator

```bash
npx @evenrealities/evenhub-simulator http://localhost:5173
```

### On the glasses

`npm run pack` produces `targetglance.ehpk`, which `evenhub create` / `evenhub upload` accepts.
The packaged app needs a hosted copy of `dist/` (the dev server URL works on the same Wi-Fi).
Set that host in `app.json` → `permissions[0].whitelist` before packing — the G2 network
permission is a host whitelist, so an unlisted host fails silently.

---

## What it does

| Screen | Content |
|---|---|
| **Watchlist** | 3 assets, price, day move, session chip, freshness dot, distance-to-sell bar. Header shows paper equity and open PnL. |
| **Alert flash** | One line naming the zone (or rung, or stop), the price and the target; one paper order with its cost and share of cash; a single primary action. |
| **Editor** | Buy zone, sell zone, stop, take-profit rungs. Swipe to adjust, **tap to quick-set** (cycles −10 / −6 / −4 / +4 / +6 / +10 % from the current price), long-press to save. |
| **Portfolio** | Positions, average cost, unrealised PnL, cash and realised PnL (says "flat" when every trade is closed). |
| **Journal** | Last 5 trades with side, quantity, fill, realised PnL and time. |

**Gestures:** swipe up/down select · tap open/confirm · double-tap back (or cycle the
`ALL/STOCKS/CRYPTO` filter on the watchlist) · long-press portfolio, then journal.
On a laptop the same gestures are `↑ ↓ Enter Esc L`.

**Contextual menu** on the glasses: `Portfolio` · `Journal` · `Reset view` (the long-press
shortcut). **Temple hold** opens the mic and shows what to say; speech-to-text is not in this
build, so the phrase box in Judge Mode does the parsing.

**Emphasis on glass is one step:** the container is drawn at the default brightness normally and
at the bold step when a row needs you (`ZONE HIT`, `STOP HIT`, a price sitting in a zone).
Per-row shading is not a thing on this hardware, and the preview reflects that.

### The three ideas that make it more than a ticker

1. **Zones, not points.** `BUY 118-122` is a decision; `BUY 118.00` is a hope.
2. **The buy→sell loop is automatic.** Buy-zone alerts fire while you are flat, sell-zone
   alerts fire while you hold. After a paper buy the sell alert is armed by definition —
   there is no "armed" flag to desync, and nothing ever sells without an explicit tap.
3. **The exit is a ladder, not a hope.** While holding, the sell side becomes three rungs
   (`+15%`, `+30%`, your own sell zone) drawn under each row as `○○○ → ●○○ → ●●○ → ●●●`.
   A tap sells one third; the last rung sells what is left. A stop-zone breach exits the lot
   and says so. Never auto-sells.

### Honesty features (they matter to judges)

- `LIVE / DELAYED / STALE / MOCK` on every row, with the age of the tick.
- `LIVE / PRE / AH / CLOSED / 24-7` per asset, DST-correct for New York.
- `PAPER` in the header, `(paper only)` on stops, and every fill in the journal.
- Alerts are **in-session**: they fire while the app is open, plus the Judge Mode trigger.
  Even G2 background notification delivery is not used or claimed here.

---

## Paper trading rules

- Start with **$10,000**. Cash can never go negative.
- Buys size to **5% of available cash**; if 5% is less than one share, one affordable share.
  Stocks round down to whole shares; crypto keeps 6 decimals.
- Sells come from the ladder: **one third** of the position per rung, **the rest** at the final
  rung or on a stop. A tranche is cut in the asset's own lot size, so a stock ladder sells whole
  shares and a one-share lot exits whole instead of offering a flash that trades zero.
- The buy side means **start a position**. A buy-zone alert while you already hold is dropped
  rather than averaging up; while holding, the ladder is the sell side.
- Fills are the live price when you tap, never the target — no fantasy fills.
- Average cost per symbol; realised PnL on sell, unrealised on hold; total = cash + market value.
- **Undo for 5 s** restores the book, the journal and the alert state exactly.

## Alert rules

- Crossings only. Sitting in a zone never re-alerts. The first poll after the glasses wake up is
  a baseline: it records where each price is without announcing a zone the price was already in.
- Judge simulation is applied at read time, so clearing it moves the price back immediately
  instead of waiting out the 10 s cache.
- Hysteresis: leaving a zone needs a 0.25% move past its edge, so the boundary cannot flicker.
- 60 s cooldown **per rung**, so buy→sell and rung→rung are news, not repeats.
- On a wild day (≥ 7%), the price must hold in the zone for a second poll. A Judge Mode
  simulation skips that wait, because the judge is asking for the price on purpose.
- Stops are checked first: a paper position below its stop alerts `STOP HIT` before any zone.
- One flash on screen; up to 3 queued. Swipe = snooze for an hour.
- Never a sell or stop alert on a flat book, and never a countdown to a trade of zero.
- Saved state is parsed at the edge (`src/core/state.ts`): a malformed value falls back instead
  of blanking the glasses. `PUT` rejects prototype keys, over-deep JSON, an unknown session or a
  simulation beyond ±90% with a **422**.

## Data

```
GET /api/quotes?symbols=NVDA,SOL
[{ "symbol":"NVDA","price":138.2,"prevClose":132.6,"changePct":4.23,
   "session":"AH","source":"yahoo","stale":false,"mock":false,"ts":"…" }]
```

Crypto comes from Binance (quoted in USDT, shown as `≈$`), stocks from Yahoo's public chart
endpoint. 10 s cache; failures fall back to the last known price (`stale`) and then to a
deterministic mock (`mock`) — the badge always says which. Symbols are allowlisted in
`src/core/symbols.ts`; anything else is a 400.

State (`targets`, `book`, `alerts`, `trades`, `watchlist`) lives on the server behind
`GET/PUT /api/state/:key`, with `localStorage` as an offline cache. The phone and the glasses
are different storage origins on real hardware, so a shared server is what actually keeps them
in sync.

---

## The preview tells the truth

Hardware draws **one** text container at **one** brightness. Per-line shading is not a thing
there, so the browser mirror does not fake it: by default it renders the *hardware look* —
every line at the same weight, with `·` marking secondary rows (a 5 px dot replacing a 5 px
space, so no line grows past 576 px). `?look=preview` shows the shaded version for reading
screenshots, and the README says which one is real.

## Layout is measured, not guessed

The G2 font is proportional and a fullwidth glyph (`─ ● █`) is exactly 20 px, so 576 px holds
**28.8 characters** — box-drawing frames wrap and shred the layout. Every line is built by
`src/g2/frame.ts` and checked in `tests/layout.test.ts` with `@evenrealities/pretext`, the same
library calibrated against the firmware. That test also asserts the app never draws a glyph the
firmware lacks (`:`, `|`, `▪`, `↺`, `░` are missing at this weight) and that no screen exceeds
10 lines at the firmware's 27 px line height.

## Layout of the code

```
src/core/     pure logic, no DOM and no SDK — the tested part
              quotes · session · targets · alerts · paper · voice · format
src/g2/       frame (all 5 screens as strings) · look (hardware brightness) ·
              sdk (one text container) · main (controller) · mirror (browser, keyboard)
src/server/   quotes (sources, cache, fallback) · store · handler (framework-free router) · standalone
tests/        core · alerts · paper · server · app (controller lifecycle) · layout
```

`npm run proxy` and the dev server mount the **same** `src/server/handler.ts`, so there is one
implementation of the API and two hosts.

## What is deliberately not here

Cloud speech-to-text (needs a key or a Whisper install — the regex parser is wired to the
companion's text box and is ready for any STT), background push alerts, sparklines, event
badges, G2 contextual menus. Details and reasons: `PLAN.md` §3.

## Credits

Rules in `AGENTS.md` are [ponytail](https://github.com/DietrichGebert/ponytail) by Dietrich
Gebert (MIT, see `PONYTAIL-LICENSE`).
