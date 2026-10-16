import { afterEach, beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { CSV_COLUMNS, downloadFile, parseImportFile, toCsv, toJsonExport } from '../lib/export.js';

const HEADER = CSV_COLUMNS.join(',');

const PLAIN = {
  id: 'e-1',
  symbol: 'AAPL',
  market: 'stocks',
  direction: 'long',
  entryPrice: 10.5,
  exitPrice: 11,
  quantity: 1,
  entryDate: '2026-02-01',
  exitDate: '2026-02-02',
  fees: 0.25,
  strategy: 'ORB',
  setup: 'breakout',
  notes: 'textbook',
  createdAt: '2026-02-01T10:00:00.000Z',
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('toCsv', () => {
  it('emits the exact fixed header row even for an empty list', () => {
    expect(toCsv([])).toBe('id,symbol,market,direction,entryPrice,exitPrice,quantity,invested,entryDate,exitDate,fees,strategy,setup,notes,hasScreenshot,createdAt');
  });

  it('maps columns in fixed order and is deterministic', () => {
    const csv = toCsv([PLAIN]);
    const lines = csv.split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe(HEADER);
    expect(lines[1]).toBe(
      'e-1,AAPL,stocks,long,10.5,11,1,,2026-02-01,2026-02-02,0.25,ORB,breakout,textbook,false,2026-02-01T10:00:00.000Z',
    );
    expect(csv).toBe(toCsv([PLAIN])); // deterministic
    expect(toCsv([{ ...PLAIN }, { ...PLAIN }])).toBe(toCsv([{ ...PLAIN }, { ...PLAIN }]));
  });

  it('null exitPrice → empty cell; exitPrice 0 is preserved as "0"', () => {
    const openRow = toCsv([{ ...PLAIN, exitPrice: null, exitDate: null }]).split('\n')[1].split(',');
    expect(openRow[5]).toBe(''); // exitPrice cell (column 6) empty for an open trade
    expect(openRow[5]).not.toBe('null');

    const zeroRow = toCsv([{ ...PLAIN, id: 'e-2', exitPrice: 0, exitDate: '2026-02-02' }]).split('\n')[1].split(',');
    expect(zeroRow[5]).toBe('0');
  });

  it('escapes commas, doubled quotes and newlines inside fields', () => {
    // The embedded newline stays INSIDE the quoted notes field, so the whole
    // file must be compared at once (splitting on \n would cut the row).
    const csv = toCsv([
      {
        ...PLAIN,
        id: 'm-1',
        strategy: 'a,b',
        setup: 'say "hi"',
        notes: 'line1\nline2, "x"',
      },
    ]);

    expect(csv).toBe(
      `${HEADER}\nm-1,AAPL,stocks,long,10.5,11,1,,2026-02-01,2026-02-02,0.25,"a,b","say ""hi""","line1\nline2, ""x""",false,2026-02-01T10:00:00.000Z`,
    );
  });
});

describe('toJsonExport', () => {
  it('is pretty-printed and losslessly round-trips', () => {
    const json = toJsonExport([PLAIN]);
    expect(json).toContain('\n  '); // pretty-printed
    const parsed = JSON.parse(json);
    expect(parsed).toEqual([PLAIN]);
  });

  it('serializes an empty list as []', () => {
    expect(JSON.parse(toJsonExport([]))).toEqual([]);
  });
});

describe('parseImportFile', () => {
  it('accepts a plain JSON array', () => {
    expect(parseImportFile(JSON.stringify([PLAIN]))).toEqual([PLAIN]);
  });

  it('unwraps a { trades: [...] } wrapper', () => {
    expect(parseImportFile(JSON.stringify({ trades: [PLAIN, PLAIN] }))).toEqual([PLAIN, { ...PLAIN, id: 'e-1' }]);
  });

  it('throws a friendly error for unparseable JSON', () => {
    expect(() => parseImportFile('{nope')).toThrow(/^Invalid JSON: /);
  });

  it('throws a friendly error for wrong top-level shapes', () => {
    expect(() => parseImportFile('{"id":"x"}')).toThrow(/^Invalid import file: /);
    expect(() => parseImportFile('{"trades":"nope"}')).toThrow(/^Invalid import file: /);
    expect(() => parseImportFile('"just a string"')).toThrow(/^Invalid import file: /);
    expect(() => parseImportFile('null')).toThrow(/^Invalid import file: /);
  });
});

describe('downloadFile', () => {
  // jsdom cannot create object URLs; swap in fakes for the click tests.
  beforeAll(() => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: vi.fn(() => 'blob:fake-url') });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function clicked() {
      this.dataset.clicked = 'yes';
    });
  });

  afterAll(() => {
    delete URL.createObjectURL; // returns jsdom to its original (absent) state
    delete URL.revokeObjectURL;
  });

  it('returns false when there is no document (non-browser environment)', () => {
    vi.stubGlobal('document', undefined);
    expect(typeof document === 'undefined').toBe(true);
    expect(downloadFile('f.txt', 'content', 'text/plain')).toBe(false);
  });

  it('creates a Blob, clicks a download anchor, and reports success', () => {
    const clicks = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function capture() {
      clicks.push(this);
    });

    const clicked = downloadFile('trading-journal.csv', 'h1,h2', 'text/csv');
    expect(clicked).toBe(true);
    const blob = URL.createObjectURL.mock.calls.at(-1)[0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/csv');

    const anchor = clicks.at(-1);
    expect(anchor.download).toBe('trading-journal.csv');
    expect(anchor.href).toBe('blob:fake-url');
    // The anchor has already been detached after the click.
    expect(document.querySelector('a[download="trading-journal.csv"]')).toBeNull();
  });
});
