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
  unrealizedPnl,
  unrealizedReturnOnInvested,
} from '../lib/calculations.js';
import { isTradeOpen } from '../lib/schema.js';
import { formatCurrency, formatDate, formatNumber, signedFormatCurrency } from '../lib/format.js';
import ConfirmDialog from './ConfirmDialog.jsx';

function capitalize(value) {
  return typeof value === 'string' && value ? value.charAt(0).toUpperCase() + value.slice(1) : '';
}

/** Net P&L cell: Open badge (+ live unrealized when a price exists) for open trades; signed realized amount otherwise. */
function NetPnlCell({ trade, price = null }) {
  if (isTradeOpen(trade)) {
    const floating = unrealizedPnl(trade, price);
    const roi = unrealizedReturnOnInvested(trade, price);
    return (
      <td className="mono num">
        <span className="badge badge-open">Open</span>
        {floating != null && (
          <>
            {' '}
            <span className={floating > 0 ? 'pnl-pos' : floating < 0 ? 'pnl-neg' : 'pnl-flat'}>
              <span className="visually-hidden">Unrealized: </span>
              {signedFormatCurrency(floating, trade.currency)}
            </span>
            {roi != null && (
              <span className="pnl-sub">
                {' '}
                {`${roi > 0 ? '+' : ''}${roi}% on margin`}
              </span>
            )}
          </>
        )}
      </td>
    );
  }
  const net = tradeNetPnl(trade);
  const roiClosed = tradeReturnOnInvested(trade);
  return (
    <td className={`mono num ${net > 0 ? 'pnl-pos' : net < 0 ? 'pnl-neg' : 'pnl-flat'}`}>
      {signedFormatCurrency(net, trade.currency)}
      {roiClosed != null && (
        <span className="pnl-sub" aria-label="Return on invested capital (margin)">
          {' '}
          {`${roiClosed > 0 ? '+' : ''}${roiClosed}% on invested`}
        </span>
      )}
    </td>
  );
}

export default function TradesTable({ trades, onEdit, onDelete, onViewScreenshot, livePrices = null, liveNse = null }) {
  const [pendingDelete, setPendingDelete] = useState(null);

  function confirmDelete() {
    if (pendingDelete && typeof onDelete === 'function') onDelete(pendingDelete.id);
    setPendingDelete(null);
  }

  return (
    <>
      <section className="card table-wrap">
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
              <th scope="col" className="num">TP / SL</th>
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
              // One quote source per market: Binance for crypto, the NSE
              // relay (Yahoo chart API) for Indian stocks, none for the rest
              // (futures/options/forex stay honestly manual).
              const symbolKey = String(trade.symbol).trim().toUpperCase();
              const isCryptoTrade = trade.market === 'crypto';
              const isNseStock = trade.market === 'stocks' && trade.currency === 'INR';
              const rawQuote = open
                ? (isCryptoTrade ? livePrices?.prices?.[symbolKey] : isNseStock ? liveNse?.prices?.[symbolKey] : null)
                : null;
              const quote = rawQuote ?? null;
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
                  <td className="mono num">
                    {trade.takeProfit != null || trade.stopLoss != null ? (
                      <span className="tpsl-cell">
                        {trade.takeProfit != null ? (
                          <span className="pnl-pos" title={`Take profit ${formatCurrency(trade.takeProfit, trade.currency)}`}>
                            🎯 {formatCurrency(trade.takeProfit, trade.currency)}
                          </span>
                        ) : null}
                        {trade.takeProfit != null && trade.stopLoss != null ? ' / ' : null}
                        {trade.stopLoss != null ? (
                          <span className="pnl-neg" title={`Stop loss ${formatCurrency(trade.stopLoss, trade.currency)}`}>
                            🛑 {formatCurrency(trade.stopLoss, trade.currency)}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <NetPnlCell trade={trade} price={open && quote ? quote.price : null} />
                  <td>{trade.strategy || '—'}</td>
                  <td>{formatDate(trade.entryDate)}</td>
                  <td className="num">
                    {open ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Edit ${trade.symbol} trade`}
                        onClick={() => onEdit?.(trade)}
                      >
                        Edit
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Edit ${trade.symbol} trade (closed — you'll be asked to confirm)`}
                        title="Closed trade — editing rewrites recorded history, so you'll be asked to confirm first."
                        onClick={() => onEdit?.(trade)}
                      >
                        Edit
                      </button>
                    )}
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
