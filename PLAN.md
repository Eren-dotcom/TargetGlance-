# TargetGlance — Build Plan & Analysis

**Track 03 (Exchanges & Stocks) · Even Realities G2 · 576×288**

> Glanceable buy-zone / sell-zone alerts for **stocks + crypto** on Even G2.
> Set entry and exit zones, see a live range bar, execute 1-tap **paper** trades.
> No broker or exchange API keys.

Built with the **[ponytail](https://github.com/DietrichGebert/ponytail) "lazy senior dev" rules**
(MIT, vendored as `AGENTS.md`): smallest complete change, name what you skip, no code
nobody asked for. Every place this plan deletes something the attached docs asked for is
listed in §3 and §15.

---

## 1. What the two input documents agree on

| Area | Plan decision |
|---|---|
| Core promise | 0.5-second glanceable buy/sell discipline, not liquidation panic |
| Differentiator | Stocks **and** crypto in one watchlist (most Track 03 builds are crypto-only) |
| Signature UI | Unicode range bar: `BUY 120 [────●──] 150 SELL` |
| Safety | Paper only. No real orders, no keys, 5-second undo |
| Demo insurance | "Judge Mode" companion page: simulate dip/spike, fake clock, reset |
| Honesty | Data-quality badges (`LIVE / DELAYED / STALE / MOCK`), session labels |

Both docs are sound. The work below keeps every P0 behaviour and fixes the parts that
would break on the judge's machine or on real hardware.

---

## 2. Analysis — where the attached plan would have failed

### 2.1 Two processes, two origins (fixed)

The docs specify a Vite app on `:5173` calling a Node proxy on `:8787`. On real hardware the
G2 app is **packed and loaded from Even's WebView**, where `app.json` network permissions use a
host **whitelist** — `http://localhost:8787` is a separate origin, a CORS preflight, and a
whitelist entry. That is three ways for a 10-second demo to fail.

**Fix:** the quote service is a *module*, mounted in **two places** — a Vite middleware plugin
(dev, one process, one origin, relative `/api/...`) and a 20-line standalone Node server
(`npm run proxy`, port 8787) for anyone who wants a separate host. The G2 app only ever calls
relative `/api/quotes`, so there is no CORS, no second port to forget, and the packaged app
needs exactly one host in its whitelist.

### 2.2 "Companion syncs to localStorage" does not work on hardware (fixed)

The docs say the phone companion writes targets to `localStorage` and "syncs instantly to the
G2 display". The phone browser and the Even App WebView are **different storage origins** on
real hardware — the phone would set targets the glasses never see. It only appears to work in
the simulator, where both pages share one WebView.

**Fix:** targets, paper book, alert state and trade log live on the **server** behind one tiny
generic endpoint (`GET/PUT /api/state/:key`), with `localStorage` as an offline cache. Same code
works in the simulator, in a browser preview, and on a phone + glasses pair.
`shortcut:` last-write-wins, single user. Upgrade to per-device revisions if this ever gets a
second user.

### 2.3 "Zero API keys" was true but fragile (kept, guarded)

The judge's machine may be geo-blocked or rate-limited from Binance/Yahoo (this sandbox is —
both are unreachable here, which is exactly the failure mode to expect on demo day).

**Fix:** 10 s cache, `Promise.allSettled` per source, per-symbol last-known-good, deterministic
mock fallback, and a visible badge on every row. `npm run probe` prints the status of each
upstream in 2 seconds so the demo can start on the mock path deliberately, not by accident.

### 2.4 Alerts are in-session only (stated, not faked)

Even G2 background push is not verified. The docs already hedge this; the README states it
plainly: alerts fire **while the app is open**, plus the Judge Mode trigger. No claim is made
about background notifications.

### 2.5 Voice-set targets (narrowed, honestly)

Regex parsing is kept and tested (`"SOL buy 140 sell 180"`, `"BTC buy 92k sell 105k"`,
`"NVDA buy 118-122 sell 148-152"`). Speech-to-text is **cut**: the G2 mic gives raw PCM, and
turning PCM into text needs either a cloud key (breaks the zero-key claim) or a local Whisper
install (breaks the 10-second run). The parser is wired to a text box on the companion page and
is ready for any STT later — the hard, testable half ships.

### 2.6 UI assumptions corrected against the real SDK

Verified against `@evenrealities/even_hub_sdk@0.0.16` and `@evenrealities/pretext@0.1.4`:

- The G2 font **is proportional**, and fullwidth glyphs (`─ ● ◆ █ │`) are a hard **20 px**.
  576 px / 20 px = **28.8 characters** — the docs' `┌──│└` box frames would wrap and shred the
  layout. Screen art is now plain text rows, and every line is measured with `pretext` so it can
  never wrap. `pxTruncate` guards long symbols.
- `:`, `|`, `▪`, `↺`, `✕`, `░` are **missing glyphs** at this weight — banned from the UI.
- `🟢`/`⚠` render as 4 px placeholder boxes; state is shown with `●`/`○`/`◆` + words instead.
- A full-screen text container at `0,0 576×288` with `isEventCapture: 1` passes the SDK's page
  validator, needs **one** container, and one `textContainerUpgrade` per frame is the flicker-free
  path the docs wanted. So the whole app is **one text container**, not 5 screens of widgets:
  screens are pure string builders, input is `textEvent` (`CLICK`, `SCROLL_TOP`, `SCROLL_BOTTOM`,
  `DOUBLE_CLICK`, `LONG_PRESS`).

