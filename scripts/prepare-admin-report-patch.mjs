// Preserve the newer production release when this checkout predates it.
// Inputs are exact, retained production artifacts. Each replacement must match
// once; only reporting code changes. Never rebuild/deploy the older application.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const base = process.argv[2];
if (!/^\.local\/[a-z0-9-]+$/.test(base ?? '')) throw Error('Supply a retained release directory.');
const read = name => fs.readFileSync(`${base}/${name}`, 'utf8');
const once = (text, from, to) => {
  if (text.split(from).length !== 2) throw Error(`Production anchor is not unique: ${from.slice(0,100)}`);
  return text.replace(from, to);
};
const saved = JSON.parse(read('saved.json'));
const deployed = JSON.parse(read('deployed-script.json'));
for (const file of saved.files) if (file.source !== deployed.files.find(f => f.name === file.name)?.source) throw Error('Saved source differs from deployed source.');
const patch = {files:saved.files.map(f=>({...f}))};
const backend = patch.files.find(f=>f.name==='Backend');
backend.source = once(backend.source, 'return readOwnerUsageReport(identity);', 'return ResourceReporting.readResourceReport(identity);');
backend.source = once(backend.source, 'if (!marketServiceActive(mode, now)) return { ok: true, paused: true };', '// Admin reporting is independent of market activation.');
backend.source = once(backend.source, '"ADMIN_DAILY_SNAPSHOT"', '"ADMIN_DAILY_SNAPSHOT_REPORTING_V2"');
const reportAdapter = 'const report = measureAdmin(\n      (url) => {\n        const r = UrlFetchApp.fetch(url, {\n          headers: { Authorization: `Bearer ${token}` },';
backend.source = once(backend.source, reportAdapter, reportAdapter.replace('headers: { Authorization: `Bearer ${token}` },', 'headers: { Authorization: `Bearer ${token}`, "x-goog-user-project": url.startsWith("https://monitoring.googleapis.com/") || url.includes("/projects/bazaarsignal-510305/") ? "bazaarsignal-510305" : "bazaarsignal" },'));
const entry = patch.files.find(f=>f.name==='Entrypoints');
entry.source = once(entry.source,
  'function scheduledPaidMinuteTick() { return BazaarBackend.scheduledPaidMinuteTick(); }',
  'function scheduledPaidMinuteTick() { try { ResourceReporting.scheduledResourceTick(); } catch (e) { console.error("Resource reporting failed; next attempt is tomorrow."); } return BazaarBackend.scheduledPaidMinuteTick(); }');
entry.source += '\nfunction authorizeReporting() { console.log(JSON.stringify(ResourceReporting.refreshResourcesAfterAuthorization())); }\n';
const manifest = patch.files.find(f=>f.name==='appsscript'), config=JSON.parse(manifest.source);
config.oauthScopes.push('https://www.googleapis.com/auth/cloud-platform');
config.oauthScopes=[...new Set(config.oauthScopes)];
manifest.source=JSON.stringify(config,null,2);
const result=await build({entryPoints:['apps-script/resource-report.ts'],bundle:true,format:'iife',globalName:'ResourceReporting',target:'es2020',write:false});
patch.files.push({name:'ResourceReporting',type:'SERVER_JS',source:result.outputFiles[0].text});
fs.writeFileSync(`${base}/script-patch.json`,JSON.stringify(patch,null,2));

let admin=read('live-admin.js');
const replace=(from,to)=>{admin=once(admin,from,to);};
replace('o={until:1/0,value:a}', 'o={until:b(r)+6e4,value:a}');
replace('return w.set(n,o),a.catch', 'return w.set(n,o),a.then(e=>{o.until=Math.min(o.until,Math.max(r+6e4,e.nextMeasurementAt+6e4))}).catch(()=>{}),a.catch');
replace('P=(0,g.useRef)(null),F=', 'P=(0,g.useRef)(null),reportReadAfter=(0,g.useRef)(0),F=');
replace('async function I(){if(r)return;', 'async function I(){if(r)return;reportReadAfter.current=Date.now()+300000;');
replace('F(t)&&n(r)', 'F(t)&&(n(r),reportReadAfter.current=Math.max(reportReadAfter.current,r.nextRefreshAt+60000))');
replace('async function L(){if(v||w)return;', '(0,g.useEffect)(()=>{if(_>=reportReadAfter.current&&document.visibilityState!=="hidden"){void I();if(v)void L()}},[_]);async function L(){if(w)return;');
replace('children:`Historical free-tier report · October 2026`', 'children:`Resource usage · ${v?new Intl.DateTimeFormat("en-US",{month:"long",year:"numeric",timeZone:"America/Los_Angeles"}).format(v.generatedAt):"updates daily"}`');
replace('This archived report predates the paid pilot. Its allowance percentages and paused status do not describe the current operating budget.', 'Automatically measured daily. Monthly counters reset with the Pacific calendar; daily counters and storage capacity use the periods shown below. These measurements describe usage, not Google charges or spending limits.');
replace('Loading historical report…','Loading resource report…');
replace('`. Collection was`,` `,v.collection.state.toLowerCase(),` as measured`,` `,O(v.collection.measuredAt),`.`', '`. Next scheduled update `,O(v.nextMeasurementAt),` · ${_>=v.nextMeasurementAt+60000?"Update overdue; last saved measurements shown.":"Provider data may arrive late."}`');
replace('(0,D.jsx)(`th`,{children:`Historical measurement`})', '(0,D.jsx)(`th`,{children:`Project / period`}),(0,D.jsx)(`th`,{children:`Measurement`})');
replace('(0,D.jsx)(`td`,{children:e.resource})', '(0,D.jsx)(`td`,{children:e.resource}),(0,D.jsxs)(`td`,{children:[e.project,(0,D.jsx)(`br`,{}),e.periodLabel]})');
replace('(0,D.jsx)(`td`,{children:e.measured==null?', '(0,D.jsx)(`td`,{title:e.coverageDetail,children:e.measured==null?');
fs.writeFileSync(`${base}/patched-admin.js`,admin);
const sha=text=>createHash('sha256').update(text).digest('hex');
fs.writeFileSync(`${base}/patch-summary.json`,JSON.stringify({
  scriptBefore:saved.files.map(f=>({name:f.name,sha256:sha(f.source)})),
  scriptAfter:patch.files.map(f=>({name:f.name,sha256:sha(f.source)})),
  adminBefore:sha(read('live-admin.js')),adminAfter:sha(admin),
  preserved:'All existing non-reporting production code; no market deployment, schedule, ledger, budget, or email changes.',
},null,2));
console.log('Prepared reporting-only script and frontend patches. Nothing deployed.');
