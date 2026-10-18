/**
 * Live crypto prices — the ONLY outbound network feature in the app.
 *
 * Contract:
 *  - Read-only public quotes from Binance's free REST API (no key, no auth).
 *  - Requests carry nothing but the symbols being priced; responses are
 *    plain price numbers kept in memory only (never persisted, never mixed
 *    into journal data that is exported/synced to disk).
 *  - Everything is honest: failures surface as errors, never fake prices.
 *  - NSE equities also quote live: Yahoo's public chart API through the
 *    same public relay list the news page uses (fetchIndianPrices below),
 *    polled only during NSE trading hours. Forex/futures/options have no
 *    free browser-friendly source and stay honestly manual.
 */

const BINANCE_TICKER_URL = 'https://api.binance.com/api/v3/ticker/price';

/** Only the crypto market gets live quotes. */
export function isCryptoTrade(trade) {
  return Boolean(trade) && trade.market === 'crypto';
}

/**
 * Map a journal symbol to a Binance trading pair. Traders write symbols in
 * several shapes — BTC, btc, BTC/USDT, BTC-USDT, BTCUSD, BTCUSDT — all
 * resolve to the base asset + USDT pool, which is Binance's deepest market.
 * Returns null when nothing usable survives normalization.
 */
export function toBinanceSymbol(symbol) {
  if (typeof symbol !== 'string') return null;
  const cleaned = symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!cleaned) return null;

  let base = cleaned;
  for (const quote of ['USDT', 'USD', 'USDC', 'FDUSD', 'TUSD', 'BUSD']) {
    if (cleaned.endsWith(quote) && cleaned.length > quote.length) {
      base = cleaned.slice(0, cleaned.length - quote.length);
      break;
    }
  }
  if (!base) return null;
  return `${base}USDT`;
}

function encodeSymbolList(binanceSymbols) {
  // Binance's batch endpoint expects a URL-encoded JSON array.
  return encodeURIComponent(JSON.stringify(binanceSymbols));
}

/**
 * Fetch current prices for a set of journal symbols in one batched request.
 * Returns `{ prices, errors }`:
 *   prices[symbol] = { price, asOf } — numbers only, `asOf` ISO time
 *   errors[symbol]  = 'offline' | 'not listed on Binance'
 * Unknown symbols are retried individually (Binance rejects a whole batch
 * containing one bad pair) so one unlisted coin can't blind the others.
 */
export async function fetchCryptoPrices(journalSymbols) {
  const list = Array.isArray(journalSymbols) ? journalSymbols : [];
  const keyed = new Map(); // binanceSymbol -> journal symbol (source of truth: the raw journal tag)
  for (const raw of list) {
    const journalSymbol = String(raw || '').trim().toUpperCase();
    const binanceSymbol = toBinanceSymbol(journalSymbol);
    if (!journalSymbol || !binanceSymbol) {
      continue; // unresolvable — caller sees no price; the UI shows '—'
    }
    if (!keyed.has(binanceSymbol)) keyed.set(binanceSymbol, journalSymbol);
  }
  if (keyed.size === 0) return { prices: {}, errors: {} };

  const batchSymbols = [...keyed.keys()];
  const byBinance = new Map(keyed);
  const prices = {};
  const errors = {};

  async function record(json) {
    if (json === null || typeof json !== 'object') return false;
    const list = Array.isArray(json) ? json : [json];
    for (const entry of list) {
      if (!entry || typeof entry.symbol !== 'string' || !/^-?\d+(\.\d+)?$/.test(String(entry.price))) continue;
      const journalSymbol = byBinance.get(entry.symbol);
      if (!journalSymbol || prices[journalSymbol]) continue;
      prices[journalSymbol] = {
        price: Number(entry.price),
        asOf: typeof entry.closeTime === 'number'
          ? new Date(entry.closeTime).toISOString()
          : new Date().toISOString(),
      };
    }
    return list.length > 0;
  }

  let batchOk = false;
  if (typeof fetch === 'function') {
    try {
      const url = `${BINANCE_TICKER_URL}?symbols=${encodeSymbolList(batchSymbols)}`;
      const response = await fetch(url, { method: 'GET' });
      if (response.ok) {
        batchOk = await record(await response.json());
      }
      // Non-ok falls through to individual probes below.
    } catch {
      // Network down / offline / blocked: fall through to individual probes
      // so the first response still yields prices for reachable pairs.
    }
  }

  const probed = batchSymbols.filter((binanceSymbol) => {
    const journalSymbol = keyed.get(binanceSymbol);
    return !prices[journalSymbol];
  });

  if (probed.length > 0 && typeof fetch === 'function') {
    const results = await Promise.allSettled(
      probed.map(async (binanceSymbol) => {
        const url = `${BINANCE_TICKER_URL}?symbol=${encodeURIComponent(binanceSymbol)}`;
        const response = await fetch(url, { method: 'GET' });
        if (!response.ok) {
          return { binanceSymbol, ok: false, unknown: response.status === 400 };
        }
        return { binanceSymbol, ok: true, json: await response.json() };
      }),
    );
    let probedHit = false;
    for (const result of results) {
      const binanceSymbol = result.value?.binanceSymbol;
      if (!binanceSymbol) continue;
      const journalSymbol = keyed.get(binanceSymbol);
      if (result.status === 'fulfilled' && result.value.ok && await record(result.value.json)) {
        probedHit = true;
      } else if (result.status === 'fulfilled' && result.value.unknown) {
        errors[journalSymbol] = 'not listed on Binance';
      } else {
        errors[journalSymbol] = 'offline';
      }
    }
    if (probedHit) batchOk = true;
  }

  // Symbols that never resolved get an honest error class.
  for (const journalSymbol of keyed.values()) {
    if (!prices[journalSymbol] && !errors[journalSymbol]) {
      errors[journalSymbol] = batchOk ? 'not listed on Binance' : 'offline';
    }
  }

  return { prices, errors };
}

