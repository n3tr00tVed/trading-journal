import { useState } from 'react';
import { parseCapitalInput } from '../lib/capitalStorage.js';
import { formatCurrency } from '../lib/format.js';
import { useCurrency } from '../hooks/useCurrency.js';
import { downloadFile, parseImportFile, toCsv, toJsonExport } from '../lib/export.js';

const PRIVACY_NOTE =
  'Data stays on this device — exports/files are handled entirely in your browser, nothing is uploaded.';

// Keeps the native file input focusable-but-invisible so the styled label
// works even without any supporting CSS class.
const HIDDEN_INPUT_STYLE = {
  position: 'absolute',
  width: '1px',
  height: '1px',
  margin: '-1px',
  padding: 0,
  overflow: 'hidden',
  clip: 'rect(0 0 0 0)',
  whiteSpace: 'nowrap',
  border: 0,
};

function pluralTrades(count) {
  return `${count} trade${count === 1 ? '' : 's'}`;
}

/** Read a File as text, preferring Blob.text() with a FileReader fallback. */
async function readAsText(file) {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(new Error('Could not read the selected file.'));
    reader.readAsText(file);
  });
}

/**
 * Settings: data export, JSON import (merge + replace-all), and a two-step
 * inline-confirm "delete all" danger zone. Every message shown here reflects
 * a real state change — nothing is faked.
 */
