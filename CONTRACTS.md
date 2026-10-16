# Shared Contracts — Trading Journal

**Authoritative contracts. Agents MUST consume these modules as-is; do not modify files you do not own.**

## File ownership

| Owner | Files |
|---|---|
| Lead (integrator) | `src/lib/*`, `src/hooks/useTrades.js`, `src/App.jsx`, `src/main.jsx`, `vite.config.js`, `package.json` |
| Agent UI | `src/components/Sidebar.jsx`, `src/components/StatCard.jsx`, `src/components/EmptyState.jsx`, `src/components/Dashboard.jsx`, `src/styles/app.css` |
| Agent Trade Mgmt | `src/components/TradeForm.jsx`, `src/components/TradesTable.jsx`, `src/components/TradesPage.jsx` (no other files) |
| Agent Persistence/QA | `src/components/SettingsPage.jsx`, `src/lib/export.js`, `src/tests/*.test.jsx` (any test files, incl. `workspace.test.jsx` replacing the placeholder stub) |

## Trade record (`src/lib/schema.js` → `normalizeTrade`, `validateTrade`, `createTrade`)

```js
{
  id: string,          // crypto.randomUUID() at creation
  symbol: string,      // required, trimmed, uppercase-ish ("AAPL", "ES", "BTCUSDT")
  market: "stocks" | "futures" | "forex" | "crypto" | "options",
  direction: "long" | "short",
  entryPrice: number,  // > 0
  exitPrice: number|null, // null => open trade. 0 is a legal exit price (never treated as open)
  quantity: number,    // > 0
  entryDate: string,   // ISO "YYYY-MM-DD" (required)
  exitDate: string|null,  // ISO "YYYY-MM-DD"; required when closed
  fees: number,        // >= 0, default 0
  strategy: string,    // optional, free text, may be ""
  setup: string,       // optional, free text, may be ""
  notes: string,       // optional, may be ""
  createdAt: string,   // ISO datetime, set at creation, preserved on edit
}
```

- `status` is **derived, never stored**: `isTradeOpen(trade)` → `trade.exitPrice === null`.
- Dates are stored as `YYYY-MM-DD` date-only strings for entry/exit (`entryDatetime`/`exitDatetime` optional extra is NOT used — keep it simple).
- Unknown/extra properties are dropped by `normalizeTrade`; numbers come out as `number` (never string).
- `createTrade(partial)` fills defaults + generates id/createdAt. `validateTrade(trade)` returns `{ ok: true, errors: {} }` or `{ ok: false, errors: { field: "message" } }` (message keys = field names: `symbol`, `entryPrice`, `exitPrice`, `quantity`, `entryDate`, `exitDate`, `fees`, `direction`, `market`, `dates`). Use it for form validation display too.

## Calculations (`src/lib/calculations.js`) — pure, no React

- `tradeGrossPnl(trade)` — closed only: long `(exit-entry)*qty`, short `(entry-exit)*qty`; open → `0`.
- `tradeNetPnl(trade)` — ` tradeGrossPnl(trade) - (trade.fees || 0)`, closed only.
- `isTradeOpen(trade)`.
- `computeStats(trades)` →
  `{ total, open, closed, wins, losses, breakeven, winRate, grossProfit, grossLoss, netPnl, totalFees, profitFactor, avgWin, avgLoss, expectancy, largestWin, largestLoss }`
  - win/loss classification by **net** PnL (fees included); `wins: net > 0`, `losses: net < 0`, `breakeven: net === 0`.
  - `winRate = (wins / closed) * 100` when `closed > 0`, else `null`.
  - `profitFactor = grossProfit / grossLoss` where `grossProfit = Σ net pnl of wins`, `grossLoss = |Σ net pnl of losses|`; return `null` when closed === 0 or both grossProfit and grossLoss are 0; return `Infinity` when grossProfit > 0 and grossLoss === 0. UI renders `Infinity` as `"∞"`.
  - `avgWin = grossProfitOfWins / wins` (null when no wins), `avgLoss` analogous, `expectancy = netPnl / closed` (null when closed === 0).
  - All aggregate fields are `0` for empty arrays except ratios which are `null` — nothing NaN anywhere.
- `filterTrades(trades, { query, symbol, direction, strategy, market?, dateFrom, dateTo, status })` — all optional; `status` in `all|open|closed`; `query` matches symbol/strategy/setup/notes case-insensitively; date strings compare lexicographically (valid `YYYY-MM-DD`).
- `sortTrades(trades, key, dir)` — keys `entryDate|exitDate|netPnl|symbol` default `entryDate` desc (chronological, newest first for table display). Stable, does not mutate input.

## Formatting (`src/lib/format.js`)

`formatCurrency(n, {currency='USD'})` → `"$1,234.56"`, negative `−$123.45` printed via sign; `formatPercent(12.5)` → `"12.5%"`; `formatNumber(n)`; `formatDate('2026-01-02')` → `"Jan 2, 2026"`; `signedFormatCurrency(n)` → `"+…"`/`"−…"` prefix for P&L. Safe against null/undefined/NaN → `""`.

## Persistence hook (`src/hooks/useTrades.js`)

```js
const { trades, stats, addTrade, updateTrade, deleteTrade, restoreTrades, importTrades, clearAll, lastError } = useTrades();
```

- Backed by `src/lib/storage.js` (`loadTrades(): Trade[]` with per-record `normalizeTrade` + `validateTrade` filtering/quarantine of malformed records, `saveTrades(trades)` best-effort with quota/serialization-safe try/catch, `STORAGE_KEY = 'trading-journal:trades:v1'`).
- Mutations validate and return `{ ok, errors }`; all state updates persist synchronously to localStorage; `stats` from `computeStats(trades)` via `useMemo`.
- `importTrades(raw)` validates array of raw objects, returns `{ ok, added, skipped, errors }`, merges by id (skip duplicates), persists.

## App shell (`src/App.jsx` — lead)

State-based routing on `view`: `dashboard | trades | settings` + modal `editing: null | 'new' | trade`. `useTrades` lives once in `App` and is passed down. Sidebar switches views. TradeForm opens via a shared modal wrapper; on save it calls `addTrade`/`updateTrade` and stays open side-free on error (errors from `validateTrade` rendered inline per field).

## Data flow & styling rules

- Pure dark trading-terminal aesthetic in `src/styles/app.css`; tokens in `:root` (`--bg: #0d1117`, panels `#12181f`, border `#1f2b38`, green `#2ecc71`-ish `#16a34a`/`#22c55e`, red `#ef4444`, accent blue `#3b82f6`, muted text `#8b98a9`, text `#e6edf3`). All CSS via `:root` variables cascading into plain CSS since index.css may also be edited by lead — **Agent UI must not import two different normalize/reset css; only import `./styles/app.css` inside components**, and just uses classes it defines.
- Numbers/monospace in tables via `.mono` class; semantic positive/negative colors via `.pnl-pos`/`.pnl-neg`.
- No animation beyond ≤150ms color/border transitions. No new npm deps.
- Accessibility: every control needs an accessible label (`<label htmlFor>` or `aria-label`); table headers `<th scope>`; forms keep native focusability; buttons real `<button>`.
