# TargetGlance — DoraHacks submission copy
Hackathon: Heads Up: Even Realities Hackathon by TVM Ventures & Daos Hub
Deadline: Nov 29, 2026, 23:59 Dubai time (Nov 30, 01:29 IST)
Repo: https://github.com/Eren-dotcom/TargetGlance-
Track: 03 · Exchanges & Stocks (main track)

## Name
TargetGlance

## Tagline (one line)
Buy-zone / sell-zone alerts for stocks and crypto on Even G2 — set your zones, glance, paper-trade in one tap.

## Description

**The problem.** Price alerts on a phone are either too late or too loud. A trader who
already decided "I buy NVDA between 118 and 122, I sell between 148 and 152" does not
need another chart — they need the moment a price enters a zone, in half a second,
without picking up a phone.

**Who it is for.** Retail stock and crypto holders who trade in sessions and want
discipline at a glance: zones they set in advance, one tap to act, nothing automatic.

**How it works.** TargetGlance runs on Even Realities G2 (576×288). The watchlist shows
each asset with a range bar between its buy and sell zones, a session chip
(LIVE / PRE / AH / CLOSED / 24-7) and a data-quality badge (LIVE / STALE / MOCK — with
the reason when a row is not live). When a price crosses into a buy zone while you are
flat, the glasses flash one line — zone, price, paper order size — and one tap executes
a paper buy. Holding turns the sell side into a three-rung take-profit ladder; a stop
breach exits the lot. Every alert is crossing-only with hysteresis and a 60-second
cooldown, so sitting in a zone never re-alerts. A long-press opens a detail screen with
a real 288×144 candle chart (zones drawn on it) and a target editor. The phone companion
(Judge Mode) sets targets by typing a phrase like "SOL buy 140 sell 180", simulates dips
and spikes, and exports the trade journal.

**Live data, no keys.** Crypto quotes walk a keyless chain — Binance → Coinbase → OKX →
Kraken — because Binance answers HTTP 451 from restricted regions (verified live during
the build: Binance blocked, Coinbase served BTC live). Stocks come from Yahoo's public
chart endpoint, candles from Binance klines with a Coinbase fallback. Optional server-side
keys (Finnhub / Twelve Data / Polygon) add a documented rate limit; the app runs fully
without them. All state lives on the app's own server, so the phone and the glasses —
different storage origins on real hardware — stay in sync.

**Safety.** Paper trading only. No real orders, no exchange or broker keys, no custody,
no financial advice. Cash can never go negative, fills use the live price at tap time,
and every trade can be undone within 5 seconds.

**Tech.** TypeScript, Vite, Even Hub SDK 0.0.16, one text container on the glasses
(every line measured with pretext so it can never wrap), a framework-free Node quote
service, 149 automated tests including the full 90-second demo played end to end over
real HTTP against live data.

## Demo video script (≤3 min, storyboard for the build)
1. (0:00) Watchlist on the G2 mirror: NVDA / SOL / BTC, range bars, session chips, LIVE badges.
2. (0:25) Companion: type "NVDA buy 118-122 sell 148-152" — targets land on the glasses.
3. (0:45) Companion: simulate dip into the zone → glasses flash BUY ZONE HIT → tap → paper buy, undo toast.
4. (1:15) Simulate spike → sell-rung flash → tap → realised gain in Portfolio.
5. (1:40) Long-press: candle chart detail with zones; swipe cycles 1D / 5D / 1M.
6. (2:05) Force mock → badges flip to MOCK with the reason; probe shows Binance 451, chain live.
7. (2:30) Reset → clean slate. End card: repo URL + "Paper only. No real orders."

## Optional: API feature requests (up to 5)
1. A documented background/alert delivery path for G2 apps, or a clear statement that none exists — apps currently cannot alert when closed.
2. A monospace or fixed-advance font option for tabular data on the 576×288 display.
3. Speech-to-text access for the G2 microphone, or a documented partner endpoint — the SDK gives raw PCM only.
4. Simulator parity notes: which glyphs and brightness steps the firmware really supports, published as a machine-readable table.
5. A hosted dev tunnel option so a packaged .ehpk can reach a local quote service without manual whitelist edits.

## How did you hear about this hackathon?
(Leave for the user to confirm at filing — DoraHacks account tofikhashmi2222@gmail.com.)

## Filing checklist
- [x] Public repo with README + setup: https://github.com/Eren-dotcom/TargetGlance-
- [x] Packaged build: targetglance.ehpk (local, attach if the form accepts it)
- [ ] Demo video link (YouTube, ≤3 min) — pending build + upload
- [ ] Submit before Nov 29, 23:59 Dubai time and verify the confirmation / BUIDL URL
