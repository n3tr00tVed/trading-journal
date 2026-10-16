import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import Sidebar from '../components/Sidebar.jsx';
import CalculatorPage from '../components/CalculatorPage.jsx';
import TradesPage from '../components/TradesPage.jsx';
import { CurrencyContext } from '../hooks/useCurrency.js';
import { createTrade } from '../lib/schema.js';
import { loadCurrency, saveCurrency } from '../lib/settingsStorage.js';

afterEach(cleanup);

describe('sidebar market switch', () => {
  it('switches between India (₹) and US ($) and persists', async () => {
    expect(loadCurrency()).toBe('INR');
    expect(saveCurrency('USD')).toBe(true);
    expect(loadCurrency()).toBe('USD');
    saveCurrency('INR');

    const onCurrencyChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Sidebar view="dashboard" onNavigate={() => {}} currency="INR" onCurrencyChange={onCurrencyChange} />,
    );

    const select = screen.getByLabelText('Trading market');
    expect(select).toHaveValue('INR');
    await user.selectOptions(select, 'USD');
    expect(onCurrencyChange).toHaveBeenCalledWith('USD');
  });
});

describe('calculator labels follow the market currency', () => {
  it('shows $ labels in US mode and ₹ in India mode', () => {
    const page = (currency) =>
      render(
        <CurrencyContext.Provider value={{ currency, setCurrency: () => {} }}>
          <CalculatorPage capital={null} />
        </CurrencyContext.Provider>,
      );

    page('USD');
    expect(screen.getByLabelText('Capital ($)')).toBeInTheDocument();
    expect(screen.getByLabelText('Entry price ($)')).toBeInTheDocument();
    cleanup();

    page('INR');
    expect(screen.getByLabelText('Capital (₹)')).toBeInTheDocument();
  });
});

describe('trades page market filter', () => {
  const trades = [
    createTrade({ symbol: 'NIFTY', market: 'futures', entryPrice: 100, quantity: 1 }),
    createTrade({ symbol: 'AAPL', market: 'stocks', entryPrice: 200, quantity: 2 }),
    createTrade({ symbol: 'BTCUSDT', market: 'crypto', entryPrice: 50000, quantity: 0.01 }),
  ];

  it('filters by market segment and clears back to all', async () => {
    const user = userEvent.setup();
    const clearInvoked = vi.fn();
    render(
      <CurrencyContext.Provider value={{ currency: 'INR', setCurrency: () => {} }}>
        <TradesPage trades={trades} onAdd={() => {}} onEdit={() => {}} onDelete={clearInvoked} />
      </CurrencyContext.Provider>,
    );

    expect(screen.getByText(/3 trades shown/)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Market'), 'futures');
    expect(screen.getByText(/1 trade shown/)).toBeInTheDocument();
    expect(screen.queryByText(/3 trades shown/)).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Market'), 'all');
    expect(screen.getByText(/3 trades shown/)).toBeInTheDocument();
  });

  it('shows the empty-filter state when no trades exist in a segment', async () => {
    const user = userEvent.setup();
    render(
      <CurrencyContext.Provider value={{ currency: 'INR', setCurrency: () => {} }}>
        <TradesPage trades={trades} onAdd={() => {}} onEdit={() => {}} onDelete={() => {}} />
      </CurrencyContext.Provider>,
    );
    await user.selectOptions(screen.getByLabelText('Market'), 'forex');
    expect(screen.getByText('No trades match your filters')).toBeInTheDocument();
  });
});
