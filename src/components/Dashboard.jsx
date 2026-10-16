/**
 * Dashboard: summary stat cards, recent trades, and open positions.
 *
 * Currency: money cards read the market you're viewing (sidebar switch) and
 * print that market's own ledger via computeCurrencyBreakdown — India view
 * shows ₹ totals for INR-tagged trades, US view shows $ totals for
 * USD-tagged trades; the sub-line always reveals the other market's total
 * when it has trades, since rupees and dollars are never summed.
 *
 * Props:
 *   stats         computeStats(trades) result (see src/lib/calculations.js)
 *   trades        Trade[] (see src/lib/schema.js)
 *   onAddTrade    () => void — open the form in "new" mode
 *   onEditTrade   (trade) => void — open the form for an existing trade
 *   onViewTrades  () => void — switch to the trades view
 *
 * P&L correctness lives entirely in `stats` + lib helpers; this component
 * only formats and displays.
 */
import { useMemo, useState } from 'react';
import { computeCurrencyBreakdown, filterTrades, sortTrades, tradeInvested, tradeNetPnl } from '../lib/calculations.js';
import { isTradeOpen, TRADE_CURRENCIES } from '../lib/schema.js';
import {
  formatCurrency,
  formatDateTime,
  formatDate,
  formatNumber,
  formatPercent,
  formatRatio,
  signedFormatCurrency,
} from '../lib/format.js';
import { unrealizedPnl, unrealizedReturnOnInvested } from '../lib/calculations.js';
import { useCurrency } from '../hooks/useCurrency.js';
import StatCard from './StatCard.jsx';
import EmptyState from './EmptyState.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
// Single stylesheet import for the whole component tree I own.
import '../styles/app.css';

function pnlClass(netPnl) {
  if (!Number.isFinite(netPnl) || netPnl === 0) return 'pnl-flat';
  return netPnl > 0 ? 'pnl-pos' : netPnl < 0 ? 'pnl-neg' : 'pnl-flat';
}

function directionBadge(direction) {
  const isShort = direction === 'short';
  return (
    <span className={`badge ${isShort ? 'badge-neg' : 'badge-pos'}`}>
      {isShort ? 'SHORT' : 'LONG'}
    </span>
  );
}

/** Honest status line for the live crypto feed (in the open positions header). */
function LivePriceStatus({ live = null, symbolCount = 0 }) {
  if (!live || symbolCount === 0) return null;
  const { status, errors = {}, lastUpdated = null, POLL_MS } = live;
  const failedSymbols = Object.keys(errors);
  let label;
  if (status === 'live' || status === 'partial') {
    label = `Live every ${Math.round(POLL_MS / 1000)}s`;
  } else if (status === 'error') {
    label = failedSymbols.some((sym) => errors[sym] === 'offline')
      ? 'Connection failed — retrying…'
      : 'Quotes unavailable';
  } else if (status === 'paused') {
    label = 'Paused (tab hidden)';
  } else {
    label = 'Waiting for first price…';
  }
  const asOf = lastUpdated ? ` · as of ${formatDateTime(lastUpdated)}` : '';
  const warn = status === 'error'
    ? ` · ${failedSymbols.join(', ')}: ${failedSymbols.map((sym) => errors[sym]).join(', ')}`
    : '';
  return (
    <span className="live-status" role="status">
      <span className={`live-dot ${status === 'live' || status === 'partial' ? 'on' : ''}`} aria-hidden="true" />
      {label}
      {asOf}
      {warn}
    </span>
  );
}

/** StatCard that shows the active market's money, and the other market's
 *  total in the sub-line when that ledger has trades (never merged). */
