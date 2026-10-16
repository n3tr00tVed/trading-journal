import { beforeEach, describe, expect, it } from 'vitest';
import { STORAGE_KEY, loadTrades, saveTrades } from '../lib/storage.js';
import { createTrade } from '../lib/schema.js';

const CLOSED = {
  id: 'a-1',
  symbol: 'ES',
  market: 'futures',
  direction: 'long',
  entryPrice: 100,
  exitPrice: 110,
  quantity: 2,
  invested: 200,
  currency: 'INR',
  leverage: null,
  entryDate: '2026-01-02',
  exitDate: '2026-01-03',
  fees: 1,
  strategy: 'ORB',
  setup: 'breakout',
  notes: 'clean fill',
  hasScreenshot: false,
  createdAt: '2026-01-02T15:00:00.000Z',
};

function writeStorage(value) {
  window.localStorage.setItem(STORAGE_KEY, value);
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('saveTrades / loadTrades round-trip', () => {
  it('persists and loads a complete record unchanged', () => {
    expect(saveTrades([CLOSED])).toBe(true);
    const loaded = loadTrades();
    expect(loaded).toHaveLength(1);
    expect(loaded[0]).toEqual(CLOSED);
  });

  it('missing key yields an empty list', () => {
    expect(loadTrades()).toEqual([]);
  });
});

describe('robustness against corrupt storage', () => {
  it('corrupt JSON returns [] and never throws', () => {
    writeStorage('{not-json-at-all');
    expect(loadTrades()).toEqual([]);
  });

  it('non-array stored values return []', () => {
    writeStorage(JSON.stringify({ trades: [] }));
    expect(loadTrades()).toEqual([]);
    writeStorage('"just a string"');
    expect(loadTrades()).toEqual([]);
    writeStorage('42');
    expect(loadTrades()).toEqual([]);
    writeStorage('null');
    expect(loadTrades()).toEqual([]);
  });
});

describe('quarantine of malformed records', () => {
  it('skips individually invalid records while valid ones survive', () => {
    const missingSymbol = { direction: 'long', entryPrice: 10, quantity: 1, entryDate: '2026-01-02' };
    const badEntryPrice = { ...CLOSED, id: 'a-2', entryPrice: -5 };
    writeStorage(JSON.stringify([missingSymbol, null, 'oops', 42, badEntryPrice, CLOSED]));
    const loaded = loadTrades();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('a-1');
    expect(loaded[0].symbol).toBe('ES');
  });

  it('derives unknown fields through normalizeTrade (NaN/undefined dropped, numbers typed)', () => {
    // JSON has no NaN; NaN serializes to null, and undefined keys disappear.
    writeStorage(JSON.stringify([
      {
        id: 'n-1',
        symbol: 'aapl', // upper-cased by normalize
        entryPrice: '12.5', // numeric string -> number
        quantity: '3',
        exitPrice: '0', // 0 is a legal exit price, must NOT become null/open
        entryDate: '2026-02-01',
        fees: -3, // clamped to 0
        junkField: 'dropped',
      },
      { symbol: 'DEAD', entryPrice: null, quantity: 1, entryDate: '2026-02-01' }, // unrecoverable
    ]));
    const loaded = loadTrades();
    expect(loaded).toHaveLength(1);
    const trade = loaded[0];
    expect(trade.symbol).toBe('AAPL');
    expect(trade.entryPrice).toBe(12.5);
    expect(trade.quantity).toBe(3);
    expect(trade.exitPrice).toBe(0);
    expect(trade.fees).toBe(0);
    expect(trade.market).toBe('stocks'); // default fallback
    expect(trade.junkField).toBeUndefined();
    expect(typeof trade.entryPrice).toBe('number');
  });

  it('exitPrice 0 means closed and exitDate defaults to entryDate', () => {
    writeStorage(JSON.stringify([{ id: 'z-1', symbol: 'T', entryPrice: 1, quantity: 1, exitPrice: 0, entryDate: '2026-03-01' }]));
    const loaded = loadTrades();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].exitDate).toBe('2026-03-01');
  });

  it('missing createdAt is generated, missing exitDate on closed trade defaults to entryDate', () => {
    writeStorage(JSON.stringify([{ id: 'w-1', symbol: 'ANET', entryPrice: 10, quantity: 1, exitPrice: 12, entryDate: '2026-03-02' }]));
    const loaded = loadTrades();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].createdAt).toBeTruthy();
    expect(loaded[0].exitDate).toBe('2026-03-02');
  });
});

describe('deduplication', () => {
  it('drops records with duplicate ids, keeping the first occurrence', () => {
    const laterEdit = { ...CLOSED, exitPrice: 120 };
    expect(saveTrades([CLOSED, laterEdit])).toBe(true);
    const loaded = loadTrades();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].exitPrice).toBe(110);
  });
});

describe('createTrade sanity for clean writes', () => {
  it('createTrade output survives a full save/load cycle', () => {
    const trade = createTrade({ symbol: 'btcusdt', market: 'crypto', direction: 'short', entryPrice: 50000, quantity: 0.2, entryDate: '2026-04-05' });
    expect(trade).not.toBeNull();
    expect(trade.symbol).toBe('BTCUSDT');
    expect(trade.exitPrice).toBeNull();
    saveTrades([trade]);
    expect(loadTrades()[0]).toEqual(trade);
  });
});