/* ---- Indian market (NSE) quotes ----
 * Same honesty rules as Binance: read-only public data, no keys, nothing
 * stored. Browsers cannot call Yahoo's finance chart API directly (no
 * CORS), so requests go through the same public relays the news page uses
 * — nothing but the symbol URL is sent, and only plain price numbers come
 * back. Quotes are usable for NSE equities only; futures/options/baskets
 * have no reliable free source and stay manual on purpose. Polling is
 * gated to NSE trading hours (Mon–Fri 09:15–15:30 IST) so the app never
 * hammers a relay for zero information.
 */

const YAHOO_CHART_URL = 'https://query1.finance.yahoo.com/v8/finance/chart/';
const QUOTE_RELAYS = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

/** 'RELIANCE' → 'RELIANCE.NS' (NSE). '.NS'/'.BO' pass through unchanged. */
export function toYahooSymbol(symbol) {
  if (typeof symbol !== 'string') return null;
  const cleaned = symbol.trim().toUpperCase();
  if (!/^[A-Z0-9.\-&]+$/.test(cleaned)) return null;
  if (cleaned.endsWith('.NS') || cleaned.endsWith('.BO')) return cleaned;
  return `${cleaned}.NS`;
}

/** Mon–Fri 09:15–15:30 IST — computed without timezone libs via Intl. */
export function isNseMarketOpenNow(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Kolkata',
      weekday: 'short',
      hour: 'numeric',
      minute: 'numeric',
      hour12: false,
    }).formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value;
    const weekday = get('weekday');
    const hour = Number(get('hour')) % 24; // some engines report '24' at midnight
    const minute = Number(get('minute'));
    if (!weekday || !Number.isFinite(hour) || !Number.isFinite(minute)) return false;
    if (weekday === 'Sat' || weekday === 'Sun') return false;
    const minutesOfDay = hour * 60 + minute;
    return minutesOfDay >= (9 * 60 + 15) && minutesOfDay <= (15 * 60 + 30);
  } catch {
    return false; // an unusable clock says "closed" — the honest default
  }
}

function parseYahooChart(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const meta = json?.chart?.result?.[0]?.meta;
  const price = meta?.regularMarketPrice;
  if (typeof price !== 'number' || !Number.isFinite(price) || price <= 0) return null;
  const stampSec = meta?.regularMarketTime;
  return {
    price,
    asOf: typeof stampSec === 'number' && stampSec > 0 ? new Date(stampSec * 1000).toISOString() : new Date().toISOString(),
  };
}

/**
 * Live NSE quotes for a set of journal symbols. Returns
 * `{ prices, errors }` keyed by the JOURNAL symbol:
 *   prices[journalSymbol] = { price, asOf }
 *   errors[journalSymbol] = 'offline' | 'no quote' | 'throttled'
 * Each symbol walks the relay list independently, so relay #1 being
 * rate-limited never blinds the rest.
 */
export async function fetchIndianPrices(journalSymbols) {
  const list = Array.isArray(journalSymbols) ? journalSymbols : [];
  const keyed = new Map(); // yahooSymbol → journalSymbol
  for (const raw of list) {
    const journalSymbol = String(raw || '').trim().toUpperCase();
    const yahooSymbol = toYahooSymbol(journalSymbol);
    if (!journalSymbol || !yahooSymbol) continue;
    if (!keyed.has(yahooSymbol)) keyed.set(yahooSymbol, journalSymbol);
  }

  const prices = {};
  const errors = {};
  if (keyed.size === 0 || typeof fetch !== 'function') {
    return { prices, errors };
  }

  await Promise.allSettled(
    [...keyed.entries()].map(async ([yahooSymbol, journalSymbol]) => {
      const target = `${YAHOO_CHART_URL}${encodeURIComponent(yahooSymbol)}?interval=1d&range=1d`;
      for (const relay of QUOTE_RELAYS) {
        let quote = null;
        let throttled = false;
        try {
          const response = await fetch(relay(target), { method: 'GET' });
          if (response.ok) {
            quote = parseYahooChart(await response.text());
          } else if (response.status === 429 || response.status === 401 || response.status === 403) {
            throttled = true; // rate limit / auth wall — a real upstream signal
          }
        } catch {
          // relay down / offline → try the next relay
        }
        if (quote) {
          prices[journalSymbol] = quote;
          return;
        }
        if (throttled) errors[journalSymbol] = 'throttled';
      }
      if (!prices[journalSymbol] && !errors[journalSymbol]) {
        errors[journalSymbol] = 'no quote';
      }
    }),
  );

  return { prices, errors };
}
