/**
 * Position-size calculator — pure math, no React.
 *
 * Given capital, risk-per-trade %, entry/stop prices, direction and lot
 * size, answer: how many shares (or lots) can this trade be sized at?
 *
 * Two independent caps are computed:
 *   risk-based   : qty = floor( riskAmount / |entry - stop| )
 *   capital-based: qty = floor( capital / entry )      (full-outlay, cash)
 * The recommended size is the smaller of the two (a trade over-either cap
 * breaks the rule that cap enforces). Lot count = floor(qty / lotSize).
 */

import { DEFAULT_LOT_SIZE } from './lotSizes.js';

function positiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * @param {object} p
 * @param {number} p.capital   account capital (>= 0)
 * @param {number} p.riskPercent risk per trade as a percent (0 < x <= 100)
 * @param {number} p.entryPrice   > 0
 * @param {number|null} p.stopLoss > 0, on the loss side of entry for the direction
 * @param {'long'|'short'} p.direction
 * @param {number} [p.lotSize]  >= 1 (default 1 = cash-market shares)
 * @returns sizing result; all numeric fields are null-safe
 */
export function positionSizing({ capital, riskPercent, entryPrice, stopLoss, direction = 'long', lotSize }) {
  const lot = Number.isFinite(lotSize) && lotSize >= 1 ? Math.floor(lotSize) : null;
  const usableLot = lot ?? DEFAULT_LOT_SIZE;

  const cap = typeof capital === 'number' && Number.isFinite(capital) && capital >= 0 ? capital : null;
  const entry = positiveNumber(entryPrice);
  const risk = typeof riskPercent === 'number' && Number.isFinite(riskPercent) && riskPercent > 0 ? riskPercent : null;

  if (entry === null) {
    return {
      ok: false,
      reason: entry === null && !positiveNumber(entryPrice) ? 'invalid-entry' : 'invalid-entry',
      riskAmount: null, perUnitRisk: null, qtyByRisk: null,
      qtyByCapital: null, recommendedQty: null, lots: null,
      lotSize: usableLot, positionValue: null,
    };
  }

  const riskAmount = cap !== null && risk !== null ? round2((cap * risk) / 100) : null;

  // Stop must sit on the losing side of the entry, otherwise it's a data error.
  let perUnitRisk = null;
  let qtyByRisk = null;
  if (positiveNumber(stopLoss) && riskAmount !== null) {
    const lossPerUnit = direction === 'short' ? stopLoss - entry : entry - stopLoss;
    if (direction === 'short' ? stopLoss <= entry : stopLoss >= entry) {
      qtyByRisk = null;
    } else {
      perUnitRisk = Math.abs(lossPerUnit);
      qtyByRisk = perUnitRisk > 0 ? Math.floor(riskAmount / perUnitRisk) : null;
    }
  }

  const qtyByCapital = cap !== null ? Math.floor(cap / entry) : null;

  let recommendedQty = null;
  const caps = [qtyByRisk, qtyByCapital].filter((n) => typeof n === 'number' && n >= 0);
  if (caps.length === 2) {
    recommendedQty = Math.min(qtyByRisk, qtyByCapital);
  } else if (caps.length === 1) {
    recommendedQty = caps[0];
  }

  const lots = recommendedQty !== null ? Math.floor(recommendedQty / usableLot) : null;

  return {
    ok: true,
    riskAmount,
    perUnitRisk: perUnitRisk === null ? null : round2(perUnitRisk),
    qtyByRisk,
    qtyByCapital,
    recommendedQty,
    lots: usableLot > 1 ? lots : null,
    lotSize: usableLot,
    positionValue: recommendedQty !== null ? round2(recommendedQty * entry) : null,
  };
}

function round2(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
