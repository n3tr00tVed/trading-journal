# Trading Journal

A local-first personal trading journal. Track your trades, compute realized
P&L with fees included, and review your performance — all stored entirely on
your own device. No accounts, no servers, nothing leaves your browser.

## Features

- **Dashboard** — net P&L, win rate, profit factor, average win/loss,
  open positions, and recent trades at a glance.
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
