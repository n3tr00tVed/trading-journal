import { describe, expect, it } from 'vitest';
import {
  computeCurrencyBreakdown,
  computeStats,
  filterTrades,
  sortTrades,
  tradeGrossPnl,
  tradeInvested,
  tradeNetPnl,
  tradeReturnOnInvested,
} from '../lib/calculations.js';
import { createTrade, normalizeTrade, validateTrade, isTradeOpen } from '../lib/schema.js';

/** Helper: trade with a default valid symbol; fees handled explicitly. */
function trade(fields) {
  return createTrade({ symbol: 'TEST', ...fields });
}

describe('tradeInvested', () => {
  it('derives entry × quantity when no explicit invested is stored', () => {
    const t = trade({ direction: 'long', entryPrice: 812.5, quantity: 4 });
    expect(tradeInvested(t)).toBe(3250);
    // open trades invest real money too
    expect(tradeInvested({ ...t, exitPrice: null })).toBe(3250);
  });

  it('uses the explicit invested override when present', () => {
    const t = trade({ direction: 'long', entryPrice: 100, quantity: 2, invested: 175 });
    expect(tradeInvested(t)).toBe(175);
  });

  it('returns 0 instead of NaN for broken records', () => {
    expect(tradeInvested({ direction: 'long' })).toBe(0);
    expect(tradeInvested(null)).toBe(0);
  });

  it('rejects negative invested values', () => {
    const verdict = validateTrade(trade({ direction: 'long', entryPrice: 100, quantity: 2, invested: -50 }));
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.invested).toBeTruthy();
  });

  it('reports invested totals per open/closed split', () => {
    const trades = [
      trade({ direction: 'long', entryPrice: 100, exitPrice: 110, quantity: 2, invested: 150 }),
      trade({ direction: 'long', entryPrice: 50, exitPrice: null, quantity: 4 }),
    ];
    const s = computeStats(trades);
    expect(s.investedClosed).toBe(150);
    expect(s.investedOpen).toBe(200);
  });
});

describe('leverage', () => {
  it('divides auto-derived invested by leverage when invested is unset', () => {
    const t = trade({ direction: 'long', entryPrice: 400, exitPrice: 420, quantity: 10, leverage: 5 });
    expect(tradeInvested(t)).toBe(800); // 4000 ÷ 5 margin
    expect(tradeNetPnl(t)).toBe(200); // +20/pt × 10 pts
    expect(tradeReturnOnInvested(t)).toBe(25); // 200 ÷ 800 margin
  });

  it('explicit invested beats the leverage derivation', () => {
    const t = trade({ direction: 'long', entryPrice: 400, quantity: 10, leverage: 5, invested: 900 });
    expect(tradeInvested(t)).toBe(900);
  });

  it('treats missing/tiny leverage as unlevered', () => {
    const t = trade({ direction: 'long', entryPrice: 100, quantity: 2 });
    expect(tradeInvested(t)).toBe(200);
    // Sub-1 leverage is invalid input; the helper ignores it (÷1), while
    // full validation rejects it at save time.
    expect(tradeInvested({ ...t, leverage: 0.5 })).toBe(200);
  });

  it('rejects leverage below 1', () => {
    const verdict = validateTrade(trade({ entryPrice: 100, quantity: 2, leverage: 0 }));
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.leverage).toBeTruthy();
  });
});

