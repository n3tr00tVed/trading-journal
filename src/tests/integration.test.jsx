import { useEffect } from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useTrades } from '../hooks/useTrades.js';
import SettingsPage from '../components/SettingsPage.jsx';
import { downloadFile, toCsv, toJsonExport } from '../lib/export.js';
import { STORAGE_KEY } from '../lib/storage.js';

// ---- Real composed UI: a shell that uses the REAL useTrades hook and the
// ---- REAL SettingsPage. No fakes anywhere except a mutable ref handle so
// ---- the test can drive the hook API directly.
const apiRef = { current: null };

function TestShell() {
  const api = useTrades();
  useEffect(() => {
    apiRef.current = api; // expose the latest hook API to the test after each render
  }, [api]);
  return (
    <SettingsPage
      stats={api.stats}
      trades={api.trades}
      importTrades={api.importTrades}
      restoreTrades={api.restoreTrades}
      clearAll={api.clearAll}
    />
  );
}

const OPEN = {
  id: 'open-1',
  symbol: 'MSFT',
  market: 'stocks',
  direction: 'short',
  entryPrice: 200,
  quantity: 1,
  entryDate: '2026-01-05',
  exitPrice: null,
};

const CLOSED = {
  id: 'closed-1',
  symbol: 'AAPL',
  market: 'stocks',
  direction: 'long',
  entryPrice: 100,
  exitPrice: 110,
  quantity: 2,
  entryDate: '2026-01-02',
  exitDate: '2026-01-03',
  fees: 1,
  strategy: 'ORB',
  notes: 'textbook fill',
};

function addTrades(...trades) {
  // Separate act() calls on purpose: useTrades.addTrade closes over the
  // current list, so two calls within the same tick would overwrite each
  // other (see defect report).
  trades.forEach((trade) => {
    act(() => {
      apiRef.current.addTrade(trade);
    });
  });
}

function jsonFile(payload) {
  return new File([JSON.stringify(payload)], 'import.json', { type: 'application/json' });
}

beforeEach(() => {
  window.localStorage.clear();
});

// jsdom has no object URL support; the download click test needs fakes.
// Capture originals before any test replaces them.
const originalCreate = URL.createObjectURL;
const originalRevoke = URL.revokeObjectURL;
afterAll(() => {
  if (typeof originalCreate === 'function') {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: originalCreate });
  } else {
    try { delete URL.createObjectURL; } catch { /* noop */ }
  }
  if (typeof originalRevoke === 'function') {
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: originalRevoke });
  } else {
    try { delete URL.revokeObjectURL; } catch { /* noop */ }
  }
});

describe('export affordances', () => {
  it('export buttons are disabled with a visible reason while the journal is empty', async () => {
    render(<TestShell />);
    const csvBtn = screen.getByRole('button', { name: 'Export CSV' });
    const jsonBtn = screen.getByRole('button', { name: 'Export JSON' });
    expect(csvBtn).toBeDisabled();
    expect(jsonBtn).toBeDisabled();
    expect(screen.getByText(/Nothing to export yet/)).toBeVisible();
    expect(screen.getByText(/Data stays on this device/)).toBeVisible(); // privacy statement
  });

  it('export buttons flip to enabled once a trade exists', () => {
    render(<TestShell />);
    addTrades(CLOSED);
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Export JSON' })).toBeEnabled();
  });

  it('clicking the export buttons produces real CSV/JSON download payloads', async () => {
    const user = userEvent.setup();
    const created = [];
    const revoked = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: (blob) => {
        created.push(blob);
        return `blob:f${created.length}`;
      },
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoked });

    const clickedAnchors = [];
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function capture() {
        clickedAnchors.push(this);
      });

    render(<TestShell />);
    addTrades(OPEN, CLOSED);

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));
    expect(clickSpy).toHaveBeenCalled();
    expect(clickedAnchors.at(-1).download).toBe('trading-journal.csv');
    expect(clickedAnchors.at(-1).href).toBe('blob:f1');
    let blob = created.at(-1);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/csv');

    await user.click(screen.getByRole('button', { name: 'Export JSON' }));
    expect(clickedAnchors.at(-1).download).toBe('trading-journal.json');
    expect(clickedAnchors.at(-1).href).toBe('blob:f2');
    blob = created.at(-1);
    expect(blob.type).toBe('application/json');
  });
});

