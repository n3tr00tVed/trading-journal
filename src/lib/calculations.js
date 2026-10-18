/**
 * Pure financial calculations for the trading journal.
 * No React, no persistence, no side effects — fully unit-testable.
 *
 * Conventions (see CONTRACTS.md):
 * - P&L is computed per "contract/share/unit" (multiplier of 1).
 * - long:  (exitPrice - entryPrice) * quantity
 * - short: (entryPrice - exitPrice) * quantity
 * - Net P&L always subtracts fees.
 * - A trade is open iff exitPrice === null; open trades contribute 0 to P&L.
 * - All ratios are null-safe: never NaN, empty datasets yield 0 / null.
 */

import { isTradeOpen } from './schema.js';

/** Gross P&L for a closed trade; 0 for open trades. */
export function tradeGrossPnl(trade) {
  if (!trade || isTradeOpen(trade)) return 0;
  const { entryPrice, exitPrice, quantity, direction } = trade;
  if (!isFiniteNumber(entryPrice) || !isFiniteNumber(exitPrice) || !isFiniteNumber(quantity)) {
    return 0;
  }
  const diff = direction === 'short' ? entryPrice - exitPrice : exitPrice - entryPrice;
  return round2(diff * quantity);
}

/** Net P&L = gross - fees, for closed trades only. */
export function tradeNetPnl(trade) {
  if (!trade || isTradeOpen(trade)) return 0;
  const fees = isFiniteNumber(trade.fees) ? trade.fees : 0;
  return round2(tradeGrossPnl(trade) - fees);
}

/**
 * Money invested in the trade — the capital actually committed:
 *   1. explicit `invested` field when set (margin outlays, scaled positions),
 *   2. else (entry price × quantity) ÷ leverage for leveraged trades,
 *   3. else plain entry price × quantity.
 * Open trades invest real money too.
 */
export function tradeInvested(trade) {
  if (!trade) return 0;
  if (isFiniteNumber(trade.invested) && trade.invested >= 0) return round2(trade.invested);
  if (isFiniteNumber(trade.entryPrice) && isFiniteNumber(trade.quantity)) {
    const leverage = isFiniteNumber(trade.leverage) && trade.leverage >= 1 ? trade.leverage : 1;
    return round2((trade.entryPrice * trade.quantity) / leverage);
  }
  return 0;
}

/** Leverage label for UI: null when unlevered, '5×' style string otherwise. */
export function tradeLeverageLabel(trade) {
  if (trade && isFiniteNumber(trade.leverage) && trade.leverage > 1) {
    return `${round2(trade.leverage)}×`;
  }
  return null;
}

/** Net P&L as a percent of the invested capital (closed trades only). */
export function tradeReturnOnInvested(trade) {
  if (!trade || isTradeOpen(trade)) return null;
  const invested = tradeInvested(trade);
  if (!Number.isFinite(invested) || invested <= 0) return null;
  return round2((tradeNetPnl(trade) / invested) * 100);
}

/**
 * Unrealized (open-position) P&L from a live/last price:
 *   long  → (last − entry) × quantity
 *   short → (entry − last) × quantity
 * Returns null when there is no usable price — null means "unknown";
 * 0 is a real answer (price exactly at entry).
 */
export function unrealizedPnl(trade, lastPrice) {
  if (!trade || !isFiniteNumber(lastPrice)) return null;
  const entry = trade.entryPrice;
  const qty = trade.quantity;
  if (!isFiniteNumber(entry) || !isFiniteNumber(qty)) return null;
  const diff = trade.direction === 'short' ? entry - lastPrice : lastPrice - entry;
  return round2(diff * qty);
}

/** Unrealized P&L as a percent of invested capital (margin-aware), or null. */
export function unrealizedReturnOnInvested(trade, lastPrice) {
  const pnl = unrealizedPnl(trade, lastPrice);
  if (pnl === null) return null;
  const invested = tradeInvested(trade);
  if (!Number.isFinite(invested) || invested <= 0) return null;
  return round2((pnl / invested) * 100);
}

/**
 * Percent move still needed from `lastPrice` to reach the take-profit
 * level, signed by profitability of hitting it (positive = target still
 * ahead in the winning direction). null when there is no usable price or
 * the trade has no take-profit set.
 */
