import { PAID_PILOT_END, PAID_PILOT_ID } from '../shared/paid-pilot.ts';

// Reading the existing public API does not start a collector or renew its budget.
// A separate URL namespace keeps old SQLite snapshots out of the shared cache.
export function localMarketEnvironment(offline = false) {
  return {
    LOCAL_SHARED_MARKET: offline ? 'false' : 'true',
    LOCAL_CLOUD_HISTORY: offline ? 'false' : 'true',
    LOCAL_DAILY_HISTORY: 'false',
    VITE_PRICE_HISTORY_URL: '',
    VITE_LOCAL_MARKET_PREVIEW: offline ? 'true' : 'false',
    VITE_MARKET_API_URL: offline ? '' : '/live-market',
    VITE_MARKET_OPERATING_MODE: offline ? '' : 'paid-budget',
    VITE_MARKET_TRIAL_ID: offline ? '' : PAID_PILOT_ID,
    VITE_MARKET_TRIAL_END: offline ? '' : new Date(PAID_PILOT_END).toISOString(),
    VITE_MARKET_UPDATES_PAUSED: offline || Date.now() >= PAID_PILOT_END ? 'true' : 'false',
    MARKET_SCHEDULER_DISABLED: '1',
  };
}
