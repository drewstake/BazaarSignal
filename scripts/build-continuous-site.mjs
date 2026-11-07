// Build the explicitly selected continuous service. Does not deploy or activate it.
import { spawnSync } from 'node:child_process';
import { CONTINUOUS_MARKET_ID, CONTINUOUS_MARKET_MODE } from '../shared/continuous-market.ts';
import { PAID_MARKET_ORIGIN } from '../shared/paid-pilot.ts';

const response = await fetch('https://bazaarsignal.web.app/__/firebase/init.json', {
  redirect: 'error', signal: AbortSignal.timeout(15000),
});
if (!response.ok) throw Error(`Firebase public configuration HTTP ${response.status}`);
const c = await response.json();
if (c.projectId !== 'bazaarsignal' || !c.apiKey || !c.authDomain || !c.appId)
  throw Error('Existing Firebase configuration incomplete');
const env = { ...process.env, VITE_CONFIG_NATIVE_IGNORE_WARNING: 'true',
  VITE_FIREBASE_API_KEY: c.apiKey, VITE_FIREBASE_AUTH_DOMAIN: c.authDomain,
  VITE_FIREBASE_PROJECT_ID: c.projectId, VITE_FIREBASE_APP_ID: c.appId,
  VITE_APPS_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzcKMazci0idgnN_tyccU8Q2ab6KRGWKm9Wo363sSwgIt946DmAcO_VU3yVSspplIat9Q/exec',
  VITE_MARKET_OPERATING_MODE: CONTINUOUS_MARKET_MODE, VITE_MARKET_TRIAL_ID: CONTINUOUS_MARKET_ID,
  VITE_MARKET_TRIAL_END: '', VITE_MARKET_UPDATES_PAUSED: 'false',
  VITE_MARKET_API_URL: PAID_MARKET_ORIGIN, VITE_PRICE_HISTORY_URL: `${PAID_MARKET_ORIGIN}/api/price-history`,
  VITE_USE_EMULATORS: 'false', VITE_LOCAL_WORKSPACE: 'false' };
for (const args of [['node_modules/typescript/bin/tsc', '--noEmit'], ['node_modules/vite/bin/vite.js', 'build']]) {
  const result = spawnSync(process.execPath, args, { env, stdio: 'inherit' });
  if (result.error || result.status !== 0) throw Error('Continuous site build failed');
}
