import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { useTrades } from '../hooks/useTrades.js';
import { STORAGE_KEY } from '../lib/storage.js';

const OPEN = {
  id: 'open-1',
  symbol: 'MSFT',
  market: 'stocks',
  direction: 'short',
  entryPrice: 200,
  quantity: 1,
  entryDate: '2026-01-05',
  exitPrice: null,
};

const CLOSED = {
  id: 'closed-1',
  symbol: 'AAPL',
  market: 'stocks',
  direction: 'long',
  entryPrice: 100,
  exitPrice: 110,
  quantity: 2,
  entryDate: '2026-01-02',
  exitDate: '2026-01-03',
  fees: 1,
};

function storedTrades() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('load on mount', () => {
  it('hydrates previously persisted trades', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([OPEN, CLOSED]));
    const { result } = renderHook(() => useTrades());
    expect(result.current.trades).toHaveLength(2);
    expect(result.current.stats.total).toBe(2);
  });

  it('starts empty when storage is empty', () => {
    const { result } = renderHook(() => useTrades());
    expect(result.current.trades).toEqual([]);
  });
});

describe('addTrade', () => {
  it('adds a trade, persists it, and reports its id', () => {
    const { result } = renderHook(() => useTrades());
    let verdict;
    act(() => {
      verdict = result.current.addTrade(OPEN);
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.tradeId).toBe(OPEN.id);
    expect(result.current.trades).toHaveLength(1);
    expect(result.current.trades[0].symbol).toBe('MSFT');
    expect(storedTrades()).toHaveLength(1);
    expect(result.current.lastError).toBeNull();
  });

  it('rejects invalid trades with field errors and does not persist', () => {
    const { result } = renderHook(() => useTrades());
    let verdict;
    act(() => {
      verdict = result.current.addTrade({ ...OPEN, quantity: 0 });
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.quantity).toBeTruthy();
    expect(result.current.trades).toHaveLength(0);
    expect(storedTrades()).toBeNull();
  });
});

describe('updateTrade', () => {
  function hookWithClosedTrade() {
    const { result } = renderHook(() => useTrades());
    act(() => {
      result.current.addTrade(CLOSED);
    });
    return result;
  }

  it('applies valid changes and preserves createdAt', () => {
    const result = hookWithClosedTrade();
    const createdAt = result.current.trades[0].createdAt;
    expect(createdAt).toBeTruthy();

    let verdict;
    act(() => {
      verdict = result.current.updateTrade(CLOSED.id, { exitPrice: 120, fees: 2 });
    });
    expect(verdict.ok).toBe(true);
    expect(result.current.trades[0].exitPrice).toBe(120);
    expect(result.current.trades[0].createdAt).toBe(createdAt);
    expect(storedTrades()[0].exitPrice).toBe(120);
  });

  it('refuses invalid changes (bad dates / prices) and leaves the record untouched', () => {
    const result = hookWithClosedTrade();
    const before = { ...result.current.trades[0] };

    let verdict;
    act(() => {
      verdict = result.current.updateTrade(CLOSED.id, { exitDate: '2026-01-01' }); // before entryDate
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.exitDate).toBeTruthy();

    act(() => {
      verdict = result.current.updateTrade(CLOSED.id, { entryPrice: -5 });
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.errors.entryPrice).toBeTruthy();

    expect(result.current.trades[0]).toEqual(before);
    expect(storedTrades()[0]).toEqual(before);
  });

  it('reports a miss for unknown ids', () => {
    const result = hookWithClosedTrade();
    let verdict;
    act(() => {
      verdict = result.current.updateTrade('nope', { fees: 3 });
    });
    expect(verdict.ok).toBe(false);
  });
});

describe('deleteTrade', () => {
  it('removes the trade from state and storage', () => {
    const { result } = renderHook(() => useTrades());
    act(() => {
      result.current.addTrade(CLOSED);
    });
    act(() => {
      result.current.addTrade(OPEN);
    });
    act(() => {
      result.current.deleteTrade(CLOSED.id);
    });
    expect(result.current.trades.map((t) => t.id)).toEqual([OPEN.id]);
    expect(storedTrades().map((t) => t.id)).toEqual([OPEN.id]);
  });
});

describe('importTrades', () => {
  it('merges new records, skips duplicates and invalid ones, with accurate counts', () => {
    const { result } = renderHook(() => useTrades());
    act(() => {
      result.current.addTrade(CLOSED);
    });

    let verdict;
    act(() => {
      verdict = result.current.importTrades([
        { ...CLOSED, exitPrice: 999 }, // duplicate id -> skipped, no overwrite
        CLOSED, // duplicate id again -> skipped
        { ...OPEN, id: 'new-1' }, // valid new record
        { symbol: 'BAD', entryPrice: -1, quantity: 0, entryDate: 'nope' }, // invalid -> skipped
      ]);
    });

    expect(verdict.added).toBe(1);
    expect(verdict.skipped).toBe(3);
    expect(verdict.errors).toHaveLength(3);
    expect(verdict.ok).toBe(true);
    expect(result.current.trades.map((t) => t.id).sort()).toEqual([CLOSED.id, 'new-1'].sort());
    expect(storedTrades()).toHaveLength(2);
    // Existing record was not silently overwritten.
    expect(result.current.trades.find((t) => t.id === CLOSED.id).exitPrice).toBe(110);
  });

  it('rejects non-array payloads', () => {
    const { result } = renderHook(() => useTrades());
    let verdict;
    act(() => {
      verdict = result.current.importTrades({ trades: [] });
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.added).toBe(0);
    expect(verdict.errors[0]).toBe('Import file must be a JSON array of trades.');
  });
});

describe('restoreTrades', () => {
  it('replaces the entire dataset', () => {
    const { result } = renderHook(() => useTrades());
    act(() => {
      result.current.addTrade(CLOSED);
    });
    act(() => {
      result.current.addTrade(OPEN);
    });

    let kept;
    act(() => {
      kept = result.current.restoreTrades([{ id: 'only-1', symbol: 'ES', entryPrice: 10, quantity: 1, exitPrice: 12, entryDate: '2026-05-01' }]);
    });
    expect(kept).toBe(1);
    expect(result.current.trades.map((t) => t.id)).toEqual(['only-1']);
    expect(storedTrades().map((t) => t.id)).toEqual(['only-1']);
  });
});

describe('clearAll', () => {
  it('empties state and storage and resets stats', () => {
    const { result } = renderHook(() => useTrades());
    act(() => {
      result.current.addTrade(CLOSED);
    });
    act(() => {
      result.current.clearAll();
    });
    expect(result.current.trades).toEqual([]);
    expect(result.current.stats.netPnl).toBe(0);
    expect(result.current.stats.winRate).toBeNull();
    const raw = window.localStorage.getItem(STORAGE_KEY);
    expect(JSON.parse(raw)).toEqual([]);
  });
});
