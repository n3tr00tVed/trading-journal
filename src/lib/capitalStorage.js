/**
 * Local persistence for the user's account capital.
 * Key: 'trading-journal:capital:v1'. Same defensive model as rules:
 * never throws, anything non-numeric/negative loads as null (unset).
 */

const KEY = 'trading-journal:capital:v1';
export const CAPITAL_STORAGE_KEY = KEY;

/** Load capital; null when unset or stored value is unusable. */
export function loadCapital() {
  if (typeof window === 'undefined') return null;
  let raw;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch (err) {
    console.warn('trading-journal: cannot read capital from localStorage', err);
    return null;
  }
  if (raw === null) return null;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
    return null;
  } catch (err) {
    console.warn('trading-journal: capital value was not JSON, ignoring', err);
    return null;
  }
}

/**
 * Save capital. Accepts a non-negative finite number or null (unset);
 * anything else is rejected and nothing is written. Returns success flag.
 */
export function saveCapital(value) {
  if (typeof window === 'undefined') return false;
  const next = value === null ? null : value;
  if (next !== null && !(typeof next === 'number' && Number.isFinite(next) && next >= 0)) {
    return false;
  }
  try {
    if (next === null) {
      window.localStorage.removeItem(KEY);
    } else {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    }
    return true;
  } catch (err) {
    console.warn('trading-journal: cannot write capital to localStorage', err);
    return false;
  }
}

/** Coerce a settings input string ("12,500.50") to a number or null. */
export function parseCapitalInput(text) {
  if (typeof text !== 'string') return { ok: false, error: 'Enter capital as a number, e.g. 10000.' };
  const trimmed = text.trim().replace(/[$,\s]/g, '');
  if (trimmed === '') return { ok: true, value: null }; // empty = unset
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return { ok: false, error: 'Capital must be a number, e.g. 10000.' };
  if (num < 0) return { ok: false, error: 'Capital cannot be negative.' };
  return { ok: true, value: Math.round(num * 100) / 100 };
}
