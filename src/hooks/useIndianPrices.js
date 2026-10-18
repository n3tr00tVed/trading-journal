/**
 * useIndianPrices — polls live NSE equity quotes through public relays for
 * open Indian-market stock positions, kept in memory only.
 *
 * Same lifecycle rules as the crypto hook (see useLivePrices.js), plus one
 * market-specific gate:
 *  - Polling happens ONLY during NSE trading hours (Mon–Fri 09:15–15:30
 *    IST). Outside those hours the hook requests nothing and reports
 *    status 'closed' — an honest "manual" is better than a stale price.
 *  - POLL is 60s (vs crypto's 10s): the relayed endpoint rate-limits
 *    aggressive polling, and Indian equities are a slow market anyway.
 *  - Settings toggle off → no requests. Tab hidden → paused. Prices are
 *    never persisted; failures surface in `errors`/`status`, never faked.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchIndianPrices, isNseMarketOpenNow } from '../lib/marketData.js';

const POLL_MS = 60_000;

export function useIndianPrices(trades = [], { enabled = true } = {}) {
  const [prices, setPrices] = useState({}); // journalSymbol -> { price, asOf }
  const [errors, setErrors] = useState({}); // journalSymbol -> 'offline' | 'no quote' | 'throttled'
  const [lastUpdated, setLastUpdated] = useState(null);
  const [status, setStatus] = useState('idle'); // idle | live | partial | paused | error | closed
  const stopRef = useRef(false);
  const prevStatusRef = useRef(null);

  // Only open Indian-ledger stock positions are quoted. memo keeps the
  // poll effect stable across renders.
  const openNseSymbols = useMemo(
    () => (Array.isArray(trades) ? trades : [])
      .filter((t) => t?.exitPrice === null && t?.market === 'stocks' && t?.currency === 'INR')
      .map((t) => String(t.symbol || '').trim().toUpperCase())
      .sort(),
    [trades],
  );
  const signature = openNseSymbols.join('|');
  const active = enabled === true && openNseSymbols.length > 0 && typeof fetch === 'function';

  useEffect(() => {
    if (!active) return undefined;
    stopRef.current = false;

    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return;

      // NSE door policy: quote only while the bell is ringing.
      if (!isNseMarketOpenNow()) {
        setStatus((current) => {
          if (current === 'paused' || current === 'closed') return current;
          prevStatusRef.current = current;
          return 'closed';
        });
        return;
      }

      const result = await fetchIndianPrices(openNseSymbols);
      if (stopRef.current) return;
      const resultPrices = result.prices;
      const resultErrors = result.errors;
      setPrices(resultPrices);
      setErrors(resultErrors);
      const gotAny = Object.keys(resultPrices).length > 0;
      const gotFailure = Object.keys(resultErrors).length > 0;
      if (gotAny) {
        setLastUpdated(new Date().toISOString());
        setStatus(gotFailure ? 'partial' : 'live');
      } else if (gotFailure) {
        setStatus('error');
      }
    };

    const timer = window.setInterval(tick, POLL_MS);
    tick();

    return () => {
      stopRef.current = true;
      window.clearInterval(timer);
    };
  }, [active, signature]); // eslint-disable-line react-hooks/exhaustive-deps -- signature covers the symbol list

  // Pause while the tab is hidden (visibilitychange), same contract as crypto.
  useEffect(() => {
    if (typeof document === 'undefined' || typeof document.hidden === 'undefined') return undefined;
    const onVisibility = () => {
      if (document.hidden) {
        prevStatusRef.current = status;
        setStatus((current) => (current === 'idle' || current === 'closed' ? current : 'paused'));
      } else if (status === 'paused') {
        setStatus(prevStatusRef.current ?? 'live');
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [status]);

  return {
    prices: active ? prices : {},
    errors: active ? errors : {},
    status: active ? status : 'idle',
    lastUpdated: active ? lastUpdated : null,
    POLL_MS,
  };
}
