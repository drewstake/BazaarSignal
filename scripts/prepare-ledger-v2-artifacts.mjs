// Local-only packaging. Never imports credentials or calls a production endpoint.
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, readdirSync, symlinkSync, lstatSync } from 'node:fs';
import { resolve, join, dirname, relative } from 'node:path';
import { build } from 'esbuild';
import { loadEnv } from 'vite';

const root = resolve(import.meta.dirname, '..');
const [destination] = process.argv.slice(2);
if (process.argv.length !== 3 || !/^\.local\/[a-z0-9-]+$/.test(destination ?? ''))
  throw Error('Usage: node scripts/prepare-ledger-v2-artifacts.mjs .local/<new-packet-directory>');
const out = resolve(root, destination), baseline = join(root, '.local/cadence-oct21-site');
if (existsSync(out)) throw Error('Packet directory already exists; refusing overwrite');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const hashFile = path => sha(readFileSync(path));
const save = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: root, encoding: 'utf8' }).split('\0').filter(Boolean);
const compatibility = ['collector/paid-budget.ts','collector/paid-ledger-storage.ts',
  'collector/google-cache-store.ts','collector/trial-google.ts','apps-script/admin-report.ts'];
const candidateOnly = ['apps-script/backend.ts','apps-script/portfolio-backend.ts','apps-script/store.ts',
  'src/companion/BazaarItemPage.tsx','src/companion/bazaar-search-data.ts','src/companion/request-cache.ts'];
const testFiles = ['tests/paid-ledger-size.test.ts','tests/paid-budget.test.ts','tests/paid-runtime-cache.test.ts',
  'tests/paid-write-throttle.test.ts','tests/support/paid-runtime-fixture.ts'];
const candidateTests = ['tests/portfolio-backend.test.ts','tests/paid-mail.test.ts','tests/bazaar-search.test.ts',
  'tests/search-browser/search.spec.ts','tests/search-browser/item-refresh.spec.ts'];
mkdirSync(out, { recursive: false });
const provenance = { observedAt: '2026-10-21', liveStateRevalidated: false, baseline,
  sourceManifestSha256: hashFile(join(root,'.local/cadence-oct21-source.json')),
  compatibility, candidateOnly, changesOutsideAllowlist: [] };

