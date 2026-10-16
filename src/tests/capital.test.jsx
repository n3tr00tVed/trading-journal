import { beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CAPITALS_STORAGE_KEY,
  loadCapitals,
  loadCapital,
  parseCapitalInput,
  saveCapitals,
} from '../lib/capitalStorage.js';
import SettingsPage from '../components/SettingsPage.jsx';
import Dashboard from '../components/Dashboard.jsx';
import { CurrencyContext } from '../hooks/useCurrency.js';

beforeEach(() => {
  window.localStorage.clear();
});

describe('capital storage (per market)', () => {
  it('round-trips separate India and US capitals', () => {
    expect(saveCapitals({ INR: 25000, USD: 12000 })).toBe(true);
    const map = loadCapitals();
    expect(map.INR).toBe(25000);
    expect(map.USD).toBe(12000);
    expect(loadCapital('INR')).toBe(25000);
    expect(loadCapital('USD')).toBe(12000);
  });

  it('defaults to INR when no currency is given (legacy-friendly)', () => {
    saveCapitals({ INR: 9500 });
    expect(loadCapital()).toBe(9500);
  });

  it('migrates a legacy v1 single capital into the INR bucket', () => {
    window.localStorage.setItem('trading-journal:capital:v1', JSON.stringify(18000));
    expect(loadCapitals().INR).toBe(18000);
    expect(loadCapitals().USD).toBeNull();
  });

  it('invalid entries are ignored while valid ones persist', () => {
    saveCapitals({ INR: 1000, USD: 500 });
    saveCapitals({ INR: -5, USD: 7000 });
    const map = loadCapitals();
    expect(map.INR).toBe(1000); // invalid keeps previous value
    expect(map.USD).toBe(7000);
    expect(loadCapital('INR')).toBe(1000);
  });

  it('ignores corrupt or wrong-type stored data', () => {
    window.localStorage.setItem(CAPITALS_STORAGE_KEY, '"not-a-map"');
    expect(loadCapitals()).toEqual({ INR: null, USD: null });
    window.localStorage.setItem(CAPITALS_STORAGE_KEY, '{broken');
    expect(loadCapitals()).toEqual({ INR: null, USD: null });
  });

  it('parses user input: numbers, ₹/$-symbols and commas, empty to unset', () => {
    expect(parseCapitalInput('25000')).toEqual({ ok: true, value: 25000 });
    expect(parseCapitalInput('₹12,500.50')).toEqual({ ok: true, value: 12500.5 });
    expect(parseCapitalInput('')).toEqual({ ok: true, value: null });
    expect(parseCapitalInput('-10').ok).toBe(false);
    expect(parseCapitalInput('abc').ok).toBe(false);
  });
});

describe('capitals in Settings', () => {
  it('saves both markets at once and reports the result', async () => {
    const user = userEvent.setup();
    render(
      <SettingsPage
        stats={{ total: 0, open: 0 }}
        trades={[]}
        importTrades={() => ({ ok: true, added: 0, skipped: 0, errors: [] })}
        restoreTrades={() => 0}
        clearAll={() => {}}
        capitals={{ INR: null, USD: null }}
        onSaveCapitals={saveCapitals}
      />,
    );
    await user.type(screen.getByLabelText('India capital (₹ INR)'), '25000');
    await user.type(screen.getByLabelText('US capital ($ USD)'), '12000');
    await user.click(screen.getByRole('button', { name: 'Save capitals' }));

    expect(loadCapitals()).toEqual({ INR: 25000, USD: 12000 });
    expect(screen.getByText(/Capitals saved — India ₹25,000.00 · US \$12,000.00/)).toBeInTheDocument();
  });

  it('deleting the contents of an input unsets that market only', async () => {
    const user = userEvent.setup();
    saveCapitals({ INR: 1000, USD: 500 });
    render(
      <SettingsPage
        stats={{ total: 0, open: 0 }}
        trades={[]}
        importTrades={() => ({ ok: true, added: 0, skipped: 0, errors: [] })}
        restoreTrades={() => 0}
        clearAll={() => {}}
        capitals={{ INR: 1000, USD: 500 }}
        onSaveCapitals={saveCapitals}
      />,
    );
    const inrInput = screen.getByLabelText('India capital (₹ INR)');
    await user.clear(inrInput);
    await user.click(screen.getByRole('button', { name: 'Save capitals' }));
    const map = loadCapitals();
    expect(map.INR).toBeNull();
    expect(map.USD).toBe(500);
  });
});

describe('dashboard uses the capital for the chosen market', () => {
  it('shows the India capital in INR mode and the unset hint', () => {
    const baseStats = { total: 0, open: 0, closed: 0, netPnl: 0, winRate: null, profitFactor: null, wins: 0, losses: 0, avgWin: null, avgLoss: null };
    const renderIn = (currency, capital) =>
      render(
        <CurrencyContext.Provider value={{ currency, setCurrency: () => {} }}>
          <Dashboard stats={baseStats} trades={[]} capital={capital} />
        </CurrencyContext.Provider>,
      );

    renderIn('INR', 25000);
    expect(screen.getByText('₹25,000.00')).toBeInTheDocument();
    cleanup();
    renderIn('USD', null);
    expect(screen.getByText('Set it in Settings')).toBeInTheDocument();
  });

  it('shows return-on-capital from the market-specific capital', () => {
    render(
      <CurrencyContext.Provider value={{ currency: 'USD', setCurrency: () => {} }}>
        <Dashboard
          stats={{ total: 1, open: 0, closed: 1, netPnl: 500, winRate: 100, profitFactor: Infinity, wins: 1, losses: 0, avgWin: 500, avgLoss: null }}
          trades={[]}
          capital={10000}
        />
      </CurrencyContext.Provider>,
    );
    expect(screen.getByText('Return on capital: +5.0%')).toBeInTheDocument();
  });
});
