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

import { useEffect, useId, useMemo, useState } from 'react';
import { DIRECTIONS, MARKETS, validateTrade } from '../lib/schema.js';
import { getScreenshot } from '../lib/screenshots.js';
import { swapExitPrice } from '../lib/calculations.js';
import { fetchCryptoPrices } from '../lib/marketData.js';
import { formatCurrency } from '../lib/format.js';
import { useCurrency } from '../hooks/useCurrency.js';

const EMPTY_EXIT_PRICE = 'Exit price is required for a closed trade.';

const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // keep blobs sane for IndexedDB
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];

/**
 * Screenshot attach / preview / remove control (PNG/JPEG/WEBP/GIF ≤ 5 MB).
 * Reports its pending change upward as { file?, removed? } so the trade
 * payload plus IndexedDB update flow through a single save path.
 */
function ScreenshotField({ tradeId, hasInitial, onChange }) {
  const fieldId = 'trade-screenshot';
  const [pendingFile, setPendingFile] = useState(null);
  const [pendingUrl, setPendingUrl] = useState(null);
  const [removed, setRemoved] = useState(false);
  const [existingUrl, setExistingUrl] = useState(null);
  const [missing, setMissing] = useState(false);
  const [warn, setWarn] = useState(null);

  // Load the stored screenshot once (edit mode). Graceful when absent.
  useEffect(() => {
    let cancelled = false;
    if (hasInitial && tradeId) {
      getScreenshot(tradeId).then((blob) => {
        if (cancelled) return;
        if (blob instanceof Blob) {
          setExistingUrl(URL.createObjectURL(blob));
        } else {
          setMissing(true);
        }
      });
    }
    return () => {
      cancelled = true;
    };
  }, [tradeId, hasInitial]);

  // Each object-URL is revoked exactly when it is replaced or unmounted.
  useEffect(() => {
    if (!pendingUrl) return undefined;
    return () => URL.revokeObjectURL(pendingUrl);
  }, [pendingUrl]);

  useEffect(() => {
    if (!existingUrl) return undefined;
    return () => URL.revokeObjectURL(existingUrl);
  }, [existingUrl]);

  const emit = (file, isRemoved) => onChange({ file, removed: isRemoved });

  const handleFile = (event) => {
    const selected = event.target.files?.[0];
    setWarn(null);
    if (!selected) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(selected.type) || selected.size > MAX_SCREENSHOT_BYTES) {
      event.target.value = '';
      setWarn('Choose a PNG, JPEG, WEBP or GIF image up to 5 MB.');
      return;
    }
    setPendingFile(selected);
    setPendingUrl(URL.createObjectURL(selected));
    setRemoved(false);
    emit(selected, false);
    event.target.value = '';
  };

  const handleRemove = (event) => {
    const checked = event.target.checked;
    setRemoved(checked);
    if (checked) {
      setPendingFile(null); // picking a file and clicking remove are exclusive
    }
    emit(null, checked && hasInitial);
  };

  const previewUrl = pendingUrl ?? (removed ? null : existingUrl);

  const hintText = pendingFile
    ? `${pendingFile.name} — attaches when you save.`
    : missing
      ? 'No screenshot saved on this device (attachments are local-only, not included in exports).'
      : hasInitial && !removed
        ? 'Saved screenshot loaded. Pick a new image to replace it.'
        : 'Optional: attach a chart snapshot from your device (PNG/JPEG/WEBP/GIF up to 5 MB, stored in your browser only).';

  return (
    <div className="field screenshot-field">
      <label className="label" htmlFor={fieldId}>
        Screenshot
      </label>

      {previewUrl ? (
        <img
          className="screenshot-thumb"
          src={previewUrl}
          alt={pendingFile ? `New screenshot ${pendingFile.name}` : 'Saved chart screenshot'}
          width="220"
        />
      ) : null}

      <p className="page-sub" id={`${fieldId}-hint`}>{hintText}</p>

      <input
        id={fieldId}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        onChange={handleFile}
        aria-describedby={`${fieldId}-hint`}
      />

      {pendingFile ? (
        <p className="page-sub">{pendingFile.name} — attaches when you save.</p>
      ) : hasInitial && !removed && !missing ? (
        <div className="checkbox-label">
          <input type="checkbox" id={`${fieldId}-remove`} checked={removed} onChange={handleRemove} />
          <label htmlFor={`${fieldId}-remove`}>Remove screenshot on save</label>
        </div>
      ) : null}

      {warn ? (
        <p className="field-error" id={`${fieldId}-warn`} role="alert">
          {warn}
        </p>
      ) : null}
    </div>
  );
}

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
      leverage: '',
      invested: '',
      takeProfit: '',
      stopLoss: '',
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
    leverage: initial.leverage == null ? '' : String(initial.leverage),
    entryDate: initial.entryDate ?? '',
    exitDate: isOpen || !initial.exitDate ? '' : String(initial.exitDate),
    invested: initial.invested == null ? '' : String(initial.invested),
    takeProfit: initial.takeProfit == null ? '' : String(initial.takeProfit),
    stopLoss: initial.stopLoss == null ? '' : String(initial.stopLoss),
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
    leverage: trim(draft.leverage) === '' ? null : Number(trim(draft.leverage)),
    invested: trim(draft.invested) === '' ? null : Number(trim(draft.invested)),
    takeProfit: trim(draft.takeProfit) === '' ? null : Number(trim(draft.takeProfit)),
    stopLoss: trim(draft.stopLoss) === '' ? null : Number(trim(draft.stopLoss)),
    entryDate: trim(draft.entryDate),
    exitDate: isOpen ? null : trim(draft.exitDate) === '' ? null : trim(draft.exitDate),
    fees: trim(draft.fees) === '' ? 0 : Number(trim(draft.fees)),
    strategy: draft.strategy,
    setup: draft.setup,
    notes: draft.notes,
  };
}

