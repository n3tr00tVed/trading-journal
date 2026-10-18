/**
 * News — curated market headlines for whichever markets you trade
 * (India, US, crypto), rendered as read-only link-outs.
 *
 * Data rules:
 *  - Headlines come from publisher RSS via NewsService (src/lib/news.js).
 *  - The feed is fetched when this view opens (or on Refresh); a 10-minute
 *    cache keeps tab-switching polite. Nothing auto-polls in the
 *    background — news is consumed deliberately, not streamed.
 *  - Region tabs filter what you already have (no refetch per tab).
 *  - Failures are named per source with a Retry; the page never shows
 *    placeholder/fake headlines.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchNews, NEWS_REGION_LABELS, NEWS_REGIONS, NEWS_SOURCES, overallSentiment } from '../lib/news.js';
import EmptyState from './EmptyState.jsx';
import '../styles/app.css';

const CARD_LIMIT = 36;

function timeAgo(iso, now = Date.now()) {
  const ms = iso ? Date.parse(iso) : null;
  if (!Number.isFinite(ms)) return '—';
  const diff = Math.max(0, now - ms);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function NewsCard({ item }) {
  const sentimentBadge = item?.sentiment && item.sentiment !== 'neutral' ? (
    <span
      className={`badge ${item.sentiment === 'bullish' ? 'badge-bullish' : 'badge-bearish'}`}
      title={
        item.sentiment === 'bullish'
          ? 'Headline reads bullish — news like this may lift the market (keyword analysis, informational only)'
          : 'Headline reads bearish — news like this may press the market down (keyword analysis, informational only)'
      }
    >
      {item.sentiment === 'bullish' ? '↑ Bullish' : '↓ Bearish'}
    </span>
  ) : null;

  return (
    <article className="news-card card">
      <header className="news-meta">
        <span className="badge badge-neutral news-source">
          {NEWS_REGION_LABELS[item.region] ?? item.region}
          {item.source ? ` · ${item.source}` : ''}
        </span>
        <time className="news-time" dateTime={item.publishedAt ?? undefined}>
          {timeAgo(item.publishedAt)}
        </time>
        {sentimentBadge}
      </header>
      <a className="news-title" href={item.link} target="_blank" rel="noopener noreferrer">
        {item.title}
      </a>
      {item.summary ? <p className="news-summary">{item.summary}</p> : null}
    </article>
  );
}

function ErrorList({ errors, onRetry }) {
  const labels = Object.keys(errors);
  return (
    <div className="news-errors" role="alert">
      <p>Couldn’t reach {labels.length === 1 ? labels[0] : `${labels.length} sources`} right now:</p>
      <ul>
        {labels.map((label) => (
          <li key={label}>
            {label} — {errors[label]}
          </li>
        ))}
      </ul>
      <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>
        Retry now
      </button>
    </div>
  );
}

function NewsSkeleton() {
  return (
    <div className="news-grid" aria-hidden="true">
      {Array.from({ length: 6 }, (_, i) => (
        <div className="news-card card news-skeleton" key={i}>
          <span className="skeleton-line short" />
          <span className="skeleton-line" />
          <span className="skeleton-line" />
        </div>
      ))}
    </div>
  );
}

/**
 * Overall sentiment strip: one verdict card per market (India, US, crypto,
 * plus the combined view). The verdict is a keyword tally over the fetched
 * headlines — informational mood-reading, never a trading signal — and the
 * bullish/bearish counts are always shown so the basis is visible.
 */
function SentimentSummary({ summary }) {
  // Reading order: combined first, then the markets in the same order as
  // the region tabs (India → US → crypto → forex).
  const order = ['all', 'IN', 'US', 'CRYPTO', 'FOREX'];
  const toneClass = { bullish: 'badge-bullish', bearish: 'badge-bearish', mixed: 'badge-neutral', neutral: 'badge-neutral' };
  const toneDot = { bullish: 'pnl-pos', bearish: 'pnl-neg', mixed: 'pnl-flat', neutral: 'pnl-flat' };

  return (
    <div className="news-sentiment" aria-label="Overall market sentiment from the latest headlines">
      {order.map((key) => {
        const s = summary[key];
        if (!s) return null;
        return (
          <div className={`news-sentiment-card card sentiment-${s.tone}`} key={key} title="Keyword tally over the latest headlines — informational mood-read, never a trading signal">
            <span className="news-sentiment-market">
              {key === 'all' ? '🌐 All markets' : NEWS_REGION_LABELS[key]}
            </span>
            <span className={`badge ${toneClass[s.tone]}`} role="status">
              {s.label}
            </span>
            <span className="news-sentiment-forecast">
              {s.forecast}
            </span>
            <span className={`news-sentiment-counts mono ${toneDot[s.tone]}`}>
              ↑ {s.bullish} · ↓ {s.bearish} · {s.neutral} neutral
            </span>
          </div>
        );
      })}
    </div>
  );
}

