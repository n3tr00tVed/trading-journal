/**
 * TradesPage — full Trades view: header + summary strip, filter bar,
 * sorted trades table and empty states.
 *
 * Props:
 *   trades    Trade[] — full dataset from useTrades
 *   onAdd     () => void     — open create form
 *   onEdit    (trade) => void
 *   onDelete  (tradeId) => void
 *
 * Filtering/sorting goes through lib/filterTrades + lib/sortTrades; the
 * summary strip stats over exactly the filtered set, never the raw array.
 */

import { useMemo, useState } from 'react';
import { computeStats, computeCurrencyBreakdown, filterTrades, sortTrades } from '../lib/calculations.js';
import { signedFormatCurrency } from '../lib/format.js';
import { formatCurrency } from '../lib/format.js';
import EmptyState from './EmptyState.jsx';
import { MARKETS, TRADE_CURRENCIES } from '../lib/schema.js';
import TradesTable from './TradesTable.jsx';

const DEFAULT_FILTERS = {
  query: '',
  symbol: '',
  direction: 'all',
  strategy: 'all',
  market: 'all',
  currency: 'all',
  status: 'all',
  dateFrom: '',
  dateTo: '',
};

const MARKET_LABELS = {
  stocks: 'Stocks',
  futures: 'Futures',
  forex: 'Forex',
  crypto: 'Crypto',
  options: 'Options',
};

const DEFAULT_SORT = 'entryDate:desc';

const SORT_OPTIONS = [
  { value: 'entryDate:desc', label: 'Date ↓ (newest first)' },
  { value: 'entryDate:asc', label: 'Date ↑ (oldest first)' },
  { value: 'netPnl:desc', label: 'P&L ↓ (best first)' },
  { value: 'netPnl:asc', label: 'P&L ↑ (worst first)' },
  { value: 'symbol:asc', label: 'Symbol A-Z' },
];

function isDefault(filters) {
  return Object.keys(DEFAULT_FILTERS).every((key) => filters[key] === DEFAULT_FILTERS[key]);
}

function netPnlClass(net) {
  return net > 0 ? 'pnl-pos' : net < 0 ? 'pnl-neg' : 'pnl-flat';
}

