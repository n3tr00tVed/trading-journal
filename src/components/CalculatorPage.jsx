import { useMemo, useState } from 'react';
import { positionSizing } from '../lib/calculator.js';
import { lotSizeFor } from '../lib/lotSizes.js';
import { formatCurrency, formatNumber } from '../lib/format.js';
import { useCurrency } from '../hooks/useCurrency.js';

/**
 * Position-size calculator for the Indian market.
 * "I have ₹25,000 — how many shares/lots can I buy?"
 *
 * Prefills capital from the account capital saved in Settings. Risk-based
 * sizing needs a stop loss; affordability is independent of it. Lot size
 * auto-fills for known futures/options symbols and defaults to 1 (cash
 * market) otherwise — usable as an "Override" input for any contract.
 */
export default function CalculatorPage({ capital = null }) {
  const { currency } = useCurrency();
  const symbol = currency === 'INR' ? '₹' : '$';
  const [inputs, setInputs] = useState({
    capital: capital == null ? '' : String(capital),
    riskPercent: '1',
    entryPrice: '',
    stopLoss: '',
    direction: 'long',
    symbol: '',
    market: 'stocks',
    lotOverride: '',
  });

  const set = (field) => (event) => {
    setInputs((d) => ({ ...d, [field]: event.target.value }));
  };

  const num = (text) => {
    const trimmed = String(text ?? '').trim();
    if (trimmed === '') return null;
    const value = Number(trimmed.replace(/[$₹,\s]/g, ''));
    return Number.isFinite(value) ? value : NaN;
  };

  const autoLot = useMemo(
    () => lotSizeFor(inputs.symbol, inputs.market),
    [inputs.symbol, inputs.market],
  );
  const lotValue = inputs.lotOverride.trim() === '' ? autoLot : num(inputs.lotOverride);

  const result = useMemo(
    () =>
      positionSizing({
        capital: num(inputs.capital),
        riskPercent: num(inputs.riskPercent),
        entryPrice: num(inputs.entryPrice),
        stopLoss: num(inputs.stopLoss),
        direction: inputs.direction,
        lotSize: lotValue,
      }),
    [inputs.capital, inputs.riskPercent, inputs.entryPrice, inputs.stopLoss, inputs.direction, lotValue],
  );

  // Hard errors the calculator cannot answer honestly:
  let blocker = null;
  if (Number.isNaN(num(inputs.capital)) || Number.isNaN(num(inputs.entryPrice))) {
    blocker = 'Capital and entry price must be numbers (for example 25000 and 812.50).';
  } else if (num(inputs.stopLoss) !== null && !Number.isNaN(num(inputs.stopLoss))) {
    const entry = num(inputs.entryPrice);
    const stop = num(inputs.stopLoss);
    if (entry && stop > 0) {
      if (inputs.direction === 'long' && stop >= entry) blocker = 'For a long trade, the stop loss must be below the entry price.';
      if (inputs.direction === 'short' && stop <= entry) blocker = 'For a short trade, the stop loss must be above the entry price.';
    }
  }

  const fmt = (v) => formatCurrency(v, currency);
  const hasResult = result.ok && result.recommendedQty !== null;
  const isLotInstrument = result.lotSize > 1;
  const lotQty = isLotInstrument && hasResult ? result.lots * result.lotSize : null;

  return (
    <section aria-labelledby="calc-heading" className="calc">
      <div className="page-head">
        <h1 id="calc-heading" className="page-title">Position size calculator</h1>
        <p className="page-sub">
          Size a trade by risk and by affordable capital, with Indian F&amp;O lot sizes (symbol match auto-fills them).
        </p>
      </div>

      <form className="card calc-form" onSubmit={(event) => event.preventDefault()} noValidate>
        <div className="calc-grid">
          <div className="field-col">
            <label htmlFor="calc-capital" className="label">Capital ({symbol})</label>
            <input id="calc-capital" className="field" type="number" min="0" step="any" inputMode="decimal"
              value={inputs.capital} onChange={set('capital')} placeholder={capital == null ? 'e.g. 25000' : String(capital)} />
          </div>
          <div className="field-col">
            <label htmlFor="calc-risk" className="label">Risk per trade (%)</label>
            <input id="calc-risk" className="field" type="number" min="0.01" step="any" inputMode="decimal"
              value={inputs.riskPercent} onChange={set('riskPercent')} placeholder="1" />
          </div>
          <div className="field-col">
            <label htmlFor="calc-direction" className="label">Direction</label>
            <select id="calc-direction" className="field" value={inputs.direction} onChange={set('direction')}>
              <option value="long">Long (buy)</option>
              <option value="short">Short (sell)</option>
            </select>
          </div>
          <div className="field-col">
            <label htmlFor="calc-entry" className="label">Entry price ({symbol})</label>
            <input id="calc-entry" className="field" type="number" min="0" step="any" inputMode="decimal"
              value={inputs.entryPrice} onChange={set('entryPrice')} placeholder="e.g. 812.50" />
          </div>
          <div className="field-col">
            <label htmlFor="calc-stop" className="label">Stop loss ({symbol})</label>
            <input id="calc-stop" className="field" type="number" min="0" step="any" inputMode="decimal"
              value={inputs.stopLoss} onChange={set('stopLoss')} placeholder={inputs.direction === 'long' ? 'below entry' : 'above entry'} />
          </div>
          <div className="field-col">
            <label htmlFor="calc-market" className="label">Instrument</label>
            <select id="calc-market" className="field" value={inputs.market} onChange={set('market')}>
              <option value="stocks">Stock (cash) — lot 1</option>
              <option value="futures">Futures (F&amp;O)</option>
              <option value="options">Options (F&amp;O)</option>
            </select>
          </div>
          <div className="field-col">
            <label htmlFor="calc-symbol" className="label">Symbol</label>
            <input id="calc-symbol" className="field" type="text"
              value={inputs.symbol} onChange={set('symbol')} placeholder="e.g. NIFTY, BANKNIFTY, TCS" />
          </div>
          <div className="field-col">
            <label htmlFor="calc-lot" className="label">Lot size {inputs.lotOverride.trim() !== '' ? '(override)' : `(${autoLot})`}</label>
            <input id="calc-lot" className="field" type="number" min="1" step="1" inputMode="numeric"
              value={inputs.lotOverride} onChange={set('lotOverride')} placeholder={String(autoLot)} />
          </div>
        </div>
      </form>

      {blocker ? (
        <div className="card calc-result" role="alert">
          <p className="field-error">{blocker}</p>
        </div>
      ) : (
        <div className="card calc-result" aria-live="polite">
          {hasResult ? (
            <>
              <div className="calc-hero">
                <span className="calc-hero-label">Recommended size</span>
                <span className="stat-value mono">
                  {isLotInstrument
                    ? `${formatNumber(result.lots)} lot${result.lots === 1 ? '' : 's'} (${formatNumber(lotQty)} units @ ${result.lotSize}/lot)`
                    : `${formatNumber(result.recommendedQty)} share${result.recommendedQty === 1 ? '' : 's'}`}
                </span>
              </div>
              <table className="trades-table calc-table">
                <caption className="visually-hidden">Position size breakdown</caption>
                <tbody>
                  {result.riskAmount !== null && (
                    <tr><th scope="row">Risk amount ({formatNumber(num(inputs.riskPercent) ?? 0)}%)</th><td className="num mono">{fmt(result.riskAmount)}</td></tr>
                  )}
                  {result.perUnitRisk !== null && (
                    <tr><th scope="row">Loss per unit at stop</th><td className="num mono">{fmt(result.perUnitRisk)}</td></tr>
                  )}
                  {result.qtyByRisk !== null && (
                    <tr><th scope="row">Units allowed by risk cap</th><td className="num mono">{formatNumber(result.qtyByRisk)}</td></tr>
                  )}
                  {result.qtyByCapital !== null && (
                    <tr><th scope="row">Units allowed by capital ({fmt(num(inputs.capital) ?? 0)})</th><td className="num mono">{formatNumber(result.qtyByCapital)}</td></tr>
                  )}
                  {lotQty !== null && (
                    <tr><th scope="row">Units in whole lots</th><td className="num mono">{formatNumber(lotQty)}</td></tr>
                  )}
                  {result.positionValue !== null && (
                    <tr><th scope="row">Full outlay at entry</th><td className="num mono">{fmt(result.positionValue)}</td></tr>
                  )}
                </tbody>
              </table>
              <p className="page-sub calc-note">
                {isLotInstrument
                  ? lotQty === 0
                    ? 'Not enough capital for even one full lot at this entry price — reduce the entry or increase capital.'
                    : 'Whole lots only; the lot count is rounded down so planned outlay never exceeds capital at entry.'
                  : result.qtyByRisk !== null
                    ? 'Size respects both caps: it never risks more than your risk % and never costs more than capital (charges excluded).'
                    : 'Sized by capital alone — add a stop loss on the losing side of entry to cap risk per trade.'}
              </p>
            </>
          ) : (
            <p className="page-sub">
              Enter capital and entry price{result.riskAmount === null && num(inputs.stopLoss) === null ? ' (and a stop loss to cap risk)' : ''} to see how many shares or lots fit.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
