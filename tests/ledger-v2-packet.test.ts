import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
// @ts-expect-error local ESM verifier
import {verifyPacket} from '../scripts/verify-ledger-v2-packet.mjs';
const hash=(b:string|Buffer)=>createHash('sha256').update(b).digest('hex');
const roots:string[]=[];
afterEach(()=>{
  for(const root of roots.splice(0)) {
    if(dirname(root)!==resolve(tmpdir())||!root.split(/[\\/]/).at(-1)?.startsWith('bazaar-ledger-packet-'))throw Error('Unsafe fixture cleanup');
    rmSync(root,{recursive:true});
  }
});
function fixture() {
  const root=mkdtempSync(join(tmpdir(),'bazaar-ledger-packet-'));roots.push(root);
  const put=(path:string,value:any)=>{mkdirSync(dirname(path),{recursive:true});const b=typeof value==='string'?value:JSON.stringify(value);writeFileSync(path,b);return hash(b);};
  const packet:any={version:1,productionExecutionEnabled:false,provenance:{liveStateRevalidated:false},expiry:'2026-11-01T07:00:00.000Z',artifacts:{}};
  for(const flavor of ['candidate','fallback']) {
    const source=join(root,flavor),image=join(source,'.local/image');
    const sourceHash=put(join(source,'market-functions/lib/index.cjs'),'fixture cloud');
    const lockHash=put(join(source,'market-functions/package-lock.json'),'{}');
    const manifest=[{path:'fixture.ts',sha256:put(join(source,'fixture.ts'),'fixture source')}];
    const output:any={hosting:[],appsScript:[]};
    for(const [group,dir]of [['hosting','dist'],['appsScript','apps-script/build']]) {
      const content=`fixture ${group}`;
      output[group]=[{path:'fixture.js',bytes:Buffer.byteLength(content),sha256:put(join(source,dir,'fixture.js'),content)}];
    }
    const blob=(value:any)=>{const b=JSON.stringify(value),h=hash(b);put(join(image,'oci/blobs/sha256',h),b);return {digest:'sha256:'+h,size:Buffer.byteLength(b)};};
    const config=blob({architecture:'amd64'}),layer=blob('synthetic-layer'),oci=blob({config,layers:[layer]});
    const receipt={imageDigest:oci.digest,applicationOnly:true,localRuntimeSmokeVerified:true,cloudBuildMinutes:0,uploaded:false,
      localRuntimeSmoke:{outboundConnections:'blocked',handlerRequests:0},sourceSha256:sourceHash,lockSha256:lockHash};
    packet.artifacts[flavor]={sourceDirectory:source,ledgerFormats:[1,2],writesLedgerVersion:2,localRuntimeSmokeVerified:true,uploaded:false,
      sourceManifestSha256:put(join(root,`${flavor}-source-manifest.json`),manifest),outputManifestSha256:put(join(root,`${flavor}-output-manifest.json`),output),
      hostingSha256:hash(JSON.stringify(output.hosting)),appsScriptSha256:hash(JSON.stringify(output.appsScript)),
      imageDirectory:image,imageDigest:oci.digest,imageReceiptSha256:put(join(image,'receipt.json'),receipt)};
  }
  const path=join(root,'packet.json');put(path,packet);
  return {root,path,packet,put,save:()=>put(path,packet)};
}
it('verifies an entirely isolated packet and hashes its exact bytes',()=>{
  const f=fixture(),result=verifyPacket(f.path);expect(result.packetSha256).toBe(hash(readFileSync(f.path)));
});
it.each(['source','hosting','extra-output','receipt','blob','manifest','cloud-source','lock'])('rejects %s artifact tampering',kind=>{
  const f=fixture(),a=f.packet.artifacts.candidate;
  const paths:any={source:join(a.sourceDirectory,'fixture.ts'),hosting:join(a.sourceDirectory,'dist/fixture.js'),
    'extra-output':join(a.sourceDirectory,'dist/injected.js'),receipt:join(a.imageDirectory,'receipt.json'),
    blob:join(a.imageDirectory,'oci/blobs/sha256',a.imageDigest.slice(7)),manifest:join(f.root,'candidate-source-manifest.json'),
    'cloud-source':join(a.sourceDirectory,'market-functions/lib/index.cjs'),lock:join(a.sourceDirectory,'market-functions/package-lock.json')};
  f.put(paths[kind],'modified');expect(()=>verifyPacket(f.path)).toThrow();
});
it('rejects manifest traversal even if its replacement hash is supplied',()=>{
  const f=fixture();f.packet.artifacts.candidate.sourceManifestSha256=f.put(join(f.root,'candidate-source-manifest.json'),[{path:'../packet.json',sha256:hash(readFileSync(f.path))}]);f.save();
  expect(()=>verifyPacket(f.path)).toThrow('escapes');
});
it('rejects linked directories even when the target bytes match',()=>{
  const f=fixture(),a=f.packet.artifacts.candidate;
  mkdirSync(join(f.root,'linked-source'));f.put(join(f.root,'linked-source/fixture.ts'),'fixture source');
  symlinkSync(join(f.root,'linked-source'),join(a.sourceDirectory,'link'),'junction');
  a.sourceManifestSha256=f.put(join(f.root,'candidate-source-manifest.json'),[{path:'link/fixture.ts',sha256:hash('fixture source')}]);f.save();
  expect(()=>verifyPacket(f.path)).toThrow('link');
});
it.each(['live','v1','uploaded','network-smoke'])('rejects an incompatible %s packet',kind=>{
  const f=fixture(),a=f.packet.artifacts.candidate;
  if(kind==='live')f.packet.productionExecutionEnabled=true;
  if(kind==='v1')a.ledgerFormats=[1];
  if(kind==='uploaded')a.uploaded=true;
  if(kind==='network-smoke'){
    const p=join(a.imageDirectory,'receipt.json'),receipt=JSON.parse(readFileSync(p,'utf8'));receipt.localRuntimeSmoke.outboundConnections='allowed';a.imageReceiptSha256=f.put(p,receipt);
  }
  f.save();expect(()=>verifyPacket(f.path)).toThrow();
});
it('refuses --apply before loading any packet or creating output',()=>{
  const result=spawnSync(process.execPath,['scripts/rehearse-ledger-v2.mjs','--apply'],{encoding:'utf8',windowsHide:true});
  expect(result.status).toBe(1);expect(result.stderr).toContain('Production execution is disabled');
});