### 2.7 Auto-flip sell logic simplified (deleted state)

The docs model an explicit `armed` buy/sell flag that auto-flips. The rule that produces the
same behaviour with no state: **buy-zone alerts fire when you are flat, sell-zone alerts fire
only when you hold.** After a paper buy you are holding, so the sell alert is armed by
definition; before it, a sell alert would have nothing to sell. Auto-arm, never auto-sell,
zero flags, nothing to desync.

---

## 3. Final scope

### Ship (P0)

1. **Watchlist** — 3 rows, range bar, session chip, freshness dot, paper PnL header.
2. **Quick target editor** — buy zone, sell zone, stop; swipe adjust, tap to switch field,
   quick-set −5 % / −10 % / +5 % / +10 %.
3. **Alert state machine** — crossing-only, hysteresis, 60 s cooldown, one flash at a time with a
   queue, 1 h snooze, persisted.
4. **Alert flash** — one primary action (tap = paper buy/sell), swipe = dismiss.
5. **Paper trade + 5 s undo** — exact state restore. Buy arms the sell alert. Never auto-sells.
6. **Portfolio + PnL** — unrealised, realised, cash, total return.
7. **Trade journal** — last 10 trades, JSON export from the companion.
8. **Judge Mode companion** — simulate dip/spike, fake session clock, force stale/mock, seed
   portfolio, reset, live alert + trade log, poll interval, target text box + voice-phrase parser.
9. **Session labels** — `LIVE / PRE / AH / CLOSED / 24-7`, DST-correct via `Intl` (America/New_York).
10. **Data-quality badges** — `LIVE / DELAYED / STALE / MOCK` + "12s ago".
11. **Quote service** — Binance + Yahoo, 10 s cache, allowlist, per-source `allSettled`, mock
    fallback, `/health`, `/api/probe`.
12. **Tests + README** — `npm i && npm run dev` and nothing else.

### Ship because it was nearly free (P1)

13. Zone targets (`118-122`) as well as point targets; one parser handles both.
14. Stop / invalidation zone, paper only — checked before zones, exits the lot, says `STOP HIT`.
14b. **Take-profit ladder** (was P2, promoted): while holding, the sell side *is* three rungs.
15. Falling-knife confirmation: normal ticks alert on crossing, a wild tick (≥ 7 % on the day)
    must hold for 2 polls.
16. Smart sizing: 5 % of cash, whole shares for stocks, fractional for crypto.
17. Asset-class filter `ALL / STOCKS / CRYPTO` on the list (long-press).
18. Presets: Megacap / Crypto majors — as companion buttons that fill the watchlist.

### Cut, and named (ponytail rule 1)

| Cut | Why |
|---|---|
| Cloud STT / Whisper | Needs a key or a heavy local install; regex parser ships instead |
| Background push alerts | Not verified on G2; claiming it is a demo-day bug |
| ~~Scaled take-profit ladder (P2)~~ | **Promoted to P0.** It needed no new state: rungs are `ladderFor(avgCost, sellLow)`, derived each poll, and "sell one third" is one line in `plan()`. It also fixed a real flaw — see §17. |
| Portfolio heat strip (P2) | The rungs under each row already answer "how far to sell" |
| Animations / transitions | Text containers have no tweening; `textColor` + `●` is the whole budget |
| G2 contextual-menu presets | Menu items need 32-byte names and a rebuild per switch, for a control the phone already has |
| Event badges (earnings/ex-div/FOMC) | Needs a data source or hand-maintained dates; a wrong date costs credibility |
| Order book, candles, LLM chat, auth, social | Explicitly in the docs' "do not add" list |
| Vite SSR / router / state library | One screen at a time, one `AppFrame` object; a router would be bigger than the app |

---

## 4. Architecture

```
                    ┌─────────────────── one origin, no CORS ───────────────────┐
 phone / judge  ──► │ companion.html                     (Judge Mode, targets)  │
 G2 WebView     ──► │ index.html  ──► src/g2/main.ts  (one text container)      │
 simulator      ──► │                      │                                    │
                    │                      ▼                                    │
                    │        /api/quotes  /api/state/:key  /api/judge  /health  │
                    │                      │                                    │
                    │        src/server/quotes.ts  ◄── Binance · Yahoo · Mock   │
                    └───────────────────────────────────────────────────────────┘
```

- **`src/core/*` — pure, no DOM, no SDK.** Range bar, session clock, target validation, alert
  state machine, paper book, PnL, undo, voice parser. This is what the tests hammer.
- **`src/g2/*` — the view.** `frame.ts` builds an `AppFrame` (screen + lines) from state;
  `sdk.ts` pushes it to the glasses via `textContainerUpgrade`; `mock.ts` renders the same frame
  into a 576×288 DOM box so the app is usable in a plain browser (and in the Arena preview)
  without the simulator.
