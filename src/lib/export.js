/**
 * Export / import helpers — pure, no React.
 *
 * CSV is the interchange format for spreadsheets; JSON is the lossless
 * round-trip format. Both operate on the canonical trade records described
 * in CONTRACTS.md. Nothing here talks to the network: downloads happen
 * entirely in the browser via a Blob + object URL.
 */

/** Fixed column order. Deterministic regardless of record key order. */
export const CSV_COLUMNS = [
  'id',
  'symbol',
  'market',
  'direction',
  'entryPrice',
  'exitPrice',
  'quantity',
  'entryDate',
  'exitDate',
  'fees',
  'strategy',
  'setup',
  'notes',
  'createdAt',
];

/**
 * Escape a single CSV cell per RFC 4180: fields containing a comma, double
 * quote, or newline are wrapped in double quotes and internal quotes are
 * doubled. null/undefined become empty cells.
 */
function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/[",\n\r]/.test(text)) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** Trades → CSV string. Row order follows the input array (deterministic). */
export function toCsv(trades) {
  const list = Array.isArray(trades) ? trades : [];
  const header = CSV_COLUMNS.join(',');
  const rows = list.map((trade) => CSV_COLUMNS.map((column) => csvCell(trade?.[column])).join(','));
  return [header, ...rows].join('\n');
}

/** Trades → pretty JSON string. Lossless: parse it back and you get the array. */
export function toJsonExport(trades) {
  return JSON.stringify(Array.isArray(trades) ? trades : [], null, 2);
}

/**
 * Download `content` as a file using a Blob + object URL + programmatic
 * <a download> click. Returns true when the click was performed, false when
 * there is no DOM (e.g. server-side or non-browser test environment).
 */
export function downloadFile(filename, content, mimeType = 'text/plain') {
  if (typeof document === 'undefined') return false;

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Revoke lazily so the browser has a chance to start the download.
  if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
  return true;
}

/**
 * Parse the text of an imported file. Accepts a plain JSON array of trades
 * or an object shaped like { trades: [...] }. Throws a friendly Error for
 * unparseable JSON or an unexpected top-level shape; never returns null.
 */
export function parseImportFile(text) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new Error(`Invalid JSON: ${err instanceof Error ? err.message : String(err)}`, { cause: err });
  }

  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.trades)) return parsed.trades;

  throw new Error('Invalid import file: expected a JSON array of trades, or an object with a "trades" array.');
}
