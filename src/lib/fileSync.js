/**
 * Device-folder sync via the File System Access API.
 *
 * The user grants access to a folder once (a browser gesture) and the app
 * then mirrors the journal to <chosen-folder>/trades_data/ on every save:
 *   trades_data/trades.json    trade records (complete, restorable)
 *   trades_data/rules.txt      rules text
 *   trades_data/capital.json   account capital
 * Nothing is uploaded anywhere; the writes are local disk files.
 *
 * Browser support: Chromium (Chrome/Edge/Opera). Everywhere else the
 * feature reports unavailable and the UI states so honestly.
 */

const HANDLES_DB = 'trading-journal';
const HANDLES_STORE = 'handles';
const DIR_KEY = 'journalDir';
const SUBDIR = 'trades_data';
export const TRADES_FILE = `${SUBDIR}/trades.json`;
export const RULES_FILE = `${SUBDIR}/rules.txt`;
export const CAPITAL_FILE = `${SUBDIR}/capital.json`;

/** Feature detect. False in Firefox/Safari/jest-jsdom. */
export function supportedDirectorySync() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

function idbAvailable() {
  return typeof indexedDB !== 'undefined';
}

/** Persist the dir handle across reloads (best effort). */
export function saveDirectoryHandle(handle) {
  if (!idbAvailable()) return false;
  return new Promise((resolve) => {
    let idbRequest;
    try {
      idbRequest = indexedDB.open(HANDLES_DB, 1);
    } catch (err) {
      console.warn('trading-journal: IDB unavailable for sync handle', err);
      resolve(false);
      return;
    }
    idbRequest.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(HANDLES_STORE)) db.createObjectStore(HANDLES_STORE);
    };
    idbRequest.onerror = () => resolve(false);
    idbRequest.onsuccess = () => {
      const db = idbRequest.result;
      try {
        const tx = db.transaction(HANDLES_STORE, 'readwrite');
        tx.objectStore(HANDLES_STORE).put(handle, DIR_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch (err) {
        console.warn('trading-journal: cannot store sync handle', err);
        resolve(false);
      } finally {
        db.close();
      }
    };
  });
}

/** Read the persisted dir handle; resolve null when missing/broken. */
export function loadDirectoryHandle() {
  if (!idbAvailable()) return Promise.resolve(null);
  return new Promise((resolve) => {
    let idbRequest;
    try {
      idbRequest = indexedDB.open(HANDLES_DB, 1);
    } catch {
      resolve(null);
      return;
    }
    idbRequest.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(HANDLES_STORE)) db.createObjectStore(HANDLES_STORE);
    };
    idbRequest.onerror = () => resolve(null);
    idbRequest.onsuccess = () => {
      const db = idbRequest.result;
      try {
        const req = db.transaction(HANDLES_STORE, 'readonly').objectStore(HANDLES_STORE).get(DIR_KEY);
        req.onsuccess = () => resolve(req.result ?? null);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      } finally {
        db.close();
      }
    };
  });
}

export function forgetDirectoryHandle() {
  if (!idbAvailable()) return Promise.resolve(true);
  return new Promise((resolve) => {
    let idbRequest;
    try {
      idbRequest = indexedDB.open(HANDLES_DB, 1);
    } catch {
      resolve(true);
      return;
    }
    idbRequest.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(HANDLES_STORE)) db.createObjectStore(HANDLES_STORE);
    };
    idbRequest.onerror = () => resolve(false);
    idbRequest.onsuccess = () => {
      const db = idbRequest.result;
      try {
        const tx = db.transaction(HANDLES_STORE, 'readwrite');
        tx.objectStore(HANDLES_STORE).delete(DIR_KEY);
        tx.oncomplete = () => resolve(true);
        tx.onerror = () => resolve(false);
      } catch {
        resolve(false);
      } finally {
        db.close();
      }
    };
  });
}

/**
 * Open the directory picker and ensure a `trades_data` subfolder exists.
 * Returns { ok, directory?, reason? }. Must be called from a user gesture.
 */
export async function connectJournalDirectory() {
  if (!supportedDirectorySync()) return { ok: false, reason: 'unsupported' };
  try {
    const dir = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'documents', id: 'trading-journal' });
    const dataDir = await dir.getDirectoryHandle(SUBDIR, { create: true });
    const saved = await saveDirectoryHandle(dir);
    return { ok: true, directory: dir, dataDir, persisted: saved };
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, reason: 'canceled' };
    }
    console.warn('trading-journal: cannot open folder for sync', err);
    return { ok: false, reason: err?.name === 'NotAllowedError' ? 'denied' : 'error' };
  }
}

/** Re-check we still have write permission for the stored handle. */
export async function verifyPermission(dir) {
  if (!dir?.queryPermission) return false;
  try {
    const opts = { mode: 'readwrite' };
    if ((await dir.queryPermission(opts)) === 'granted') return true;
    if ((await dir.requestPermission(opts)) === 'granted') return true;
  } catch (err) {
    console.warn('trading-journal: folder permission check failed', err);
  }
  return false;
}

/** Resolve + write a file inside the synced trades_data folder. */
async function writeText(dataDir, fileName, text) {
  try {
    const handle = await dataDir.getFileHandle(fileName, { create: true });
    const writable = await handle.createWritable();
    await writable.write(text);
    await writable.close();
    return true;
  } catch (err) {
    console.warn(`trading-journal: cannot write ${fileName}`, err);
    return false;
  }
}

/**
 * Mirror a snapshot to trades_data/. `journal` shape:
 *   { trades, rules, capital, currency? }
 * Returns { ok, written } with the list of files actually written.
 */
export async function writeJournalFolder(dataDir, journal) {
  if (!dataDir?.getFileHandle) return { ok: false, written: [], reason: 'no-directory' };
  const written = [];
  if (Array.isArray(journal.trades)) {
    (await writeText(dataDir, 'trades.json', JSON.stringify(journal.trades, null, 2))) && written.push(TRADES_FILE);
  }
  if (typeof journal.rules === 'string') {
    (await writeText(dataDir, 'rules.txt', journal.rules)) && written.push(RULES_FILE);
  }
  if (journal.capitals && typeof journal.capitals === 'object') {
    const payload = {
      INR: typeof journal.capitals.INR === 'number' ? journal.capitals.INR : null,
      USD: typeof journal.capitals.USD === 'number' ? journal.capitals.USD : null,
    };
    (await writeText(dataDir, 'capital.json', JSON.stringify(payload, null, 2))) && written.push(CAPITAL_FILE);
  }
  return { ok: written.length > 0, written };
}

/** Read trades.json back from the synced folder (for restore). */
export async function readJournalTrades(dataDir) {
  if (!dataDir?.getFileHandle) return null;
  try {
    const handle = await dataDir.getFileHandle('trades.json', { create: false });
    const text = await (await handle.getFile()).text();
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return null;
    return parsed;
  } catch (err) {
    if (err?.name !== 'NotFoundError') console.warn('trading-journal: cannot read trades.json', err);
    return null;
  }
}

/** Folder tree presentation helper for UI copy (single shape only). */
export const FOLDER_LAYOUT = {
  subdir: SUBDIR,
  files: ['trades.json', 'rules.txt', 'capital.json'],
};