- **`src/server/*` — the service.** `quotes.ts` (sources + cache + judge sim), `store.ts`
  (k/v state + judge overrides), `handler.ts` (framework-free request router). Mounted by
  `vite.config.ts` (dev) and `src/server/standalone.ts` (`npm run proxy`, :8787).
- **Build:** `npm run build` → `dist/` → `evenhub pack app.json dist`.

---

## 5. Data contracts

### `GET /api/quotes?symbols=NVDA,SOL`

```json
[{ "symbol":"NVDA", "price":138.2, "prevClose":132.6, "changePct":4.23,
   "session":"AH", "source":"yahoo", "stale":false, "mock":false, "ts":"2026-11-27T12:00:04Z" }]
```

Rules: allowlisted symbols only (400 otherwise); cache 10 s per symbol; per-source
`Promise.allSettled`; failure → last-known-good with `stale: true`; nothing known → deterministic
mock with `mock: true`; crypto quotes are USDT and the UI prints `≈$`.

### `GET /api/state/:key` · `PUT /api/state/:key` (JSON body)

Keys: `targets`, `book`, `alerts`, `trades`. Unknown key → 400. Body ≤ 64 KB.
`shortcut:` last-write-wins, no auth, single user on localhost.

### `GET|POST /api/judge`

```json
{ "mock": false, "forceStale": false, "session": "auto",
  "sim": { "NVDA": { "pct": -13.8 } }, "pollMs": 5000 }
```

`session`: `auto | LIVE | PRE | AH | CLOSED | 24-7`. `sim` is a per-symbol override that
replaces the live price until cleared — this is what makes the 90-second demo deterministic.

### `GET /health` → `{"ok":true,"ts":"…"}` · `GET /api/probe` → upstream status

### Storage (server primary, `localStorage` cache)

```
targetglance_targets  { "NVDA": { buy: {low,high}, sell: {low,high}, stop: null } }
targetglance_book     { cash: 10000, positions: { NVDA: {qty, avgCost, realized} } }
targetglance_alerts   { "NVDA": { zone: "buy", lastPrice, lastAlertAt, snoozedUntil, held } }
targetglance_trades   [ { symbol, side, qty, price, reason, pnl, ts } ]   // last 10
```

---

## 6. Screens (576×288, ~10 lines of 27 px, ≤ 112 chars/line, measured)

Type is ~10 px tall; rows are padded and measured with `pretext.getTextWidth`, header aligned
with spaces, never tabs.

**S1 Watchlist** — `▲`/`▼` + percent, `●` freshness (`●` ok, `○` stale), session chip, bar.
```
TARGETGLANCE   PAPER $10,340  +3.4%  ●
> NVDA   ≈$138.20  AH +4.2%   BUY 118-122 ────────●── 148-152 SELL
  SOL    ≈$142.50  24/7 -2.1%  BUY 139-141 ●─────────── 178-182 SELL
  BTC    ≈$97,400  24/7 +0.8%  BUY 92k     ──────●───── 105k SELL
```
**S2 Alert flash** — huge one-liner, single action, undo toast afterwards.
```
● BUY ZONE HIT · NVDA @ $119.40
Target 118-122 · -13.8% today
Paper buy 4 NVDA · $477 (5% cash)
[TAP = YES]     [SWIPE = DISMISS]
```
**S3 Editor** — one field selected; swipe adjusts by a step that follows the price magnitude.
```
EDIT · NVDA  ≈$138.20   ▲+4.2%  AH
> Buy zone    118 - 122    (-5%  -10%)
  Sell zone   148 - 152    (+5%  +10%)
  Stop        110.00
  Held        10 sh · +$182.00
SWIPE: -/+ step · TAP: next · LONG: save+back
```
**S4 Portfolio / journal** — toggled by long-press on S1.
```
PAPER PORTFOLIO  $10,340  +3.4%
NVDA  10 sh  avg 119.40  +$188.00
SOL   5 SOL  avg 139.80  +$13.50
Cash $8,259  Realised +$127.20
LONG: journal · TAP: back
```

Input map: `SCROLL_TOP/BOTTOM` = move selection · `CLICK` = open/confirm ·
`DOUBLE_CLICK` = back · `LONG_PRESS` = portfolio/journal. One primary action per screen,
swipe always dismisses — no double-tap-to-dismiss anywhere (glasses ambiguity).

---

## 7. Alert state machine (F03)

Per symbol, persisted in `targetglance_alerts`:

```
zone: null | buy | sell      (zone we were last inside)
held: int                    (consecutive polls inside the zone)
```

On each poll, `next(p) = zoneOf(price)`:

| From | To | Action |
|---|---|---|
| `null` | `buy` | confirm → **TRIGGERED** `buy` |
| `null` | `sell` | confirm → **TRIGGERED** `sell` (only if holding) |
| `buy` | `null` | clear (needs price > buy.high × 1.0025 — hysteresis) |
| `buy` | `sell` | **TRIGGERED** `sell` (crossed the whole band) |
| same | same | nothing — **no re-alert while in the zone** |

