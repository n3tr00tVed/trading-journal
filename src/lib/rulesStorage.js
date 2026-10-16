/**
 * Local persistence for the user's personal trading rules — plain text in
 * localStorage. Mirrors the defensive approach used for trades: never throws,
 * non-string stored values are rejected (returned as empty text).
 */

const KEY = 'trading-journal:rules:v1';
export const RULES_STORAGE_KEY = KEY;

/** Load rules text from localStorage; '' when missing or malformed. */
export function loadRules() {
  if (typeof window === 'undefined') return '';
  let raw;
  try {
    raw = window.localStorage.getItem(KEY);
  } catch (err) {
    console.warn('trading-journal: cannot read rules from localStorage', err);
    return '';
  }
  if (raw === null) return '';
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === 'string' ? parsed : '';
  } catch (err) {
    // Backward-compat path for a previous plain-text (non-JSON) value.
    console.warn('trading-journal: rules value was not JSON, starting empty', err);
    return '';
  }
}

/** Save rules. Best-effort; returns success flag. */
export function saveRules(text) {
  if (typeof window === 'undefined') return false;
  try {
    window.localStorage.setItem(KEY, JSON.stringify(String(text)));
    return true;
  } catch (err) {
    console.warn('trading-journal: cannot write rules to localStorage', err);
    return false;
  }
}
