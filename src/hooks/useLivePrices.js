/**
 * useLivePrices — polls Binance's public ticker for open crypto positions
 * every 10 seconds and keeps the prices in memory only.
 *
 * Lifecycle rules:
 *  - Zero open crypto trades → no requests at all.
 *  - Tab hidden → polling pauses; visible again → resumes immediately.
 *  - Settings toggle off → no requests.
 *  - Network/symbol failures never throw to the UI; they surface in
 *    `errors` and `status` ('error'), so the app can print the truth.
 *  - Prices are deliberately not persisted: a stale quote shown after
 *    reload would be a lie. First tick arrives within the interval.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCryptoPrices, isCryptoTrade } from '../lib/marketData.js';

const POLL_MS = 10_000;

export function useLivePrices(trades = [], { enabled = true } = {}) {
  const [prices, setPrices] = useState({}); // journalSymbol -> { price, asOf }
  const [errors, setErrors] = useState({}); // journalSymbol -> 'offline' | 'not listed on Binance'
  const [lastUpdated, setLastUpdated] = useState(null); // ISO time of the last successful tick
  const [status, setStatus] = useState('idle'); // idle | live | partial | paused | error
  const stopRef = useRef(false);
  const prevStatusRef = useRef(null); // status before the tab was hidden

  // Only open crypto positions are priced; memo keeps the poll effect stable.
  const openCryptoSymbols = useMemo(
    () => (Array.isArray(trades) ? trades : [])
      .filter((t) => isCryptoTrade(t) && t.exitPrice === null)
      .map((t) => String(t.symbol || '').trim().toUpperCase())
      .sort(),
    [trades],
  );
  const signature = openCryptoSymbols.join('|');
  const active = enabled === true && openCryptoSymbols.length > 0 && typeof fetch === 'function';

  useEffect(() => {
    if (!active) return undefined;
    stopRef.current = false;

    const tick = async () => {
      if (typeof document !== 'undefined' && document.hidden) return; // paused
      const result = await fetchCryptoPrices(openCryptoSymbols);
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

    // First tick right away (so the P&L appears immediately), then interval.
    // Hidden tabs skip network calls entirely (pause = no requests).
    const timer = window.setInterval(tick, POLL_MS);
    tick();

    return () => {
      stopRef.current = true;
      window.clearInterval(timer);
    };
  }, [active, signature]); // eslint-disable-line react-hooks/exhaustive-deps -- signature covers the symbol list

  // Pause while the tab is hidden (visibilitychange): polling is a
  // courtesy, not a background service. The exact pre-hide status is
  // captured at hide time and restored on return rather assumed.
  useEffect(() => {
    if (typeof document === 'undefined' || typeof document.hidden === 'undefined') return undefined;
    const onVisibility = () => {
      if (document.hidden) {
        prevStatusRef.current = status; // captured inside a listener, not render
        setStatus((current) => (current === 'idle' ? current : 'paused'));
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
