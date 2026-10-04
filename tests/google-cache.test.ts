import { beforeAll, beforeEach, afterAll, expect, it, vi } from "vitest";
import { initializeApp, deleteApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { GoogleCacheStore, type SnapshotBlobs } from "../collector/google-cache-store";
import { Coordinator } from "../collector/coordinator";
import { MarketCollector } from "../collector/engine";
import { defaultPolicy } from "../collector/policy";
import { randomUUID } from "node:crypto";
import { trialGoogleStore } from '../collector/trial-google';
import { gzipSync } from 'node:zlib';

const app = initializeApp({projectId:"demo-bazaar-watch"}, "google-cache-tests");
const db = getFirestore(app);
const namespace = `market-${randomUUID()}`;
const files = new Map<string, {value:string; createdAt:number}>();
const blobs: SnapshotBlobs = {
  put: vi.fn(async (key,value) => { files.set(key,{value,createdAt:Date.now()}); }),
  get: async key => { if(!files.has(key)) throw new Error("missing blob"); return files.get(key)!.value; },
  remove: vi.fn(async key => {files.delete(key);}),
  list: vi.fn(async () => [...files].map(([name,f])=>({name,createdAt:f.createdAt}))),
};
beforeAll(()=>{if(!process.env.FIRESTORE_EMULATOR_HOST)throw new Error("Firestore emulator required");});
beforeEach(async()=>{await db.recursiveDelete(db.collection(namespace));files.clear();vi.clearAllMocks();});
afterAll(async()=>{await db.recursiveDelete(db.collection(namespace));await deleteApp(app);});
const store = () => new GoogleCacheStore(db, blobs, namespace);
it('the counted REST transport publishes through real Firestore preconditions and rejects a stale owner',async()=>{
  const host=process.env.FIRESTORE_EMULATOR_HOST!;
  if(!/^(127\.0\.0\.1|localhost):\d+$/.test(host))throw new Error('Only a local emulator is permitted');
  const compressed=new Map<string,Uint8Array>(),attempts:Record<string,number>={};
  const transport:typeof fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.origin===`http://${host}`)return fetch(input,init);
    if(url.hostname!=='storage.googleapis.com')throw new Error('Unexpected emulator transport host');
    if(url.pathname.startsWith('/upload/')){
      compressed.set(url.searchParams.get('name')!,new Uint8Array(init!.body as any));return Response.json({});
    }
    const name=decodeURIComponent(url.pathname.split('/o/')[1]);
    return new Response(Buffer.from(compressed.get(name)??gzipSync('missing')));
  };
  const config={project:'demo-bazaar-watch',bucket:'fixture',collection:namespace,
    firestoreOrigin:`http://${host}`,token:async()=>'owner',network:transport,
    onAttempt:(costs:Record<string,number>)=>{for(const[k,v]of Object.entries(costs))attempts[k]=(attempts[k]??0)+v;}};
  const a=trialGoogleStore(config),b=trialGoogleStore(config);
  const outcomes=await Promise.all([a.commit('trial',null,'a'),b.commit('trial',null,'b')]);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  expect(await b.commit('trial','not-current','lost')).toBe(false);
  const c=new Coordinator(a,defaultPolicy);expect(await c.acquire()).toBe(true);
  const old=(await a.read('control'))!;
  expect(await a.commit('control',old,old,{key:'auctions',value:'complete-rest-snapshot'})).toBe(true);
  expect(await b.read('auctions')).toBe('complete-rest-snapshot');
  const expired=JSON.parse(old);expired.lease.until=Date.now()-1;
  expect(await a.commit('control',old,JSON.stringify(expired))).toBe(true);
  expect(await b.commit('control',JSON.stringify(expired),JSON.stringify(expired),{key:'auctions',value:'invalid'})).toBe(false);
  expect(attempts.snapshotUploads).toBe(1);expect(attempts.storageClassB).toBe(1);
  expect(attempts.firestoreReads).toBeGreaterThan(0);
});
async function seedComplete() {
  const s=store(), c=new Coordinator(s,defaultPolicy);
  await c.acquire();const old=await s.read("control");
  expect(await s.commit("control",old,old!,{key:"auctions",value:"complete-v1"})).toBe(true);
  await c.release();
}

it("100 independent Google-backed coordinators elect exactly one refresher", async()=>{
  const workers = Array.from({length:100},()=>new Coordinator(store(),defaultPolicy));
  const outcomes = await Promise.all(workers.map(w=>w.acquire()));
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  await workers[outcomes.indexOf(true)].release();
},60_000);