Guards: 60 s cooldown per symbol **per zone** (a buy→sell crossing is news, not a repeat);
one flash on screen, the rest queue (max 3, drop oldest);
snooze 1 h; `held` must reach 1 normally, 2 when `|changePct| ≥ 7` (falling-knife). Snooze and
cooldown are ignored by the Judge Mode trigger so a rehearsal is always one tap.

---

## 8. Paper rules (F07, F10, PnL)

- Start cash **$10,000**. Cash can never go negative: order qty is clamped to affordable.
- Sizing 5 % of cash; stocks round **down** to whole shares (an unaffordable stock shows
  `no cash`, not a silent 0-share trade); crypto 6 decimals.
- Average cost per symbol; realised PnL on sell = `(price − avgCost) × qty`; unrealised =
  `(last − avgCost) × qty`; total = cash + market value.
- Undo: the pre-trade snapshot (`book` + `trades` + `alerts`) is kept for 5 s and restored
  byte-for-byte; a second trade inside the window clears the undo.
- Fill price is the live price at confirmation, not the target — no fantasy fills.

---

## 9. Sessions

Crypto `24-7`. Stocks, computed in `America/New_York` through `Intl` (DST-correct):
`04:00–09:30 PRE`, `09:30–16:00 LIVE`, `16:00–20:00 AH`, otherwise `CLOSED`; weekends `CLOSED`.
`shortcut:` no holiday calendar (US market holidays show `LIVE`), upgrade if this outlives the demo.
Yahoo's own `marketState` overrides the clock when it disagrees.

---

## 10. Judge Mode companion

`companion.html` — one page, no framework: watchlist editor + target text box + the controls
below, all writing through `/api/judge` and `/api/state`.

`Simulate −12 %` / `Simulate +12 %` per symbol · `Clear sim` · `Force mock` · `Force stale` ·
`Session: auto/LIVE/PRE/AH/CLOSED` · `Seed portfolio` · `Reset everything` · poll interval ·
live `/api/quotes` table · alert + trade log · journal JSON export.

---

## 11. File map

```
PLAN.md · AGENTS.md · README.md · app.json · index.html · companion.html
package.json · tsconfig.json · vite.config.ts
src/core/     quotes.ts alerts.ts paper.ts targets.ts session.ts voice.ts
src/g2/       frame.ts main.ts sdk.ts mock.ts screens/ (in frame.ts)
src/server/   quotes.ts store.ts handler.ts standalone.ts
tests/        core.test.ts alerts.test.ts server.test.ts
```

## 12. Tests (`npm test`, node's runner via vitest)

Range bar clamp at both ends and the zone edges · session labels at DST boundaries and weekends ·
alert crossing-only, no re-alert inside a zone, hysteresis, cooldown, queue, falling-knife hold ·
buy arms sell and never auto-sells · PnL average cost, realised vs unrealised, undo restores
exactly, cash never negative, whole-share rounding · target validation (`buy < sell`, positives,
far-target warning) · candle bitmap pixel contract (one byte per pixel, never empty, only the
price line spans the frame, out-of-window zones stay off the edge) · history parsers reject
null bars and bodies outside their wick · state trust boundary (junk, prototype keys, deep nesting, unknown symbols
dropped) · mock run over real HTTP · voice parser (`140`, `92k`, `135-140`, symbol-only, junk) · quote fallback
(mock, stale, sim override, allowlist 400) · layout: every rendered line ≤ 576 px measured with
`pretext`, so a long symbol can never wrap the glasses UI.

## 13. Demo script (90 s)

1. Open the watchlist — three assets, bars, session chips, `●` freshness.
2. Companion: `Drop NVDA −13 %` → G2 flashes `BUY ZONE HIT · NVDA @ $119.40`.
3. Tap → `Bought 4 NVDA @ $119.40 · Undo 5s`, sell alert armed.
4. Companion: `Spike NVDA +27 %` → sell-zone flash → tap → realised gain in the portfolio.
5. Long-press: portfolio and journal, `Cash` never negative.
6. `Force mock` → badges flip to `MOCK`; `Reset` → clean slate, ready for the next judge.

## 14. Risks

| Risk | Mitigation |
|---|---|
| Binance/Yahoo geo-blocked on demo day | mock fallback + `npm run probe` + `Force mock` |
| Judges ask "is this real money?" | `PAPER` in the header, `(paper only)` on stops, README §PnL |
| Font/glyph mismatch vs simulator | every line measured with `pretext`, banned-glyph list, verified on the sim |
| Alert fires twice in one zone | crossing-only + hysteresis + 60 s cooldown, covered by tests |
| Companion and glasses out of sync | all state on the server, single source of truth |

## 15. Ponytail ledger

Skipped: cloud STT, background push, TP ladder, heat strip, animations, G2 menus, event badges
(§3).

Not checked here: **live** Binance/Yahoo responses and **on-glasses** rendering — both networks
are unreachable from this sandbox and I have no hardware. The live path is written against the
documented response shapes and exercised with stubbed responses in `tests/server.test.ts`; the
framing is verified against `pretext`'s firmware-calibrated metrics and the SDK's own page
validator, not against a photo of the hardware.

