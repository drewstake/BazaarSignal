// Explicit operating mode, enabled only by a coordinated deployment. Historical
// paid/free-tier releases retain their deadlines and stopped ledgers.
export const CONTINUOUS_MARKET_MODE = 'continuous';
export const CONTINUOUS_MARKET_ID = 'continuous-v1';
export const CONTINUOUS_LEDGER_KEY = 'market-operations';
export const continuousMarket = (mode: string | null | undefined) => mode === CONTINUOUS_MARKET_MODE;
