# Trading Journal

A local-first personal trading journal. Track trades with take-profit / stop-loss
plans, watch open crypto positions move in real time, keep a rules page, read
market news with a per-market sentiment read — and know your stats. Everything
is stored on your own device. No accounts, no servers, nothing leaves your
browser unless you explicitly allow it.

Built to help people (or myself) manage by their trades — knowing the stats
behind them — and as a new project to learn a new stack.

## Features

### Journaling
- **Trades** — add / edit / delete with filters (symbol, direction, strategy,
  market segment, status, date range) and full-text search across
  symbol / strategy / setup / notes.
- **Take profit 🎯 / stop loss 🛑** — optional price levels on every trade.
  The form previews what each level is worth in money as you type
  (direction-aware for long/short), the trades table shows the levels inline,
  and open crypto positions show **live distance to target/stop** (e.g.
  `+4.2%`) with a flag when the Binance price has reached a level.
- **Money invested + leverage** — the invested amount auto-derives as
  entry × qty ÷ leverage (set `5` for 5× margin, override by hand). Stats
  report invested in closed trades, capital in open positions, and each
  trade's return on invested capital.
- **Per-market currencies** — every trade is tagged with the currency of its
  market: US trades read **$**, Indian trades read **₹**, row by row.
  Rupees and dollars are never summed; the dashboard leads with the market
  you're viewing and surfaces the other ledger beside it.
- **Guarded history** — closed trades show an **Edit** button that first asks
  *"Edit closed trade? Unlock and edit"* — editing rewrites recorded history,
  so it's deliberate, double-guarded (UI confirm + data-layer reject). Deleting
  a trade (or all trades) always requires confirmation.
- **Screenshots** — attach a chart image (PNG/JPEG/WEBP/GIF ≤ 5 MB) to any
  trade. Stored in your browser's IndexedDB only; **excluded from exports**
  and never synced to disk.
- **Rules page** — a private, autosaved page for your own trading rules and
  self-checks.

### Analytics
- **Dashboard** — net P&L (per market), win rate, profit factor, average
  win/loss, expectancy, total invested, open positions with unrealized P&L,
  and recent trades.
- **Honest math** — win/loss classification uses **net** P&L (fees included);
  open trades contribute zero to realized stats and are shown separately.
  All figures derive from the records — no stored status flags to drift.
- **Monthly P&L review** — a month-wise statement grouped by the month each
  trade **closed** (exitDate), expandable to every trade realized in that
  month, with region chips: 🌐 All · 🇮🇳 India · 🇺🇸 US · 🪙 Crypto · 💱
  Forex. A trade belongs to exactly one region, rupees and dollars never
  merge, and open positions join the statement only once they actually close.
- **Position size calculator** — capital + risk % + entry/stop → shares or
  whole F&O lots, capped by both risk and affordability. NSE/BSE/MCX lot
  sizes auto-fill (NIFTY 75, BANKNIFTY 35, GOLD 100 …).

### Market news + sentiment
- **Headlines** from publisher RSS feeds for 🇮🇳 India, 🇺🇸 US, 🪙 crypto, and
  💱 forex (Economic Times, CNBC, CoinDesk + Google News topic feeds).
- **Per-headline sentiment** — keyword analysis marks bullish/bearish reads
  (word-boundary matching, so "update" doesn't count as "up").
- **Overall verdict per market** — an India / US / crypto / forex / combined
  summary with a forward framing: *Likely bullish — market may rise*,
  *Likely bearish — market may fall*, *Mixed signals — direction unclear* or
  *No clear signals*, with the ↑/↓ tally shown so you can see the basis.
  Verdicts need at least 3 directional headlines — two headlines are gossip,
  not a trend. Sentiment is informational mood-reading, never a trading signal.
- 10-minute cache for polite re-opens; failed feeds are listed by name with a
  retry — nothing is faked.
- **IP-minimizing fetches** — whichever public relay (rss2json / AllOrigins /
  CodeTabs) succeeds for a feed is remembered and then tried alone first, so
  refreshes contact one known service instead of spraying all three every
  time. Publisher sites never see your IP; relays necessarily do, and
  VPN/Tor remains a system-level option if you want more.

### Live data & privacy
- **Live crypto P&L** — optional 10-second quotes from Binance's free public
  price API for open crypto positions only; unrealized P&L (+% on margin) and
  an honest status line. Quotes stay in memory, never stored or synced.
- **Live NSE quotes** — open Indian stock positions (₹ ledger) quote every
  ~60 s through the news page's public relays (Yahoo's public chart API in
  between), and only during NSE trading hours (Mon–Fri 09:15–15:30 IST) —
  outside those hours the row honestly shows "manual". Futures, options, and
  forex have no free browser-friendly feed and stay manual: never a
  fabricated price.
