/**
 * Local persistence for the user's account capitals — one value per market
 * currency: INR (India) and USD (US). Key scheme:
 *   v2: 'trading-journal:capitals:v2'   { INR: number|null, USD: number|null }
 *   v1: 'trading-journal:capital:v1'    single legacy number (migrated to INR)
 * Non-finite/negative values are rejected; corrupt storage falls back to unset.
 */

const V2_KEY = 'trading-journal:capitals:v2';
export const CAPITALS_STORAGE_KEY = V2_KEY;
const V1_KEY = 'trading-journal:capital:v1'; // legacy single-capital store

export const SUPPORTED_CAPITAL_MARKETS = ['INR', 'USD'];

function sanitize(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;
}

function emptyCapitals() {
  return { INR: null, USD: null };
}

function readRaw(key) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    return JSON.parse(raw);
  } catch (err) {
    console.warn(`trading-journal: cannot read ${key}`, err);
    return null;
  }
}

/** Full capitals map, with legacy v1 single capital migrated into INR. */
export function loadCapitals() {
  const map = emptyCapitals();
  const v2 = readRaw(V2_KEY);
  if (v2 && typeof v2 === 'object' && !Array.isArray(v2)) {
    for (const cur of SUPPORTED_CAPITAL_MARKETS) {
      map[cur] = sanitize(v2[cur]);
    }
  }
  if (map.INR === null && map.USD === null) {
    const legacy = readRaw(V1_KEY);
    const legacyValue = sanitize(legacy);
    if (legacyValue !== null) map.INR = legacyValue;
  }
  return map;
}

/** Convenience: capital for one market (default INR); null when unset. */
export function loadCapital(currency = 'INR') {
  const key = SUPPORTED_CAPITAL_MARKETS.includes(currency) ? currency : 'INR';
  return loadCapitals()[key];
}

/**
 * Save the capitals map. Invalid entries (negative, non-finite) are rejected
 * individually and left unchanged. Returns true when at least the valid
 * entries were persisted; false only when nothing could be saved.
 */
export function saveCapitals(input) {
  if (typeof window === 'undefined') return false;
  const current = loadCapitals();
  const next = emptyCapitals();
  for (const cur of SUPPORTED_CAPITAL_MARKETS) {
    if (input && Object.prototype.hasOwnProperty.call(input, cur)) {
      const value = input[cur];
      next[cur] = value === null ? null : sanitize(value) === null ? current[cur] : sanitize(value);
    } else {
      next[cur] = current[cur];
    }
  }

  try {
    window.localStorage.setItem(V2_KEY, JSON.stringify(next));
    window.localStorage.removeItem(V1_KEY); // migration complete
    return true;
  } catch (err) {
    console.warn('trading-journal: cannot write capitals to localStorage', err);
    return false;
  }
}

/** Thin wrapper for single-market saves used by tests/fallbacks. */
export function saveCapital(value, currency = 'INR') {
  const key = SUPPORTED_CAPITAL_MARKETS.includes(currency) ? currency : 'INR';
  return saveCapitals({ [key]: value });
}

/** Coerce a settings input string ("12,500.50") to a number or null. */
export function parseCapitalInput(text) {
  if (typeof text !== 'string') return { ok: false, error: 'Enter capital as a number, e.g. 25000.' };
  const trimmed = text.trim().replace(/[₹$,\s]/g, '');
  if (trimmed === '') return { ok: true, value: null }; // empty = unset
  const num = Number(trimmed);
  if (!Number.isFinite(num)) return { ok: false, error: 'Capital must be a number, e.g. 25000.' };
  if (num < 0) return { ok: false, error: 'Capital cannot be negative.' };
  return { ok: true, value: Math.round(num * 100) / 100 };
}
