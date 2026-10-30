import { readFileSync, lstatSync, readdirSync } from 'node:fs';
import { resolve, dirname, relative, isAbsolute, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const hash=b=>createHash('sha256').update(b).digest('hex');
function inside(root,path) {
  const p=resolve(root,path), rel=relative(root,p);
  if(rel==='..'||rel.startsWith('../')||rel.startsWith('..\\')||isAbsolute(rel))throw Error('Packet path escapes its directory');
  let cursor=p;
  while(true) {
    if(lstatSync(cursor).isSymbolicLink())throw Error('Packet path traverses a link');
    if(cursor===root)break;
    cursor=dirname(cursor);
  }
  return p;
}
function bytes(path) {
  if(!lstatSync(path).isFile())throw Error('Packet entry is not a regular file');
  return readFileSync(path);
}
function json(path) {const b=bytes(path);if(b.length>8*1024**2)throw Error('Manifest exceeds bound');return JSON.parse(b);}
function inventory(root,prefix='') {
  return readdirSync(root).sort().flatMap(name=>{
    const path=join(root,name),stat=lstatSync(path);
    if(stat.isSymbolicLink())throw Error('Packet path traverses a link');
    return stat.isDirectory()?inventory(path,prefix+name+'/'):[prefix+name];
  });
}
export function verifyPacket(path) {
  const packetPath=resolve(path),root=dirname(packetPath),packet=json(packetPath);
  if(packet.version!==1 || packet.productionExecutionEnabled!==false || packet.provenance.liveStateRevalidated!==false ||
      packet.expiry!=='2026-11-01T07:00:00.000Z')throw Error('Unexpected release packet scope');
  for(const flavor of ['candidate','fallback']) {
    const a=packet.artifacts[flavor],source=inside(root,flavor);
    if(resolve(a.sourceDirectory)!==source || a.writesLedgerVersion!==2 || JSON.stringify(a.ledgerFormats)!=='[1,2]' ||
        !a.localRuntimeSmokeVerified || a.uploaded!==false)throw Error('Incompatible or nonlocal artifact');
    for(const [name,expected]of [['source',a.sourceManifestSha256],['output',a.outputManifestSha256]])
      if(hash(bytes(join(root,`${flavor}-${name}-manifest.json`)))!==expected)throw Error('Manifest hash mismatch');
    for(const f of json(join(root,`${flavor}-source-manifest.json`)))
      if(hash(bytes(inside(source,f.path)))!==f.sha256)throw Error(`Source changed: ${flavor}/${f.path}`);
    const output=json(join(root,`${flavor}-output-manifest.json`));
    for(const [group,directory]of [['hosting','dist'],['appsScript','apps-script/build']]) {
      if(hash(JSON.stringify(output[group]))!==a[`${group}Sha256`])throw Error('Output group hash mismatch');
      if(JSON.stringify(inventory(join(source,directory)).sort())!==JSON.stringify(output[group].map(f=>f.path).sort()))
        throw Error('Output inventory changed');
      for(const f of output[group]) {const b=bytes(inside(join(source,directory),f.path));
        if(b.length!==f.bytes||hash(b)!==f.sha256)throw Error(`Output changed: ${flavor}/${f.path}`);}
    }
    const image=inside(source,a.imageDirectory),receiptPath=join(image,'receipt.json');
    if(hash(bytes(receiptPath))!==a.imageReceiptSha256)throw Error('Image receipt changed');
    const receipt=json(receiptPath);
    if(receipt.imageDigest!==a.imageDigest || !receipt.applicationOnly || !receipt.localRuntimeSmokeVerified ||
        receipt.cloudBuildMinutes!==0 || receipt.uploaded || receipt.localRuntimeSmoke?.outboundConnections!=='blocked' ||
        receipt.localRuntimeSmoke?.handlerRequests!==0 ||
        receipt.sourceSha256!==hash(bytes(join(source,'market-functions/lib/index.cjs'))) ||
        receipt.lockSha256!==hash(bytes(join(source,'market-functions/package-lock.json'))))throw Error('Image receipt contract mismatch');
    const blob=d=>{
      if(!/^sha256:[a-f0-9]{64}$/.test(d))throw Error('Invalid OCI digest');
      const b=bytes(join(image,'oci/blobs/sha256',d.slice(7)));if('sha256:'+hash(b)!==d)throw Error('OCI content hash mismatch');return b;
    };
    const manifest=JSON.parse(blob(a.imageDigest));
    for(const entry of [manifest.config,...manifest.layers])if(blob(entry.digest).length!==entry.size)throw Error('OCI content size mismatch');
  }
  return {packet,packetSha256:hash(bytes(packetPath))};
}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(process.argv.length!==3)throw Error('Usage: node scripts/verify-ledger-v2-packet.mjs <packet.json>');
  const result=verifyPacket(process.argv[2]);
  console.log(JSON.stringify({verified:true,packetSha256:result.packetSha256,productionExecutionEnabled:false}));
}
