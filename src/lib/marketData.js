/**
 * Live crypto prices — the ONLY outbound network feature in the app.
 *
 * Contract:
 *  - Read-only public quotes from Binance's free REST API (no key, no auth).
 *  - Requests carry nothing but the symbols being priced; responses are
 *    plain price numbers kept in memory only (never persisted, never mixed
 *    into journal data that is exported/synced to disk).
 *  - Everything is honest: failures surface as errors, never fake prices.
 *  - Non-crypto markets (stocks/futures/forex/options) have no free,
 *    CORS-friendly quote source for browsers, so they simply show no live
 *    price.
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
