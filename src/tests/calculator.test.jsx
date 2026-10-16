import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { lotSizeFor, LOT_SIZES } from '../lib/lotSizes.js';
import { positionSizing } from '../lib/calculator.js';
import CalculatorPage from '../components/CalculatorPage.jsx';
import { CurrencyContext } from '../hooks/useCurrency.js';

afterEach(() => {
  window.localStorage.clear();
});

describe('lot sizes (Indian F&O)', () => {
  it('indexes trade in standard lots; cash stocks are single-share lots', () => {
    expect(LOT_SIZES.NIFTY).toBeGreaterThan(1);
    expect(lotSizeFor('NIFTY', 'futures')).toBe(LOT_SIZES.NIFTY);
    expect(lotSizeFor('TCS', 'stocks')).toBe(1);
  });

  it('tolerates expiry-suffixed symbols', () => {
    expect(lotSizeFor('NIFTY28OCT2625000CE', 'options')).toBe(LOT_SIZES.NIFTY);
    expect(lotSizeFor('BANKNIFTY', 'futures')).toBe(LOT_SIZES.BANKNIFTY);
  });

  it('unknown F&O symbols fall back to lot size 1 (user overrides)', () => {
    expect(lotSizeFor('MYSTERYCONTRACT', 'futures')).toBe(1);
  });
});

describe('positionSizing', () => {
  it('the ₹25,000 example: 1% risk, entry 812.50, stop 800 → 20 shares', () => {
    const r = positionSizing({
      capital: 25000,
      riskPercent: 1,
      entryPrice: 812.5,
      stopLoss: 800,
      direction: 'long',
    });
    expect(r.ok).toBe(true);
    expect(r.riskAmount).toBe(250);
    expect(r.perUnitRisk).toBe(12.5);
    expect(r.qtyByRisk).toBe(20);
    expect(r.qtyByCapital).toBe(Math.floor(25000 / 812.5));
    expect(r.recommendedQty).toBe(20); // risk cap binds
    expect(r.lots).toBeNull();
    expect(r.positionValue).toBe(20 * 812.5);
  });

  it('skip lots to floor rounds down: one-lot too big → 0 lots, not a negative', () => {
    const r = positionSizing({
      capital: 1000,
      riskPercent: 100,
      entryPrice: 80,
      stopLoss: 60,
      direction: 'long',
      lotSize: 75,
    });
    expect(r.qtyByRisk).toBe(1000 / 20);
    expect(r.lots).toBe(0);
  });

  it('short trades size with stop above entry', () => {
    const r = positionSizing({
      capital: 25000,
      riskPercent: 2,
      entryPrice: 500,
      stopLoss: 520,
      direction: 'short',
    });
    expect(r.perUnitRisk).toBe(20);
    expect(r.qtyByRisk).toBe(Math.floor(500 / 20));
  });

  it('a stop on the wrong side yields no risk-based size instead of a bogus number', () => {
    const r = positionSizing({
      capital: 25000,
      riskPercent: 1,
      entryPrice: 500,
      stopLoss: 480,
      direction: 'short',
    });
    expect(r.qtyByRisk).toBeNull();
  });

  it('short stop higher than entry is invalid by long convention check', () => {
    // Long with stop above entry → no risk cap, affordability still answers.
    const r = positionSizing({
      capital: 25000,
      riskPercent: 1,
      entryPrice: 500,
      stopLoss: 510,
      direction: 'long',
    });
    expect(r.qtyByRisk).toBeNull();
    expect(r.qtyByCapital).toBe(50);
    expect(r.recommendedQty).toBe(50);
  });

  it('missing/invalid inputs are null-safe (no NaN anywhere)', () => {
    const r = positionSizing({ capital: null, riskPercent: null, entryPrice: null, stopLoss: null });
    expect(r.ok).toBe(false);
    expect(Number.isNaN(r.qtyByCapital)).toBe(false);
    expect(r.recommendedQty).toBeNull();

    const r2 = positionSizing({ capital: 90000, riskPercent: 0, entryPrice: 100 });
    expect(r2.ok).toBe(true);
    expect(r2.riskAmount).toBeNull();
    expect(r2.qtyByCapital).toBe(900);
  });

  it('capital cap binds when risk cap is looser', () => {
    const r = positionSizing({
      capital: 3000,
      riskPercent: 50,
      entryPrice: 100,
      stopLoss: 10, // per-unit risk 90; risk amount 1500 → 16 shares
      direction: 'long',
      lotSize: 1,
    });
    expect(r.riskAmount).toBe(1500);
    expect(r.qtyByRisk).toBe(16);
    expect(r.qtyByCapital).toBe(30);
    expect(r.recommendedQty).toBe(16); // tighter risk cap binds
  });
});

describe('CalculatorPage (Indian market UI)', () => {
  const renderPage = (capital = null) =>
    render(
      <CurrencyContext.Provider value={{ currency: 'INR', setCurrency: () => {} }}>
        <CalculatorPage capital={capital} />
      </CurrencyContext.Provider>,
    );

  it('answers the ₹25,000 stock example end to end', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage(25000);

    const capitalInput = screen.getByLabelText('Capital (₹)');
    expect(capitalInput).toHaveValue(25000); // prefilled from saved capital

    await user.type(screen.getByLabelText('Entry price (₹)'), '812.50');
    await user.type(screen.getByLabelText('Stop loss (₹)'), '800');

    expect(screen.getByText('Recommended size').parentElement.textContent).toMatch(/20 shares/);
    expect(screen.getByText('Risk amount (1%)').nextElementSibling.textContent).toContain('250');
    expect(screen.getByText(/Units allowed by risk cap/).nextElementSibling.textContent).toContain('20');
    unmount();
  });

  it('auto-fills NIFTY lot size and reports whole lots', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage(100000);

    await user.type(screen.getByLabelText('Symbol'), 'NIFTY');
    await user.selectOptions(screen.getByLabelText('Instrument'), 'futures');
    await user.type(screen.getByLabelText('Entry price (₹)'), '1200');
    await user.type(screen.getByLabelText('Stop loss (₹)'), '1180');

    // risk 1% of 100k = 1000; per-unit 20 → 50 units → 0 lots of 75
    expect(screen.getByText('Recommended size').parentElement.textContent).toMatch(
      /0 lots \(0 units @ 75\/lot\)/,
    );
    unmount();
  });

  it('blocks impossible stops with an honest error', async () => {
    const user = userEvent.setup();
    const { unmount } = renderPage(25000);
    await user.type(screen.getByLabelText('Entry price (₹)'), '100');
    await user.type(screen.getByLabelText('Stop loss (₹)'), '110');
    expect(screen.getByRole('alert')).toHaveTextContent(/stop loss must be below the entry/i);
    unmount();
  });
});
