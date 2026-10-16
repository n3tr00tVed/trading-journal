import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NEWS_SOURCES,
  clearNewsCache,
  fetchNews,
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

describe('fetchNews', () => {
  it('fetches through the relay, parses, sorts newest first, and caches', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, text: async () => RSS_FIXTURE }) // et-markets (IN)
      .mockResolvedValueOnce({ ok: true, text: async () => ATOM_FIXTURE }) // gn-india (IN)
      .mockResolvedValueOnce({ ok: true, text: async () => ATOM_FIXTURE }) // cnbc (US)
      .mockResolvedValueOnce({ ok: true, text: async () => ATOM_FIXTURE }) // gn-us (US)
      .mockResolvedValueOnce({ ok: true, text: async () => RSS_FIXTURE }) // coindesk (CRYPTO)
      .mockResolvedValueOnce({ ok: true, text: async () => RSS_FIXTURE }); // gn-crypto (CRYPTO)

    const first = await fetchNews('all');
    expect(fetch).toHaveBeenCalledTimes(NEWS_SOURCES.length);
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
    fetch
      .mockResolvedValueOnce({ ok: true, text: async () => RSS_FIXTURE }) // et-markets ok
      .mockResolvedValueOnce({ ok: false, status: 502 }) // gn-india: relay down for that URL
      .mockResolvedValueOnce({ ok: true, text: async () => RSS_FIXTURE }) // cnbc ok
      .mockResolvedValueOnce({ ok: true, text: async () => BROKEN_FIXTURE }) // gn-us: junk
      .mockResolvedValueOnce({ ok: true, text: async () => RSS_FIXTURE }) // coindesk ok
      .mockResolvedValueOnce({ ok: true, text: async () => RSS_FIXTURE }); // gn-crypto ok

    const result = await fetchNews('all');
    expect(result.items.length).toBeGreaterThan(0);
    expect(result.errors['Google News · India business']).toBe('relay unreachable');
    expect(result.errors['Google News · US business']).toBe('unparseable feed');
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
});