export function distanceToTakeProfit(trade, lastPrice) {
  return distanceToLevel(trade, lastPrice, 'takeProfit');
}

/** Same as distanceToTakeProfit but for the stop-loss level. */
export function distanceToStopLoss(trade, lastPrice) {
  return distanceToLevel(trade, lastPrice, 'stopLoss');
}

function distanceToLevel(trade, lastPrice, field) {
  if (!trade || !isFiniteNumber(lastPrice) || lastPrice <= 0) return null;
  const level = trade[field];
  if (!isFiniteNumber(level) || level <= 0) return null;
  const entry = trade.entryPrice;
  if (!isFiniteNumber(entry) || entry <= 0) return null;
  // % distance from the current price to the level (positive = level is above).
  return round2(((level - lastPrice) / lastPrice) * 100);
}

/**
 * Has the live price already touched the take-profit level? For a long
 * trade TP is above; for a short trade TP is below.
 */
export function takeProfitHit(trade, lastPrice) {
  return levelHit(trade, lastPrice, 'takeProfit');
}

/** Has the live price already touched the stop-loss level? */
export function stopLossHit(trade, lastPrice) {
  return levelHit(trade, lastPrice, 'stopLoss');
}

function levelHit(trade, lastPrice, field) {
  if (!trade || !isFiniteNumber(lastPrice) || lastPrice <= 0) return false;
  const level = trade[field];
  if (!isFiniteNumber(level) || level <= 0) return false;
  // Take-profit sits on the winning side (above entry for a long, below
  // for a short); stop-loss sits on the losing side. The price has hit a
  // level when it has reached it from the entry side.
  const winningSide = (trade.direction === 'long') === (field === 'takeProfit');
  return winningSide ? lastPrice >= level : lastPrice <= level;
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Aggregate statistics over an array of trades.
 * Never returns NaN; ratios are null when their denominator is zero.
 */
export function computeStats(trades) {
  const all = Array.isArray(trades) ? trades : [];
  const open = all.filter((t) => isTradeOpen(t));
  const closed = all.filter((t) => !isTradeOpen(t));

  let grossProfit = 0;
  let grossLoss = 0;
  let wins = 0;
  let losses = 0;
  let breakeven = 0;
  let largestWin = 0;
  let largestLoss = 0;

  for (const trade of closed) {
    const net = isFiniteNumber(trade?.netPnl) ? trade.netPnl : tradeNetPnl(trade);
    if (net > 0) {
      wins += 1;
      grossProfit += net;
      largestWin = Math.max(largestWin, net);
    } else if (net < 0) {
      losses += 1;
      grossLoss += Math.abs(net);
      largestLoss = Math.min(largestLoss, net);
    } else {
      breakeven += 1;
    }
  }

  grossProfit = round2(grossProfit);
  grossLoss = round2(grossLoss);
  const netPnl = round2(grossProfit - grossLoss);
  const totalFees = round2(closed.reduce((sum, t) => sum + (isFiniteNumber(t?.fees) ? t.fees : 0), 0));
  const investedClosed = round2(closed.reduce((sum, t) => sum + tradeInvested(t), 0));
  const investedOpen = round2(open.reduce((sum, t) => sum + tradeInvested(t), 0));

  const winRate = closed.length > 0 ? round2((wins / closed.length) * 100) : null;

  let profitFactor = null;
  if (closed.length > 0 && !(grossProfit === 0 && grossLoss === 0)) {
    profitFactor = grossLoss === 0 ? Infinity : round2(grossProfit / grossLoss);
  }

  const avgWin = wins > 0 ? round2(grossProfit / wins) : null;
  const avgLoss = losses > 0 ? round2(grossLoss / losses) : null;
  const expectancy = closed.length > 0 ? round2(netPnl / closed.length) : null;

  return {
    total: all.length,
    open: open.length,
    closed: closed.length,
    wins,
    losses,
    breakeven,
    winRate,
    grossProfit,
    grossLoss,
    netPnl,
    totalFees,
    profitFactor,
    avgWin,
    avgLoss,
    expectancy,
    largestWin,
    largestLoss,
    investedClosed,
    investedOpen,
  };
}

/**
 * Per-currency ledger: the same stat shape as computeStats but computed
 * separately for each native trade currency ('INR' for Indian-market
 * trades, 'USD' for US-market ones). Rupees and dollars must never be
 * summed, so every money total is reported per bucket while ratios
 * (win rate, profit factor) stay globally meaningful per bucket.
 * Buckets with no trades report zeros / nulls rather than being omitted,
 * so UI code can index breakdown['USD'] unconditionally.
 */
export function computeCurrencyBreakdown(trades) {
  const all = Array.isArray(trades) ? trades : [];
  const buckets = { INR: [], USD: [] };
  for (const trade of all) {
    const key = trade?.currency === 'USD' ? 'USD' : 'INR';
    buckets[key].push(trade);
  }
  return {
    INR: computeStats(buckets.INR),
    USD: computeStats(buckets.USD),
  };
}

/**
 * Filter trades. All criteria optional:
 *   query      matches symbol/strategy/setup/notes (case-insensitive substring)
 *   symbol     exact symbol match (case-insensitive)
 *   direction  'long' | 'short' | 'all'
 *   strategy   exact match (case-insensitive) or 'all'
 *   market     exact match or 'all'
 *   currency   'INR' | 'USD' | 'all' — native trade currency tag
 *   status     'all' | 'open' | 'closed'
 *   dateFrom / dateTo — lexicographic YYYY-MM-DD comparison on entryDate
 * Does not mutate the input; returns a new array.
 */
export function filterTrades(trades, criteria = {}) {
  const all = Array.isArray(trades) ? trades : [];
  const {
    query,
    symbol,
    direction = 'all',
    strategy = 'all',
    market = 'all',
    currency = 'all',
    status = 'all',
    dateFrom,
    dateTo,
  } = criteria;

  const q = typeof query === 'string' ? query.trim().toLowerCase() : '';

  return all.filter((trade) => {
    if (q) {
      const haystack = [trade.symbol, trade.strategy, trade.setup, trade.notes]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (symbol && String(trade.symbol).toLowerCase() !== String(symbol).trim().toLowerCase()) return false;
    if (direction !== 'all' && trade.direction !== direction) return false;
    if (strategy !== 'all' && (trade.strategy || '') !== strategy) return false;
    if (market !== 'all' && trade.market !== market) return false;
    if (currency !== 'all' && trade.currency !== currency) return false;
    if (status === 'open' && !isTradeOpen(trade)) return false;
    if (status === 'closed' && isTradeOpen(trade)) return false;
    if (dateFrom && (trade.entryDate || '') < dateFrom) return false;
    if (dateTo && (trade.entryDate || '') > dateTo) return false;
    return true;
  });
}

/**
 * Sort trades without mutating the input.
 * keys: 'entryDate' (default) | 'exitDate' | 'netPnl' | 'symbol'
 * dir: 'desc' (default) | 'asc'
 */
export function sortTrades(trades, key = 'entryDate', dir = 'desc') {
  const sorted = [...(Array.isArray(trades) ? trades : [])];
  const factor = dir === 'asc' ? 1 : -1;

  sorted.sort((a, b) => {
    let cmp;
    if (key === 'netPnl') {
      cmp = tradeNetPnl(a) - tradeNetPnl(b);
    } else if (key === 'symbol') {
      cmp = String(a?.symbol ?? '').localeCompare(String(b?.symbol ?? ''));
    } else if (key === 'exitDate') {
      cmp = String(a?.exitDate ?? '').localeCompare(String(b?.exitDate ?? ''));
    } else {
      cmp = String(a?.entryDate ?? '').localeCompare(String(b?.entryDate ?? ''));
    }
    if (cmp !== 0) return cmp * factor;
    // Stable tie-breaker keeps the list deterministic.
    return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
  });

  return sorted;
}

/**
 * Monthly P&L — a month-wise statement grouped by the month a trade CLOSED
 * (the exitDate's YYYY-MM), so each calendar month carries exactly the net
 * P&L that was realized in it. This is a reporting lens, not a new metric:
 * every money number passes through the same tradeNetPnl the dashboard
 * uses, so no total anywhere changes.
 *
 * Reading: "how much did I actually make or lose in Sep 2026?" Each closed
 * trade lands in the calendar month of its exit — the month its P&L
 * happened — regardless of which month it was taken in. Open trades appear
 * only once they close (their realization month); until then they
 * contribute to nothing here.
 *
 * Currency honesty applies month by month: money is reported per native
 * trade currency ({INR, USD}) and rupees/dollars are never summed.
 *
 * Returns an array sorted newest month first; rows render as
 *   { key: '2026-09', label: 'Sep 2026',
 *     closed, wins, losses,
 *     netPnl: { INR, USD }, currencies: ['USD', …],
 *     trades: Trade[] }
 * `currencies` lists every ledger the month touched (even a flat one), so
 * UI can lead with the active ledger when present and surface the other.
 * `trades` holds the trade objects themselves, in input order, so the UI
 * can expand a month and show every trade realized in it — the references
 * point at the original records, nothing is copied.
 *
 * `region` scopes the statement to one market, mirroring the news page's
 * markets (see MONTHLY_REGIONS). Trades are partitioned — market wins over
 * currency — so a trade belongs to exactly one region's view and no row is
 * ever counted twice across regions:
 *   CRYPTO → market 'crypto', whatever its quoting currency
 *   FOREX  → market 'forex' (INR and USD legs both land here)
 *   US     → USD ledger, crypto/forex excluded
 *   IN     → everything left (the INR ledger)
 *   'all'  → all trades together
 */
export const MONTHLY_REGIONS = ['all', 'IN', 'US', 'CRYPTO', 'FOREX'];

/** Exactly-one-bucket partition: market decides first, then currency. */
function tradeInRegion(trade, region) {
  if (region === 'all') return true;
  if (trade?.market === 'crypto') return region === 'CRYPTO';
  if (trade?.market === 'forex') return region === 'FOREX';
  if (trade?.currency === 'USD') return region === 'US';
  return region === 'IN';
}

export function monthlyBreakdown(trades, region = 'all') {
  const all = Array.isArray(trades) ? trades : [];
  const months = new Map();

  for (const trade of all) {
    if (isTradeOpen(trade)) continue; // an open trade's P&L isn't realized yet
    if (!tradeInRegion(trade, region)) continue;
    const key = monthKeyOf(trade?.exitDate);
    if (!key) continue; // a closed trade without a usable exit month can't be placed

    let bucket = months.get(key);
    if (!bucket) {
      bucket = {
        key,
        label: monthLabelOf(key),
        closed: 0,
        wins: 0,
        losses: 0,
        netPnl: { INR: 0, USD: 0 },
        currencies: [],
        trades: [],
      };
      months.set(key, bucket);
    }

    bucket.closed += 1;
    bucket.trades.push(trade);
    const currency = trade?.currency === 'USD' ? 'USD' : 'INR';
    if (!bucket.currencies.includes(currency)) bucket.currencies.push(currency);
    const net = isFiniteNumber(trade?.netPnl) ? trade.netPnl : tradeNetPnl(trade);
    bucket.netPnl[currency] = round2(bucket.netPnl[currency] + net);
    if (net > 0) bucket.wins += 1;
    else if (net < 0) bucket.losses += 1;
  }

  return [...months.values()].sort((a, b) => b.key.localeCompare(a.key));
}

/** '2026-09-14' → '2026-09'; null for anything non-month-shaped. */
function monthKeyOf(iso) {
  if (typeof iso !== 'string') return null;
  const match = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(iso.trim());
  if (!match) return null;
  const month = Number(match[2]);
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;
  return `${match[1]}-${match[2]}`;
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-09' → 'Sep 2026' (input already validated by monthKeyOf). */
function monthLabelOf(key) {
  const [year, month] = key.split('-').map(Number);
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

/**
 * Crypto swap exit price — what each unit of the sold coin was effectively
 * sold for when the position went out as a swap: value received
 * (receivedQuantity × receivedPrice) ÷ quantitySold. The form fills the
 * trade's exit price from this, so the swap journals as a normal close of
 * the sold coin and every existing P&L rule keeps working.
 * Returns null when any input isn't a positive finite number.
 */
export function swapExitPrice(quantitySold, receivedQuantity, receivedPrice) {
  if (
    !isFiniteNumber(quantitySold) || quantitySold <= 0 ||
    !isFiniteNumber(receivedQuantity) || receivedQuantity <= 0 ||
    !isFiniteNumber(receivedPrice) || receivedPrice <= 0
  ) {
    return null;
  }
  return round2((receivedQuantity * receivedPrice) / quantitySold);
}
