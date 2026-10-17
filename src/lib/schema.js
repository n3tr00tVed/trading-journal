/**
 * Trade data model and schema utilities.
 *
 * Canonical field list (see CONTRACTS.md):
 *   id, symbol, market, currency, direction, entryPrice, exitPrice,
 *   quantity, invested, entryDate, exitDate, fees, strategy, setup, notes,
 *   hasScreenshot, createdAt, takeProfit, stopLoss
 *
 * `country` money is always the trade's own: a trade recorded in the US
 * market is tagged 'USD' and formatted in dollars, an Indian market trade
 * is tagged 'INR' and formatted in rupees. Legacy records without a
 * currency normalize to 'INR' (the app's primary market).
 * `exitPrice === null` means the trade is open. Status is always derived,
 * never stored, so totals cannot drift from the raw records.
 *
 * `leverage` (optional, e.g. 5 = 5× margin) scales the auto-derived invested
 * amount: invested = entryPrice × quantity ÷ leverage when `invested` is
 * unset. Trade-level money fields use the trade's own `currency` tag.
 *
 * `takeProfit` and `stopLoss` are optional price targets for the trade.
 * When set, they represent the price at which the trade would be closed
 * for profit (take profit) or loss (stop loss). These are informational
 * only and do not affect P&L calculations unless explicitly used.
 */

export const MARKETS = ['stocks', 'futures', 'forex', 'crypto', 'options'];
export const DIRECTIONS = ['long', 'short'];
export const TRADE_CURRENCIES = ['INR', 'USD'];