Risk: if either upstream changes shape, rows fall back to `STALE`/`MOCK` with the badge visible
rather than showing a wrong number. Risk: real G2 text may wrap a line this plan thinks fits;
`MAX_CHARS` and the measured test are the guard, and the first hardware run should re-check
`tests/layout.test.ts` widths.

## 16. Round two: polish, and the four things it caught

Everything below was found by walking the demo script against the real modules, not by taste.

1. **A simulated dip never fired.** Judge Mode forces `NVDA -13.8 %`, which trips the
   falling-knife hold (two polls). The demo would sit silent for 10 seconds. Fixed: a quote
   carrying `simPct` is deliberate, so it skips the hold. The hold still guards real ticks.
2. **The ladder could place a rung above the user's own sell zone** (`137 / 148 / 155` with a
   sell zone at `148-152`), so that rung could never fire before the zone took the position.
   Fixed: rungs are capped at the sell zone, and while holding the first rung *is* the sell
   edge. The user's own target always wins a disagreement with the app.
3. **The last rung sold one third instead of the rest.** Walking up through the ladder left
   shares behind with no rung left to sell them. Fixed: the final rung and a stop both exit
   the lot (`final` on the alert, not a new flag in state).
4. **The preview lied about brightness.** Hardware draws one container at one brightness, so
   the five-level shading in the browser was fiction. Fixed: `src/g2/look.ts` collapses the
   frame to what firmware can show, using `·` — a 5 px dot that exactly replaces the 5 px
   space it displaces, because `=` (10 px) pushed full lines to 590 px and wrapped them.

Also in this round: a per-symbol **targets and ladder table** in the companion (it could set
targets but not see them), simulate buttons that compute the exact move into a zone instead of
guessing `-13 %`, copy-to-clipboard for the journal (a download is blocked in embedded frames),
explicit freshness text per row (`live now` / `stale 2m` / `mock`), and one shared price
formatter (`src/core/format.ts`) after `g2/fmt.ts` drifted from the companion's copy.

## 17. Round three: what a second pass over real paths found

1. **Mock prices moved in lockstep.** The mock wobble keyed off `symbol.length`, so BTC, ETH
   and SOL all printed `+0.807%` — nobody believes three majors move together. Now a per-symbol
   FNV hash seeds the wobble: `+2.5% / +0.7% / −0.9%`.
2. **A simulation was baked into the cache.** Set a sim, and for the next 10 s a cached read
   returned it; clear the sim, and the price stayed wrong until the cache expired. Sim is now
   applied at read time (`simulate()`), so clearing it is instant.
3. **The startup page was never validated.** A rejected page is a blank pair of glasses. The
   exact payload `connect()` sends now runs through the SDK's own `validateEvenHubPageContainer`
   in `tests/sdk.test.ts`, menu included.
4. **A phantom zero-quantity stop could flash.** `holds` was derived from quantity, but the
   alert engine now takes `held` explicitly and refuses a stop at 0, and `nextFlash()` drops a
   queued sale for a position that is already closed.
5. **Boot could leave a blank screen.** A failing state read, bridge or `#glass` mount aborted
   `boot()` before the first draw. Each step is guarded now, and the first frame is drawn before
   the first poll.
6. **Assumption tested instead of shipped:** I suspected a partial take-profit would re-flash a
   rung on the way back down to the entry price. A probe (`tests/app.test.ts`) showed the
   average cost keeps rungs above the entry, so no phantom alert — the hypothetical fix was
   reverted, the probe kept as a regression test.

Also added: **G2 contextual menu** (Portfolio / Journal / Reset view), **temple hold** wired to
the mic with an on-glass prompt, and **one-step emphasis** — the container goes bold when a row
needs the wearer, which is the only brightness difference the firmware really offers.

## 18. Round three, part two: the mock run, the attacks and what they caught

The demo was played end to end against the **real** dev server, in a test that drives the
actual `App` over real HTTP (`tests/mockrun.test.ts`, skipped automatically when `npm run dev`
is not up). Boot → judge dips NVDA → tap buys → judge spikes → tap sells → portfolio →
journal → undo → clear the sim. That one test found three things the unit suites could not:

1. **Saved state never loaded.** `load()` destructured positionally against
   `STATE_KEYS = ['targets','book','alerts','trades','watchlist']`, but the fields were read in
   field order. Every stored payload went to the wrong parser and fell back to a default, so a
   restart quietly reset the book and the zones. Now each key is read by name, and the mock run
   asserts the restored value (`NVDA` sell `148-152`, not the default zone).
2. **A malformed value blanked the glasses.** One non-array `watchlist` made `knownSymbols()`
   throw inside `App.load()`, so the first frame never drew. `src/core/state.ts` is the single
   trust boundary now: every stored value is parsed, unknown symbols dropped, quantities and
   prices bounded, the journal capped at 10 and the watchlist at 12 with a known fallback.
3. **A phantom sell tranche.** The flash said `Paper sell 1 NVDA` and the book sold `1.3333`,
   then printed `hold 3` on a 2.6667-share position. Tranches are cut in the asset's own lot
   size (`trancheQty`), and a one-share lot sells one share rather than a flash promising zero.

