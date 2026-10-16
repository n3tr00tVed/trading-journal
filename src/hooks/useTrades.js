import { useCallback, useMemo, useState } from 'react';
import { loadTrades, saveTrades } from '../lib/storage.js';
import { createTrade, normalizeTrade, validateTrade } from '../lib/schema.js';
import { computeStats } from '../lib/calculations.js';

/**
 * Single source of truth for trades. Loads from localStorage on mount,
 * writes on every mutation, exposes derived statistics.
 *
 * Return contract (see CONTRACTS.md):
 *   { trades, stats, addTrade, updateTrade, deleteTrade,
 *     importTrades, restoreTrades, clearAll, lastError }
 *
 * Mutations return { ok, errors } or { ok: true, trade } / { ok: true, tradeId }.
 * importTrades returns { added, skipped, errors, ok } — duplicate ids are
 * skipped (existing records are never silently overwritten).
 */
export function useTrades() {
  // Lazy initializer: localStorage is only available in the browser,
  // which is exactly where this app runs.
  const [trades, setTrades] = useState(loadTrades);
  const [lastError, setLastError] = useState(null);

  // Memoize the concrete list so hook dependencies stay stable.
  const list = useMemo(() => trades ?? [], [trades]);

  const addTrade = useCallback(
    (partial) => {
      const trade = partial?.id ? normalizeTrade(partial) : createTrade(partial);
      if (!trade) return { ok: false, errors: { form: 'Invalid trade record.' } };
      const verdict = validateTrade(trade);
      if (!verdict.ok) return verdict;

      const next = [...list, trade];
      persist(next, setLastError);
      setTrades(next);
      return { ok: true, tradeId: trade.id };
    },
    [list],
  );

  const updateTrade = useCallback(
    (id, changes) => {
      const index = list.findIndex((t) => t.id === id);
      if (index === -1) return { ok: false, errors: { form: 'Trade not found.' } };
      const merged = { ...list[index], ...changes, id, createdAt: list[index].createdAt };
      const normalized = normalizeTrade(merged);
      if (!normalized) return { ok: false, errors: { form: 'Invalid trade record.' } };
      const verdict = validateTrade(normalized);
      if (!verdict.ok) return verdict;

      const next = [...list];
      next[index] = normalized;
      persist(next, setLastError);
      setTrades(next);
      return { ok: true, trade: normalized };
    },
    [list],
  );

  const deleteTrade = useCallback(
    (id) => {
      persist(list.filter((t) => t.id !== id), setLastError);
      setTrades((prev) => (prev ?? []).filter((t) => t.id !== id));
      return { ok: true };
    },
    [list],
  );

  const importTrades = useCallback(
    (rawList) => {
      if (!Array.isArray(rawList)) {
        return { ok: false, added: 0, skipped: 0, errors: ['Import file must be a JSON array of trades.'] };
      }

      const existing = new Set(list.map((t) => t.id));
      const errors = [];
      let added = 0;
      let skipped = 0;
      const accepted = [];

      rawList.forEach((raw, i) => {
        const trade = normalizeTrade(raw);
        const verdict = trade ? validateTrade(trade) : { ok: false, errors: { form: 'unparseable' } };
        if (!verdict.ok) {
          skipped += 1;
          errors.push(`Record ${i + 1} was invalid and skipped.`);
          return;
        }
        if (existing.has(trade.id)) {
          skipped += 1;
          errors.push(`Record ${i + 1} (${trade.symbol}) already exists and was skipped.`);
          return;
        }
        existing.add(trade.id);
        accepted.push(trade);
        added += 1;
      });

      if (accepted.length > 0) {
        const next = [...list, ...accepted];
        persist(next, setLastError);
        setTrades(next);
      }
      return { ok: accepted.length > 0, added, skipped, errors };
    },
    [list],
  );

  /** Replace the entire dataset. Returns the number of records kept. */
  const restoreTrades = useCallback((input) => {
    const normalized = (Array.isArray(input) ? input : [])
      .map(normalizeTrade)
      .filter(Boolean)
      .filter((t) => validateTrade(t).ok);
    persist(normalized, setLastError);
    setTrades(normalized);
    return normalized.length;
  }, []);

  const clearAll = useCallback(() => {
    persist([], setLastError);
    setTrades([]);
  }, []);

  const stats = useMemo(() => computeStats(list), [list]);

  return { trades: list, stats, addTrade, updateTrade, deleteTrade, importTrades, restoreTrades, clearAll, lastError };
}

function persist(next, setLastError) {
  const saved = saveTrades(next);
  if (!saved) {
    setLastError('Could not write to local storage. Latest changes may not survive a refresh.');
  } else {
    setLastError(null);
  }
}
