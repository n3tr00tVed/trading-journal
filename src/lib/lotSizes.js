/**
 * Market lot sizes (Indian F&O focus).
 * Cash-market stocks trade in units of 1 share, so an unknown symbol
 * defaults to lot size 1. Curated defaults for popular futures/options
 * instruments; the user can always override the lot size in the
 * calculator for their specific contract.
 */

export const DEFAULT_LOT_SIZE = 1;

export const LOT_SIZES = {
  // Index futures/options (NSE)
  NIFTY: 75,
  BANKNIFTY: 35,
  FINNIFTY: 65,
  MIDCPNIFTY: 140,
  NIFTYNXT50: 25,
  // BSE
  SENSEX: 20,
  BANKEX: 60,
  SENSEX50: 60,
  // MCX commodity futures (indicative 2025 figures)
  GOLD: 100,
  GOLDM: 10,
  GOLDPETAL: 20,
  SILVER: 30,
  SILVERM: 5,
  SILVERMIC: 1,
  CRUDEOIL: 100,
  CRUDEOILM: 10,
  NATURALGAS: 1250,
  COPPER: 2500,
  ZINC: 5000,
  ALUMINIUM: 5000,
  LEAD: 5000,
  NICKEL: 15000,
  // NSE currency derivatives (USDINR / others)
  USDINR: 1000,
  EURINR: 1000,
  GBPINR: 1000,
  JPYINR: 1000,
};

/** Lot size for a symbol (case-insensitive, trailing month codes tolerated). */
export function lotSizeFor(symbol, market = 'stocks') {
  if (market === 'stocks') return 1;
  if (typeof symbol !== 'string') return DEFAULT_LOT_SIZE;
  const key = symbol.trim().toUpperCase().replace(/\d+[\w]*$/, '').trim();
  if (LOT_SIZES[key]) return LOT_SIZES[key];
  const bare = key.replace(/[^A-Z]/g, '');
  return LOT_SIZES[bare] ?? DEFAULT_LOT_SIZE;
}