export default function SettingsPage({
  stats,
  trades = [],
  importTrades,
  restoreTrades,
  clearAll,
  capitals = null,
  onSaveCapitals,
  syncSupported = false,
  syncStatus = 'off', // off | connecting | on | blocked | error | unsupported
  syncAuto = true,
  onSyncAutoChange,
  dataDir = null,
  syncNote = null, // { tone, message } | null
  onConnectSync,
  onDisconnectSync,
  onSyncNow,
  onRestoreFromFolder,
  livePrices = false,
  onLivePricesChange,
}) {
  const [status, setStatus] = useState(null); // { kind: 'ok'|'error'|'info', message, details? }
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const tradeCount = trades.length;
  const isEmpty = tradeCount === 0;

  function handleExportCsv() {
    const clicked = downloadFile('trading-journal.csv', toCsv(trades), 'text/csv');
    if (!clicked) {
      setStatus({ kind: 'error', message: 'Export failed: no browser document is available to trigger the download.' });
    }
  }

  function handleExportJson() {
    const clicked = downloadFile('trading-journal.json', toJsonExport(trades), 'application/json');
    if (!clicked) {
      setStatus({ kind: 'error', message: 'Export failed: no browser document is available to trigger the download.' });
    }
  }

  async function handleMergeImport(event) {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-selecting the same file later
    if (!file) {
      setStatus({ kind: 'error', message: 'No file selected.' });
      return;
    }
    try {
      const parsed = parseImportFile(await readAsText(file));
      const result = importTrades(parsed);
      if (result.added === 0 && result.skipped === 0) {
        setStatus({ kind: 'info', message: 'No trades found in the file.' });
        return;
      }
      setStatus({
        kind: result.ok ? 'ok' : 'error',
        message: `Imported ${pluralTrades(result.added)}, skipped ${result.skipped}.`,
        details: result.errors.slice(0, 3),
      });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  async function handleReplaceImport(event) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) {
      setStatus({ kind: 'error', message: 'No file selected.' });
      return;
    }
    try {
      const parsed = parseImportFile(await readAsText(file));
      const confirmed = window.confirm(`Replace all ${pluralTrades(tradeCount)} with the imported file?`);
      if (!confirmed) {
        setStatus({ kind: 'info', message: 'Replace canceled — your data is unchanged.' });
        return;
      }
      const kept = restoreTrades(parsed);
      setStatus({ kind: 'ok', message: `Journal replaced with ${pluralTrades(kept)}.` });
    } catch (err) {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }

  function handleDeleteConfirmed() {
    clearAll();
    setConfirmingDelete(false);
    setStatus({ kind: 'ok', message: 'All trades deleted.' });
  }

  /** Capitals per market (see lib/capitalStorage.js) — explicit two-field save. */
  const [draftINR, setDraftINR] = useState(capitals?.INR == null ? '' : String(capitals.INR));
  const [draftUSD, setDraftUSD] = useState(capitals?.USD == null ? '' : String(capitals.USD));
  const [capitalNote, setCapitalNote] = useState(null);
  const { currency, setCurrency } = useCurrency();

  function handleSaveCapitals() {
    const inrParsed = parseCapitalInput(draftINR);
    const usdParsed = parseCapitalInput(draftUSD);
    if (!inrParsed.ok) {
      setCapitalNote({ kind: 'error', message: `India capital: ${inrParsed.error}` });
      return;
    }
    if (!usdParsed.ok) {
      setCapitalNote({ kind: 'error', message: `US capital: ${usdParsed.error}` });
      return;
    }
    const saved = typeof onSaveCapitals === 'function' ? onSaveCapitals({ INR: inrParsed.value, USD: usdParsed.value }) : true;
    setDraftINR(inrParsed.value == null ? '' : String(inrParsed.value));
    setDraftUSD(usdParsed.value == null ? '' : String(usdParsed.value));
    setCapitalNote(
      saved
        ? {
            kind: 'ok',
            message: `Capitals saved — India ${inrParsed.value == null ? '(unset)' : formatCurrency(inrParsed.value, 'INR')} · US ${usdParsed.value == null ? '(unset)' : formatCurrency(usdParsed.value, 'USD')}`,
          }
        : { kind: 'error', message: 'Could not save capitals (storage unavailable).' },
    );
  }

  return (
    <main>
      <h1>Settings</h1>
      <p className="label">{stats?.total ?? tradeCount} trades · {stats?.open ?? 0} open on this device</p>

      <section className="card" aria-labelledby="settings-currency-heading">
        <h2 id="settings-currency-heading">Currency</h2>
        <p>Applies to every money display in the app (capital, trade prices, P&amp;L, calculator). Default ₹ INR for the Indian market.</p>
        <div>
          <label htmlFor="currency-select" className="label">Display currency</label>
          <select id="currency-select" className="field" value={currency} onChange={(event) => setCurrency(event.target.value)}>
            <option value="INR">INR — ₹ (Indian market)</option>
            <option value="USD">USD — $</option>
          </select>
        </div>
      </section>

      <section className="card" aria-labelledby="settings-live-prices-heading">
        <h2 id="settings-live-prices-heading">Live crypto prices</h2>
        <p>
          While on, open crypto positions quote roughly every 10 seconds from Binance&apos;s free public API so their
          P&amp;L updates as the price moves. This is the app&apos;s only network use: it sends nothing but the symbols
          being quoted, needs no account, and prices are never stored in your journal or synced to disk.
          Other markets (stocks, futures, forex) have no free browser-friendly feed and stay manual.
        </p>
        <div className="checkbox-label">
          <input
            type="checkbox"
            id="live-prices-checkbox"
            checked={livePrices === true}
            onChange={(event) => onLivePricesChange?.(event.target.checked)}
          />
          <label htmlFor="live-prices-checkbox">Fetch live prices for open crypto positions</label>
        </div>
      </section>

      <section className="card" aria-labelledby="settings-capital-heading">
        <h2 id="settings-capital-heading">Account capital</h2>
        <p>
          One capital per market — the dashboard and calculator use the one matching your chosen market
          (sidebar switch). Stored on this device only.
        </p>
        <div className="form-actions" style={{ gap: '8px', alignItems: 'flex-end' }}>
          <div>
            <label htmlFor="capital-inr" className="label">India capital (₹ INR)</label>
            <input
              id="capital-inr"
              className="field"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder="e.g. 25000"
              value={draftINR}
              onChange={(event) => setDraftINR(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleSaveCapitals();
                }
              }}
            />
          </div>
          <div>
            <label htmlFor="capital-usd" className="label">US capital ($ USD)</label>
            <input
              id="capital-usd"
              className="field"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              placeholder="e.g. 10000"
              value={draftUSD}
              onChange={(event) => setDraftUSD(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  handleSaveCapitals();
                }
              }}
            />
          </div>
          <button type="button" className="btn btn-primary" onClick={handleSaveCapitals}>
            Save capitals
          </button>
        </div>
        {capitalNote ? (
          <p className={capitalNote.kind === 'error' ? 'field-error' : 'label'} role="status">
            {capitalNote.message}
          </p>
        ) : null}
      </section>

      <section className="card" aria-labelledby="settings-sync-heading">
        <h2 id="settings-sync-heading">Device folder backup (trades_data)</h2>
        {!syncSupported ? (
          <p>
            Folder auto-save needs Chrome or Edge (File System Access API). In this browser the journal keeps its
            private localStorage store and you can use manual CSV/JSON export instead.
          </p>
        ) : (
          <>
            {syncStatus === 'on' ? (
              <>
                <p role="status">
                  Auto-save {syncAuto ? 'on' : 'paused'}{dataDir ? ' → trades_data/' : ''}
                  {syncNote ? ` — ${syncNote.message}` : ''}
                </p>
                <div>
                  <button type="button" className="btn btn-ghost" onClick={onSyncNow}>Save now</button>
                  <button type="button" className="btn btn-ghost" onClick={onRestoreFromFolder}>Restore trades from folder…</button>
                  <button type="button" className="btn btn-primary" onClick={onDisconnectSync}>Disconnect folder</button>
                </div>
                <div className="checkbox-label">
                  <input
                    type="checkbox"
                    id="sync-auto-checkbox"
                    checked={syncAuto}
                    onChange={(event) => onSyncAutoChange?.(event.target.checked)}
                  />
                  <label htmlFor="sync-auto-checkbox">Auto-save on every change</label>
                </div>
              </>
            ) : (
              <>
                {syncStatus === 'blocked' ? (
                  <p className="field-error">
                    Folder access was revoked or the folder moved. Reconnect to continue auto-saving.
                  </p>
                ) : syncStatus === 'error' ? (
                  <p className="field-error">
                    The last write to trades_data/ failed. Rename nothing, press “Save now”, or reconnect.
                  </p>
                ) : (
                  <p>Grant access to a folder once; then every save is mirrored locally:</p>
                )}
                <pre className="sync-layout">{'trades_data/\n  trades.json   — all trade records (restorable)\n  rules.txt     — your rules text\n  capital.json  — India & US capitals'}</pre>
                <div>
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={onConnectSync}
                    disabled={syncStatus === 'connecting'}
                  >
                    {syncStatus === 'connecting' ? 'Waiting for folder access…' : 'Choose folder & enable auto-save'}
                  </button>
                </div>
              </>
            )}
          </>
        )}
      </section>

      <section className="card" aria-labelledby="settings-export-heading">
        <h2 id="settings-export-heading">Data &amp; Export</h2>
        <p>{PRIVACY_NOTE}</p>
        <div>
          <button type="button" className="btn btn-primary" onClick={handleExportCsv} disabled={isEmpty}>
            Export CSV
          </button>
          <button type="button" className="btn btn-primary" onClick={handleExportJson} disabled={isEmpty}>
            Export JSON
          </button>
        </div>
        {isEmpty && <p className="field-error">Nothing to export yet — add a trade first.</p>}
      </section>

      <section className="card" aria-labelledby="settings-import-heading">
        <h2 id="settings-import-heading">Import</h2>

        <h3>Add trades from a JSON file</h3>
        <p>Adds trades from a JSON export. Existing trades are kept; duplicate ids and invalid records are skipped.</p>
        <label htmlFor="import-file" className="btn btn-ghost">
          Choose JSON file
        </label>
        <input
          id="import-file"
          type="file"
          accept="application/json,.json"
          style={HIDDEN_INPUT_STYLE}
          onChange={handleMergeImport}
        />

        <h3>Replace the whole journal</h3>
        <p>Replaces every trade on this device with the contents of a JSON file. This cannot be undone.</p>
        <label htmlFor="replace-file" className="btn btn-ghost">
          Replace all trades with a JSON file
        </label>
        <input
          id="replace-file"
          type="file"
          accept="application/json,.json"
          style={HIDDEN_INPUT_STYLE}
          onChange={handleReplaceImport}
        />

        <div id="import-status" role="status" aria-live="polite">
          {status ? (
            <div className={status.kind === 'error' && 'field-error'}>
              <p>{status.message}</p>
              {status.details?.length > 0 && (
                <ul>
                  {status.details.map((detail, index) => (
                    <li key={index}>{detail}</li>
                  ))}
                </ul>
              )}
            </div>
          ) : null}
        </div>
      </section>

      <section className="card" aria-labelledby="settings-danger-heading">
        <h2 id="settings-danger-heading">Danger zone</h2>
        {isEmpty ? <p>Your journal is empty.</p> : null}
        {confirmingDelete ? (
          <div>
            <p className="field-error">Really delete all? This permanently removes every trade from this device.</p>
            <button type="button" className="btn btn-danger" onClick={handleDeleteConfirmed}>
              Yes, delete all
            </button>
            <button type="button" className="btn btn-ghost" onClick={() => setConfirmingDelete(false)}>
              No, keep them
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn btn-danger"
            disabled={isEmpty}
            onClick={() => setConfirmingDelete(true)}
          >
            Delete all trades
          </button>
        )}
      </section>
    </main>
  );
}
