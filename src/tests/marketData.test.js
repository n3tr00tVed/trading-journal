import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCryptoPrices, toBinanceSymbol, isCryptoTrade, toYahooSymbol, isNseMarketOpenNow, fetchIndianPrices } from '../lib/marketData.js';
import { unrealizedPnl, unrealizedReturnOnInvested } from '../lib/calculations.js';
import { createTrade } from '../lib/schema.js';

describe('toBinanceSymbol', () => {
  it('maps the symbol shapes traders actually write to the USDT pool', () => {
    expect(toBinanceSymbol('BTC')).toBe('BTCUSDT');
    expect(toBinanceSymbol(' btc ')).toBe('BTCUSDT');
    expect(toBinanceSymbol('BTC/USDT')).toBe('BTCUSDT');
    expect(toBinanceSymbol('eth-usdt')).toBe('ETHUSDT');
    expect(toBinanceSymbol('BTCUSD')).toBe('BTCUSDT');
    expect(toBinanceSymbol('BTCUSDT')).toBe('BTCUSDT');
    expect(toBinanceSymbol('SOL')).toBe('SOLUSDT');
  });

  it('returns null for unusable symbols', () => {
    expect(toBinanceSymbol('')).toBe(null);
    expect(toBinanceSymbol(null)).toBe(null);
    expect(toBinanceSymbol('///')).toBe(null);
  });
});

describe('isCryptoTrade', () => {
  it('gates the feed to the crypto market only', () => {
    expect(isCryptoTrade({ market: 'crypto' })).toBe(true);
    expect(isCryptoTrade({ market: 'stocks' })).toBe(false);
    expect(isCryptoTrade(null)).toBe(false);
  });
});

describe('unrealizedPnl', () => {
  const long = createTrade({
    symbol: 'BTC', market: 'crypto', direction: 'long',
    entryPrice: 40000, quantity: 0.5,
  });
  const short = createTrade({
    symbol: 'ETH', market: 'crypto', direction: 'short',
    entryPrice: 2000, quantity: 2,
  });

  it('follows the price moving (long: up = profit, short: down = profit)', () => {
    expect(unrealizedPnl(long, 42000)).toBe(1000); // +2000 × 0.5
    expect(unrealizedPnl(long, 38000)).toBe(-1000);
    expect(unrealizedPnl(short, 1800)).toBe(400); // (2000−1800) × 2
    expect(unrealizedPnl(short, 2100)).toBe(-200);
  });

  it('0 is a real answer (price exactly at entry), null means unknown', () => {
    expect(unrealizedPnl(long, 40000)).toBe(0);
    expect(unrealizedPnl(long, null)).toBe(null);
    expect(unrealizedPnl(null, 40000)).toBe(null);
  });

  it('return on margin divides by the leveraged invested amount', () => {
    const margined = createTrade({
      symbol: 'BTC', market: 'crypto', direction: 'long',
      entryPrice: 40000, quantity: 0.5, leverage: 5,
    });
    // Invested = 20000 ÷ 5 = 4000; +1000 unrealized → +25%.
    expect(unrealizedReturnOnInvested(margined, 42000)).toBe(25);
    expect(unrealizedReturnOnInvested(long, null)).toBe(null);
  });
});

describe('fetchCryptoPrices', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns empty results early when no symbols are requested', async () => {
    const result = await fetchCryptoPrices([]);
    expect(result).toEqual({ prices: {}, errors: {} });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('batches one request for several symbols and records prices keyed by journal symbol', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [
        { symbol: 'BTCUSDT', price: '42500.10' },
        { symbol: 'ETHUSDT', price: '2100' },
      ],
    });

    const { prices, errors } = await fetchCryptoPrices(['BTC', 'ETH']);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain('symbols=%5B%22BTCUSDT%22%2C%22ETHUSDT%22%5D');
    expect(errors).toEqual({});
    expect(prices.BTC.price).toBe(42500.1);
    expect(prices.ETH.price).toBe(2100);
    expect(typeof prices.BTC.asOf).toBe('string');
  });

  it('falls back to per-symbol probes when the batch is rejected, and reports unlisted coins honestly', async () => {
    fetch
      .mockResolvedValueOnce({ ok: false, status: 400 }) // batch contains an unlisted pair
      .mockResolvedValueOnce({ ok: true, json: async () => ({ symbol: 'BTCUSDT', price: '42500' }) }) // probe 1: fine
      .mockResolvedValueOnce({ ok: false, status: 400 }); // probe 2: genuinely unlisted

    const { prices, errors } = await fetchCryptoPrices(['BTC', 'FAKECOIN']);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(prices.BTC.price).toBe(42500);
    expect(errors.FAKECOIN).toBe('not listed on Binance'); // the truth, not a fake price
  });

  it('reports offline instead of inventing prices when the network fails', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));

    const { prices, errors } = await fetchCryptoPrices(['BTC']);
    expect(prices).toEqual({});
    expect(errors.BTC).toBe('offline');
  });
});

