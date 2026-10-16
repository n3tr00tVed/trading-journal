# Shared contracts — Trading Journal

Design and calculation-convention reference for the modules in `src/lib`,
`src/hooks` and the component interfaces in `src/components`. (Originally
written to coordinate parallel implementation agents; retained as the
authoritative conventions doc.)

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

## Rules view (`src/components/RulesPage.jsx` + `src/lib/rulesStorage.js`)

- Free-form text, autosaved (600ms debounce) to `trading-journal:rules:v1`.
- Same safety model as trades: corrupt/non-string stored values load as ''.
- Clearing requires an explicit confirm dialog.

## Account capital (`src/lib/capitalStorage.js`)

- Single non-negative number (or unset/null) stored at
  `trading-journal:capital:v1`; rejects negative/non-finite on save,
  ignores corrupt stored data on load.
- `parseCapitalInput(text)` accepts `'$12,500.50'`/`''` (→ unset) styles.
- App state owned by `App.jsx`; Settings page edits it, Dashboard renders
  `Return on capital: netPnl / capital` when capital > 0.

## Currency (`src/lib/settingsStorage.js` + `src/hooks/useCurrency.js`)

- `CurrencyContext{ currency, setCurrency }` in `App.jsx`; persisted at
  `trading-journal:settings:v1`. Default `INR`; only `INR`/`USD` accepted.
- Quick switch lives in the sidebar ("Trading market: India/US"), the
  Settings card mirrors the same state; the Calculator's price labels and
  the Trades market filter follow it.
- `formatCurrency/signedFormatCurrency(value, currency)` take the currency
  explicitly everywhere; INR renders with `en-IN` grouping (₹1,23,456).

## Position-size calculator (`src/lib/calculator.js` + `CalculatorPage`)

- Pure `positionSizing({ capital, riskPercent, entryPrice, stopLoss,
  direction, lotSize })` — two caps: `qtyByRisk = floor(riskAmount /
  |entry-stop|)` (needs a stop on the losing side of entry) and
  `qtyByCapital = floor(capital / entry)`; `recommendedQty = min(both)`;
  lots = `floor(qty / lotSize)` only when lotSize > 1, rounded down so
  planned outlay never exceeds capital. Null-safe, never NaN.
- `LOT_SIZES` in `src/lib/lotSizes.js` curates NSE/BSE/MCX lots; cash
  stocks and unknown symbols default to 1 (overridable input).

## Engineering notes (post-integration)

- `addTrade`/`updateTrade`/etc. compute from the current `list` state rather
  than functional updates — deliberate, because persisting inside a
  functional updater runs side effects twice under StrictMode. The UI only
  triggers one mutation per interaction; `importTrades` handles batches
  internally in a single pass.
- A negative `exitPrice` never flips a trade to "open"; it is a validation
  error (`Exit price must be 0 or a positive number.`).
- `ok` from `importTrades` means "at least one trade was added".
- No exit-vs-entry sanity rule exists by design: `exit < entry` is a normal
  losing (long) or winning (short) trade, not malformed data.

## Data flow & styling rules

- Dark trading-terminal aesthetic in `src/styles/app.css`; all styling via
  `:root` variables cascading into plain CSS. Only one stylesheet is imported
  (`src/App.jsx`), and components use the shared class system.
- Numbers/monospace in tables via `.mono` class; semantic positive/negative colors via `.pnl-pos`/`.pnl-neg`.
- No animation beyond ≤150ms color/border transitions. No new npm deps.
- Accessibility: every control needs an accessible label (`<label htmlFor>` or `aria-label`); table headers `<th scope>`; forms keep native focusability; buttons real `<button>`.
