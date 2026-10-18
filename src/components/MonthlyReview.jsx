/**
 * Monthly review — a month-wise P&L statement. Each row is a calendar month
 * carrying the net P&L realized in it (grouped by each trade's close date),
 * so "Sep 2026" answers "how much did I actually make or lose in September?"
 *
 * Clicking a month expands it to show EVERY trade realized in that month —
 * the exact records behind the money shown in the row.
 *
 * This is a reporting lens, not a new metric: money comes straight from
 * tradeNetPnl and per-currency honesty is preserved (₹ and $ are shown
 * separately, never summed), so nothing on the dashboard changes because
 * of this section. Open trades only appear here once they close — their
 * P&L isn't realized until then.
 *
 * Props:
 *   trades  Trade[] (see src/lib/schema.js); empty ⇒ the section renders
 *           nothing (the empty dashboard already has its own empty state).
 */
import { Fragment, useMemo, useState } from 'react';
import { MONTHLY_REGIONS, monthlyBreakdown } from '../lib/calculations.js';
import { TRADE_CURRENCIES } from '../lib/schema.js';
import { formatDate, formatNumber, signedFormatCurrency } from '../lib/format.js';
import { useCurrency } from '../hooks/useCurrency.js';
import '../styles/app.css';

const REGION_LABELS = {
  all: '🌐 All markets',
  IN: '🇮🇳 India',
  US: '🇺🇸 US',
  CRYPTO: '🪙 Crypto',
};

/** The ledger this row leads with: the active one when the month touched it, else the other. */
function leadCurrencyOf(month, active) {
  return month.currencies.includes(active) ? active : month.currencies[0] ?? 'INR';
}

function DirectionPill({ direction }) {
  const isShort = direction === 'short';
  return (
    <span className={`badge ${isShort ? 'badge-neg' : 'badge-pos'}`}>
      {isShort ? 'SHORT' : 'LONG'}
    </span>
  );
}

/**
 * Same chip pattern as the news page (news-chips/chip classes). Counts are
 * closed trades per region across all months, so a chip always answers
 * "is anything even in here?" before you click it.
 */
function RegionChips({ region, onPick, counts }) {
  return (
    <div className="news-chips" role="group" aria-label="Monthly P&L market">
      {MONTHLY_REGIONS.map((key) => (
        <button
          key={key}
          type="button"
          className={`chip${region === key ? ' chip-active' : ''}`}
          aria-pressed={region === key}
          onClick={() => onPick(key)}
        >
          {REGION_LABELS[key]}
          {counts[key] > 0 ? ` (${counts[key]})` : ''}
        </button>
      ))}
    </div>
  );
}

