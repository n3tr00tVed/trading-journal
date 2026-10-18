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
  leverage: number|null, // e.g. 5 = 5× margin; null = unlevered (validated ≥ 1)
  entryDate: string,   // ISO "YYYY-MM-DD" (required)
  exitDate: string|null,  // ISO "YYYY-MM-DD"; required when closed
  invested: number|null,  // money committed; null = derive as entryPrice × quantity ÷ leverage
  takeProfit: number|null, // planned profit-exit price; optional, validated > 0
  stopLoss: number|null,   // planned max-loss price; optional, validated > 0
  currency: 'INR'|'USD',  // native tag of the trade's market (legacy defaults to 'INR')
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
- `tradeInvested(trade)` — capital actually committed: explicit `invested` when set, else `(entryPrice × quantity) ÷ leverage` (leverage < 1 ignored = ÷1), else `0`. Open trades invest too.
- `tradeReturnOnInvested(trade)` — net P&L as % of invested; `null` while open or invested ≤ 0.
- **TP/SL levels** (`takeProfit`, `stopLoss`, both optional, > 0 when set): `distanceToTakeProfit(trade, lastPrice)` / `distanceToStopLoss` return the percent move from the live price to each level (null without a level or price); `takeProfitHit` / `stopLossHit` report whether a live price has reached the level (TP: reach on the winning side — long ≥ level, short ≤ level; SL: reach on the losing side — long ≤ level, short ≥ level). Levels are informational planning fields and never enter P&L aggregates.
- `isTradeOpen(trade)`.
- `computeStats(trades)` →
  `{ total, open, closed, wins, losses, breakeven, winRate, grossProfit, grossLoss, netPnl, totalFees, profitFactor, avgWin, avgLoss, expectancy, largestWin, largestLoss, investedClosed, investedOpen }`
  - win/loss classification by **net** PnL (fees included); `wins: net > 0`, `losses: net < 0`, `breakeven: net === 0`.
  - `winRate = (wins / closed) * 100` when `closed > 0`, else `null`.
  - `profitFactor = grossProfit / grossLoss` where `grossProfit = Σ net pnl of wins`, `grossLoss = |Σ net pnl of losses|`; return `null` when closed === 0 or both grossProfit and grossLoss are 0; return `Infinity` when grossProfit > 0 and grossLoss === 0. UI renders `Infinity` as `"∞"`.
  - `avgWin = grossProfitOfWins / wins` (null when no wins), `avgLoss` analogous, `expectancy = netPnl / closed` (null when closed === 0).
  - All aggregate fields are `0` for empty arrays except ratios which are `null` — nothing NaN anywhere.
- `computeCurrencyBreakdown(trades)` → `{ INR: stats, USD: stats }` — both keys always present (empty ledgers are zero-stat). **Rupees and dollars are never summed**: per-market money (net P&L, invested, averages) comes from each bucket; the active-market ledger leads UI cards and the other market surfaces in the sub-line.
- **Currency tagging**: trades carry a native `currency` tag of their market. New trades are tagged with the market you're viewing at save time (`App.saveTradeWithScreenshot`); edited trades keep their tag **unless the `market` field changes** — fixing the wrong market re-tags the profit to that market. Every money cell in the tables renders in `trade.currency` row by row.
- `filterTrades(trades, { query, symbol, direction, strategy, market?, currency?, dateFrom, dateTo, status })` — all optional; `currency` in `all|INR|USD`; `status` in `all|open|closed`; `query` matches symbol/strategy/setup/notes case-insensitively; date strings compare lexicographically (valid `YYYY-MM-DD`).
- `sortTrades(trades, key, dir)` — keys `entryDate|exitDate|netPnl|symbol` default `entryDate` desc (chronological, newest first for table display). Stable, does not mutate input.
- **Crypto swap exit pricing** `swapExitPrice(quantitySold, receivedQuantity, receivedPrice)` → `(receivedQuantity × receivedPrice) ÷ quantitySold`, rounded to 2dp; `null` when any input isn't a positive finite number. Pure core of the crypto-only swap helper in `TradeForm.jsx`: a swap (BTC → SOL) has no fiat step, so the trade's exit side derives from the coins received and every existing P&L rule keeps working. The UI fills `exitPrice` from it, closes the trade (`isOpen: false`; `exitDate` defaults to today unless already set) and records `"Swap: X FROM → Y TO @ price…"` in Notes — no schema change, and the result is reviewed + validated like any close before saving. The received coin's price may be auto-fetched from Binance (USD; for ₹-tagged trades the user supplies their own USD→INR rate).
- **Monthly P&L statement** `monthlyBreakdown(trades, region = 'all')` → rows keyed on the **close month** of `exitDate`, newest first: `{ key: '2026-09', label: 'Sep 2026', closed, wins, losses, breakeven, netPnl: { INR, USD }, currencies: ['USD', …], trades: Trade[] }` — `trades` holds references to the original records so the UI can expand a month into every trade realized in it. Rules: open trades contribute nothing until they close; currencies are NEVER summed inside a row — `netPnl` carries separate `INR`/`USD` buckets and `currencies` lists every ledger the month touched (even a flat one); a closed trade with an unparsable `exitDate` is skipped, not fabricated. `region` scopes the statement via `MONTHLY_REGIONS = ['all', 'IN', 'US', 'CRYPTO', 'FOREX']` and the exactly-one-bucket `tradeInRegion` partition — **market decides first** (crypto → CRYPTO, forex → FOREX, whatever their quoting currency), **then currency** (USD → US, everything else → IN) — so no trade is ever counted in two regions and monthly numbers never drift from the stats above.

