import { afterEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  CAPITAL_STORAGE_KEY,
  loadCapital,
  parseCapitalInput,
  saveCapital,
} from '../lib/capitalStorage.js';
import SettingsPage from '../components/SettingsPage.jsx';
import Dashboard from '../components/Dashboard.jsx';

afterEach(() => {
  window.localStorage.clear();
});

describe('capital storage', () => {
  it('round-trips a saved capital value', () => {
    expect(saveCapital(25000)).toBe(true);
    expect(loadCapital()).toBe(25000);
  });

  it('rejects negative and non-finite values without writing', () => {
    expect(saveCapital(-5)).toBe(false);
    expect(loadCapital()).toBeNull();
    expect(window.localStorage.getItem(CAPITAL_STORAGE_KEY)).toBeNull();
  });

  it('clears stored capital with null', () => {
    saveCapital(1000);
    expect(saveCapital(null)).toBe(true);
    expect(loadCapital()).toBeNull();
  });

  it('ignores corrupt or wrong-type stored data', () => {
    window.localStorage.setItem(CAPITAL_STORAGE_KEY, '"not-a-number"');
    expect(loadCapital()).toBeNull();
    window.localStorage.setItem(CAPITAL_STORAGE_KEY, '{broken');
    expect(loadCapital()).toBeNull();
  });

  it('parses user input: numbers, $ and commas, empty to unset', () => {
    expect(parseCapitalInput('25000')).toEqual({ ok: true, value: 25000 });
    expect(parseCapitalInput('$12,500.50')).toEqual({ ok: true, value: 12500.5 });
    expect(parseCapitalInput('')).toEqual({ ok: true, value: null });
    expect(parseCapitalInput('-10').ok).toBe(false);
    expect(parseCapitalInput('abc').ok).toBe(false);
  });
});

describe('capital in Settings and Dashboard', () => {
  it('saves capital from Settings and shows the resulting note', async () => {
    const user = userEvent.setup();
    render(
      <SettingsPage
        stats={{ total: 0, open: 0 }}
        trades={[]}
        importTrades={() => ({ ok: true, added: 0, skipped: 0, errors: [] })}
        restoreTrades={() => 0}
        clearAll={() => {}}
        onSaveCapital={(v) => saveCapital(v)}
      />,
    );
    await user.type(screen.getByLabelText('Capital (USD)'), '25000');
    await user.click(screen.getByRole('button', { name: 'Save capital' }));
    expect(loadCapital()).toBe(25000);
    expect(screen.getByText('Capital saved: $25,000.00')).toBeInTheDocument();
  });

  it('shows return-on-capital on the dashboard instead of the placeholder', () => {
    render(
      <Dashboard
        stats={{
          total: 1, open: 0, closed: 1, netPnl: 500, winRate: 100, profitFactor: Infinity,
          wins: 1, losses: 0, avgWin: 500, avgLoss: null,
        }}
        trades={[]}
        capital={10000}
      />,
    );
    expect(screen.getByText('Account capital')).toBeInTheDocument();
    expect(screen.getByText('Return on capital: +5.0%')).toBeInTheDocument();
  });

  it('dashboard shows the Settings hint when capital is unset', () => {
    render(
      <Dashboard
        stats={{ total: 0, open: 0, closed: 0, netPnl: 0, winRate: null, profitFactor: null, wins: 0, losses: 0, avgWin: null, avgLoss: null }}
        trades={[]}
        capital={null}
      />,
    );
    expect(screen.getByText('Set it in Settings')).toBeInTheDocument();
  });
});