function MonthTradeRows({ month }) {
  return (
    <div className="month-trades">
      <table className="trades-table month-trades-table">
        <caption className="visually-hidden">
          Trades realized in {month.label}. Net P&L per trade is shown in
          that trade's own market currency.
        </caption>
        <thead>
          <tr>
            <th scope="col">Symbol</th>
            <th scope="col">Direction</th>
            <th scope="col" className="num">Qty</th>
            <th scope="col" className="num">Closed on</th>
            <th scope="col" className="num">Net P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {month.trades.map((trade) => {
            const net =
              Number.isFinite(trade.netPnl) ? trade.netPnl : undefined;
            return (
              <tr key={trade.id}>
                <td className="mono">
                  {trade.symbol}
                  <span className="month-sub"> — {trade.market}</span>
                </td>
                <td><DirectionPill direction={trade.direction} /></td>
                <td className="mono num">{formatNumber(trade.quantity)}</td>
                <td>{formatDate(trade.exitDate)}</td>
                <td className="mono num">
                  <span className={net > 0 ? 'pnl-pos' : net < 0 ? 'pnl-neg' : 'pnl-flat'}>
                    {signedFormatCurrency(net, trade.currency) || '—'}
                  </span>
                  {trade.fees > 0 && (
                    <span className="month-sub" title="Fees already deducted from Net P&L">
                      {' '}incl. fees
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export default function MonthlyReview({ trades = [] }) {
  const { currency } = useCurrency();
  const active = TRADE_CURRENCIES.includes(currency) ? currency : 'INR';
  const [region, setRegion] = useState('all');
  const [openMonths, setOpenMonths] = useState(() => new Set());

  const months = useMemo(() => monthlyBreakdown(trades, region), [trades, region]);

  // Closed-trade counts per market — computed on the whole partition, not
  // the selected view, so chips label themselves honestly before any click
  // and an empty selection can say "nothing closed here yet" instead of
  // silently vanishing.
  const counts = useMemo(() => {
    const countFor = (r) => monthlyBreakdown(trades, r).reduce((n, row) => n + row.closed, 0);
    return { all: countFor('all'), IN: countFor('IN'), US: countFor('US'), CRYPTO: countFor('CRYPTO') };
  }, [trades]);

  if (counts.all === 0) return null;

  function toggle(key) {
    setOpenMonths((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // Tiny inline bar: each month's realized P&L relative to the strongest
  // month on screen. All-zero data skips it — a bar of nothing lies.
  const magnitudePeak = Math.max(...months.map((m) => Math.abs(m.netPnl[leadCurrencyOf(m, active)])), 0) || null;

  return (
    <section className="card table-wrap" aria-labelledby="monthly-review-title">
      <div className="section-header">
        <h2 className="section-title" id="monthly-review-title">
          Monthly review
        </h2>
        <RegionChips region={region} onPick={setRegion} counts={counts} />
      </div>
      {months.length === 0 ? (
        <p className="section-note">
          Nothing closed in {REGION_LABELS[region].replace(/^\S+ /, '')} yet — open positions appear
          here in the month they close.
        </p>
      ) : (
      <table className="trades-table">
        <caption className="visually-hidden">
          Monthly P&L statement, newest month first. Each month carries the
          net P&L realized in it — trades are grouped by the month they
          closed, whatever month they were entered. Expand a month to see
          every trade realized in it. Rupee and dollar totals are listed
          separately and never summed. Open trades appear when they close.
        </caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col" className="num">Trades closed</th>
            <th scope="col" className="num">Wins · Losses</th>
            <th scope="col" className="num">Net P&amp;L</th>
          </tr>
        </thead>
        <tbody>
          {months.map((month) => {
            const lead = leadCurrencyOf(month, active);
            const leadAmount = month.netPnl[lead];
            const other = lead === 'INR' ? 'USD' : 'INR';
            const showsOther = month.currencies.includes(other);
            const tone = leadAmount > 0 ? 'pnl-pos' : leadAmount < 0 ? 'pnl-neg' : 'pnl-flat';
            const barWidth = magnitudePeak
              ? Math.round((Math.abs(leadAmount) / magnitudePeak) * 100)
              : 0;
            const expanded = openMonths.has(month.key);
            return (
              <Fragment key={month.key}>
                <tr className={expanded ? 'month-row month-row-open' : 'month-row'}>
                  <td>
                    <button
                      type="button"
                      className="month-expander"
                      aria-expanded={expanded}
                      aria-controls={`month-detail-${month.key}`}
                      onClick={() => toggle(month.key)}
                    >
                      <span className={`month-caret${expanded ? ' open' : ''}`} aria-hidden="true">▸</span>
                      <span className="mono">{month.label}</span>
                      <span className="month-sub">{month.closed} trade{month.closed === 1 ? '' : 's'}</span>
                    </button>
                  </td>
                  <td className="mono num">{formatNumber(month.closed)}</td>
                  <td className="mono num">
                    {month.wins}W · {month.losses}L
                  </td>
                  <td className="mono num">
                    <span className="month-net">
                      <span className={tone}>
                        {signedFormatCurrency(leadAmount, lead) || '—'}
                      </span>
                      {showsOther && (
                        <span className="month-sub">
                          {signedFormatCurrency(month.netPnl[other], other)}
                        </span>
                      )}
                      {magnitudePeak != null && (
                        <span className="month-bar" aria-hidden="true">
                          <span
                            className={leadAmount >= 0 ? 'month-bar-pos' : 'month-bar-neg'}
                            style={{ width: `${barWidth}%` }}
                          />
                        </span>
                      )}
                    </span>
                  </td>
                </tr>
                {expanded && (
                  <tr className="month-detail">
                    <td colSpan={4} id={`month-detail-${month.key}`}>
                      <MonthTradeRows month={month} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      )}
    </section>
  );
}