Two smaller ones from the same run: a wake-up no longer announces a zone the price was already
sitting in (the first poll after `load()` is a baseline, still overridden by a judge simulation),
and a buy-zone flash is dropped while the book already holds — the ladder owns the row then, and
averaging up is not a feature.

### The API under attack

`curl` against every route, before the fixes: traversal and `%2F` keys → 404/400, injected
symbols → 400, wrong methods → 404/405, a 100 KB body → 413. But `{"__proto__":{…}}` and
`{"constructor":{…}}` writes returned **200**, 2000-level nesting stored fine, `session:"EVIL"`
was accepted, and `sim: 1e308` went into the cache. Fixed at the boundary: a forbidden-key set,
a key-shape regex, a depth cap of 8, `session` restricted to the five real sessions, and a
simulation banded to ±90% (`MAX_SIM_PCT`), because a 1e308 multiple is not a market move, it is
a way to overflow the display. All of it returns **422**, and the legitimate writes still 200.

## 19. Round four: the chart, and why it cannot be text

The request was "a graph and candles if the user wants more detail". The honest answer
started with a measurement, because the obvious implementation is wrong on this hardware.

**The font is proportional.** `getTextWidth` from `@evenrealities/pretext`: `█`, `│`, `●`,
`▲`, `─` are a hard **20 px**, but `▓`, `░`, `▐`, `╎`, `║`, `▀` are **4 px**. A candle drawn
as a character grid therefore drifts — column 1 lines up, column 12 does not — and this is
invisible in a monospace browser preview, which is exactly how a chart would ship broken.

**The image container is 288×144.** The SDK declares width `20..288`, height `20..144`, max
four image containers, `imageData` as grayscale bytes (LZ4'd by the SDK). That is exactly a
quarter of 576×288, so the chart goes bottom-right at 1× and the text above it is its legend.
A 576-wide image is not offered, so "full-width chart" is not a thing this firmware does.

What shipped:

- `src/core/candles.ts` — `Candle`, `Range` (`1D|5D|1M`), `RANGE_SPEC`, `isCandle`,
  `normalizeCandles`, `extent`, `mockCandles`, `zoneHits`. A bar is only a bar if prices are
  positive and the body sits inside its own wick — Yahoo pads holidays with nulls.
- `src/core/quotes.ts` — `binanceKlines`, `yahooCandles`. Same hosts as the quotes, so no new
  permission and no key.
- `src/server/quotes.ts` — `candlesFor` with the quote's trust order (judge mock → 60 s cache
  → live → last good → deterministic mock), and the **last bar overwritten with the live
  quote** so the chart never contradicts the row above it.
- `src/g2/chart.ts` — `renderCandles` (pure), `chartWindow`, `toImageData`, `ascii`.
- `src/g2/sdk.ts` — `showChart`/`hideChart`: one `rebuildPageContainer` per session to mount
  the image container (carrying the menu over, or it would be cleared), then a cheap
  `updateImageRawData` per frame. A rejection is not fatal.
- `src/g2/bar.ts` — `textSpark`: the fallback, eight 20 px block glyphs.
- `src/g2/mirror.ts` — paints the same bytes into a canvas at the same position, so the
  preview cannot show a chart the glass would not draw.
- `companion.html` — the same map at 3×, with range buttons, for judging a zone on a laptop.

### Defects this round found

1. **`chartView()` recursed into `rows()` → `view()` → `chartView()`** and blew the stack on
   the first poll. Caught by the mock run, not by the unit tests.
2. **A 1 px overflow** in the detail legend (`...high 138.82` measured 577 px). Caught by the
   existing `layout.test.ts`, which is why that test measures instead of asserting text.
3. **A body outside its own wick passed validation**, so a bad vendor bar could draw a candle
   that could never have traded. `isCandle` now requires `l <= o,c <= h`.
4. **Zone bands drew at the frame edge** when a target was far outside the window, which reads
   as "the price is here". An out-of-window target now gets one dashed marker row two pixels
   inside the frame and no interior at all.
5. **A 50%-duty dash on every row became vertical hatching.** Measured after rendering the real
   bitmap: rows 7–80 carried ~130 of 144 columns of dots, which reads as a solid green wall and
   buries the candles. A zone interior is now a one-pixel-in-four screen-door tint and its edges
   are dashed rules, verified by counting ink per row in `tests/chart.test.ts`.
6. **The mock walk drifted**, so a 1D window looked like a five-day trend and the buy zone
   covered half the chart. The walk is now mean-reverting *and* bridged between two pinned
   ends: bar 0 opens at the previous close and the last bar closes on the live price, so the
   chart's own % move equals the day change on the row above it.
7. **`mockCandles` had no previous close to anchor on.** Found while fixing 6: the server had
   the quote's `prevClose` in hand and never passed it, so the chart and the header could state
   different day moves.

## 20. Round five: optional live keys, and honest failure

The request was "add a live public key for better". Two honest findings first:

1. **The app already runs on public endpoints.** Binance's ticker and Yahoo's chart endpoint
   are keyless and public, which is why P0 has no key requirement. A key does not unlock
   *more data* here; it unlocks a **contract**: a documented rate limit, a documented symbol
   list, and an error that is distinguishable from a network blip.