// Rebuild the historical server sources in memory and compare archived deployment receipts.
async function serverBundle(cwd, script = false) {
  const result = await build({ absWorkingDir: cwd,
    entryPoints: [script ? 'apps-script/backend.ts' : 'market-functions/src/index.ts'],
    bundle: true, write: false, ...(script ? { format:'iife',globalName:'BazaarBackend',target:'es2020' } :
      { platform:'node',target:'node24',format:'cjs',external:['firebase-admin','firebase-admin/*','firebase-functions','firebase-functions/*'] }) });
  return result.outputFiles[0].contents;
}
const oldImage = read(join(root,'.local/market-image-br9tOa/receipt.json'));
const scriptProof = read(join(root,'.local/cadence-oct21-script-verified.json'));
const oldCloud = await serverBundle(baseline), oldWorker = await serverBundle(baseline,true);
// The archived staging tree uses a dependency junction. Only esbuild's source
// path comments differ; canonicalize that exact comment prefix, never code.
const canonical = bytes => Buffer.from(Buffer.from(bytes).toString().replace(/^(\s*\/\/ )(?:\.\.\/)+node_modules\//gm,'$1node_modules/'));
if (sha(canonical(oldCloud)) !== oldImage.sourceSha256 || sha(canonical(oldWorker).toString().trim()) !== scriptProof.files.find(f=>f.file==='Backend.js').sha256) {
  writeFileSync(join(out,'baseline-cloud.cjs'),oldCloud);
  writeFileSync(join(out,'baseline-worker.js'),oldWorker);
  throw Error(`Historical source does not reproduce archived hashes: cloud ${sha(oldCloud)} worker ${sha(oldWorker)}`);
}
for (const file of read(join(root,'.local/cadence-oct21-hosting-verified.json')).files)
  if (hashFile(join(baseline,'dist',file.file)) !== file.sha256) throw Error('Historical Hosting artifact changed');
provenance.cloud = { sourceSha256:sha(canonical(oldCloud)),rawRebuildSha256:sha(oldCloud),imageDigest:oldImage.imageDigest };
provenance.worker = { version:scriptProof.version,sourceSha256:sha(canonical(oldWorker).toString().trim()),rawRebuildSha256:sha(oldWorker),historicalReceiptUsesTrim:true };
provenance.pathCommentNormalization = 'Only esbuild // ../../node_modules/ comments are canonicalized to // node_modules/; the historical Apps Script receipt hashes trimmed source.';

// Only public Firebase fields are read. Do not copy .env files, login caches or private state.
const publicConfig = loadEnv('production', root, 'VITE_FIREBASE_');
for (const key of ['API_KEY','AUTH_DOMAIN','PROJECT_ID','APP_ID'])
  if (!publicConfig[`VITE_FIREBASE_${key}`]) throw Error('Saved public Firebase configuration is incomplete');
if (publicConfig.VITE_FIREBASE_PROJECT_ID !== 'bazaarsignal') throw Error('Unexpected public Firebase project');
const scriptUrl = readFileSync(join(root,'scripts/build-paid-site.mjs'),'utf8').match(/VITE_APPS_SCRIPT_URL:'([^']+)'/)?.[1];
const priorJs = readdirSync(join(baseline,'dist/assets')).filter(f=>f.endsWith('.js'))
  .map(f=>readFileSync(join(baseline,'dist/assets',f),'utf8')).join('\n');
for (const value of [...Object.values(publicConfig),scriptUrl])
  if (!value || !priorJs.includes(value)) throw Error('Public build configuration differs from historical deployed artifact');
const env = { ...process.env, ...publicConfig, VITE_CONFIG_NATIVE_IGNORE_WARNING:'true',
  VITE_APPS_SCRIPT_URL:scriptUrl,VITE_MARKET_OPERATING_MODE:'paid-budget',VITE_MARKET_TRIAL_ID:'paid-202610',
  VITE_MARKET_TRIAL_END:'2026-11-01T07:00:00.000Z',VITE_MARKET_UPDATES_PAUSED:'false',
  VITE_MARKET_API_URL:'https://marketapi-k5a64sgi2q-uc.a.run.app',
  VITE_PRICE_HISTORY_URL:'https://marketapi-k5a64sgi2q-uc.a.run.app/api/price-history',
  VITE_USE_EMULATORS:'false',VITE_LOCAL_WORKSPACE:'false',LOCAL_SHARED_MARKET:'false',
  LOCAL_CLOUD_HISTORY:'false',LOCAL_DAILY_HISTORY:'false',MARKET_SCHEDULER_DISABLED:'1',
  npm_config_offline:'true',npm_config_audit:'false',npm_config_fund:'false' };
save(join(out,'public-build-config.json'), Object.fromEntries(Object.entries(env).filter(([k])=>k.startsWith('VITE_'))));

function run(cwd, label, args) {
  const result = spawnSync(process.execPath, args, { cwd, env, encoding:'utf8',windowsHide:true,timeout:240000,maxBuffer:4*1024**2 });
  writeFileSync(join(out,`${label}.log`), (result.stdout ?? '') + (result.stderr ?? ''));
  if (result.error || result.status !== 0) throw Error(`${label} failed; inspect the local log (${result.error?.message ?? result.status})`);
}
function inventory(dir, prefix='') {
  return readdirSync(dir).sort().flatMap(name=>{
    const file=join(dir,name), path=prefix+name, stat=lstatSync(file);
    if(stat.isSymbolicLink())throw Error('Unexpected artifact symlink');
    return stat.isDirectory()?inventory(file,path+'/'):[{path,bytes:stat.size,sha256:hashFile(file)}];
  });
}
const packet = {version:1,preparedAt:new Date().toISOString(),productionExecutionEnabled:false,
  expiry:'2026-11-01T07:00:00.000Z',provenance,artifacts:{},
  fallbackLimitation:'The cloud fallback intentionally retains the identical v2 accounting implementation. It cannot undo a ledger defect; contain and forward-repair that defect.',
  pending:['Fresh production management evidence','Execution adapter and authorization review','Natural-run production verification']};
for (const flavor of ['candidate','fallback']) {
  const cwd = join(out,flavor); mkdirSync(cwd);
  const overlay = new Set([...compatibility,...testFiles,...(flavor==='candidate'?[...candidateOnly,...candidateTests]:[])]);
  const files = new Set([...tracked.filter(f=>existsSync(join(baseline,f))),...overlay]);
  const manifest=[];
  for (const file of [...files].sort()) {
    if (file.startsWith('.') && !['.gitignore','.env.example'].includes(file)) continue;
    const source=join(overlay.has(file)?root:baseline,file), target=join(cwd,file);
    if (!existsSync(source)) throw Error(`Missing staged source ${file}`);
    mkdirSync(dirname(target),{recursive:true}); copyFileSync(source,target);
    manifest.push({path:file,sha256:hashFile(target),origin:overlay.has(file)?'reviewed-fix':'historical-release'});
  }
  symlinkSync(join(root,'node_modules'),join(cwd,'node_modules'),'junction');
  // The existing image builder uses npm_execpath but never deploys; require offline installation.
  const npmCli=process.env.npm_execpath || resolve(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  if(!existsSync(npmCli))throw Error('Cannot locate the current npm CLI');
  env.npm_execpath=npmCli;
  for(const [label,args] of [
    ['types',[join(root,'node_modules/typescript/bin/tsc'),'--noEmit']],
    ['collector-types',[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','-p','collector/tsconfig.json']],
    ['worker-types',[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','-p','apps-script/tsconfig.json']],
    ['cloud-types',[join(root,'node_modules/typescript/bin/tsc'),'--noEmit','-p','market-functions/tsconfig.json']],
    ['site',[join(root,'node_modules/vite/bin/vite.js'),'build']],
    ['worker',['scripts/build-apps-script.mjs']],
    ['cloud',['scripts/build-market-functions.mjs']],
    ['image',['scripts/build-market-image.mjs']],
  ]) { console.log(`${flavor}: ${label}`); run(cwd,`${flavor}-${label}`,args); }
  const imageDir=readdirSync(join(cwd,'.local')).find(n=>n.startsWith('market-image-'));
  if(!imageDir)throw Error('Missing generated image');
  run(cwd,`${flavor}-image-smoke`,['scripts/verify-market-image.mjs',join(cwd,'.local',imageDir)]);
  const image=read(join(cwd,'.local',imageDir,'receipt.json'));
  const outputs={hosting:inventory(join(cwd,'dist')),appsScript:inventory(join(cwd,'apps-script/build'))};
  save(join(out,`${flavor}-source-manifest.json`),manifest);
  save(join(out,`${flavor}-output-manifest.json`),outputs);
  packet.artifacts[flavor]={sourceDirectory:cwd,sourceManifestSha256:hashFile(join(out,`${flavor}-source-manifest.json`)),
    outputManifestSha256:hashFile(join(out,`${flavor}-output-manifest.json`)),
    imageDirectory:join(cwd,'.local',imageDir),imageDigest:image.imageDigest,
    imageReceiptSha256:hashFile(join(cwd,'.local',imageDir,'receipt.json')),
    localRuntimeSmokeVerified:image.localRuntimeSmokeVerified,cloudRuntimeVerified:false,uploaded:false,
    hostingSha256:sha(JSON.stringify(outputs.hosting)),appsScriptSha256:sha(JSON.stringify(outputs.appsScript)),
    ledgerFormats:[1,2],writesLedgerVersion:2};
}
const commonCloud=packet.artifacts.candidate.imageDigest===packet.artifacts.fallback.imageDigest;
packet.sharedCloudArtifact=commonCloud;
packet.workspaceDifferencesExcluded=tracked.filter(f=>existsSync(join(baseline,f)) &&
  ![...compatibility,...candidateOnly,...testFiles,...candidateTests].includes(f) && hashFile(join(root,f))!==hashFile(join(baseline,f)));
save(join(out,'packet.json'),packet);
console.log(JSON.stringify({packet:join(out,'packet.json'),artifacts:packet.artifacts,sharedCloudArtifact:commonCloud},null,2));
