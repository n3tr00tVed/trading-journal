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
 *  - IP visibility, stated plainly: publisher hosts never see the user's
 *    IP (the relay does the fetching for them). The relay services DO see
 *    the requesting IP — that is inherent to any server that serves you.
 *    The app minimizes that exposure: a 10-minute cache plus per-feed
 *    "path pinning" — each feed remembers the one fetch path that worked
 *    last time and tries it alone first, so repeat refreshes put ONE known
 *    third party per feed in the loop instead of spraying every relay.
 *    Hiding the IP from the relays themselves needs a VPN/Tor, which is a
 *    system-level concern no page can do for its own requests.
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
 * accounts, every feed public and free to read. Feeds were verified live
 * (HTTP 200 + RSS parse) in Oct 2026; Google News topic feeds back up
 * publishers whose hosts block bots/proxies (Moneycontrol 403, Yahoo 429).
 */
export const NEWS_SOURCES = [
  {
    id: 'et-markets',
    label: 'Economic Times · Markets',
    region: 'IN',
    url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977011501.cms',
  },
  {
    id: 'gn-india',
    label: 'Google News · India business',
    region: 'IN',
    url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-IN&gl=IN&ceid=IN:en',
  },
  {
    id: 'cnbc-us',
    label: 'CNBC · Markets',
    region: 'US',
    url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258',
  },
  {
    id: 'gn-us',
    label: 'Google News · US business',
    region: 'US',
    url: 'https://news.google.com/rss/headlines/section/topic/BUSINESS?hl=en-US&gl=US&ceid=US:en',
  },
  {
    id: 'coindesk',
    label: 'CoinDesk',
    region: 'CRYPTO',
    url: 'https://www.coindesk.com/arc/outboundfeeds/rss/',
  },
  {
    id: 'gn-crypto',
    label: 'Google News · Crypto',
    region: 'CRYPTO',
    url: 'https://news.google.com/rss/search?q=crypto+OR+bitcoin+OR+ethereum&hl=en-US&gl=US&ceid=US:en',
  },
];

/** Hard ceiling per feed request: a slow relay must never pin the UI. */
const FETCH_TIMEOUT_MS = 15_000;

/**
 * Fetch paths, tried in order per source until one yields items:
 * 1. rss2json — CORS-native feed→JSON service, so the browser calls it
 *    directly. Proven the most reliable path (public XML relays currently
 *    5xx on Google News/CNBC/CoinDesk).
 * 2. Raw XML through public CORS relays (AllOrigins, then CodeTabs).
 * A source fails only when EVERY path fails, and the error names it.
 */
