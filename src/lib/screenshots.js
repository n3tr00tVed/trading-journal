/**
 * Screenshot storage — IndexedDB, local-first.
 *
 * Images are blobs keyed by trade id in db `trading-journal`, store
 * `screenshots`. Blobs cannot live in localStorage, so the trade record
 * keeps only a boolean `hasScreenshot` flag while the bytes live here.
 *
 * Everything degrades gracefully: when IndexedDB is unavailable (private
 * mode, very old browser, test environments) the helpers resolve to null
 * instead of crashing, and the UI treats the feature as absent.
 */

const DB_NAME = 'trading-journal';
const STORE = 'screenshots';

function available() {
  return typeof indexedDB !== 'undefined' && typeof Blob !== 'undefined';
}

function withStore(mode, run) {
  if (!available()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.open(DB_NAME, 1);
    } catch (err) {
      console.warn('trading-journal: IndexedDB unavailable for screenshots', err);
      resolve(null);
      return;
    }

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };

    request.onerror = () => resolve(null);
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let result;
        const outcome = run(store);
        if (outcome && typeof outcome.then === 'function') {
          outcome.then(resolve, () => resolve(null));
        } else {
          result = outcome?.result !== undefined ? outcome.result : outcome;
          resolve(result ?? null);
        }
      } catch (err) {
        console.warn('trading-journal: screenshot store error', err);
        resolve(null);
      } finally {
        db.close();
      }
    };
  });
}

/** Store an image blob for a trade. Returns true on success. */
export async function putScreenshot(tradeId, blob) {
  if (!tradeId || !(blob instanceof Blob)) return false;
  const ok = await withStore('readwrite', (store) => {
    const req = store.put(blob, String(tradeId));
    return new Promise((done) => {
      req.onsuccess = () => done(true);
      req.onerror = () => done(false);
    });
  });
  return ok === true;
}

/** Fetch the stored blob for a trade; null when absent/unavailable. */
export async function getScreenshot(tradeId) {
  if (!tradeId) return null;
  return withStore('readonly', (store) => store.get(String(tradeId)));
}

/** Best-effort fetch returning a string flag usable for UI checks. */
export async function hasScreenshot(tradeId) {
  const blob = tradeId ? await getScreenshot(tradeId) : null;
  return blob instanceof Blob;
}

/** Delete the stored blob; resolves false on failure, true on success-or-nothing. */
export async function deleteScreenshot(tradeId) {
  if (!tradeId) return false;
  const ok = await withStore('readwrite', (store) => {
    const req = store.delete(String(tradeId));
    return new Promise((done) => {
      req.onsuccess = () => done(true);
      req.onerror = () => done(false);
    });
  });
  return ok !== false;
}
