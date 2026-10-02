import { loadEnv } from 'vite';

// Exercise the same bounded operating period as the production build. Missing
// usage metadata deliberately pauses production reads, so mocks must include it.
export function productionUsage() {
  const env = loadEnv('production', process.cwd(), 'VITE_MARKET_');
  return {
    mode: 'normal',
    pollMs: 3600_000,
    trialId: env.VITE_MARKET_TRIAL_ID,
    expiresAt: Date.parse(env.VITE_MARKET_TRIAL_END),
  };
}
