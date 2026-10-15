// Reproducible fixed-period paid site build. Public Firebase configuration comes
// from this existing Hosting site's reserved endpoint; no secret is embedded.
import {spawnSync} from 'node:child_process';
import { PAID_PILOT_END, PAID_PILOT_ID, PAID_MARKET_ORIGIN } from '../shared/paid-pilot.ts';
const end=new Date(PAID_PILOT_END).toISOString();
if(Date.now()>=Date.parse(end))throw Error('October pilot expired; review before another release');
const r=await fetch('https://bazaarsignal.web.app/__/firebase/init.json',{redirect:'error',signal:AbortSignal.timeout(15000)});
if(!r.ok)throw Error(`Public Firebase configuration HTTP ${r.status}`);
const c=await r.json();
if(c.projectId!=='bazaarsignal'||!c.apiKey||!c.authDomain||!c.appId)throw Error('Existing Firebase configuration incomplete');
const env={...process.env,VITE_CONFIG_NATIVE_IGNORE_WARNING:'true',VITE_FIREBASE_API_KEY:c.apiKey,VITE_FIREBASE_AUTH_DOMAIN:c.authDomain,VITE_FIREBASE_PROJECT_ID:c.projectId,VITE_FIREBASE_APP_ID:c.appId,
  VITE_APPS_SCRIPT_URL:'https://script.google.com/macros/s/AKfycbzcKMazci0idgnN_tyccU8Q2ab6KRGWKm9Wo363sSwgIt946DmAcO_VU3yVSspplIat9Q/exec',
  VITE_MARKET_OPERATING_MODE:'paid-budget',VITE_MARKET_TRIAL_ID:PAID_PILOT_ID,VITE_MARKET_TRIAL_END:end,VITE_MARKET_UPDATES_PAUSED:'false',VITE_MARKET_API_URL:PAID_MARKET_ORIGIN,VITE_USE_EMULATORS:'false',VITE_LOCAL_WORKSPACE:'false'};
for(const args of [['node_modules/typescript/bin/tsc','--noEmit'],['node_modules/vite/bin/vite.js','build']]) {
  const run=spawnSync(process.execPath,args,{env,stdio:'inherit',windowsHide:true});if(run.error||run.status!==0)throw Error('Paid site build failed');
}
