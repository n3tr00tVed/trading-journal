/**
 * Market news — the app's second (and only other) network surface.
 *
 * Contract:
 *  - Read-only headlines from curated publisher RSS feeds (Economic Times +
 *    Moneycontrol for India, Yahoo Finance for the US, CoinDesk for crypto).
 *  - Browsers cannot read publisher RSS directly (no CORS on feed URLs), so
 *    requests relay through AllOrigins' free public endpoint — same honesty
 *    rules as the crypto quotes: nothing but the feed URL is sent, nothing
 *    personal travels, responses are headlines + links only.
 *  - Parsed with the browser's own DOMParser; items are sorted newest
 *    first and cached in localStorage for 10 minutes so reopening the tab
 *    doesn't re-hit the relay. Failures are reported per source, never
 *    papered over with fake items.
 */

const RELAY = 'https://api.allorigins.win/raw?url=';
const CACHE_KEY = 'trading-journal:news:cache:v1';
const CACHE_TTL_MS = 10 * 60 * 1000;

export const NEWS_REGIONS = ['all', 'IN', 'US', 'CRYPTO'];

export const NEWS_REGION_LABELS = {
  all: 'All markets',
  IN: '🇮🇳 India',
  US: '🇺🇸 US',
  CRYPTO: '🪙 Crypto',
};

/**
 * Curated feeds. Publisher-hosted RSS only — no scraping, no aggregator
 * accounts, every feed public and free to read.
 */
export const NEWS_SOURCES = [
  {
    id: 'et-markets',
    label: 'Economic Times · Markets',
    region: 'IN',
    url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977011501.cms',
  },
  {
    id: 'mc-top',
    label: 'Moneycontrol · Top news',
    region: 'IN',
    url: 'https://www.moneycontrol.com/rss/latestnews.xml',
  },
  {
    id: 'mc-personal',
    label: 'Moneycontrol · Personal finance',
    region: 'IN',
    url: 'https://www.moneycontrol.com/rss/businessnews.xml',
  },
  {
    id: 'yahoo-us',
    label: 'Yahoo Finance · US',
    region: 'US',
    url: 'https://feeds.finance.yahoo.com/rss/2.0/headline?s=%5EGSPC&region=US&lang=en-US',
  },
  {
    id: 'cnbc-us',
    label: 'CNBC · Markets',
    region: 'US',
    url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258',
  },
  {
    id: 'coindesk',
    label: 'CoinDesk',
    region: 'CRYPTO',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
  },
];

export function sourcesForRegion(region = 'all') {
  return NEWS_SOURCES.filter((source) => region === 'all' || source.region === region);
}

/** Parse RSS 2.0 / Atom text into normalized items. Never throws. */
export function parseFeedXml(text, { sourceLabel = '', region = '' } = {}) {
  if (typeof text !== 'string' || !text.trim()) return [];
  if (typeof DOMParser === 'undefined') return [];
  let doc;
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml');
  } catch {
    return [];
  }
  if (doc.querySelector('parsererror')) return [];

  const items = [];
  const seen = new Set();

  doc.querySelectorAll('item').forEach((node) => {
    const title = (node.querySelector('title')?.textContent ?? '').trim();
    const link = (node.querySelector('link')?.textContent ?? '').trim();
    const publishedAt = (node.querySelector('pubDate')?.textContent ?? '').trim();
    const summary = (node.querySelector('description')?.textContent ?? '').trim();
    if (!title || !link || seen.has(link)) return;
    seen.add(link);
    const parsedDate = publishedDate(publishedAt);
    items.push({
      title,
      link,
      source: sourceLabel,
      region,
      publishedAt: parsedDate ? parsedDate.toISOString() : null,
      summary: stripTags(summary).slice(0, 220),
    });
  });

  doc.querySelectorAll('entry').forEach((node) => {
    const title = (node.querySelector('title')?.textContent ?? '').trim();
    const linkHref = node.querySelector('link[rel="alternate"]')?.getAttribute('href')
      ?? node.querySelector('link')?.getAttribute('href')
      ?? '';
    const link = linkHref.trim();
    const publishedAt = (node.querySelector('updated')?.textContent ?? node.querySelector('published')?.textContent ?? '').trim();
    const summary = (node.querySelector('summary')?.textContent ?? node.querySelector('content')?.textContent ?? '').trim();
    if (!title || !link || seen.has(link)) return;
    seen.add(link);
    const parsedDate = publishedDate(publishedAt);
    items.push({
      title,
      link,
      source: sourceLabel,
      region,
      publishedAt: parsedDate ? parsedDate.toISOString() : null,
      summary: stripTags(summary).slice(0, 220),
    });
  });

  return items;
}

/** RSS/Atom date strings → Date, or null for unusable stamps. */
export function publishedDate(raw) {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function stripTags(text) {
  if (typeof document === 'undefined') return text ?? '';
  // description/summary may embed HTML; extracting text via the DOM keeps
  // parsing honest (malformed junk yields '').
  const holder = document.createElement('template');
  holder.innerHTML = text ?? '';
  return (holder.content.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function readCache() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.items)) return null;
    if (!Number.isFinite(parsed.fetchedAt) || Date.now() - parsed.fetchedAt > CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(items) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify({ fetchedAt: Date.now(), items }));
  } catch {
    // Storage full / private mode: cache is a courtesy, drop silently.
  }
}

export function clearNewsCache() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(CACHE_KEY);
  } catch {
    // ignore
  }
}

/**
 * Fetch + parse the feeds for a region. Returns
 * `{ items, fetchedAt, errors }` where errors maps source label → honest
 * message ('relay unreachable', 'unparseable feed', 'empty feed').
 */
export async function fetchNews(region = 'all', { force = false } = {}) {
  if (!force) {
    const cache = readCache();
    if (cache) return { items: cache.items, fetchedAt: cache.fetchedAt, errors: {}, fromCache: true };
  }

  const sources = sourcesForRegion(region);
  if (sources.length === 0) {
    return { items: [], fetchedAt: Date.now(), errors: {}, fromCache: false };
  }

  const results = await Promise.allSettled(
    sources.map(async (source) => {
      if (typeof fetch !== 'function') throw new Error('relay unreachable');
      const response = await fetch(`${RELAY}${encodeURIComponent(source.url)}`, { method: 'GET' });
      if (!response.ok) throw new Error('relay unreachable');
      const text = await response.text();
      const items = parseFeedXml(text, { sourceLabel: source.label, region: source.region });
      if (items.length === 0) throw new Error('unparseable feed');
      return items;
    }),
  );

  const items = [];
  const errors = {};
  results.forEach((result, index) => {
    const source = sources[index];
    if (result.status === 'fulfilled') {
      items.push(...result.value);
    } else {
      errors[source.label] = result.reason instanceof Error ? result.reason.message : 'relay unreachable';
    }
  });

  items.sort((a, b) => {
    const at = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const bt = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return bt - at; // newest first; undated items sink
  });

  const fetchedAt = Date.now();
  if (items.length > 0) writeCache(items);
  return { items, fetchedAt, errors, fromCache: false };
}