/**
 * Crypto swap helper — crypto accounts often move one coin directly into
 * another (BTC → SOL) instead of selling into fiat first. This panel turns
 * that movement into the trade's exit side: value received
 * (receivedQty × receivedPrice) ÷ qty sold becomes the exit price, so the
 * swap journals as an honest close of the sold coin and every P&L rule
 * keeps working. Available for crypto trades only.
 */
function SwapPanel({ idBase, tradeCurrency, quantity, onApply }) {
  const [open, setOpen] = useState(false);
  const [fromQty, setFromQty] = useState('');
  const [toCoin, setToCoin] = useState('');
  const [toQty, setToQty] = useState('');
  const [toPriceUsd, setToPriceUsd] = useState('');
  const [usdInrRate, setUsdInrRate] = useState('');
  const [fetching, setFetching] = useState(false);
  const [msg, setMsg] = useState(null); // { tone: 'pos' | 'neg', text }

  const toggle = () => {
    if (!open) {
      setFromQty(quantity || ''); // prefill with the position being exited
      setMsg(null);
    }
    setOpen(!open);
  };

  const fetchPrice = async () => {
    const coin = toCoin.trim().toUpperCase();
    if (!coin) {
      setMsg({ tone: 'neg', text: 'Type the coin you received first (e.g. SOL).' });
      return;
    }
    setFetching(true);
    setMsg(null);
    try {
      const { prices, errors } = await fetchCryptoPrices([coin]);
      const hit = prices[coin];
      if (hit) {
        setToPriceUsd(String(hit.price));
        setMsg({
          tone: 'pos',
          text: `Fetched ${coin} = $${hit.price} (Binance public API). Review the USD→INR rate before applying.`,
        });
      } else {
        setMsg({
          tone: 'neg',
          text: `Could not fetch ${coin}: ${errors[coin] ?? 'unavailable'}. Enter its price manually.`,
        });
      }
    } catch {
      setMsg({ tone: 'neg', text: 'Price fetch failed — enter the received coin’s price manually.' });
    } finally {
      setFetching(false);
    }
  };

  const apply = () => {
    const price = Number(toPriceUsd);
    const rate = tradeCurrency === 'INR' ? Number(usdInrRate) : 1;
    const effectivePrice = tradeCurrency === 'INR' && rate > 0 ? price * rate : price;
    const exit = swapExitPrice(Number(fromQty), Number(toQty), effectivePrice);
    if (exit === null) {
      setMsg({ tone: 'neg', text: 'All three amounts must be positive numbers (rate too, when INR).' });
      return;
    }
    onApply({
      exitPrice: exit,
      note: `Swap: ${Number(fromQty)} units sold for ${Number(toQty)} ${toCoin.trim().toUpperCase()} @ ${effectivePrice.toFixed(4)} per coin (${tradeCurrency === 'INR' ? 'USD→INR applied' : 'USD quote'}).`,
    });
    setMsg({ tone: 'pos', text: `Exit price filled: ${formatCurrency(exit, tradeCurrency)} per sold unit. Review, then save.` });
  };

  if (!open) {
    return (
      <div className="field">
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggle}>
          🔁 Log a swap (exchanged into another coin)
        </button>
      </div>
    );
  }

  return (
    <div className="field swap-panel">
      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor={`${idBase}-swapFrom`}>
            Quantity sold
          </label>
          <input
            id={`${idBase}-swapFrom`}
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            value={fromQty}
            onChange={(e) => setFromQty(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${idBase}-swapToCoin`}>
            Received coin
          </label>
          <input
            id={`${idBase}-swapToCoin`}
            type="text"
            value={toCoin}
            onChange={(e) => setToCoin(e.target.value)}
            placeholder="e.g. SOL"
            autoComplete="off"
          />
        </div>
      </div>
      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor={`${idBase}-swapToQty`}>
            Received qty
          </label>
          <input
            id={`${idBase}-swapToQty`}
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            value={toQty}
            onChange={(e) => setToQty(e.target.value)}
          />
        </div>
        <div className="field">
          <label className="label" htmlFor={`${idBase}-swapToPrice`}>
            Received coin price (USD)
          </label>
          <input
            id={`${idBase}-swapToPrice`}
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            value={toPriceUsd}
            onChange={(e) => setToPriceUsd(e.target.value)}
            placeholder="coin's USD price"
          />
          <button type="button" className="btn btn-ghost btn-sm" onClick={fetchPrice} disabled={fetching}>
            {fetching ? 'Fetching…' : 'Fetch from Binance'}
          </button>
        </div>
      </div>
      {tradeCurrency === 'INR' && (
        <div className="field">
          <label className="label" htmlFor={`${idBase}-swapRate`}>
            USD → INR rate used in your trade
          </label>
          <input
            id={`${idBase}-swapRate`}
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            value={usdInrRate}
            onChange={(e) => setUsdInrRate(e.target.value)}
            placeholder="e.g. 88.5"
          />
        </div>
      )}
      <p className="page-sub">
        Exit value = received qty × received price ÷ quantity sold; the trade closes with that exit
        price. Everything stays on this device — the fetched quote is market data only.
      </p>
      {msg && (
        <p className={msg.tone === 'pos' ? 'page-sub' : 'field-error'} role="status">
          {msg.text}
        </p>
      )}
      <div className="form-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={toggle}>
          Hide swap panel
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={apply}>
          Apply to exit price
        </button>
      </div>
    </div>
  );
}

export default function TradeForm({ initial = null, onSave, onCancel }) {
  const id = useId();
  const [draft, setDraft] = useState(() => draftFrom(initial));
  const [errors, setErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [screenshotChange, setScreenshotChange] = useState(null); // { file?, removed? }
  const { currency } = useCurrency();

  // The invested hint lives in the trade's own currency: an existing trade
  // keeps its native tag, a new trade previews in the active market's money.
  const displayCurrency = initial?.currency ?? currency;

  // Live "auto invested" preview: entry × quantity ÷ leverage.
  const derivedInvested = useMemo(() => {
    const entry = Number(draft.entryPrice);
    const qty = Number(draft.quantity);
    const lev = Number(draft.leverage);
    if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(qty) || qty <= 0) return null;
    const divisor = Number.isFinite(lev) && lev >= 1 ? lev : 1;
    return formatCurrency((entry * qty) / divisor, displayCurrency);
  }, [draft.entryPrice, draft.quantity, draft.leverage, displayCurrency]);

  // Live TP/SL outcome preview: what each level is worth in money.
  const tpSlPreview = useMemo(() => {
    const entry = Number(draft.entryPrice);
    const qty = Number(draft.quantity);
    const tp = Number(draft.takeProfit);
    const sl = Number(draft.stopLoss);
    const short = draft.direction === 'short';
    const outcome = (level) => {
      if (!Number.isFinite(level) || level <= 0 || !Number.isFinite(entry) || entry <= 0 || !Number.isFinite(qty) || qty <= 0) return null;
      const diff = short ? entry - level : level - entry;
      return formatCurrency(diff * qty, displayCurrency);
    };
    return { tp: outcome(tp), sl: outcome(sl) };
  }, [draft.entryPrice, draft.quantity, draft.takeProfit, draft.stopLoss, draft.direction, displayCurrency]);

  const set = (field) => (event) => {
    const value = event.target.type === 'checkbox' ? event.target.checked : event.target.value;
    setDraft((d) => ({ ...d, [field]: value }));
  };

  /**
   * Typing an exit price instantly marks the trade closed (no separate
   * checkbox dance), so the input always accepts keystrokes.
   */
  const setExitPriceLive = (event) => {
    const value = event.target.value;
    setDraft((d) => ({
      ...d,
      exitPrice: value,
      isOpen: value.trim() === '' ? d.isOpen : false,
    }));
  };

  /** Typing an exit date also closes the trade. */
  const setExitDateLive = (event) => {
    const value = event.target.value;
    setDraft((d) => ({
      ...d,
      exitDate: value,
      isOpen: value === '' ? d.isOpen : false,
    }));
  };

  /** "Open" checkbox: clears the exit fields (they only exist when closed). */
  const setIsOpen = (event) => {
    const checked = event.target.checked;
    setDraft((d) => ({
      ...d,
      isOpen: checked,
      ...(checked ? { exitPrice: '', exitDate: '' } : {}),
    }));
  };

  /**
   * Crypto swap: the helper computed the exit price from the received side;
   * applying closes the trade (open → closed, today's date by default) and
   * records what happened in Notes. The user reviews everything before
   * saving — nothing here bypasses validation on submit.
   */
  const applySwap = ({ exitPrice, note }) => {
    setDraft((d) => ({
      ...d,
      exitPrice: String(exitPrice),
      isOpen: false,
      exitDate: typeof d.exitDate === 'string' && d.exitDate.trim() ? d.exitDate : todayIso(),
      notes: typeof d.notes === 'string' && d.notes.trim() ? `${d.notes.trim()}\n${note}` : note,
    }));
  };

  const err = (field) => errors[field] || null;
  const errorProps = (field) => ({
    'aria-invalid': errors[field] ? true : undefined,
    'aria-describedby': errors[field] ? `${id}-${field}-error` : undefined,
  });

  async function handleSubmit(event) {
    event.preventDefault();
    const values = buildValues(draft);

    // Screenshot payload (not part of schema validation; handled by the
    // parent after the record itself saves — blob goes to IndexedDB).
    values.screenshotFile = screenshotChange?.file instanceof File ? screenshotChange.file : null;
    values.screenshotRemoveExisting = screenshotChange?.removed === true;

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
          value={draft.exitPrice}
          onChange={setExitPriceLive}
          placeholder="Leave empty while the trade is open"
          {...errorProps('exitPrice')}
        />
        {err('exitPrice') && (
          <span id={`${id}-exitPrice-error`} className="field-error" role="alert">
            {err('exitPrice')}
          </span>
        )}
      </div>

      {draft.market === 'crypto' && (
        <SwapPanel
          idBase={id}
          tradeCurrency={displayCurrency}
          quantity={draft.quantity}
          onApply={applySwap}
        />
      )}

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
        <label className="label" htmlFor={`${id}-leverage`}>
          Leverage
        </label>
        <input
          id={`${id}-leverage`}
          name="leverage"
          type="number"
          step="any"
          min="1"
          inputMode="decimal"
          placeholder="e.g. 5 for 5×"
          value={draft.leverage}
          onChange={set('leverage')}
          aria-describedby={`${id}-leverage-hint`}
          {...errorProps('leverage')}
        />
        <p className="page-sub" id={`${id}-leverage-hint`}>
          Optional. Margin trade? Money invested auto-divides by this (entry × qty ÷ {draft.leverage.trim() || 'leverage'}).
        </p>
        {err('leverage') && (
          <span id={`${id}-leverage-error`} className="field-error" role="alert">
            {err('leverage')}
          </span>
        )}
      </div>

      <div className="field">
        <label className="label" htmlFor={`${id}-invested`}>
          Money invested
        </label>
        <input
          id={`${id}-invested`}
          name="invested"
          type="number"
          step="any"
          min="0"
          inputMode="decimal"
          value={draft.invested}
          onChange={set('invested')}
          aria-describedby={`${id}-invested-hint`}
          {...errorProps('invested')}
        />
        <p className="page-sub" id={`${id}-invested-hint`}>
          {derivedInvested === null
            ? 'Optional. Auto-uses entry price × quantity ÷ leverage when left empty.'
            : `Auto: ${derivedInvested}`}
        </p>
        {err('invested') && (
          <span id={`${id}-invested-error`} className="field-error" role="alert">
            {err('invested')}
          </span>
        )}
      </div>

      <div className="field-row">
        <div className="field">
          <label className="label" htmlFor={`${id}-takeProfit`}>
            Take profit 🎯
          </label>
          <input
            id={`${id}-takeProfit`}
            name="takeProfit"
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            placeholder="Target price"
            value={draft.takeProfit}
            onChange={set('takeProfit')}
            aria-describedby={`${id}-tp-hint`}
            {...errorProps('takeProfit')}
          />
          <p className="page-sub" id={`${id}-tp-hint`}>
            {tpSlPreview?.tp != null ? `Worth ${tpSlPreview.tp} at target` : 'Price to exit in profit'}
          </p>
          {err('takeProfit') && (
            <span id={`${id}-takeProfit-error`} className="field-error" role="alert">
              {err('takeProfit')}
            </span>
          )}
        </div>

        <div className="field">
          <label className="label" htmlFor={`${id}-stopLoss`}>
            Stop loss 🛑
          </label>
          <input
            id={`${id}-stopLoss`}
            name="stopLoss"
            type="number"
            step="any"
            min="0"
            inputMode="decimal"
            placeholder="Max loss price"
            value={draft.stopLoss}
            onChange={set('stopLoss')}
            aria-describedby={`${id}-sl-hint`}
            {...errorProps('stopLoss')}
          />
          <p className="page-sub" id={`${id}-sl-hint`}>
            {tpSlPreview?.sl != null ? `Worth ${tpSlPreview.sl} at stop` : 'Price to exit at a loss'}
          </p>
          {err('stopLoss') && (
            <span id={`${id}-stopLoss-error`} className="field-error" role="alert">
              {err('stopLoss')}
            </span>
          )}
        </div>
      </div>

      <p className="page-sub">
        Optional price levels for planned exits. For a long trade, take profit sits above entry and
        stop loss below; for a short trade, the reverse.
      </p>

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
          value={draft.exitDate}
          onChange={setExitDateLive}
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
            onChange={setIsOpen}
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

      <ScreenshotField
        tradeId={initial?.id ?? null}
        hasInitial={initial?.hasScreenshot === true}
        onChange={setScreenshotChange}
      />

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