export default function TradesPage({ trades = [], onAdd, onEdit, onDelete, onViewScreenshot, livePrices = null }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS);
  const [sort, setSort] = useState(DEFAULT_SORT);

  const setFilter = (key) => (event) => {
    setFilters((prev) => ({ ...prev, [key]: event.target.value }));
  };

  const resetFilters = () => setFilters(DEFAULT_FILTERS);

  // 'entryDate:desc' -> key 'entryDate', dir 'desc'
  const [sortKey, sortDir] = sort.split(':');

  const strategies = useMemo(() => {
    const unique = new Set();
    for (const trade of trades) {
      const name = typeof trade?.strategy === 'string' ? trade.strategy.trim() : '';
      if (name) unique.add(name);
    }
    return [...unique].sort((a, b) => a.localeCompare(b));
  }, [trades]);

  const filtered = useMemo(
    () => filterTrades(trades, filters),
    [trades, filters],
  );

  // Keep a stable reference for both the summary strip and the table.
  const [shown, shownStats] = useMemo(() => {
    const sortedTrades = sortTrades(filtered, sortKey, sortDir);
    return [sortedTrades, computeStats(sortedTrades)];
  }, [filtered, sortKey, sortDir]);

  // Rupees and dollars are never summed: per-market ledgers over exactly
  // the shown (filtered + sorted) set.
  const shownBreakdown = useMemo(() => computeCurrencyBreakdown(shown), [shown]);
  const stripCurrencies = TRADE_CURRENCIES.filter((c) => shownBreakdown[c].total > 0);
  const CURRENCY_LABELS = { INR: 'India', USD: 'US' };

  const noTradesAtAll = trades.length === 0;
  const noMatches = !noTradesAtAll && shown.length === 0;

  return (
    <div className="page-head" style={{ width: '100%' }}>
      <div className="section-header">
        <div>
          <h1 className="page-title">Trades</h1>
          <p className="page-sub">
            {shown.length} {shown.length === 1 ? 'trade' : 'trades'} shown · {shownStats.open} open
            {stripCurrencies.length > 0 && stripCurrencies.map((code) => (
              <span key={code}>
                {' · '}
                {CURRENCY_LABELS[code]}
                {' net '}
                <span className={`mono ${netPnlClass(shownBreakdown[code].netPnl)}`}>
                  {signedFormatCurrency(shownBreakdown[code].netPnl, code)}
                </span>
                {' · invested '}
                <span className="mono">{formatCurrency(shownBreakdown[code].investedClosed ?? 0, code)}</span>
                {' (closed)'}
              </span>
            ))}
          </p>
        </div>
        <div className="section-actions">
          <button type="button" className="btn btn-primary" onClick={onAdd}>
            Add trade
          </button>
        </div>
      </div>

      {!noTradesAtAll && (
        <div className="card">
          <div className="section-actions" style={{ marginBottom: 'var(--space-4, 16px)' }}>
            <div className="field" style={{ flex: '1 1 200px' }}>
              <label className="label" htmlFor="trades-filter-query">
                Search
              </label>
              <input
                id="trades-filter-query"
                type="search"
                value={filters.query}
                onChange={setFilter('query')}
                placeholder="Symbol, strategy, setup, notes…"
              />
            </div>

            <div className="field" style={{ flex: '0 1 140px' }}>
              <label className="label" htmlFor="trades-filter-symbol">
                Symbol
              </label>
              <input
                id="trades-filter-symbol"
                type="text"
                value={filters.symbol}
                onChange={setFilter('symbol')}
                placeholder="Exact symbol"
                autoComplete="off"
              />
            </div>

            <div className="field">
              <label className="label" htmlFor="trades-filter-direction">
                Direction
              </label>
              <select id="trades-filter-direction" value={filters.direction} onChange={setFilter('direction')}>
                <option value="all">All</option>
                <option value="long">Long</option>
                <option value="short">Short</option>
              </select>
            </div>

            <div className="field">
              <label className="label" htmlFor="trades-filter-strategy">
                Strategy
              </label>
              <select id="trades-filter-strategy" value={filters.strategy} onChange={setFilter('strategy')}>
                <option value="all">All strategies</option>
                {strategies.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="label" htmlFor="trades-filter-market">
                Market
              </label>
              <select id="trades-filter-market" value={filters.market} onChange={setFilter('market')}>
                <option value="all">All markets</option>
                {MARKETS.map((name) => (
                  <option key={name} value={name}>
                    {MARKET_LABELS[name]}
                  </option>
                ))}
              </select>
            </div>

            <div className="field">
              <label className="label" htmlFor="trades-filter-currency">
                Currency
              </label>
              <select id="trades-filter-currency" value={filters.currency} onChange={setFilter('currency')}>
                <option value="all">All currencies</option>
                <option value="INR">India (₹)</option>
                <option value="USD">US ($)</option>
              </select>
            </div>

            <div className="field">
              <label className="label" htmlFor="trades-filter-status">
                Status
              </label>
              <select id="trades-filter-status" value={filters.status} onChange={setFilter('status')}>
                <option value="all">All</option>
                <option value="open">Open</option>
                <option value="closed">Closed</option>
              </select>
            </div>

            <div className="field">
              <label className="label" htmlFor="trades-filter-from">
                From
              </label>
              <input id="trades-filter-from" type="date" value={filters.dateFrom} onChange={setFilter('dateFrom')} />
            </div>

            <div className="field">
              <label className="label" htmlFor="trades-filter-to">
                To
              </label>
              <input id="trades-filter-to" type="date" value={filters.dateTo} onChange={setFilter('dateTo')} />
            </div>

            <div className="field">
              <label className="label" htmlFor="trades-filter-sort">
                Sort
              </label>
              <select id="trades-filter-sort" value={sort} onChange={(event) => setSort(event.target.value)}>
                {SORT_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="btn btn-ghost"
              onClick={resetFilters}
              disabled={isDefault(filters)}
            >
              Clear filters
            </button>
          </div>
        </div>
      )}

      {noTradesAtAll ? (
        <EmptyState
          title="No trades yet"
          body="Log your first trade to start tracking P&L, win rate and open positions."
          action={{ label: 'Add your first trade', onClick: onAdd }}
        />
      ) : noMatches ? (
        <EmptyState
          title="No trades match your filters"
          body="Try loosening the search or clearing one or more filters."
          action={{ label: 'Clear filters', onClick: resetFilters }}
        />
      ) : (
        <TradesTable
          trades={shown}
          onEdit={onEdit}
          onDelete={onDelete}
          onViewScreenshot={onViewScreenshot}
          livePrices={livePrices}
        />
      )}
    </div>
  );
}
