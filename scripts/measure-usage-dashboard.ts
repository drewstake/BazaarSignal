// Operator read-only diagnostic. Outputs no credentials or private user records.
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { measureDashboard } from '../collector/usage-dashboard';
import { trialGoogleStore } from '../collector/trial-google';
const require=createRequire(import.meta.url),auth=require('firebase-tools/lib/auth');
const account=auth.getAllAccounts().find((a:any)=>a.user.email==='drewstake3@gmail.com');
if(!account)throw new Error('Deployment account unavailable');
const credential=await auth.getAccessToken(account.tokens.refresh_token,[]);
const token=async()=>credential.access_token;
const result=await measureDashboard({store:trialGoogleStore({project:'bazaarsignal-510305',bucket:'bazaarsignal-510305-market-cache',token}),token});
writeFileSync('.local/usage-dashboard-measured.json',JSON.stringify(result,null,2));
console.log(JSON.stringify({at:result.generatedAt,collection:result.collection,rows:result.rows.map(r=>({id:r.id,state:r.state,measured:r.measured,at:r.measuredAt,projected:r.projected}))},null,2));