describe('toYahooSymbol', () => {
  it('suffixes plain journal symbols with .NS and keeps explicit suffixes', () => {
    expect(toYahooSymbol('RELIANCE')).toBe('RELIANCE.NS');
    expect(toYahooSymbol(' reliance ')).toBe('RELIANCE.NS');
    expect(toYahooSymbol('INFY.NS')).toBe('INFY.NS');
    expect(toYahooSymbol('TATASTEEL.BO')).toBe('TATASTEEL.BO');
  });

  it('returns null for unusable symbols', () => {
    expect(toYahooSymbol('')).toBe(null);
    expect(toYahooSymbol(null)).toBe(null);
    expect(toYahooSymbol('NIFTY 50')).toBe(null); // spaces are not equity symbols
  });
});

describe('isNseMarketOpenNow', () => {
  it('opens exactly during Mon–Fri 09:15–15:30 IST', () => {
    // 2026-10-12 is a Monday. UTC 03:45 = 09:15 IST — open boundary.
    expect(isNseMarketOpenNow(new Date('2026-10-12T03:45:00Z'))).toBe(true);
    // 09:30 IST, mid-morning.
    expect(isNseMarketOpenNow(new Date('2026-10-12T04:00:00Z'))).toBe(true);
    // 15:30 IST close — still open at the boundary minute.
    expect(isNseMarketOpenNow(new Date('2026-10-12T10:00:00Z'))).toBe(true);
    // 15:31 IST — closed.
    expect(isNseMarketOpenNow(new Date('2026-10-12T10:01:00Z'))).toBe(false);
    // 09:14 IST — not yet.
    expect(isNseMarketOpenNow(new Date('2026-10-12T03:44:00Z'))).toBe(false);
    // Sunday (2026-10-11) — closed regardless of time.
    expect(isNseMarketOpenNow(new Date('2026-10-11T05:00:00Z'))).toBe(false);
    // Saturday morning.
    expect(isNseMarketOpenNow(new Date('2026-10-10T05:00:00Z'))).toBe(false);
  });

  it('defaults to closed when the clock is unusable', () => {
    expect(isNseMarketOpenNow(new Date('not-a-date'))).toBe(false);
  });
});

describe('fetchIndianPrices', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  afterAll(() => {
    globalThis.fetch = originalFetch;
  });

  function yahooMeta(price) {
    return JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price, regularMarketTime: 1760600000 } }] } });
  }

  it('quotes NSE symbols through the relay chain and keys results by journal symbol', async () => {
    fetch.mockImplementation(async (url) => {
      if (url.includes('api.allorigins.win') && url.includes('RELIANCE.NS')) {
        return { ok: true, text: async () => yahooMeta(1284.5) };
      }
      if (url.includes('api.codetabs.com') && url.includes('INFY.NS')) {
        return { ok: true, text: async () => yahooMeta(1520) };
      }
      return { ok: false, status: 503 };
    });

    const { prices, errors } = await fetchIndianPrices(['RELIANCE', 'infy']);
    expect(prices.RELIANCE).toMatchObject({ price: 1284.5 });
    expect(prices.INFY.price).toBe(1520);
    expect(errors).toEqual({});
  });

  it('surfaces throttled/no-quote honestly per symbol when every relay fails', async () => {
    fetch.mockImplementation(async (url) => {
      if (url.includes('TCS.NS')) return { ok: true, text: async () => '<html>cloudflare wall</html>' };
      return { ok: false, status: 429 };
    });

    const { prices, errors } = await fetchIndianPrices(['WIPRO', 'TCS']);
    expect(prices).toEqual({});
    expect(errors.WIPRO).toBe('throttled');
    expect(errors.TCS).toBe('no quote'); // junk payload ≠ throttle: a parse miss
  });

  it('reports nothing invented when the network is down', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const { prices, errors } = await fetchIndianPrices(['RELIANCE']);
    expect(prices).toEqual({});
    expect(errors.RELIANCE).toBe('no quote');
  });
});