const RSS2JSON_ENDPOINT = 'https://api.rss2json.com/v1/api.json?rss_url=';
const XML_RELAYS = [
  { id: 'allorigins', url: (feedUrl) => `${RELAY}${encodeURIComponent(feedUrl)}` },
  { id: 'codetabs', url: (feedUrl) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(feedUrl)}` },
];

async function fetchWithTimeout(url) {
  // AbortSignal.timeout exists in all modern browsers; fall back to a
  // manual controller for older engines / tests.
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return fetch(url, { method: 'GET', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { method: 'GET', signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

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
    const itemSource = (node.querySelector('source')?.textContent ?? '').trim() || sourceLabel;
    if (!title || !link || seen.has(link)) return;
    seen.add(link);
    const parsedDate = publishedDate(publishedAt);
    items.push({
      title,
      link,
      source: itemSource,
      region,
      publishedAt: parsedDate ? parsedDate.toISOString() : null,
      summary: stripTags(summary).slice(0, 220),
      sentiment: classifySentiment(title + ' ' + summary),
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
      sentiment: classifySentiment(title + ' ' + summary),
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

/**
 * Keyword-based sentiment for headline text. Returns 'bullish', 'bearish'
 * or 'neutral'. Keywords match on word boundaries so 'up' doesn't fire on
 * 'update' — noise in a single headline is cosmetic, but noise in the
 * per-region aggregate would misstate the overall verdict.
 */
const SENTIMENT_KEYWORDS = {
  bullish: ['rise', 'rises', 'surge', 'surges', 'rally', 'rallies', 'gain', 'gains', 'jump', 'jumps', 'climb', 'climbs', 'growth', 'positive', 'strong', 'record', 'high', 'profit', 'profits', 'beat', 'beats', 'soar', 'soars', 'upgrade', 'outperform', 'bullish', 'uptick', 'recovery', 'rebound', 'boost'],
  bearish: ['fall', 'falls', 'drop', 'drops', 'decline', 'declines', 'plunge', 'plunges', 'slump', 'slumps', 'loss', 'losses', 'negative', 'weak', 'low', 'crash', 'crashes', 'slide', 'slides', 'downgrade', 'miss', 'misses', 'sink', 'sinks', 'bearish', 'downturn', 'downtick', 'recession', 'cut', 'cuts'],
};

const SENTIMENT_MATCHERS = Object.fromEntries(
  Object.entries(SENTIMENT_KEYWORDS).map(([tone, words]) => [
    tone,
    new RegExp(`\\b(?:${words.join('|')})\\b`, 'i'),
  ]),
);

export function classifySentiment(text) {
  if (typeof text !== 'string') return 'neutral';
  const bullish = SENTIMENT_MATCHERS.bullish.test(text);
  const bearish = SENTIMENT_MATCHERS.bearish.test(text);
  if (bullish && !bearish) return 'bullish';
  if (bearish && !bullish) return 'bearish';
  if (bullish && bearish) return 'neutral'; // mixed signals cancel out
  return 'neutral';
}

/**
 * Aggregate headline sentiment per region the news page covers.
 * Returns { all, IN, US, CRYPTO } where each is
 *   { total, bullish, bearish, neutral, tone, label, direction, forecast }
 *
 * tone is the aggregate verdict: the side with more classified headlines
 * wins, and a tie (or an all-neutral feed) is neutral. With fewer than
 * MIN_SENTIMENT_SAMPLE classified headlines the verdict is withheld as
 * 'mixed' — two headlines are gossip, not a trend — so the label stays
 * honest about what the data supports.
 *
 * forecast frames the tone as the forward-looking read the user asked for:
 * what the current headline mood implies for the market next —
 *   bullish  → 'Market may rise'  (direction 'up')
 *   bearish  → 'Market may fall'  (direction 'down')
 *   mixed    → 'Direction unclear'
 *   neutral  → 'No directional cue'
 * It is a mood-read of today's headlines, never a trading signal.
 */
export const MIN_SENTIMENT_SAMPLE = 3;

export function overallSentiment(items = []) {
  const list = Array.isArray(items) ? items : [];
  const blank = () => ({ total: 0, bullish: 0, bearish: 0, neutral: 0 });
  const tally = { all: blank(), IN: blank(), US: blank(), CRYPTO: blank() };

  for (const item of list) {
    const sentiment =
      item?.sentiment === 'bullish' ? 'bullish' : item?.sentiment === 'bearish' ? 'bearish' : 'neutral';
    const add = (bucket) => {
      if (!bucket) return;
      bucket.total += 1;
      if (sentiment === 'bullish') bucket.bullish += 1;
      else if (sentiment === 'bearish') bucket.bearish += 1;
      else bucket.neutral += 1;
    };
    add(tally[item?.region]);
    add(tally.all);
  }

  const verdict = (counts) => {
    const classified = counts.bullish + counts.bearish;
    if (classified >= MIN_SENTIMENT_SAMPLE && counts.bullish > counts.bearish) {
      return { tone: 'bullish', label: 'Likely bullish', direction: 'up', forecast: 'Market may rise' };
    }
    if (classified >= MIN_SENTIMENT_SAMPLE && counts.bearish > counts.bullish) {
      return { tone: 'bearish', label: 'Likely bearish', direction: 'down', forecast: 'Market may fall' };
    }
    if (classified > 0) {
      return { tone: 'mixed', label: 'Mixed signals', direction: null, forecast: 'Direction unclear' };
    }
    return { tone: 'neutral', label: 'No clear signals', direction: null, forecast: 'No directional cue' };
  };

  return Object.fromEntries(
    Object.entries(tally).map(([key, counts]) => [key, { ...counts, ...verdict(counts) }]),
  );
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

/** rss2json response → normalized items. Never throws for bad shapes. */
function itemsFromRss2Json(data, source) {
  if (!data || data.status !== 'ok' || !Array.isArray(data.items)) return [];
  const items = [];
  const seen = new Set();
  for (const raw of data.items) {
    const title = (raw.title ?? '').trim();
    const link = (raw.link ?? '').trim();
    if (!title || !link || seen.has(link)) continue;
    seen.add(link);
    const parsedDate = publishedDate((raw.pubDate ?? '').trim());
    const summary = stripTags(raw.description ?? '').slice(0, 220);
    items.push({
      title,
      link,
      source: source.label,
      region: source.region,
      publishedAt: parsedDate ? parsedDate.toISOString() : null,
      summary,
      // Classify on this path too: rss2json is the primary fetch route, and
      // an item without a sentiment field tallies as neutral — omitting this
      // used to starve the per-market verdicts entirely on that route.
      sentiment: classifySentiment(`${title} ${summary}`),
    });
  }
  return items;
}

/**
 * One source = several fetch attempts. First path that yields ≥1 item
 * wins; exhausting all of them throws the honest error.
 *
 * Exposure control: the winning path is remembered per feed ("pin"), and
 * later refreshes try the pinned path alone before the full chain — a
 * repeat refresh then contacts one known relay per feed instead of every
 * relay. A stale pin (relay went down) just falls through to the full
 * chain, same behavior as before.
 */

const FETCH_PATH_IDS = ['rss2json', 'allorigins', 'codetabs'];
const PATH_PIN_KEY = 'trading-journal:news:fetch-paths:v1';

const pathPins = new Map();

(function initPathPins() {
  if (typeof window === 'undefined') return;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PATH_PIN_KEY) ?? '{}');
    for (const [feedUrl, pathId] of Object.entries(parsed)) {
      if (FETCH_PATH_IDS.includes(pathId)) pathPins.set(feedUrl, pathId);
    }
  } catch {
    // Unparsable pins are discarded silently — the full chain still works.
  }
})();

function savePathPins() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(PATH_PIN_KEY, JSON.stringify(Object.fromEntries(pathPins)));
  } catch {
    // Storage full / private mode: pins are a courtesy, drop silently.
  }
}

function notePathPin(feedUrl, pathId) {
  if (pathPins.get(feedUrl) === pathId) return;
  pathPins.set(feedUrl, pathId);
  savePathPins();
}

function forgetPathPin(feedUrl) {
  if (pathPins.delete(feedUrl)) savePathPins();
}

/** Try ONE path end-to-end; returns items or null when the path yields nothing usable. */
async function tryFetchPath(pathId, source) {
  let url;
  if (pathId === 'rss2json') {
    url = `${RSS2JSON_ENDPOINT}${encodeURIComponent(source.url)}`;
  } else {
    const relay = XML_RELAYS.find((candidate) => candidate.id === pathId);
    if (!relay) return null;
    url = relay.url(source.url);
  }
  const response = await fetchWithTimeout(url);
  if (!response.ok) return null;

  if (pathId === 'rss2json') {
    const data = await response.json();
    const items = itemsFromRss2Json(data, source);
    return items.length > 0 ? items : null;
  }
  const text = await response.text();
  const items = parseFeedXml(text, { sourceLabel: source.label, region: source.region });
  return items.length > 0 ? items : null;
}

async function fetchSourceItems(source) {
  if (typeof fetch !== 'function') throw new Error('unreachable (all relays)');

  // 0) The pinned path from a previous successful refresh, tried alone.
  const pinned = pathPins.get(source.url);
  if (pinned) {
    try {
      const items = await tryFetchPath(pinned, source);
      if (items) return items;
    } catch {
      // Stale pin (relay error / timeout) → fall through to the full chain.
    }
  }

  // 1) Full chain, first path that serves ≥1 item wins and gets pinned.
  for (const pathId of FETCH_PATH_IDS) {
    if (pathId === pinned) continue; // already tried above and failed
    try {
      const items = await tryFetchPath(pathId, source);
      if (items) {
        notePathPin(source.url, pathId);
        return items;
      }
    } catch {
      // Bad payload, rate limit, timeout → next path.
    }
  }

  // Every path exhausted: this feed is unreachable right now. If a stale
  // pin just burned an attempt for nothing, drop it so the next refresh
  // starts clean with the full chain.
  if (pinned) forgetPathPin(source.url);
  throw new Error('unreachable (all relays)');
}

/**
 * Fetch + parse the feeds for a region. Returns
 * `{ items, fetchedAt, errors }` where errors maps source label → honest
 * message ('unreachable (all relays)', 'unparseable feed').
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

  const results = await Promise.allSettled(sources.map((source) => fetchSourceItems(source)));

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