export default function Dashboard({
  stats,
  trades = [],
  capital = null,
  livePrices = null,
  onAddTrade,
  onEditTrade,
  onDeleteTrade = () => {},
  onViewTrades,
  onOpenCalculator = () => {},
}) {
  // Recent-trade deletes get the same confirm guard as the full table:
  // data loss is permanent (local-first), so a stray click must be safe.
  const [pendingDelete, setPendingDelete] = useState(null);

  function confirmDelete() {
    if (pendingDelete) onDeleteTrade(pendingDelete.id);
    setPendingDelete(null);
  }

  const s = stats ?? {};
  const hasTrades = trades.length > 0;
  const { currency } = useCurrency();

  const breakdown = useMemo(() => computeCurrencyBreakdown(trades), [trades]);
  const active = TRADE_CURRENCIES.includes(currency) ? currency : 'INR';
  const other = active === 'INR' ? 'USD' : 'INR';
  const me = breakdown[active];
  const them = breakdown[other];
  const MARKET_LABELS = { INR: 'Indian market', USD: 'US market' };

  const recentTrades = sortTrades(trades, 'entryDate', 'desc').slice(0, 6);
  const openTrades = filterTrades(trades, { status: 'open' });
  const openCryptoSymbols = openTrades
    .filter((t) => t.market === 'crypto')
    .map((t) => String(t.symbol || '').trim().toUpperCase());

  // Per-market ledgers: active market leads, other market surfaces in subs.
  const leading = me.netPnl;
  const netTone = leading > 0 ? 'pos' : leading < 0 ? 'neg' : 'neutral';
  const otherNet = them.total > 0 ? signedFormatCurrency(them.netPnl, other) : null;

  // Account capital is per-market (set in Settings): it pairs with the
  // active market's own P&L for return-on-capital. An empty ledger claims
  // nothing — no rupee profit inflates the US return, and vice versa.
  const hasCapital = Number.isFinite(capital) && capital > 0;
  const hasClosedInActive = (me.closed ?? 0) > 0;
  const returnOnCapital = hasCapital && hasClosedInActive && Number.isFinite(leading)
    ? (leading / capital) * 100
    : null;
  const capitalCard = (
    <StatCard
      label="Account capital"
      value={hasCapital ? formatCurrency(capital, active) : '—'}
      sub={
        !hasCapital
          ? 'Set it in Settings'
          : returnOnCapital === null
            ? 'No closed trades yet'
            : `Return on capital: ${returnOnCapital > 0 ? '+' : ''}${formatPercent(returnOnCapital)}`
      }
      tone={hasCapital && leading > 0 ? 'pos' : hasCapital && leading < 0 ? 'neg' : 'neutral'}
    />
  );

  return (
    <div className="dash">
      <div className="page-head">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-sub">Performance overview of your trading journal.</p>
        </div>
        <div className="section-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={onOpenCalculator}
          >
            Position size calculator
          </button>
        </div>
      </div>

      {/* ---- Summary cards ---- */}
      <div className="stat-grid">
        <StatCard
          label={`Net P&L — ${MARKET_LABELS[active]}`}
          value={
            me.total > 0
              ? signedFormatCurrency(leading, active)
              : `No ${MARKET_LABELS[active]} trades`
          }
          tone={me.total > 0 ? netTone : 'neutral'}
          sub={otherNet ? `${MARKET_LABELS[other]}: ${otherNet}` : undefined}
        />
        <StatCard
          label="Win rate"
          value={me.total > 0 && me.winRate != null ? formatPercent(me.winRate) : '—'}
        />
        <StatCard
          label="Profit factor"
          value={me.total > 0 && me.profitFactor != null ? formatRatio(me.profitFactor) : '—'}
        />
        <StatCard
          label="Total trades"
          value={formatNumber(s.total)}
          sub={`${s.closed} closed · ${s.open} open`}
        />
        <StatCard
          label="Average win"
          value={me.total > 0 && me.avgWin != null ? formatCurrency(me.avgWin, active) : '—'}
          tone={me.avgWin != null ? 'pos' : 'neutral'}
          sub={them.wins > 0 ? `${MARKET_LABELS[other]}: ${formatCurrency(them.avgWin ?? 0, other)}` : undefined}
        />
        <StatCard
          label="Average loss"
          value={me.total > 0 && me.avgLoss != null ? formatCurrency(me.avgLoss, active) : '—'}
          tone={me.avgLoss != null ? 'neg' : 'neutral'}
          sub={them.losses > 0 ? `${MARKET_LABELS[other]}: ${formatCurrency(them.avgLoss ?? 0, other)}` : undefined}
        />
        <StatCard
          label="Money invested"
          value={formatCurrency(me.investedClosed ?? 0, active)}
          sub={
            [
              (me.investedOpen ?? 0) > 0
                ? `+ ${formatCurrency(me.investedOpen, active)} in open positions`
                : 'Closed trades',
              (them.investedClosed ?? 0) > 0 || (them.investedOpen ?? 0) > 0
                ? `${MARKET_LABELS[other]}: ${formatCurrency((them.investedClosed ?? 0) + (them.investedOpen ?? 0), other)}`
                : null,
            ].filter(Boolean).join(' · ')
          }
        />
        {capitalCard}
      </div>

      {/* ---- Empty dataset ---- */}
      {!hasTrades && (
        <EmptyState
          title="No trades yet"
          body="Log your first trade to see net P&L, win rate, and open positions here."
          action={{ label: 'Add trade', onClick: onAddTrade }}
        />
      )}

      {/* ---- Recent trades ---- */}
      {hasTrades && (
        <section className="card table-wrap" aria-labelledby="recent-trades-title">
          <div className="section-header">
            <h2 className="section-title" id="recent-trades-title">
              Recent trades
            </h2>
            <div className="section-actions">
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={onAddTrade}
              >
                Add trade
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={onViewTrades}
              >
                View all
              </button>
            </div>
          </div>
          <table className="trades-table">
            <caption className="visually-hidden">
              Six most recently opened trades. Amounts are shown in each
              trade's own market currency. Use the Edit button in each row to
              modify a trade.
            </caption>            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Direction</th>
                <th scope="col" className="num">Qty</th>
                <th scope="col" className="num">Net P&L</th>
                <th scope="col">Entry date</th>
                <th scope="col" className="num">
                  <span className="visually-hidden">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {recentTrades.map((trade) => {
                const open = isTradeOpen(trade);
                const net = open ? null : tradeNetPnl(trade);
                return (
                  <tr key={trade.id}>
                    <td className="mono">{trade.symbol}</td>
                    <td>{directionBadge(trade.direction)}</td>
                    <td className="mono num">{formatNumber(trade.quantity)}</td>
                    <td className="mono num">
                      {open ? (
                        <>
                          <span className="visually-hidden">Not closed: </span>
                          <span className="badge badge-open">Open</span>
                        </>
                      ) : (
                        <span className={pnlClass(net)}>
                          {signedFormatCurrency(net, trade.currency) || '—'}
                        </span>
                      )}
                    </td>
                    <td>{formatDate(trade.entryDate)}</td>
                    <td className="num">
                      {open ? (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => onEditTrade(trade)}
                          aria-label={`Edit ${trade.symbol} trade entered ${formatDate(trade.entryDate)}`}
                        >
                          Edit
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          disabled
                          aria-label={`Edit ${trade.symbol} trade (locked: trade is closed)`}
                          title="Closed trades are locked from editing. Delete and re-enter to correct history."
                        >
                          Edit 🔒
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        aria-label={`Delete ${trade.symbol} trade entered ${formatDate(trade.entryDate)}`}
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
      )}

      {/* ---- Open positions (live) ---- */}
      {hasTrades && s.open > 0 && (
        <section className="card table-wrap" aria-labelledby="open-positions-title">
          <div className="section-header">
            <h2 className="section-title" id="open-positions-title">
              Open positions
            </h2>
            <LivePriceStatus live={livePrices} symbolCount={openCryptoSymbols.length} />
            <span className="badge badge-open">{s.open} open</span>
          </div>
          <table className="trades-table">
            <caption className="visually-hidden">
              Currently open positions. Crypto rows show a live last price from
              Binance's public API; unrealized P&L is estimated from it and is
              not part of the realized Net P&L totals.
            </caption>
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Direction</th>
                <th scope="col" className="num">Entry price</th>
                <th scope="col" className="num">Last price</th>
                <th scope="col" className="num">Invested</th>
                <th scope="col" className="num">Unrealized P&amp;L</th>
                <th scope="col">Entry date</th>
              </tr>
            </thead>
            <tbody>
              {openTrades.map((trade) => {
                const quote = livePrices?.prices?.[String(trade.symbol).trim().toUpperCase()];
                const lastPrice = quote?.price ?? null;
                const pennies = unrealizedPnl(trade, lastPrice);
                const roiOnMargin = unrealizedReturnOnInvested(trade, lastPrice);
                const isCrypto = trade.market === 'crypto';
                return (
                  <tr key={trade.id}>
                    <td className="mono">{trade.symbol}</td>
                    <td>{directionBadge(trade.direction)}</td>
                    <td className="mono num">{formatCurrency(trade.entryPrice, trade.currency)}</td>
                    <td className="mono num">
                      {isCrypto ? (
                        lastPrice != null ? (
                          <span className="live-cell">
                            <span className="live-dot" aria-hidden="true" />
                            {formatCurrency(lastPrice, trade.currency)}
                          </span>
                        ) : (
                          <span className="muted">waiting…</span>
                        )
                      ) : (
                        <span className="muted" title={`No live feed for ${trade.market} — note the price you exit at`}>
                          manual
                        </span>
                      )}
                    </td>
                    <td className="mono num">{formatCurrency(tradeInvested(trade), trade.currency)}</td>
                    <td className={`mono num ${pennies == null ? '' : pennies > 0 ? 'pnl-pos' : pennies < 0 ? 'pnl-neg' : 'pnl-flat'}`}>
                      {pennies == null ? (
                        <span className="muted">—</span>
                      ) : (
                        <>
                          {signedFormatCurrency(pennies, trade.currency)}
                          {roiOnMargin != null && (
                            <span className="pnl-sub">
                              {' '}
                              {`${roiOnMargin > 0 ? '+' : ''}${roiOnMargin}% on margin`}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                    <td>{formatDate(trade.entryDate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

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
    </div>
  );
}