let n = 0;
function randomId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  n += 1;
  return `t-${Date.now().toString(36)}-${n}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Rough date-only validation: YYYY-MM-DD. Accepts only real calendar dates. */
export function isValidDateString(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split('-').map(Number);
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return (
    date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
  );
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const num = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(num) ? num : null;
}

function toText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Coerce an unknown raw record into a canonical trade, or null when the
 * essential parts are unrecoverable. Never throws. Numeric strings are
 * converted to numbers; unknown properties are dropped.
 */
export function normalizeTrade(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;

  const symbol = toText(raw.symbol).toUpperCase();
  const direction = raw.direction === 'short' ? 'short' : 'long';
  const entryPrice = toNumberOrNull(raw.entryPrice);
  const quantity = toNumberOrNull(raw.quantity);
  const exitPrice = toNumberOrNull(raw.exitPrice);
  const fees = toNumberOrNull(raw.fees);
  const invested = toNumberOrNull(raw.invested);
  const leverage = toNumberOrNull(raw.leverage);
  const takeProfit = toNumberOrNull(raw.takeProfit);
  const stopLoss = toNumberOrNull(raw.stopLoss);

  if (!symbol || entryPrice === null || quantity === null) return null;

  const trade = {
    id: typeof raw.id === 'string' && raw.id ? raw.id : randomId(),
    symbol,
    market: MARKETS.includes(raw.market) ? raw.market : 'stocks',
    currency: TRADE_CURRENCIES.includes(raw.currency) ? raw.currency : 'INR',
    direction,
    entryPrice,
    exitPrice: exitPrice !== null ? exitPrice : null,
    quantity,
    invested: invested !== null ? invested : null,
    leverage: leverage !== null ? leverage : null,
    takeProfit: takeProfit !== null && takeProfit > 0 ? takeProfit : null,
    stopLoss: stopLoss !== null && stopLoss > 0 ? stopLoss : null,
    entryDate: isValidDateString(raw.entryDate) ? raw.entryDate : null,
    exitDate: isValidDateString(raw.exitDate) ? raw.exitDate : null,
    fees: fees === null || fees < 0 ? 0 : fees,
    strategy: toText(raw.strategy),
    setup: toText(raw.setup),
    notes: typeof raw.notes === 'string' ? raw.notes : toText(raw.notes),
    hasScreenshot: raw.hasScreenshot === true,
    createdAt: typeof raw.createdAt === 'string' && raw.createdAt ? raw.createdAt : new Date().toISOString(),
  };

  // A closed trade must have an exit price; an open trade must not.
  if (trade.exitPrice !== null) {
    trade.exitDate = trade.exitDate || trade.entryDate;
  } else {
    trade.exitDate = null;
  }

  return trade;
}

export function createTrade(partial = {}) {
  const now = new Date().toISOString();
  const trade = normalizeTrade({
    market: 'stocks',
    direction: 'long',
    fees: 0,
    strategy: '',
    setup: '',
    notes: '',
    entryDate: new Date().toISOString().slice(0, 10),
    exitPrice: null,
    ...partial,
  });
  if (trade && !partial.createdAt) trade.createdAt = now;
  return trade;
}

/**
 * Validate a trade object. Returns { ok: true, errors: {} } or
 * { ok: false, errors: { field: message } } with one message per bad field.
 */
export function validateTrade(trade) {
  const errors = {};
  if (!trade || typeof trade !== 'object') {
    return { ok: false, errors: { form: 'Invalid trade record.' } };
  }

  if (!toText(trade.symbol)) errors.symbol = 'Symbol is required.';

  if (!Number.isFinite(trade.entryPrice) || trade.entryPrice <= 0) {
    errors.entryPrice = 'Entry price must be a number greater than 0.';
  }

  if (trade.exitPrice !== null && trade.exitPrice !== undefined) {
    if (!Number.isFinite(trade.exitPrice) || trade.exitPrice < 0) {
      errors.exitPrice = 'Exit price must be 0 or a positive number.';
    }
  }

  if (!Number.isFinite(trade.quantity) || trade.quantity <= 0) {
    errors.quantity = 'Quantity must be a number greater than 0.';
  }

  if (trade.invested !== null && trade.invested !== undefined) {
    if (!Number.isFinite(trade.invested) || trade.invested < 0) {
      errors.invested = 'Invested amount must be 0 or a positive number.';
    }
  }

  if (trade.leverage !== null && trade.leverage !== undefined) {
    if (!Number.isFinite(trade.leverage) || trade.leverage < 1) {
      errors.leverage = 'Leverage must be 1 or higher (e.g. 5 for 5× margin).';
    }
  }

  if (trade.takeProfit !== null && trade.takeProfit !== undefined) {
    if (!Number.isFinite(trade.takeProfit) || trade.takeProfit <= 0) {
      errors.takeProfit = 'Take profit must be a positive number.';
    }
  }

  if (trade.stopLoss !== null && trade.stopLoss !== undefined) {
    if (!Number.isFinite(trade.stopLoss) || trade.stopLoss <= 0) {
      errors.stopLoss = 'Stop loss must be a positive number.';
    }
  }

  if (!isValidDateString(trade.entryDate)) {
    errors.entryDate = 'Entry date is required (YYYY-MM-DD).';
  }

  if (trade.exitDate !== null && trade.exitDate !== undefined && !isValidDateString(trade.exitDate)) {
    errors.exitDate = 'Exit date must be a valid date (YYYY-MM-DD).';
  }

  if (trade.exitPrice != null && trade.exitDate != null && trade.exitDate < trade.entryDate) {
    errors.exitDate = 'Exit date cannot be before the entry date.';
  }

  if (trade.fees !== undefined && trade.fees !== null) {
    if (!Number.isFinite(trade.fees) || trade.fees < 0) {
      errors.fees = 'Fees must be 0 or a positive number.';
    }
  }

  if (trade.direction && !DIRECTIONS.includes(trade.direction)) {
    errors.direction = 'Direction must be long or short.';
  }

  if (trade.market && !MARKETS.includes(trade.market)) {
    errors.market = 'Select a valid market.';
  }

  if (trade.currency && !TRADE_CURRENCIES.includes(trade.currency)) {
    errors.currency = 'Currency must be INR (Indian market) or USD (US market).';
  }

  return Object.keys(errors).length === 0 ? { ok: true, errors: {} } : { ok: false, errors };
}

export function isTradeOpen(trade) {
  return Boolean(trade) && trade.exitPrice === null;
}
