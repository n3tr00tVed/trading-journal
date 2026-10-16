/**
 * App preferences persisted locally (currently: display currency + the
 * live crypto price toggle). Same defensive model as the other stores:
 * never throws, invalid values fall back to defaults.
 */

const KEY = 'trading-journal:settings:v1';
export const SETTINGS_STORAGE_KEY = KEY;

export const DEFAULT_CURRENCY = 'INR';

/** Live crypto quoting is opt-in-by-default (the feature the user asked for). */
export const DEFAULT_LIVE_PRICES = true;

function readSettings() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function loadCurrency() {
  const parsed = readSettings();
  if (!parsed) return DEFAULT_CURRENCY;
  return typeof parsed.currency === 'string'
    ? (parsed.currency === 'USD' ? 'USD' : 'INR')
    : DEFAULT_CURRENCY;
}

export function loadLivePrices() {
  const parsed = readSettings();
  if (!parsed) return DEFAULT_LIVE_PRICES;
  return typeof parsed.livePrices === 'boolean' ? parsed.livePrices : DEFAULT_LIVE_PRICES;
}

function writeSettings(patch) {
  try {
    const previous = readSettings() ?? {};
    window.localStorage.setItem(KEY, JSON.stringify({ ...previous, ...patch }));
    return true;
  } catch (err) {
    console.warn('trading-journal: cannot write settings to localStorage', err);
    return false;
  }
}

export function saveCurrency(currency) {
  const next = currency === 'USD' ? 'USD' : currency === 'INR' ? 'INR' : null;
  if (!next) return false;
  return writeSettings({ currency: next });
}

/** Toggles the Binance live-quote poller. Accepts true/false only. */
export function saveLivePrices(enabled) {
  if (typeof enabled !== 'boolean') return false;
  return writeSettings({ livePrices: enabled });
}