2. **The real defect was the silence.** Every failure — 401, 429, geo-block, DNS — collapsed
   into `mock: true` with no explanation. That is the part that would embarrass a demo, and it
   is fixable without any key at all.

What shipped, with the key strictly optional:

- `src/server/provider.ts` — Finnhub / Twelve Data / Polygon behind one interface, chosen by
  `TARGETGLANCE_KEY_*` and `TARGETGLANCE_PROVIDER`. `ProviderError` carries a `FailureKind`
  (`no-key`, `unauthorized`, `rate-limited`, `unsupported`, `unreachable`, `bad-payload`), and
  `explain()` turns it into one sentence a human can act on.
- The key never leaves the server: `keyStatus()` returns `••••` plus the last four, and
  `/api/providers` is that function. Tested by asserting the secret string is absent from the
  response.
- Trust order is now: configured key → keyless pair → last known good → deterministic mock,
  and the reason is carried on the quote (`reason`, diagnostic, never cached) and rendered:
  `key` / `limit` / `stale` / `off` on a 576 px row, the full sentence on the detail screen.
- Twelve Data answers **HTTP 200 with `{status:"error"}`** for a bad key; that is classified as
  auth, not as a price of zero. Polygon refuses crypto on its free plan, so crypto goes to
  Binance and says the provider does not serve it.

### Defects this round found

1. **`npm run proxy` would have crashed on any provider error.** `node --experimental-strip-types`
   refuses TypeScript **parameter properties**, so `constructor(readonly kind: FailureKind, …)`
   was a `SyntaxError` at load time — and the standalone server imports the quote chain. Caught
   by running the proxy under the real flag instead of only under vitest. Assigned in the body.
2. **A `reason` could have been cached as if it were a price.** It is stripped before the cache
   write, so a recovered provider does not keep apologising for an outage that ended.

## 21. Round six: the audit, and three ways the UI lied about itself

No new feature this round. The rule was to find places where the app says something it does
not do, which is worse than a missing feature because it survives a demo.

1. **The selector walked off the screen.** The watchlist renders three rows but `sel` cycles
   every symbol, so with six or more the `>` marker disappeared while tap-to-edit still acted
   on the hidden row. Rows are now a window around the selection (`windowOf`), clamped at both
   ends, and the editor reads the symbol from the same window.
2. **The editor's footer said "TAP next" and tap never moved.** It stayed on row 0 and cycled
   quick-sets, so **the sell zone and the stop could not be edited at all** by gesture — only
   the buy zone was ever reachable. Tap now advances 0→1→2→3→0, swipe nudges the row in view,
   double-tap applies the quick-set and persists it, hold saves. One implementation
   (`editGesture`), tested for reachability of all four fields.
3. **A `stop 110` phrase was parsed and thrown away.** The companion's apply spread
   `{...base, ...(buy), ...(sell)}` and never merged `intent.stop`, so the parser was right and
   the write path lost it.

Also fixed:

- **`validateWrite('targets')` only checked `typeof === 'object'`.** `{"NVDA":{"buy":"nope"}}`
  was a 200, stored, and rendered a row whose zones cannot be drawn. `badTargets` now walks the
  payload, skips unknown symbols (they are dropped on read anyway) and rejects a non-numeric
  zone, an inverted zone, `buy >= sell`, a stop above the buy zone, and a non-numeric stop —
  each with the symbol in the message.
- **The watchlist capped at 12 but the universe has 13**, so the Megacap preset — which ends
  with `RELIANCE.NS` — could never be applied whole. The cap is now the allowlist's own size,
  which is the real bound, and a test asserts every preset round-trips.

## 22. Build order

- [x] Analysis + plan + ponytail rules vendored (`AGENTS.md`, MIT)
- [x] Scaffold: `package.json`, `tsconfig`, `vite.config.ts`, `app.json`, pages
- [x] Core: quotes / session / targets / alerts / paper / voice
- [x] Server: sources, store, handler, standalone
- [x] G2 view: frame, sdk, browser mirror
- [x] Companion (Judge Mode)
- [x] 92 tests green · `tsc` clean · `vite build` clean · dev server verified · `evenhub pack` verified
- [x] README
- [x] Round two: ladder, stops wired, hardware-honest preview, companion target table
- [x] Round three: distinct mocks, sim at read time, SDK page validation, menu + temple hold
- [x] Round three, part two: live mock run, keyed state load, trust boundary, API hardening
- [x] 105 tests green · `tsc` clean · `vite build` clean · attack suite returns 422s
- [x] Round six: selection window, editor reachability, stop merge, target content validation ·
      146 tests
- [x] Round five: optional live keys, classified failures, why-not-live on the row · 139 tests
- [x] Round four: OHLC history, 288×144 candle bitmap, detail screen, text sparkline fallback,
      companion chart · 126 tests
- [x] Round seven: keyless live chain for crypto (Binance → Coinbase → OKX → Kraken),
      Coinbase candle fallback, live probe of all five sources · 149 tests

### What the build changed in this plan (found by writing it)

