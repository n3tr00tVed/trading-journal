import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NEWS_SOURCES,
  classifySentiment,
  clearNewsCache,
  fetchNews,
  overallSentiment,
  parseFeedXml,
  publishedDate,
  sourcesForRegion,
} from '../lib/news.js';

const RSS_FIXTURE = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <title>Test feed</title>
  <item>
    <title>Nifty rises on banking strength</title>
    <link>https://example.test/nifty-rises</link>
    <source url="https://example.test">Times News</source>
    <pubDate>Fri, 16 Oct 2026 08:00:00 GMT</pubDate>
    <description>&lt;p&gt;Banks led the &lt;b&gt;rally&lt;/b&gt;.&lt;/p&gt;</description>
  </item>
  <item>
    <title>Rupee steady against dollar</title>
    <link>https://example.test/rupee-steady</link>
    <pubDate>invalid-date-string</pubDate>
    <description>plain text</description>
  </item>
  <item>
    <title>Nifty rises on banking strength</title>
    <link>https://example.test/nifty-rises</link>
  </item>
</channel></rss>`;

const ATOM_FIXTURE = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Fed holds rates</title>
    <link rel="alternate" href="https://example.test/fed-holds"/>
    <updated>2026-10-16T09:30:00Z</updated>
    <summary>Markets barely moved.</summary>
  </entry>
</feed>`;

const BROKEN_FIXTURE = '<html><body>not a feed</body></html>';

function itemsOf(result) {
  return result.items;
}

