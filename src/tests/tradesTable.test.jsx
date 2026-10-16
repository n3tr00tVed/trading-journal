import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TradesTable from '../components/TradesTable.jsx';

function trade(fields) {
  return {
    id: 't-1',
    symbol: 'TEST',
    market: 'stocks',
    currency: 'INR',
    direction: 'long',
    entryPrice: 100,
    quantity: 1,
    entryDate: '2026-01-02',
    exitDate: null,
    exitPrice: null,
    fees: 0,
    strategy: '',
    setup: '',
    notes: '',
    hasScreenshot: false,
    createdAt: '2026-01-02T10:00:00.000Z',
    ...fields,
  };
}

afterEach(cleanup);

describe('TradesTable — closed trades are locked from editing', () => {
  it('enables Edit for open trades and disables it for closed ones', async () => {
    const onEdit = vi.fn();
    const user = userEvent.setup();
    render(
      <TradesTable
        trades={[
          trade({ id: 'open-1', symbol: 'OPENTRD' }),
          trade({ id: 'shut-1', symbol: 'SHUTTRD', exitPrice: 105, exitDate: '2026-01-03' }),
        ]}
        onEdit={onEdit}
      />,
    );

    const openEdit = screen.getByRole('button', { name: 'Edit OPENTRD trade' });
    const closedEdit = screen.getByRole('button', { name: 'Edit SHUTTRD trade (locked: trade is closed)' });
    expect(openEdit).toBeEnabled();
    expect(closedEdit).toBeDisabled();
    expect(closedEdit).toHaveAttribute('title', expect.stringMatching(/locked/i));

    await user.click(openEdit);
    expect(onEdit).toHaveBeenCalledTimes(1);
    expect(onEdit.mock.calls[0][0].id).toBe('open-1');
  });

  it('delete stays available on closed trades (the sanctioned correction path)', async () => {
    const onDelete = vi.fn();
    const user = userEvent.setup();
    render(
      <TradesTable
        trades={[trade({ id: 'shut-2', symbol: 'SHUTTRD', exitPrice: 105, exitDate: '2026-01-03' })]}
        onDelete={onDelete}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Delete SHUTTRD trade' }));
    expect(await screen.findByText(/This permanently removes the trade/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete trade' }));
    expect(onDelete).toHaveBeenCalledWith('shut-2');
  });
});
