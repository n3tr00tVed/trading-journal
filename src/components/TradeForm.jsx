/**
 * TradeForm — create/edit trade form.
 *
 * Props:
 *   initial  trade | null  — null => create mode, trade object => edit mode
 *   onSave   (values) => Promise | { ok, errors }  — called only when locally valid
 *   onCancel () => void  — close request (also used to close after a successful save)
 *
 * Draft state is kept as strings (native text inputs); a values object with
 * proper Number()/null conversions is derived at submit time and validated
 * with validateTrade() from ../lib/schema.js before onSave is ever called.
 */

import { useId, useState } from 'react';
import { DIRECTIONS, MARKETS, validateTrade } from '../lib/schema.js';

const EMPTY_EXIT_PRICE = 'Exit price is required for a closed trade.';

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

/** Build the string-based draft from an existing trade (edit) or defaults (create). */
function draftFrom(initial) {
  if (!initial) {
    return {
      symbol: '',
      market: 'stocks',
      direction: 'long',
      entryPrice: '',
      exitPrice: '',
      quantity: '',
      entryDate: todayIso(),
      exitDate: '',
      fees: '0',
      strategy: '',
      setup: '',
      notes: '',
      isOpen: true,
    };
  }
  const isOpen = initial.exitPrice === null;
  return {
    symbol: initial.symbol ?? '',
    market: MARKETS.includes(initial.market) ? initial.market : 'stocks',
    direction: initial.direction === 'short' ? 'short' : 'long',
    entryPrice: initial.entryPrice === null || initial.entryPrice === undefined ? '' : String(initial.entryPrice),
    exitPrice: isOpen || initial.exitPrice === null || initial.exitPrice === undefined ? '' : String(initial.exitPrice),
    quantity: initial.quantity === null || initial.quantity === undefined ? '' : String(initial.quantity),
    entryDate: initial.entryDate ?? '',
    exitDate: isOpen || !initial.exitDate ? '' : String(initial.exitDate),
    fees: initial.fees === null || initial.fees === undefined ? '0' : String(initial.fees),
    strategy: initial.strategy ?? '',
    setup: initial.setup ?? '',
    notes: initial.notes ?? '',
    isOpen,
  };
}

/** Derive the submission values object from the string draft. */
function buildValues(draft) {
  const trim = (v) => (typeof v === 'string' ? v.trim() : '');
  const num = (v) => (trim(v) === '' ? NaN : Number(trim(v))); // NaN => caught by validateTrade
  const isOpen = draft.isOpen;

  return {
    symbol: trim(draft.symbol).toUpperCase(),
    market: draft.market,
    direction: draft.direction,
    entryPrice: num(draft.entryPrice),
    exitPrice: isOpen ? null : trim(draft.exitPrice) === '' ? NaN : Number(trim(draft.exitPrice)),
    quantity: num(draft.quantity),
    entryDate: trim(draft.entryDate),
    exitDate: isOpen ? null : trim(draft.exitDate) === '' ? null : trim(draft.exitDate),
    fees: trim(draft.fees) === '' ? 0 : Number(trim(draft.fees)),
    strategy: draft.strategy,
    setup: draft.setup,
    notes: draft.notes,
  };
}