1. **Cooldown is per zone, not per symbol.** A per-symbol 60 s cooldown suppressed the
   sell alert 10 s after a buy fill — the demo's money shot. Found by `tests/app.test.ts`.
2. **`held` counting had to survive a suppressed crossing.** The falling-knife rule needed a
   `pending` flag; without it the second poll saw "same zone" and returned early.
3. **Auto-arm turned out to be zero code.** The first draft armed a sell flag and started a
   cooldown; both were bugs. `holds` in the sell rule does the whole job.
4. **The flash must be pushed on the poll, not on the next gesture** — the glasses would
   otherwise show the alert only after a tap.
5. **A 5% budget on a small book buys zero whole shares.** Plan clamps to one affordable share
   instead of failing the tap.
6. **Cents on a target are noise**: `BUY 118-122` replaced `118.00-122.00`, which also freed the
   width for a right-aligned layout.

## 23. Round seven: crypto was one geo-block away from mock

Checked live from this machine on 2026-11-28, before writing any code:

| Source | Result |
|---|---|
| Binance ticker | **451** — "Service unavailable from a restricted location" |
| Coinbase Exchange stats / candles | 200, all five crypto symbols |
| OKX ticker | 200 |
| Kraken ticker | 200 (BTC is `XBTUSD`; DOGE answers as `XDGUSD`) |
| Yahoo chart | 200 (one 429 seen on RELIANCE.NS, recovered) |
| Stooq CSV | bot-walled (JS browser check) — **rejected**, not integrated |

The shipped app had exactly one crypto source, so in any Binance-restricted region the
whole crypto side fell to the deterministic mock on demo day — the failure §2.3 predicted
for the judge's machine, confirmed on this one. Fix, in the codebase's own shape:

- `src/core/quotes.ts` — `coinbaseTicker`, `okxTicker`, `krakenTicker` (same `Ticker`
  shape, rolling-24h open as prevClose, like Binance's 24hr ticker) and `coinbaseCandles`
  (Coinbase's `[t, low, high, open, close]` newest-first rows reversed to chronological).
- `src/server/quotes.ts` — crypto quotes walk the chain Binance → Coinbase → OKX →
  Kraken; the first live answer wins, names itself in `source`, and the reason records
  what failed before it. Candle history falls back Binance klines → Coinbase candles the
  same way. `probe()` now reports all five sources.
- Coinbase and OKX are Track 03 apps in their own right, so the chain also strengthens
  the track fit: the core integration is now Binance + Coinbase + OKX, not Binance alone.
- Verified live, not just stubbed: probe shows `binance 451 · coinbase/okx/kraken/yahoo
  ok`; BTC served live by Coinbase at the real price; BTC 1D candles served by Coinbase.
  `tests/live.test.ts` walks the chain with stubbed hosts (451 → Coinbase, → OKX, →
  Kraken's renamed pair, candles oldest-first).

Also fixed in this round: the mock run's judge sim was a hardcoded −13.8 %, which only
lands in the buy zone while NVDA trades near 138 (live: 150.49, so the demo test failed
on price drift, not on code). The test now computes the move into the zone from the boot
quote, the way the companion's simulate buttons already did. And `artifacts/chart-detail.png`,
whose binary patch arrived without its data, was regenerated from the project's own
`renderCandles` output (NVDA 121.28, buy 118–122, sell 148–152, stop 110, drawn 3×).

## 24. Round eight: voice in, Telegram out, a host that is not localhost

Three additions, each aimed at a judging line:

1. **Voice on the companion.** The parser existed since round one; the microphone did
   not. The companion's Speak button now uses the browser's built-in speech recognition
   and feeds the transcript into the *same* parse path as typing — no key, no server, no
   new parser. The G2 temple-hold prompt already showed the phrase format; now the phrase
   can actually be spoken somewhere in the product. Glasses-side STT is still honestly
   absent (raw PCM, no engine), and the README says so.
2. **Telegram bot** (`src/server/telegram.ts`). The G2 cannot alert while closed — the
   hackathon page says so itself — so the server polls with the glasses' own
   `pollAlert` engine (same hysteresis, cooldown and wake-up baseline; the two surfaces
   cannot disagree) and pushes zone hits to a paired Telegram chat. Replies run the same
   target parser and write the same store, so a zone set from Telegram is on the glasses
   at the next poll. `/status` and `/zones` are read-only answers. Token is env-only;
   `/api/telegram/status` returns two booleans. Pairing and alert state are in-memory
   (named shortcut in the module). 6 tests, Telegram and quotes stubbed at fetch.
3. **Vercel host** (`api/[...slug].ts` + `vercel.json`). The framework-free handler
   made this a 30-line adapter instead of a port: static `dist/` plus one catch-all
   function. Verified locally by driving the real function module with fake req/res —
   health, live quotes (BTC via Coinbase), telegram status and state round-trip all 200.
   Serverless limits are written in the adapter's header, not discovered by judges:
   state and Judge Mode live in instance memory, Telegram pushes run on the
   always-on hosts.

Also in this round: the dev server and the standalone proxy both start the bot poller
(no token → silent no-op), and the companion gained a Telegram status section.
