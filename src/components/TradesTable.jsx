/**
 * TradesTable — data table of trades with Edit/Delete actions and a
 * ConfirmDialog for destructive deletes.
 *
 * Currency: every money cell renders in the trade's own native tag stored
 * on the record (`trade.currency`) — an AAPL trade shows $, a NIFTY trade
 * shows ₹, row by row, regardless of which market the sidebar has active.
 *
 * Props:
 *   trades    Trade[] — already filtered/sorted by the caller
 *   onEdit    (trade) => void
 *   onDelete  (tradeId) => void — called only after confirm
 */

import { useState } from 'react';
import {
  tradeInvested,
  tradeLeverageLabel,
  tradeNetPnl,
  tradeReturnOnInvested,
} from '../lib/calculations.js';
import { isTradeOpen } from '../lib/schema.js';
import { formatCurrency, formatDate, formatNumber, signedFormatCurrency } from '../lib/format.js';
import ConfirmDialog from './ConfirmDialog.jsx';

function capitalize(value) {
  return typeof value === 'string' && value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

/** Net P&L cell: '—' + Open badge for open trades, native-currency signed amount + return-on-invested otherwise. */
function NetPnlCell({ trade }) {
  if (isTradeOpen(trade)) {
    return (
      <td className="mono num">
        <span aria-hidden="true">—</span>
        <span className="badge badge-open">Open</span>
      </td>
    );
  }
  const net = tradeNetPnl(trade);
  const roi = tradeReturnOnInvested(trade);
  return (
    <td className={`mono num ${net > 0 ? 'pnl-pos' : net < 0 ? 'pnl-neg' : 'pnl-flat'}`}>
      {signedFormatCurrency(net, trade.currency)}
      {roi != null && (
        <span className="pnl-sub" aria-label="Return on invested capital (margin)">
          {' '}
          {`${roi > 0 ? '+' : ''}${roi}% on invested`}
        </span>
      )}
    </td>
  );
}

export default function TradesTable({ trades, onEdit, onDelete, onViewScreenshot }) {
  const [pendingDelete, setPendingDelete] = useState(null);

  function confirmDelete() {
    if (pendingDelete && typeof onDelete === 'function') onDelete(pendingDelete.id);
    setPendingDelete(null);
  }

  return (
    <>
      <section className="card">
        <table className="trades-table">
          <caption className="visually-hidden">
            Trades matching the current filters. Amounts are shown in each
            trade's own market currency. Use the Edit button in each row to
            modify a trade.
          </caption>
          <thead>
            <tr>
              <th scope="col">Symbol</th>
              <th scope="col">Market</th>
              <th scope="col">Direction</th>
              <th scope="col" className="num">Qty</th>
              <th scope="col" className="num">Entry price</th>
              <th scope="col" className="num">Invested</th>
              <th scope="col" className="num">Exit price</th>
              <th scope="col" className="num">Net P&amp;L</th>
              <th scope="col">Strategy</th>
              <th scope="col">Entry date</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {trades.map((trade) => {
              const open = isTradeOpen(trade);
              const leverageTag = tradeLeverageLabel(trade);
              return (
                <tr key={trade.id}>
                  <td className="mono">
                    {trade.symbol}
                    {trade.hasScreenshot ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm image-flag"
                        aria-label={`View screenshot of ${trade.symbol} trade`}
                        title="View screenshot"
                        onClick={() => onViewScreenshot?.(trade)}
                      >
                        📷
                      </button>
                    ) : null}
                  </td>
                  <td>{capitalize(trade.market)}</td>
                  <td>
                    <span className={`badge ${trade.direction === 'long' ? 'badge-pos' : 'badge-neg'}`}>
                      {trade.direction.toUpperCase()}
                    </span>
                  </td>
                  <td className="mono num">
                    {formatNumber(trade.quantity)}
                    {leverageTag && (
                      <span className="leverage-tag" title={`Leveraged ${leverageTag} (margin)`}>
                        {' '}
                        {leverageTag}
                      </span>
                  )}
                  </td>
                  <td className="mono num">{formatCurrency(trade.entryPrice, trade.currency)}</td>
                  <td className="mono num">{formatCurrency(tradeInvested(trade), trade.currency)}</td>
                  <td className="mono num">{open ? '—' : formatCurrency(trade.exitPrice, trade.currency)}</td>
                  <NetPnlCell trade={trade} />
                  <td>{trade.strategy || '—'}</td>
                  <td>{formatDate(trade.entryDate)}</td>
                  <td className="num">
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label={`Edit ${trade.symbol} trade`}
                      onClick={() => onEdit?.(trade)}
                    >
                      Edit
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      aria-label={`Delete ${trade.symbol} trade`}
                      onClick={() => setPendingDelete(trade)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {pendingDelete && (
        <ConfirmDialog
          title={`Delete ${pendingDelete.symbol} trade from ${formatDate(pendingDelete.entryDate)}?`}
          body="This permanently removes the trade from this device."
          confirmLabel="Delete trade"
          danger
          onCancel={() => setPendingDelete(null)}
          onConfirm={confirmDelete}
        />
      )}
    </>
  );
}
