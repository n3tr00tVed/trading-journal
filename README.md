# Trading Journal

A local-first personal trading journal. Track your trades, compute realized
P&L with fees included, and review your performance — all stored entirely on
your own device. No accounts, no servers, nothing leaves your browser.

## Features

- **Dashboard** — net P&L, win rate, profit factor, average win/loss,
  account capital with return-on-capital, open positions, and recent
  trades at a glance.
- **Trade management** — add, edit, and delete trades; filter by symbol,
  direction, strategy, status, and date range; free-text search across
  symbol/strategy/setup/notes.
- **Accurate analytics** — realized P&L for long and short trades, fees
  included in net results; open trades excluded from statistics but shown
  separately. All figures derive from the underlying trade records.
- **Persistence** — data is saved to your browser's localStorage
  automatically; corrupt or malformed stored records are handled safely.
- **Export / import** — one-click CSV and JSON export, plus JSON import
  (merge or replace). Everything happens client-side.

- **Rules** — a private, autosaved page for your personal trading rules
  (risk limits, setups you trade, what disqualifies a trade). It lives in
  localStorage like the trades and never leaves the device.
- **Account capital** — set your capital in Settings; the dashboard shows
  it alongside net P&L and your return on capital (`netPnl / capital`).
- **Position size calculator (Indian market)** — enter your capital
  (₹25,000 prefill from Settings), risk %, entry and stop prices, and the
  calculator answers how many shares — or whole F&O lots — you can buy,
  capping by both risk and affordability. Lot sizes auto-fill for NSE/BSE
  index and MCX contracts (NIFTY 75, BANKNIFTY 35, GOLD 100 …).
- **Money invested** — every trade tracks how much capital it commits:
  the form pre-fills it as entry × quantity ÷ **leverage** (set a leverage
  like 5× for margin trades, or override the invested amount by hand), and
  the journal reports total invested in closed trades, capital sitting in
  open positions, and each closed trade's return on invested capital.
- **Market currencies** — trades are tagged with the currency of the market
  they were logged in: US trades profit in **dollars ($)**, Indian trades
  profit in **rupees (₹)**, row by row. Rupees and dollars are never
  summed; the dashboard leads with the market you're viewing and surfaces
  the other market's total alongside it.
- **Currency** — defaults to ₹ INR with Indian digit grouping everywhere;
  switch between **India (₹ INR)** and **US ($ USD)** markets from the
  sidebar dropdown (any view) or in Settings.
- **Trade filters** — filter your journal by market segment (stocks,
  futures, forex, crypto, options) alongside direction, strategy, status,
  symbol, and date range.

## Getting started

```bash
npm install
npm run dev      # start the dev server
npm run test     # run the vitest suite (calculations, persistence, UI workflows)
npm run lint     # eslint
npm run build    # production build
```

## Data model

A trade record (`src/lib/schema.js`): `id`, `symbol`, `market` (stocks,
futures, forex, crypto, options), `direction` (long/short), `entryPrice`,
`exitPrice`, `quantity`, `entryDate`, `exitDate`, `fees`, `strategy`,
`setup`, `notes`, `createdAt`.

Conventions:

- `status` is always derived from `exitPrice === null` (never stored), so
  differences between stored status flags and arithmetic can't happen.
- Long P&L: `(exit − entry) × qty`. Short P&L: `(entry − exit) × qty`.
  Net P&L subtracts fees. Exit price `0` is a valid close (an exercised
  short, for example), not an "open" marker.
- Calendar math uses `YYYY-MM-DD` strings compared lexicographically.

## Project layout

```
src/
  lib/            pure logic: schema/validation, calculations, storage, format, export
  hooks/          useTrades — single source of truth, localStorage-backed
  components/     UI: sidebar, dashboard, trade table/form, settings
  tests/          vitest unit + integration tests
```