describe('full persistence round-trip: add → export → wipe → restore → restart', () => {
  it('survives a simulated restart with identical stats', () => {
    // 1. Real hook adds an open and a closed trade (with fees).
    const { unmount: wipeUnmount } = render(<TestShell />);
    addTrades(OPEN, CLOSED);
    const statsBefore = { ...apiRef.current.stats };
    expect(statsBefore.netPnl).toBe(19); // (110-100)*2 - 1 fees

    // 2. Export via our pure libs (download clicks are covered above).
    const json = toJsonExport(apiRef.current.trades);
    const csv = toCsv(apiRef.current.trades);
    expect(csv.split('\n')[0]).toBe(
      'id,symbol,market,direction,entryPrice,exitPrice,quantity,entryDate,exitDate,fees,strategy,setup,notes,createdAt',
    );
    expect(csv).toContain('open-1,MSFT,stocks,short,200,,1,2026-01-05,,');

    // 3. User wipes via the real inline-confirm danger zone.
    act(() => {
      apiRef.current.clearAll();
    });
    expect(screen.getByText('Your journal is empty.')).toBeVisible();
    wipeUnmount();

    // 4. "Restart": fresh hook over the (emptied) localStorage.
    render(<TestShell />);
    expect(apiRef.current.trades).toEqual([]);

    // 5. Restore from the exported JSON, then check stats survived.
    act(() => {
      apiRef.current.restoreTrades(JSON.parse(json));
    });
    const statsAfterRestore = { ...apiRef.current.stats };
    expect(statsAfterRestore.netPnl).toBe(statsBefore.netPnl);
    expect(statsAfterRestore.closed).toBe(statsBefore.closed);
    expect(statsAfterRestore.open).toBe(statsBefore.open);
    expect(statsAfterRestore.totalFees).toBe(statsBefore.totalFees);
    expect(statsAfterRestore.winRate).toBe(statsBefore.winRate);

    // 6. Second "restart": the restored data must come back from storage.
    const { unmount } = render(<TestShell />);
    expect(apiRef.current.trades).toHaveLength(2);
    expect(apiRef.current.stats.netPnl).toBe(statsBefore.netPnl);
    unmount();
  });
});

describe('merge import through the real file input', () => {
  it('imports new trades, skips duplicates/invalid records, and reports in the live region', async () => {
    const user = userEvent.setup();
    render(<TestShell />);
    addTrades(CLOSED);

    const file = jsonFile([
      { ...CLOSED, exitPrice: 999 }, // duplicate id
      { ...OPEN, id: 'new-1' }, // valid
      { symbol: 'BAD', entryPrice: -1, quantity: 0, entryDate: 'nope' }, // invalid
    ]);
    await user.upload(screen.getByLabelText('Choose JSON file'), file);

    expect(await screen.findByText(/Imported 1 trade, skipped 2\./)).toBeVisible();
    expect(screen.getByText('Record 1 (AAPL) already exists and was skipped.')).toBeVisible();
    expect(apiRef.current.trades).toHaveLength(2);
    expect(apiRef.current.trades.find((t) => t.id === CLOSED.id).exitPrice).toBe(110); // not overwritten
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY))).toHaveLength(2);
  });

  it('shows the parse error for a broken file without touching stored data', async () => {
    const user = userEvent.setup();
    render(<TestShell />);
    addTrades(CLOSED);

    const broken = new File(['{definitely not json'], 'broken.json', { type: 'application/json' });
    await user.upload(screen.getByLabelText('Choose JSON file'), broken);

    expect(await screen.findByText(/^Invalid JSON:/)).toBeVisible();
    expect(apiRef.current.trades).toHaveLength(1);
  });
});

describe('replace-all flow', () => {
  it('requires confirmation; canceling leaves data untouched', async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<TestShell />);
    addTrades(CLOSED, OPEN);

    await user.upload(screen.getByLabelText('Replace all trades with a JSON file'), jsonFile([CLOSED]));
    expect(confirmSpy).toHaveBeenCalledWith('Replace all 2 trades with the imported file?');
    expect(await screen.findByText('Replace canceled — your data is unchanged.')).toBeVisible();
    expect(apiRef.current.trades).toHaveLength(2);
  });

  it('on confirm it replaces the whole journal', async () => {
    const user = userEvent.setup();
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<TestShell />);
    addTrades(CLOSED, OPEN);

    await user.upload(screen.getByLabelText('Replace all trades with a JSON file'), jsonFile([{ ...OPEN, id: 'only-1' }]));
    expect(await screen.findByText('Journal replaced with 1 trade.')).toBeVisible();
    expect(apiRef.current.trades.map((t) => t.id)).toEqual(['only-1']);
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)).map((t) => t.id)).toEqual(['only-1']);
  });
});

describe('danger zone: two-step inline delete', () => {
  it('first click asks "Really delete all?", No cancels, clearAll only after Yes', async () => {
    const user = userEvent.setup();
    render(<TestShell />);
    addTrades(CLOSED, OPEN);

    await user.click(screen.getByRole('button', { name: 'Delete all trades' }));
    expect(screen.getByText(/Really delete all\?/)).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'No, keep them' }));
    expect(screen.queryByText(/Really delete all\?/)).not.toBeInTheDocument();
    expect(apiRef.current.trades).toHaveLength(2); // intact

    await user.click(screen.getByRole('button', { name: 'Delete all trades' }));
    await user.click(screen.getByRole('button', { name: 'Yes, delete all' }));

    expect(screen.getByText('Your journal is empty.')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Delete all trades' })).toBeDisabled();
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY))).toEqual([]);
  });
});

describe('downloadFile guard', () => {
  it('reports failure without a browser document', () => {
    vi.stubGlobal('document', undefined);
    expect(downloadFile('f.txt', 'x', 'text/plain')).toBe(false);
  });
});
