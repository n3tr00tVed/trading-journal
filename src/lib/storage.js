/**
 * Local persistence for trades — browser localStorage only.
 * Nothing leaves the device. Malformed records are quarantined (dropped)
 * rather than crashing the app.
 */

import { normalizeTrade, validateTrade } from './schema.js';

export const STORAGE_KEY = 'trading-journal:trades:v1';

/**
 * Load trades from localStorage. Corrupt JSON yields an empty list.
 * Individually-invalid records are skipped. Deduplicates by id.
 */
export function loadTrades() {
  if (typeof window === 'undefined') return [];
  let raw;
  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (err) {
    console.warn('trading-journal: cannot read localStorage', err);
    return [];
  }
  if (!raw) return [];

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn('trading-journal: stored data is corrupt, starting empty', err);
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set();
  const valid = [];
  for (const item of parsed) {
    const trade = normalizeTrade(item);
    if (!trade) continue;
    const { ok } = validateTrade(trade);
    if (!ok) continue;
    if (seen.has(trade.id)) continue;
    seen.add(trade.id);
    valid.push(trade);
  }
  return valid;
}

/** Save trades. Best-effort: swallows quota/private-mode errors, returns success flag. */
export function saveTrades(trades) {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trades));
    return true;
  } catch (err) {
    console.warn('trading-journal: cannot write localStorage', err);
    return false;
  }
}