- **Crypto swap helper** — in the trade form, crypto only: logging a swap
  (e.g. BTC → SOL) computes the exit price from the received side
  (received qty × received price ÷ qty sold), optionally auto-fetching the
  received coin's price from Binance (with your own USD→INR rate for ₹
  trades). Applying closes the trade, stamps the exit date, and records the
  swap in Notes — reviewed and validated like any trade.
- **Mobile-friendly** — responsive layout: the sidebar becomes a swipeable
  top rail on phones, wide tables scroll instead of crushing, form rows
  stack, and dialogs/toasts go full-width.
- **Folder sync (`trades_data/`)** — optional local mirror of the journal to
  a folder you pick once (trades.json, rules.txt, capital.json). Chromium
  browsers only. Restore from the folder is a guarded confirm.
- **Where your data lives** — trades, rules, capitals and news cache in
  browser localStorage; screenshots in IndexedDB; the optional
  `trades_data/` mirror on your disk. Exports (CSV/JSON) download to your
  Downloads folder. Nothing is uploaded anywhere.
- **Network activity is read-only and opt-out-able**: Binance quotes, NSE
  stock quotes, and news feed fetches via public CORS relays (each with a
  toggle in Settings). No credentials, no telemetry.

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run test     # vitest suite — calculations, persistence, UI workflows
npm run lint     # eslint
npm run build    # production build to dist/
```

Default market is **India (₹ INR)**; switch India/US from the sidebar.

## P&L conventions

- Long: `(exit − entry) × qty` · Short: `(entry − exit) × qty`
- **Net P&L = gross − fees** — wins, losses, win rate, profit factor and
  expectancy are all net-based.
- `exitPrice === null` means open (status is derived, never stored). An exit
  of `0` is a legal close, not "open".
- `invested` = explicit amount, else `entry × qty ÷ leverage`, and return on
  invested uses net P&L over that.
- Per-currency ledgers (`computeCurrencyBreakdown`) keep ₹ and $ apart;
  ratios are per-ledger, never merged.

## Data model (abridged)

`src/lib/schema.js` — a trade is `id`, `symbol`, `market` (stocks / futures /
forex / crypto / options), `direction` (long / short), `entryPrice`,
`exitPrice (null = open)`, `quantity`, `invested`, `leverage`,
`takeProfit`, `stopLoss`, `currency` (INR / USD), `entryDate`, `exitDate`,
`fees`, `strategy`, `setup`, `notes`, `hasScreenshot`, `createdAt`.
Dates are `YYYY-MM-DD` strings. Full contracts and calculation definitions
live in [`CONTRACTS.md`](CONTRACTS.md).

## Project layout

```
src/
  lib/           pure logic — schema + validation, calculations (incl. monthly
                 breakdown & swap pricing), storage, formatting,
                 export/import, Binance + NSE quotes, news feeds, folder
                 sync, screenshots, settings/capital/rules storage
  hooks/         useTrades (journal state + persistence), useLivePrices
                 (Binance), useIndianPrices (NSE via relay), useCurrency
  components/    sidebar, dashboard, monthly review, trade table + form
                 (with crypto swap helper), settings, rules, news, calculator
  tests/         vitest unit + integration tests (168 tests)
```

The whole build — stack, data flow, every feature, the privacy model — is
explained in plain English in [`flow.txt`](flow.txt).

## Browser support

- Anywhere modern for journaling and analytics.
- **Folder sync requires the File System Access API** (Chrome / Edge / other
  Chromium). Firefox / Safari get an honest "not available here" message.

## Privacy in one line

Your journal never leaves your device: no account, no server, no upload —
the only network calls are public price quotes and news feeds, and both are
read-only and switchable.