beforeEach(() => {
  clearNewsCache();
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('parseFeedXml', () => {
  it('extracts title/link/source/date and strips HTML from summaries', () => {
    const items = parseFeedXml(RSS_FIXTURE, { sourceLabel: 'Fallback', region: 'IN' });
    expect(items).toHaveLength(2); // duplicate link deduped
    const [first, second] = items;
    expect(first.title).toBe('Nifty rises on banking strength');
    expect(first.link).toBe('https://example.test/nifty-rises');
    expect(first.source).toBe('Times News'); // per-item <source> wins
    expect(first.region).toBe('IN');
    expect(first.publishedAt).toBe('2026-10-16T08:00:00.000Z');
    expect(first.summary).toBe('Banks led the rally.');
    // Unusable dates are null, never fabricated.
    expect(second.publishedAt).toBe(null);
  });

  it('falls back to the feed-level source label when no <source> element exists', () => {
    const items = parseFeedXml(RSS_FIXTURE.replace('<source url="https://example.test">Times News</source>', ''), {
      sourceLabel: 'Fallback',
    });
    expect(items[0].source).toBe('Fallback');
  });

  it('parses Atom entries too', () => {
    const items = parseFeedXml(ATOM_FIXTURE, { sourceLabel: 'AtomFeed', region: 'US' });
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('Fed holds rates');
    expect(items[0].link).toBe('https://example.test/fed-holds');
    expect(items[0].publishedAt).toBe('2026-10-16T09:30:00.000Z');
  });

  it('returns [] for junk instead of throwing', () => {
    expect(parseFeedXml(BROKEN_FIXTURE)).toEqual([]);
    expect(parseFeedXml('')).toEqual([]);
    expect(parseFeedXml(null)).toEqual([]);
  });
});

describe('publishedDate', () => {
  it('parses RFC-822 and ISO stamps, rejects garbage', () => {
    expect(publishedDate('Fri, 16 Oct 2026 08:00:00 GMT')).toBeInstanceOf(Date);
    expect(publishedDate('2026-10-16T08:00:00Z')).toBeInstanceOf(Date);
    expect(publishedDate('nope')).toBe(null);
    expect(publishedDate('')).toBe(null);
  });
});

describe('sourcesForRegion', () => {
  it('filters by region and returns everything for "all"', () => {
    expect(sourcesForRegion('IN').every((s) => s.region === 'IN')).toBe(true);
    expect(sourcesForRegion('all').length).toBe(NEWS_SOURCES.length);
  });
});

describe('classifySentiment', () => {
  it('reads word-boundary bullish and bearish cues', () => {
    expect(classifySentiment('Nifty rises on banking strength')).toBe('bullish');
    expect(classifySentiment('Banks rally as profits surge')).toBe('bullish');
    expect(classifySentiment('Rupee slumps, markets fall on weak data')).toBe('bearish');
    expect(classifySentiment('Fed holds rates; markets barely moved')).toBe('neutral');
    expect(classifySentiment('')).toBe('neutral');
    expect(classifySentiment(null)).toBe('neutral');
  });

  it('does not fire on substrings (update / startup / withdrawal)', () => {
    expect(classifySentiment('RBI to update guidelines next week')).toBe('neutral');
    expect(classifySentiment('Startup funding trends steady')).toBe('neutral');
    expect(classifySentiment('Withdrawal rules eased')).toBe('neutral');
  });

  it('mixed bullish and bearish cues in one headline cancel out', () => {
    expect(classifySentiment('Markets rise in the morning, fall by close')).toBe('neutral');
  });
});

describe('overallSentiment', () => {
  it('aggregates per region and calls the overall lean', () => {
    const items = [
      { region: 'IN', sentiment: 'bullish' },
      { region: 'IN', sentiment: 'bullish' },
      { region: 'IN', sentiment: 'bullish' },
      { region: 'US', sentiment: 'bearish' },
      { region: 'US', sentiment: 'bearish' },
      { region: 'US', sentiment: 'bearish' },
      { region: 'CRYPTO', sentiment: 'bullish' },
      { region: 'CRYPTO', sentiment: 'neither-key' },
    ];
    const s = overallSentiment(items);
    expect(s.IN.tone).toBe('bullish');
    expect(s.IN.label).toBe('Likely bullish');
    expect(s.US.tone).toBe('bearish');
    expect(s.US.label).toBe('Likely bearish');
    expect(s.US.bullish).toBe(0);
    expect(s.US.bearish).toBe(3);
    // 1 bullish + 1 uncategorized → below the minimum sample, honest fallback.
    expect(s.CRYPTO.tone).toBe('mixed');
    expect(s.CRYPTO.label).toBe('Mixed signals');
    // All regions combined: 4 bullish vs 3 bearish with 7 classified → bullish.
    expect(s.all.tone).toBe('bullish');
    expect(s.all.total).toBe(8);
  });

  it('withholds a directional verdict under MIN_SENTIMENT_SAMPLE classified headlines', () => {
    const s = overallSentiment([
      { region: 'IN', sentiment: 'bullish' },
      { region: 'IN', sentiment: 'bullish' },
    ]);
    // 2 classified < 3 → not a trend; refuse "likely bullish".
    expect(s.IN.bullish).toBe(2);
    expect(s.IN.tone).toBe('mixed');
    expect(s.IN.label).toBe('Mixed signals');
  });

  it('all-neutral feeds stay neutral and ties count as mixed', () => {
    const neutral = overallSentiment([
      { region: 'US', sentiment: 'neutral' },
      { region: 'US', sentiment: 'neutral' },
      { region: 'US', sentiment: 'neutral' },
    ]);
    expect(neutral.US.tone).toBe('neutral');
    expect(neutral.US.label).toBe('No clear signals');

    const tie = overallSentiment([
      { region: 'US', sentiment: 'bullish' },
      { region: 'US', sentiment: 'bullish' },
      { region: 'US', sentiment: 'bearish' },
      { region: 'US', sentiment: 'bearish' },
    ]);
    expect(tie.US.tone).toBe('mixed');
  });

  it('empty or junk input yields zeroed blank ledgers for every region', () => {
    const empty = overallSentiment([]);
    for (const key of ['all', 'IN', 'US', 'CRYPTO']) {
      expect(empty[key].total).toBe(0);
      expect(empty[key].tone).toBe('neutral');
      expect(empty[key].label).toBe('No clear signals');
    }
    const junk = overallSentiment(null);
    expect(junk.all.total).toBe(0);
  });

  it('frames each verdict as a forward forecast (may rise / may fall)', () => {
    const s = overallSentiment([
      { region: 'IN', sentiment: 'bullish' },
      { region: 'IN', sentiment: 'bullish' },
      { region: 'IN', sentiment: 'bullish' },
      { region: 'US', sentiment: 'bearish' },
      { region: 'US', sentiment: 'bearish' },
      { region: 'US', sentiment: 'bearish' },
      { region: 'CRYPTO', sentiment: 'bullish' },
      { region: 'CRYPTO', sentiment: 'bearish' },
    ]);
    expect(s.IN.tone).toBe('bullish');
    expect(s.IN.forecast).toBe('Market may rise');
    expect(s.IN.direction).toBe('up');
    expect(s.US.tone).toBe('bearish');
    expect(s.US.forecast).toBe('Market may fall');
    expect(s.US.direction).toBe('down');
    // 1 up + 1 down is not a verdict — unclear, and direction withheld.
    expect(s.CRYPTO.tone).toBe('mixed');
    expect(s.CRYPTO.forecast).toBe('Direction unclear');
    expect(s.CRYPTO.direction).toBe(null);
  });
});

describe('fetchNews', () => {
  it('fetches through the relay, parses, sorts newest first, and caches', async () => {
    // Per-URL mocks (not per-call): each source tries the rss2json path
    // first (no `json` on the stub → treated as unusable → falls through)
    // then the XML relays, so every source consumes 2 calls when it
    // succeeds on the first relay.
    fetch.mockImplementation(async (url) => {
      if (url.startsWith('https://api.rss2json.com/')) {
        return { ok: true, text: async () => '', json: async () => ({ status: 'error' }) };
      }
      if (url.includes('api.codetabs.com')) {
        // CodeTabs serves the hosts AllOrigins hiccups on: RSS for
        // ET/CoinDesk/crypto-topic, ATOM for the Google News business
        // feeds it fronts.
        if (url.includes('economictimes') || url.includes('coindesk')) {
          return { ok: true, text: async () => RSS_FIXTURE };
        }
        return { ok: true, text: async () => ATOM_FIXTURE };
      }
      if (url.includes('economictimes') || url.includes('coindesk') || url.includes('bitcoin+OR+ethereum')) {
        return { ok: false }; // AllOrigins hiccups on these hosts
      }
      // AllOrigins succeeds for Google News business feeds (ATOM) and CNBC.
      return { ok: true, text: async () => ATOM_FIXTURE };
    });

    const first = await fetchNews('all');
    // Every source = 1 rss2json attempt + at least 1 relay attempt.
    expect(fetch.mock.calls.length).toBeGreaterThanOrEqual(NEWS_SOURCES.length * 2);
    const items = itemsOf(first);
    expect(items.length).toBeGreaterThan(0);
    expect(first.errors).toEqual({});
    // Newest first: dated items before undated ones.
    const dates = items.filter((i) => i.publishedAt).map((i) => Date.parse(i.publishedAt));
    expect(dates).toEqual([...dates].sort((a, b) => b - a));

    // Second call serves from cache without any network.
    fetch.mockClear();
    const cached = await fetchNews('all');
    expect(fetch).not.toHaveBeenCalled();
    expect(cached.fromCache).toBe(true);
    expect(cached.items).toEqual(items);
  });

  it('isolates failures: broken sources are named, healthy ones still populate', async () => {
    // Mocks follow URLs, not call order — a source is broken only when
    // every path fails, exactly like the production fallback chain.
    fetch.mockImplementation(async (url) => {
      const rss2json = url.startsWith('https://api.rss2json.com/');
      if (rss2json) return { ok: true, text: async () => '', json: async () => ({ status: 'error' }) };

      const allorigins = url.includes('api.allorigins.win');
      const codetabs = url.includes('api.codetabs.com');
      const fixture = { ok: true, text: async () => RSS_FIXTURE };

      // Relay URLs percent-encode nearly everythingfunctional. Match on
      // fragments that survive encoding: locale codes are literal, and the
      // /headlines/ path segment becomes '%2Fheadlines%2F'.
      // gn-india topic feed: the relay is down for that URL on every path.
      if (url.includes('en-IN')) return { ok: false, status: 502 };
      // gn-us topic feed ('%2Fheadlines%2F' excludes the crypto-search
      // feed, which also carries hl=en-US): relay answers with junk no
      // parser accepts.
      if (url.includes('%2Fheadlines%2F')) {
        return allorigins || codetabs ? { ok: true, text: async () => BROKEN_FIXTURE } : { ok: false };
      }
      if (codetabs) return { ok: false }; // codetabs offline for healthy feeds
      if (allorigins) return fixture;
      return { ok: false };
    });

    const result = await fetchNews('all');
    expect(result.items.length).toBeGreaterThan(0);
    // Every failed source names itself with the honest all-paths-exhausted
    // message — a relay hiccup and an unparseable payload both surface as
    // "this feed could not be reached", never as fake success.
    expect(result.errors['Google News · India business']).toBe('unreachable (all relays)');
    expect(result.errors['Google News · US business']).toBe('unreachable (all relays)');
    expect(Object.keys(result.errors)).toHaveLength(2);
  });

  it('reports every source failed when the network is down', async () => {
    fetch.mockRejectedValue(new TypeError('Failed to fetch'));
    const result = await fetchNews('all');
    expect(result.items).toEqual([]);
    expect(Object.keys(result.errors).length).toBe(NEWS_SOURCES.length);
  });

  it('forced refresh skips the cache even when one exists', async () => {
    fetch.mockResolvedValue({ ok: true, text: async () => RSS_FIXTURE });
    await fetchNews('all'); // populates cache
    fetch.mockClear();
    const forced = await fetchNews('all', { force: true });
    expect(fetch).toHaveBeenCalled();
    expect(forced.fromCache).toBe(false);
  });

  it('classifies sentiment on the rss2json path too — the primary fetch path', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: 'ok',
        items: [
          { title: 'Rupee slumps as markets fall on weak data', link: 'https://example.test/slump', pubDate: 'Fri, 16 Oct 2026 08:00:00 GMT', description: '<b>Weak</b> GDP print.' },
          { title: 'Fed holds rates steady', link: 'https://example.test/hold', pubDate: '', description: 'Markets barely moved.' },
        ],
      }),
    });
    const result = await fetchNews('all', { force: true });
    expect(result.errors).toEqual({});
    // Same JSON served for every source: 2 items × NEWS_SOURCES.
    expect(result.items).toHaveLength(NEWS_SOURCES.length * 2);
    // The regression this locks: rss2json items MUST carry a sentiment —
    // missing ones tally as neutral and starve the per-market verdicts.
    expect(result.items.every((item) => item.sentiment)).toBe(true);
    expect(result.items.some((item) => item.sentiment === 'bearish')).toBe(true);
    expect(overallSentiment(result.items).all.bearish).toBe(NEWS_SOURCES.length);
  });

  it('pins the first working fetch path and reuses it on refresh (fewer relay hits)', async () => {
    fetch.mockImplementation(async (url) => {
      if (url.startsWith('https://api.rss2json.com/')) return { ok: false, status: 503 };
      if (url.includes('api.allorigins.win')) return { ok: false, status: 503 };
      if (url.includes('api.codetabs.com')) return { ok: true, text: async () => RSS_FIXTURE };
      return { ok: false };
    });

    const first = await fetchNews('all', { force: true });
    expect(first.errors).toEqual({});
    // Discovery run: every source walks rss2json → allorigins → codetabs.
    expect(fetch.mock.calls.length).toBeGreaterThan(NEWS_SOURCES.length);

    fetch.mockClear();
    const pinned = await fetchNews('all', { force: true });
    expect(pinned.errors).toEqual({});
    // Repeat refresh: the pinned codetabs path alone, one attempt per feed —
    // fewer relay services see the same repeating client.
    expect(fetch.mock.calls.length).toBe(NEWS_SOURCES.length);
  });
});
