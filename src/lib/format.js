/** Display formatting helpers. All helpers are null/NaN-safe and return '' on bad input. */

export function formatCurrency(value) {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** Currency with explicit +/- sign, for P&L displays. */
export function signedFormatCurrency(value) {
  if (!Number.isFinite(value)) return '';
  if (value === 0) return formatCurrency(0);
  return `${value > 0 ? '+' : '-'}${formatCurrency(Math.abs(value))}`;
}

export function formatPercent(value, digits = 1) {
  if (!Number.isFinite(value)) return '';
  return `${value.toFixed(digits)}%`;
}

export function formatNumber(value) {
  if (!Number.isFinite(value)) return '';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
}

/** "2026-01-02" -> "Jan 2, 2026". Returns the raw string when unparseable. */
export function formatDate(iso) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso ?? '';
  const [y, m, d] = iso.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

export function formatDateTime(iso) {
  if (typeof iso !== 'string' || !iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Renders Infinity (a legal profitFactor value) sensibly. */
export function formatRatio(value) {
  if (value === Infinity) return '∞';
  if (!Number.isFinite(value)) return '';
  return value.toFixed(2);
}
