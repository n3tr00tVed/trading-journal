import { useState } from 'react';
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
export default function SettingsPage({ stats, trades = [], importTrades, restoreTrades, clearAll }) {
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

  return (
    <main>
      <h1>Settings</h1>
      <p className="label">{stats?.total ?? tradeCount} trades · {stats?.open ?? 0} open on this device</p>

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
