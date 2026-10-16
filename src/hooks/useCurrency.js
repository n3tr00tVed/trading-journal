import { createContext, useContext } from 'react';

/**
 * Currency context. App provides { currency, setCurrency } so every money
 * display and the calculator follow the same preference (INR default).
 */
export const CurrencyContext = createContext({ currency: 'INR', setCurrency: () => {} });

export function useCurrency() {
  return useContext(CurrencyContext);
}