it("only publishes complete uploaded payloads; stale CAS/expired owners cannot replace them",async()=>{
  const s=store(), c=new Coordinator(s,defaultPolicy);
  expect(await c.acquire()).toBe(true);
  const current=await s.read("control");
  const next=JSON.parse(current!); next.revision++;
  expect(await s.commit("control",current,JSON.stringify(next),{key:"auctions",value:"complete-v1"})).toBe(true);
  expect(await store().read("auctions")).toBe("complete-v1");
  expect(await s.commit("control",current,JSON.stringify(next),{key:"auctions",value:"losing-v2"})).toBe(false);
  expect(blobs.put).toHaveBeenCalledTimes(1);
  expect(await store().read("auctions")).toBe("complete-v1");
  const old=await s.read("control");
  const expired=JSON.parse(old!);expired.lease.until=Date.now()-1000;
  expect(await s.commit("control",old,JSON.stringify(expired))).toBe(true);
  expect(await s.commit("control",JSON.stringify(expired),JSON.stringify(expired),{key:"auctions",value:"expired-v3"})).toBe(false);
  expect(blobs.put).toHaveBeenCalledTimes(1);
  expect(await store().read("auctions")).toBe("complete-v1");
  await c.release();
});

it("upload failures preserve the previous pointer and shared control",async()=>{
  await seedComplete();
  const broken={...blobs,put:async()=>{throw new Error("upload failed");}};
  const s=new GoogleCacheStore(db,broken,namespace), c=new Coordinator(s,defaultPolicy);
  await c.acquire();
  const old=await s.read("control");
  await expect(s.commit("control",old,old!,{key:"auctions",value:"partial"})).rejects.toThrow("upload failed");
  expect(await s.read("control")).toBe(old);
  expect(await store().read("auctions")).toBe("complete-v1");
  await c.release();
});

it("cleanup keeps current snapshots and recent staging objects, removes old failed candidates",async()=>{
  await seedComplete();
  files.set("market-current/auctions/failed.json.gz",{value:"failed",createdAt:Date.now()});
  for(const f of files.values()) f.createdAt=Date.now()-700_000;
  files.set("market-current/auctions/recent.json.gz",{value:"pending",createdAt:Date.now()});
  await store().cleanup();
  expect(await store().read("auctions")).toBe("complete-v1");
  expect([...files.values()].map(f=>f.value).sort()).toEqual(["complete-v1","pending"]);
});

it("a real collector on the Google adapter charges each page once and all browser reads remain cached",async()=>{
  // Separate namespace uses a separate mock upstream, never a second live ledger.
  const ns=`${namespace}-full`, now=Date.now();
  const fetcher=vi.fn(async (input:string|URL|Request)=>{
    const u=String(input), page=Number(new URL(u).searchParams.get("page"));
    const data=u.includes("/items")?{items:[]}:u.includes("/election")?{mayor:{name:"Normal",perks:[]}}:
      u.includes("/bazaar")?{lastUpdated:now,products:{TEST:{buy_summary:[{amount:10,pricePerUnit:100,orders:1}],sell_summary:[{amount:10,pricePerUnit:90,orders:1}]}}}:
      {lastUpdated:now,page,totalPages:4,totalAuctions:4,auctions:[{uuid:page.toString(16).padStart(32,"0")}]};
    return new Response(JSON.stringify({success:true,...data}));
  });
  try {
    const collectors=Array.from({length:100},()=>new MarketCollector(new GoogleCacheStore(db,blobs,ns),defaultPolicy,fetcher));
    await Promise.all(collectors.map(c=>c.tick()));
    expect(fetcher).toHaveBeenCalledTimes(7);
    for(let round=0;round<3;round++)await Promise.all(collectors.map(async c=>{
      await c.bazaar();await c.portfolioAuctions([]);await c.rawBazaar();await c.status();
    }));
    expect(fetcher).toHaveBeenCalledTimes(7);
    expect((await collectors[0].status()).requestBudget.used).toBe(7);
  } finally {await db.recursiveDelete(db.collection(ns));}
},60_000);

it("60 concurrent cleanup attempts share one hourly listing reservation",async()=>{
  const results=await Promise.all(Array.from({length:60},()=>store().cleanup()));
  expect(results.filter(Boolean)).toHaveLength(1);
  expect(blobs.list).toHaveBeenCalledTimes(1); // 59/60 fewer list operations.
  expect(await store().cleanup()).toBe(false);
});