## Formatting (`src/lib/format.js`)

`formatCurrency(n, {currency='USD'})` → `"$1,234.56"`, negative `−$123.45` printed via sign; `formatPercent(12.5)` → `"12.5%"`; `formatNumber(n)`; `formatDate('2026-01-02')` → `"Jan 2, 2026"`; `signedFormatCurrency(n)` → `"+…"`/`"−…"` prefix for P&L. Safe against null/undefined/NaN → `""`.

## Persistence hook (`src/hooks/useTrades.js`)

```js
const { trades, stats, addTrade, updateTrade, deleteTrade, restoreTrades, importTrades, clearAll, lastError } = useTrades();
```

- Backed by `src/lib/storage.js` (`loadTrades(): Trade[]` with per-record `normalizeTrade` + `validateTrade` filtering/quarantine of malformed records, `saveTrades(trades)` best-effort with quota/serialization-safe try/catch, `STORAGE_KEY = 'trading-journal:trades:v1'`).
- Mutations validate and return `{ ok, errors }`; all state updates persist synchronously to localStorage; `stats` from `computeStats(trades)` via `useMemo`.
- **Closed trades are guarded, not silently editable**: `updateTrade` on a closed record rejects every field change except the internal `hasScreenshot` flag — returning `{ ok: false, locked: true }` without touching storage — unless the caller explicitly passes `{ allowClosed: true }`. That flag exists only for the UI path that first shows the **"Edit closed trade?"** confirmation ("Unlock and edit"); `App.openEditTrade` routes closed trades through this dialog and marks the form `unlocked`, and the save path passes `allowClosed` on that basis. Every closed row still shows "Edit 🔒" with a tooltip explaining that editing rewrites recorded history. So accidental edits are blocked twice (UI confirm + data-layer guard), while deliberate corrections are possible without the old delete-and-re-enter workaround.
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

## Live crypto prices (`src/lib/marketData.js` + `src/hooks/useLivePrices.js`)

- Strictly read-only, the honesty template every network feature copies:
  open crypto
  positions are quoted from Binance's public `/api/v3/ticker/price` (no
  key, no auth). Requests carry nothing but the symbols; responses are
  price numbers kept in memory only — never persisted, never exported,
  never synced to `trades_data`.
- Symbol mapping `toBinanceSymbol`: `BTC`, `BTC/USDT`, `BTC-USD`,
  `BTCUSD` → `BTCUSDT` (base + USDT pool). Non-crypto markets resolve to
  no feed (browsers have no free CORS-legal quote source for them) and
  show "manual".
- `fetchCryptoPrices(symbols)` batches one request, then falls back to
  per-symbol probes when the batch is rejected, so one unlisted coin
  cannot blind the rest. Every failure surfaces honestly
  (`'offline'` / `'not listed on Binance'`) — never a fabricated price.