describe('per-trade currency tagging', () => {
  it('normalizes unknown/missing currency to INR and keeps valid tags', () => {
    expect(normalizeTrade({ symbol: 'X', entryPrice: 1, quantity: 1, entryDate: '2026-01-01' }).currency).toBe('INR');
    expect(normalizeTrade({ symbol: 'X', entryPrice: 1, quantity: 1, currency: 'EUR' }).currency).toBe('INR');
    expect(normalizeTrade({ symbol: 'X', entryPrice: 1, quantity: 1, currency: 'USD' }).currency).toBe('USD');
  });

  it('validates against unknown currency codes', () => {
    // validateTrade is the guard against hand-crafted/disabled-tag records;
    // normalizeTrade would have coerced these to INR before storage.
    const verdict = validateTrade({
      symbol: 'X',
      entryPrice: 1,
      quantity: 1,
      entryDate: '2026-01-01',
      currency: 'EUR',
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.currency).toBeTruthy();
  });

  it('breakdowns never sum rupees and dollars', () => {
    const trades = [
      trade({ direction: 'long', entryPrice: 100, exitPrice: 110, quantity: 2, currency: 'INR' }), // +20 INR
      trade({ direction: 'long', entryPrice: 100, exitPrice: 90, quantity: 1, currency: 'USD' }), // −10 USD
      trade({ direction: 'long', entryPrice: 50, exitPrice: null, quantity: 4, currency: 'USD' }),
    ];
    const breakdown = computeCurrencyBreakdown(trades);
    expect(breakdown.INR.netPnl).toBe(20);
    expect(breakdown.INR.total).toBe(1);
    expect(breakdown.USD.netPnl).toBe(-10);
    expect(breakdown.USD.open).toBe(1);
    expect(breakdown.USD.total).toBe(2);
    expect(breakdown.USD.investedClosed).toBe(100);
    // Zero-trade buckets still exist as empty ledgers.
    expect(computeCurrencyBreakdown([]).USD.total).toBe(0);
  });

  it('profit factor stays per-market, even when INR wins and USD loses', () => {
    const trades = [
      trade({ direction: 'long', entryPrice: 100, exitPrice: 120, quantity: 1, currency: 'INR' }),
      trade({ direction: 'long', entryPrice: 100, exitPrice: 50, quantity: 1, currency: 'USD' }),
    ];
    const breakdown = computeCurrencyBreakdown(trades);
    expect(breakdown.INR.profitFactor).toBe(Infinity); // only wins in INR
    expect(breakdown.USD.profitFactor).toBe(0); // only losses in USD
  });

  it('filters by native currency', () => {
    const trades = [
      trade({ direction: 'long', entryPrice: 100, quantity: 1, currency: 'INR', symbol: 'NIFTY' }),
      trade({ direction: 'long', entryPrice: 100, quantity: 1, currency: 'USD', symbol: 'AAPL' }),
    ];
    expect(filterTrades(trades, { currency: 'USD' }).map((t) => t.symbol)).toEqual(['AAPL']);
    expect(filterTrades(trades, { currency: 'all' })).toHaveLength(2);
  });
});

describe('tradeNetPnl', () => {
  it('computes long P&L including fees', () => {
    const t = trade({
      direction: 'long',
      entryPrice: 100,
      exitPrice: 110,
      quantity: 10,
      fees: 5,
    });
    expect(tradeGrossPnl(t)).toBe(100);
    expect(tradeNetPnl(t)).toBeCloseTo(100 - 5);
  });

  it('computes short P&L: profit when price falls', () => {
    const t = trade({
      direction: 'short',
      entryPrice: 50,
      exitPrice: 45,
      quantity: 4,
      fees: 2,
    });
    expect(tradeGrossPnl(t)).toBe(20);
    expect(tradeNetPnl(t)).toBeCloseTo(18);
  });

  it('computes short P&L: loss when price rises', () => {
    const t = trade({
      direction: 'short',
      entryPrice: 50,
      exitPrice: 58,
      quantity: 2,
      fees: 1,
    });
    expect(tradeGrossPnl(t)).toBe(-16);
    expect(tradeNetPnl(t)).toBeCloseTo(-17);
  });

  it('returns 0 for open trades', () => {
    const t = trade({
      direction: 'long',
      entryPrice: 100,
      exitPrice: null,
      quantity: 10,
      fees: 3,
    });
    expect(isTradeOpen(t)).toBe(true);
    expect(tradeGrossPnl(t)).toBe(0);
    expect(tradeNetPnl(t)).toBe(0);
  });

  it('treats exitPrice 0 as a closed trade, not an open one', () => {
    const t = trade({
      direction: 'short',
      entryPrice: 10,
      exitPrice: 0,
      quantity: 1,
      fees: 0,
    });
    expect(isTradeOpen(t)).toBe(false);
    expect(tradeNetPnl(t)).toBe(10);
  });
});

describe('computeStats', () => {
  it('handles empty dataset without NaN', () => {
    const s = computeStats([]);
    expect(s.total).toBe(0);
    expect(s.closed).toBe(0);
    expect(s.open).toBe(0);
    expect(s.netPnl).toBe(0);
    expect(s.winRate).toBeNull();
    expect(s.profitFactor).toBeNull();
    expect(s.avgWin).toBeNull();
    expect(s.avgLoss).toBeNull();
    expect(s.expectancy).toBeNull();
    expect(Number.isNaN(s.winRate)).toBe(false);
  });

  it('classifies wins/losses by net P&L (fees matter)', () => {
    const trades = [
      trade({ direction: 'long', entryPrice: 10, exitPrice: 10.5, quantity: 10, fees: 49 }), // +5-49 => -44 loss
      trade({ direction: 'long', entryPrice: 10, exitPrice: 11, quantity: 10, fees: 0 }), // +100 win
    ];
    const s = computeStats(trades);
    expect(s.wins).toBe(1);
    expect(s.losses).toBe(1);
    expect(s.closed).toBe(2);
    expect(s.winRate).toBe(50);
    expect(s.grossProfit).toBeCloseTo(10);
    expect(s.grossLoss).toBeCloseTo(44);
    expect(s.netPnl).toBeLessThan(0);
  });

  it('excludes open trades from P&L but reports them', () => {
    const trades = [
      trade({ direction: 'long', entryPrice: 10, exitPrice: 12, quantity: 1 }),
      trade({ direction: 'long', entryPrice: 20, exitPrice: null, quantity: 1 }),
    ];
    const s = computeStats(trades);
    expect(s.open).toBe(1);
    expect(s.closed).toBe(1);
    expect(s.netPnl).toBe(2);
  });

  it('profit factor: profit with no losers => Infinity, otherwise ratio', () => {
    const allWinners = [
      trade({ direction: 'long', entryPrice: 10, exitPrice: 11, quantity: 1 }),
    ];
    expect(computeStats(allWinners).profitFactor).toBe(Infinity);

    const mixed = [
      trade({ direction: 'long', entryPrice: 10, exitPrice: 11, quantity: 10 }), // +10
      trade({ direction: 'short', entryPrice: 10, exitPrice: 11, quantity: 10 }), // -10
    ];
    expect(computeStats(mixed).profitFactor).toBeCloseTo(1);
  });

  it('breakeven trades are neither wins nor losses', () => {
    const t = [trade({ direction: 'long', entryPrice: 100, exitPrice: 100, quantity: 1, fees: 0 })];
    const s = computeStats(t);
    expect(s.breakeven).toBe(1);
    expect(s.wins).toBe(0);
    expect(s.losses).toBe(0);
    expect(s.winRate).toBe(0);
    expect(s.profitFactor).toBeNull();
  });

  it('expectancy uses net P&L divided by closed trades', () => {
    const trades = [
      trade({ direction: 'long', entryPrice: 10, exitPrice: 20, quantity: 1, fees: 0 }), // +10
      trade({ direction: 'long', entryPrice: 10, exitPrice: 8, quantity: 1, fees: 0 }), // -2
    ];
    const s = computeStats(trades);
    expect(s.expectancy).toBeCloseTo(4);
    expect(s.avgWin).toBeCloseTo(10);
    expect(s.avgLoss).toBeCloseTo(2);
    expect(s.largestWin).toBeCloseTo(10);
    expect(s.largestLoss).toBeCloseTo(-2);
    expect(s.totalFees).toBe(0);
  });
});

describe('validateTrade / createTrade', () => {
  it('rejects bad numbers and missing symbols', () => {
    const v = validateTrade({ symbol: '', entryPrice: -5, quantity: 0, entryDate: 'nope' });
    expect(v.ok).toBe(false);
    expect(Object.keys(v.errors)).toEqual(
      expect.arrayContaining(['symbol', 'entryPrice', 'quantity', 'entryDate']),
    );
  });

  it('exit date before entry date is invalid', () => {
    const v = validateTrade({
      symbol: 'AAPL',
      entryPrice: 10,
      quantity: 1,
      entryDate: '2026-01-10',
      exitPrice: 12,
      exitDate: '2026-01-02',
    });
    expect(v.ok).toBe(false);
    expect(v.errors.exitDate).toBeTruthy();
  });

  it('accepts a valid closed trade', () => {
    const v = validateTrade(createTrade({
      symbol: 'ES',
      market: 'futures',
      direction: 'short',
      entryPrice: 5000,
      exitPrice: 4950,
      quantity: 2,
      entryDate: '2026-01-05',
      exitDate: '2026-01-06',
      fees: 4,
    }));
    expect(v.ok).toBe(true);
  });
});

describe('filterTrades', () => {
  const trades = [
    { ...createTrade({ symbol: 'AAPL', direction: 'long', strategy: 'breakout', entryPrice: 1, quantity: 1, exitPrice: 5, exitDate: '2026-01-05' }), entryDate: '2026-01-05', notes: 'gap up' },
    { ...createTrade({ symbol: 'ES', direction: 'short', strategy: 'reversal', market: 'futures', entryPrice: 1, quantity: 1, exitPrice: null }), entryDate: '2026-02-11', setup: 'fib', notes: 'overnight' },
    { ...createTrade({ symbol: 'MSFT', direction: 'long', strategy: 'breakout', entryPrice: 1, quantity: 1, exitPrice: 9, exitDate: '2026-03-02' }), entryDate: '2026-03-01' },
  ];

  it('filters by direction, status and date range', () => {
    expect(filterTrades(trades, { direction: 'short' })).toHaveLength(1);
    expect(filterTrades(trades, { status: 'open' })).toHaveLength(1);
    expect(filterTrades(trades, { status: 'closed' })).toHaveLength(2);
    expect(filterTrades(trades, { dateFrom: '2026-02-01' })).toHaveLength(2);
    expect(filterTrades(trades, { dateTo: '2026-01-31' })).toHaveLength(1);
  });

  it('free-text query matches symbol/strategy/setup/notes', () => {
    expect(filterTrades(trades, { query: 'reversal' }).map((t) => t.symbol).length).toBeGreaterThan(0);
    expect(filterTrades(trades, { query: 'gap up' })).toHaveLength(1);
    expect(filterTrades(trades, { query: 'fb', symbol: '' })).toHaveLength(0);
  });

  it('returns a fresh array and never mutates the input', () => {
    const copy = [...trades];
    filterTrades(trades, { query: 'aapl' });
    expect(trades).toEqual(copy);
  });
});

describe('sortTrades', () => {
  const a = { ...createTrade({ symbol: 'AAA', direction: 'long', entryPrice: 1, quantity: 1 }), entryDate: '2026-01-01' };
  const b = { ...createTrade({ symbol: 'ZZZ', direction: 'long', entryPrice: 1, quantity: 1 }), entryDate: '2026-02-01' };

  it('defaults to entryDate desc (newest first)', () => {
    expect(sortTrades([a, b])[0].symbol).toBe('ZZZ');
    expect(sortTrades([a, b], 'entryDate', 'asc')[0].symbol).toBe('AAA');
  });

  it('sorts by netPnl and symbol without mutating input', () => {
    const win = { ...createTrade({ symbol: 'M', direction: 'long', entryPrice: 1, quantity: 1 }), entryDate: '2026-03-01', exitPrice: 2, exitDate: '2026-03-01' };
    const lose = { ...createTrade({ symbol: 'N', direction: 'short', entryPrice: 1, quantity: 1 }), entryDate: '2026-01-05', exitPrice: 9, exitDate: '2026-01-05' };
    const input = [lose, win];
    expect(sortTrades(input, 'netPnl', 'desc')[0].symbol).toBe('M');
    expect(input).toEqual([lose, win]);
  });
});