export default function NewsPage() {
  const [region, setRegion] = useState('all');
  const [status, setStatus] = useState('loading'); // loading | ready | error
  const [items, setItems] = useState([]);
  const [errors, setErrors] = useState({});
  const [fetchedAt, setFetchedAt] = useState(null);
  const [fromCache, setFromCache] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const apply = useCallback((result) => {
    setErrors(result.errors ?? {});
    setFetchedAt(result.fetchedAt);
    setFromCache(result.fromCache === true);
    if (result.items.length > 0) setItems(result.items);
    setStatus(result.items.length > 0 ? 'ready' : 'error');
  }, []);

  // One fetch covers every region; tabs filter client-side, so switching
  // markets never re-hits the relay.
  useEffect(() => {
    let cancelled = false;
    fetchNews('all').then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  const refresh = useCallback(async () => {
    if (refreshing) return;
    setRefreshing(true);
    const result = await fetchNews('all', { force: true });
    apply(result);
    setRefreshing(false);
  }, [apply, refreshing]);

  const counts = useMemo(() => {
    const tally = { all: items.length };
    for (const key of ['IN', 'US', 'CRYPTO', 'FOREX']) {
      tally[key] = items.filter((item) => item.region === key).length;
    }
    return tally;
  }, [items]);

  const shown = useMemo(
    () => (region === 'all' ? items : items.filter((item) => item.region === region)),
    [items, region],
  );

  // Aggregate mood per market over everything currently fetched.
  const sentimentSummary = useMemo(() => overallSentiment(items), [items]);

  const sourceCount = NEWS_SOURCES.length;

  return (
    <div className="news-page page-shell">
      <div className="section-header">
        <div>
          <h1 className="page-title">Market news</h1>
          <p className="page-sub">
            Headlines curated for your markets — India, US, and crypto. Click any story to read it at the source.
          </p>
        </div>
        <div className="section-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={refresh}
            disabled={refreshing}
          >
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      <div className="news-toolbar">
        <div className="news-chips" role="group" aria-label="News region">
          {NEWS_REGIONS.map((key) => (
            <button
              key={key}
              type="button"
              className={`chip${region === key ? ' chip-active' : ''}`}
              aria-pressed={region === key}
              onClick={() => setRegion(key)}
            >
              {NEWS_REGION_LABELS[key]}
              {status === 'ready' ? ` (${counts[key]})` : ''}
            </button>
          ))}
        </div>
        {fetchedAt && (status === 'ready' || status === 'error') && (
          <span className="news-updated" role="status">
            {fromCache ? 'Cached' : 'Updated'} {timeAgo(new Date(fetchedAt).toISOString())} · {sourceCount} publisher feeds
          </span>
        )}
      </div>

      {status === 'loading' && <NewsSkeleton />}

      {status === 'ready' && (
        <>
          <SentimentSummary summary={sentimentSummary} />
          {Object.keys(errors).length > 0 && <ErrorList errors={errors} onRetry={refresh} />}
          {shown.length === 0 ? (
            <EmptyState
              title="No headlines for this market"
              body="Try All markets, or refresh to pull the latest feeds."
              action={{ label: 'Refresh', onClick: refresh }}
            />
          ) : (
            <div className="news-grid">
              {shown.slice(0, CARD_LIMIT).map((item) => (
                <NewsCard key={item.link} item={item} />
              ))}
            </div>
          )}
        </>
      )}

      {status === 'error' && (
        <>
          <ErrorList errors={Object.keys(errors).length > 0 ? errors : { 'All sources': 'relay unreachable' }} onRetry={refresh} />
          <EmptyState
            title="No news loaded"
            body="Feeds are fetched through a public relay; it may be offline or your connection may be down. Nothing is faked — retry in a moment."
            action={{ label: 'Retry', onClick: refresh }}
          />
        </>
      )}

      <p className="news-foot page-sub">
        Read-only headlines from publisher RSS ({sourceCount} feeds). Publisher sites never see your
        IP — a public relay fetches the feed for you; the relay service itself sees the requesting IP,
        which no page can prevent. Exposure is kept minimal: headlines cache for 10 minutes, and each
        feed reuses the one relay that worked for it last time. Nothing from these pages is stored
        with your journal.
      </p>
    </div>
  );
}