- Unresolved/failed symbols show `—`; `realized` totals NEVER include
  unrealized amounts: `Net P&L` and every aggregate in `computeStats`
  remain closed-trades-only. `unrealizedPnl(trade, lastPrice)` =
  `(±(last − entry)) × qty` (sign by direction), null when no price; 0 at
  entry is a real answer. `unrealizedReturnOnInvested` divides by the
  margin-aware invested amount.
- Polling (`useLivePrices`): 10s interval, only while the app has open
  crypto positions, zero requests when the tab is hidden (status
  `paused`, restored on return) or the toggle is off
  (`trading-journal:settings:v1` → `livePrices`, default true, checkbox
  in Settings). First tick is immediate so P&L appears within seconds of
  page load.

## Live NSE quotes (`src/lib/marketData.js` + `src/hooks/useIndianPrices.js`)

- Same honesty rules as Binance: read-only public data, no keys, memory
  only — never persisted, never exported, never synced to `trades_data`.
  Browsers cannot call Yahoo's chart API directly (no CORS), so requests go
  through the public relays the news page uses (AllOrigins → CodeTabs);
  nothing but the symbol URL is sent either way.
- `toYahooSymbol`: `RELIANCE` → `RELIANCE.NS` (NSE); explicit `.NS`/`.BO`
  pass through; unusable symbols → `null`.
- `isNseMarketOpenNow(date)` — Mon–Fri 09:15–15:30 IST computed via `Intl`
  (no timezone libraries); an unusable clock answers "closed", the honest
  default.
- `fetchIndianPrices(journalSymbols)` → `{ prices, errors }` keyed by the
  JOURNAL symbol: `prices[sym] = { price, asOf }`, `errors[sym] = 'offline'
  | 'no quote' | 'throttled'` (HTTP 429/401/403 → `throttled`). Each symbol
  walks the relay list independently, so one rate-limited relay never blinds
  the rest, and a failed fetch surfaces honestly — never a fabricated price.
- Polling (`useIndianPrices`): 60s interval (the relayed endpoint throttle
  is harsher than Binance's and equities are a slow market), only for OPEN
  `market: 'stocks'` + `currency: 'INR'` positions, and only while
  `isNseMarketOpenNow()` — outside NSE hours the hook requests nothing and
  reports status `'closed'` ("NSE closed — quotes resume 9:15 IST").
  Toggle `indianLivePrices` in `trading-journal:settings:v1` (default true,
  checkbox in Settings). Futures/options/forex get no live feed on purpose —
  their rows show "manual".

## News + sentiment (`src/lib/news.js` + `src/components/NewsPage.jsx`)

- Regions `NEWS_REGIONS = ['all', 'IN', 'US', 'CRYPTO', 'FOREX']` with
  publisher RSS feeds per region (Economic Times, CNBC, CoinDesk, Google
  News topics incl. a forex/currency topic). Each headline carries
  `region`, `sentiment` ('bullish' | 'bearish' | 'neutral' | null) and
  `forecast` ('up' | 'down' | null wording of the overall verdict).
- Fetch chain per feed: rss2json → AllOrigins → CodeTabs
  (`FETCH_TIMEOUT_MS = 15000`). Whichever path succeeds is **pinned**
  (localStorage `trading-journal:news:fetch-paths:v1`; path ids listed in
  `FETCH_PATH_IDS`) and tried alone first on the next refresh — fewer
  relays see a repeated client (IP minimization; relays still necessarily
  see the IP, publishers don't). A stale pin is dropped only after an
  all-paths failure. Item cache `trading-journal:news:cache:v1` with a
  10-minute TTL. Failures are named per feed with a Retry — never faked.
- `overallSentiment(items)` → per-region tally
  `{ total, bullish, bearish, neutral, tone, label, direction, forecast }`
  for all five region keys, with `MIN_SENTIMENT_SAMPLE = 3` (at least three
  classified headlines before a directional verdict is allowed — two are
  gossip, not a trend). `forecast` is the plain-English forward framing:
  'Market may rise' | 'Market may fall' | 'Direction unclear' |
  'No directional cue'; `tone`/`label` (Likely bullish/bearish, Mixed,
  No clear) are kept for compatibility. Sample counts are always rendered
  so a verdict's basis is visible. Informational mood-reading, never a
  trading signal.

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
