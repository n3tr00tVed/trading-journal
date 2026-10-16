/**
 * Dashboard: summary stat cards, recent trades, and open positions.
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
import { filterTrades, sortTrades, tradeNetPnl } from '../lib/calculations.js';
import { isTradeOpen } from '../lib/schema.js';
import {
  formatCurrency,
  formatDate,
  formatNumber,
  formatPercent,
  formatRatio,
  signedFormatCurrency,
} from '../lib/format.js';
import { useCurrency } from '../hooks/useCurrency.js';
import StatCard from './StatCard.jsx';
import EmptyState from './EmptyState.jsx';
// Single stylesheet import for the whole component tree I own.
import '../styles/app.css';

function pnlClass(netPnl) {
  if (!Number.isFinite(netPnl) || netPnl === 0) return 'pnl-flat';
  return netPnl > 0 ? 'pnl-pos' : 'pnl-neg';
}

function directionBadge(direction) {
  const isShort = direction === 'short';
  return (
    <span className={`badge ${isShort ? 'badge-neg' : 'badge-pos'}`}>
      {isShort ? 'SHORT' : 'LONG'}
    </span>
  );
}

export default function Dashboard({
  stats,
  trades = [],
  capital = null,
  onAddTrade,
  onEditTrade,
  onViewTrades,
  onOpenCalculator = () => {},
}) {
  const s = stats ?? {};
  const hasTrades = trades.length > 0;
  const { currency } = useCurrency();

  const recentTrades = sortTrades(trades, 'entryDate', 'desc').slice(0, 6);
  const openTrades = filterTrades(trades, { status: 'open' });
  const netTone =
    s.netPnl > 0 ? 'pos' : s.netPnl < 0 ? 'neg' : 'neutral';

  // Capital card: set in Settings; shows live return-on-capital once known.
  const hasCapital = Number.isFinite(capital) && capital > 0;
  const returnOnCapital = hasCapital && Number.isFinite(s.netPnl)
    ? (s.netPnl / capital) * 100
    : null;
  const capitalCard = (
    <StatCard
      label="Account capital"
      value={hasCapital ? formatCurrency(capital, currency) : '—'}
      sub={
        !hasCapital
          ? 'Set it in Settings'
          : returnOnCapital === null
            ? 'No closed trades yet'
            : `Return on capital: ${returnOnCapital > 0 ? '+' : ''}${formatPercent(returnOnCapital)}`
      }
      tone={hasCapital && s.netPnl > 0 ? 'pos' : hasCapital && s.netPnl < 0 ? 'neg' : 'neutral'}
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
          label="Net P&L"
          value={signedFormatCurrency(s.netPnl, currency)}
          tone={netTone}
        />
        <StatCard
          label="Win rate"
          value={s.winRate == null ? '—' : formatPercent(s.winRate)}
        />
        <StatCard
          label="Profit factor"
          value={s.profitFactor == null ? '—' : formatRatio(s.profitFactor)}
        />
        <StatCard
          label="Total trades"
          value={formatNumber(s.total)}
          sub={`${s.closed} closed · ${s.open} open`}
        />
        <StatCard
          label="Average win"
          value={s.avgWin == null ? '—' : formatCurrency(s.avgWin, currency)}
          tone={s.avgWin == null ? 'neutral' : 'pos'}
        />
        <StatCard
          label="Average loss"
          value={s.avgLoss == null ? '—' : formatCurrency(s.avgLoss, currency)}
          tone={s.avgLoss == null ? 'neutral' : 'neg'}
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
        <section className="card" aria-labelledby="recent-trades-title">
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
              Six most recently opened trades. Use the Edit button in each row to
              modify a trade.
            </caption>
            <thead>
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
                          {signedFormatCurrency(net, currency) || '—'}
                        </span>
                      )}
                    </td>
                    <td>{formatDate(trade.entryDate)}</td>
                    <td className="num">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => onEditTrade(trade)}
                        aria-label={`Edit ${trade.symbol} trade entered ${formatDate(trade.entryDate)}`}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* ---- Open positions ---- */}
      {hasTrades && s.open > 0 && (
        <section className="card" aria-labelledby="open-positions-title">
          <div className="section-header">
            <h2 className="section-title" id="open-positions-title">
              Open positions
            </h2>
            <span className="badge badge-open">{s.open} open</span>
          </div>
          <table className="trades-table">
            <thead>
              <tr>
                <th scope="col">Symbol</th>
                <th scope="col">Direction</th>
                <th scope="col" className="num">Entry price</th>
                <th scope="col">Entry date</th>
              </tr>
            </thead>
            <tbody>
              {openTrades.map((trade) => (
                <tr key={trade.id}>
                  <td className="mono">{trade.symbol}</td>
                  <td>{directionBadge(trade.direction)}</td>
                  <td className="mono num">{formatNumber(trade.entryPrice)}</td>
                  <td>{formatDate(trade.entryDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}