export default function TradeForm({ initial = null, onSave, onCancel }) {
  const id = useId();
  const [draft, setDraft] = useState(() => draftFrom(initial));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);

  const set = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setDraft((d) => ({ ...d, [field]: value }));
  };

  const err = (field) => errors[field] || null;
  const errorProps = (field) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${id}-${field}-error` : undefined,
  });

  async function handleSubmit(event) {
    event.preventDefault();
    const values = buildValues(draft);

    const nextErrors = { ...validateTrade(values).errors };
    // Local rule (stricter, friendlier copy than validateTrade's NaN message):
    // a checked "closed" trade cannot be closed without an exit price.
    if (!draft.isOpen && typeof draft.exitPrice === 'string' && draft.exitPrice.trim() === '') {
      nextErrors.exitPrice = EMPTY_EXIT_PRICE;
    }

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      return;
    }

    setErrors({});
    setSaving(true);
    try {
      const result = typeof onSave === 'function' ? await onSave(values) : { ok: true };
      if (result && result.ok === false) {
        // Keep the form open and surface the parent's (normalized-record) errors.
        setErrors({ ...nextErrors, ...(result.errors || {}) });
        return;
      }
      if (typeof onCancel === 'function') onCancel();
    } catch {
      setErrors({ form: 'Could not save the trade. Please try again.' });
    } finally {
      setSaving(false);
    }
  }

  const symbolError = err('symbol');

  return (
    <form onSubmit={handleSubmit} noValidate>
      {err('form') && (
        <p className="field-error" role="alert">
          {err('form')}
        </p>
      )}

      <div className="field">
        <label className="label" htmlFor={`${id}-symbol`}>
          Symbol <span title="Required">*</span>
        </label>
        <input
          id={`${id}-symbol`}
          name="symbol"
          type="text"
          value={draft.symbol}
          onChange={set('symbol')}
          autoFocus
          autoComplete="off"
          placeholder="e.g. AAPL"
          {...errorProps('symbol')}
        />
        {symbolError && (
          <span id={`${id}-symbol-error`} className="field-error" role="alert">
            {symbolError}
          </span>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-market`}>
          Market
        </label>
        <select id={`${id}-market`} name="market" value={draft.market} onChange={set('market')} {...errorProps('market')}>
          {MARKETS.map((market) => (
            <option key={market} value={market}>
              {market.charAt(0).toUpperCase() + market.slice(1)}
            </option>
          ))}
        </select>
        {err('market') && (
          <span id={`${id}-market-error`} className="field-error" role="alert">
            {err('market')}
          </span>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-direction`}>
          Direction
        </label>
        <select id={`${id}-direction`} name="direction" value={draft.direction} onChange={set('direction')} {...errorProps('direction')}>
          {DIRECTIONS.map((direction) => (
            <option key={direction} value={direction}>
              {direction.charAt(0).toUpperCase() + direction.slice(1)}
            </option>
          ))}
        </select>
        {err('direction') && (
          <span id={`${id}-direction-error`} className="field-error" role="alert">
            {err('direction')}
          </span>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-entryPrice`}>
          Entry price <span title="Required">*</span>
        </label>
        <input
          id={`${id}-entryPrice`}
          name="entryPrice"
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          value={draft.entryPrice}
          onChange={set('entryPrice')}
          {...errorProps('entryPrice')}
        />
        {err('entryPrice') && (
          <span id={`${id}-entryPrice-error`} className="field-error" role="alert">
            {err('entryPrice')}
          </span>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-exitPrice`}>
          Exit price
        </label>
        <input
          id={`${id}-exitPrice`}
          name="exitPrice"
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          value={draft.isOpen ? '' : draft.exitPrice}
          onChange={set('exitPrice')}
          disabled={draft.isOpen}
          {...errorProps('exitPrice')}
        />
        {err('exitPrice') && (
          <span id={`${id}-exitPrice-error`} className="field-error" role="alert">
            {err('exitPrice')}
          </span>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-quantity`}>
          Quantity <span title="Required">*</span>
        </label>
        <input
          id={`${id}-quantity`}
          name="quantity"
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          value={draft.quantity}
          onChange={set('quantity')}
          {...errorProps('quantity')}
        />
        {err('quantity') && (
          <span id={`${id}-quantity-error`} className="field-error" role="alert">
            {err('quantity')}
          </span>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-entryDate`}>
          Entry date <span title="Required">*</span>
        </label>
        <input
          id={`${id}-entryDate`}
          name="entryDate"
          type="date"
          value={draft.entryDate}
          onChange={set('entryDate')}
          {...errorProps('entryDate')}
        />
        {err('entryDate') && (
          <span id={`${id}-entryDate-error`} className="field-error" role="alert">
            {err('entryDate')}
          </span>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-exitDate`}>
          Exit date
        </label>
        <input
          id={`${id}-exitDate`}
          name="exitDate"
          type="date"
          value={draft.isOpen ? '' : draft.exitDate}
          onChange={set('exitDate')}
          disabled={draft.isOpen}
          {...errorProps('exitDate')}
        />
        {err('exitDate') && (
          <span id={`${id}-exitDate-error`} className="field-error" role="alert">
            {err('exitDate')}
          </span>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-fees`}>
          Fees
        </label>
        <input
          id={`${id}-fees`}
          name="fees"
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          value={draft.fees}
          onChange={set('fees')}
          {...errorProps('fees')}
        />
        {err('fees') && (
          <span id={`${id}-fees-error`} className="field-error" role="alert">
            {err('fees')}
          </span>
        )}
      </div>

      <div className="field">
        <label className="checkbox-label" htmlFor={`${id}-isOpen`}>
          <input
            id={`${id}-isOpen`}
            name="isOpen"
            type="checkbox"
            checked={draft.isOpen}
            onChange={set('isOpen')}
          />
          Trade is open (no exit yet)
        </label>
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-strategy`}>
          Strategy
        </label>
        <textarea
          id={`${id}-strategy`}
          name="strategy"
          rows="2"
          value={draft.strategy}
          onChange={set('strategy')}
          placeholder="e.g. breakout, mean reversion…"
        />
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-setup`}>
          Setup
        </label>
        <textarea
          id={`${id}-setup`}
          name="setup"
          rows="2"
          value={draft.setup}
          onChange={set('setup')}
          placeholder="e.g. 4h pullback to VWAP…"
        />
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-notes`}>
          Notes
        </label>
        <textarea
          id={`${id}-notes`}
          name="notes"
          rows="3"
          value={draft.notes}
          onChange={set('notes')}
          placeholder="Anything worth remembering about this trade…"
        />
      </div>

      <div className="form-actions">
        <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
          Cancel
        </button>
        <button type="submit" className="btn btn-primary" disabled={saving}>
          {saving ? 'Saving…' : initial ? 'Save changes' : 'Add trade'}
        </button>
      </div>
    </form>
  );
}
