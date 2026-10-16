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
