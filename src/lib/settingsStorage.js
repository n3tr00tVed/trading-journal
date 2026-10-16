/**
 * App preferences persisted locally (currently: display currency).
 * Same defensive model as the other stores: never throws, invalid values
 * fall back to defaults.
 */

const KEY = 'trading-journal:settings:v1';
export const SETTINGS_STORAGE_KEY = KEY;

export const DEFAULT_CURRENCY = 'INR';

export function loadCurrency() {
  if (typeof window === 'undefined') return DEFAULT_CURRENCY;
  let parsed;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULT_CURRENCY;
    parsed = JSON.parse(raw);
  } catch {
    return DEFAULT_CURRENCY;
  }
  return parsed && typeof parsed.currency === 'string' ? (parsed.currency === 'USD' ? 'USD' : 'INR') : DEFAULT_CURRENCY;
}

export function saveCurrency(currency) {
  const next = currency === 'USD' ? 'USD' : currency === 'INR' ? 'INR' : null;
  if (!next) return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify({ currency: next }));
    return true;
  } catch (err) {
    console.warn('trading-journal: cannot write settings to localStorage', err);
    return false;
  }
}
