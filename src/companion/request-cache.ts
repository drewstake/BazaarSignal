import { applyPollingDirective, PAUSED_MESSAGE, pollingDirective, type PollDirective } from "./polling";
import { marketReadSlot } from '../../shared/market-schedule';

type Entry = { at: number; etag: string | null; body: any; bytes?: number };
const memory = new Map<string, Entry>();
const pending = new Map<string, Promise<any>>();
const CACHE = "bazaarsignal-public-market-v1";
const LIMIT = 12;
const BYTE_LIMIT = 32 * 1024 * 1024;
const seen = new Set<string>();
async function cache() {
  try { return typeof caches === "undefined" ? null : await caches.open(CACHE); }
  catch { return null; }
}
async function read(url: string): Promise<Entry | undefined> {
  const local = memory.get(url);
  const c = await cache();
  try {
    const r = await c?.match(url);
    if (r) {
      const saved = await r.json() as Entry;
      if (Number.isFinite(saved.at) && saved.body && (!local || saved.at > local.at)) return saved;
    }
  } catch { /* Unavailable or corrupt browser cache: use bounded memory. */ }
  return local;
}
async function save(url: string, entry: Entry) {
  const serialized = JSON.stringify(entry);
  // The measured full Bazaar response is 4.1 MB of JSON. Admit it while bounding
  // total retained data; public cache eviction never starts an upstream refresh.
  if (serialized.length > 8 * 1024 * 1024) return;
  entry.bytes = serialized.length * 2;
  memory.delete(url); memory.set(url, entry);
  while (memory.size > LIMIT || [...memory.values()].reduce((n,e)=>n+(e.bytes??0),0) > BYTE_LIMIT)
    memory.delete(memory.keys().next().value!);
  const c = await cache();
  try {
    if (!c) return;
    await c.delete(url);
    await c.put(url, new Response(serialized, { headers: { "Content-Type": "application/json", "X-Cache-Bytes": String(entry.bytes) } }));
    const keys = await c.keys();
    let bytes = 0;
    for (let i=keys.length-1; i>=0; i--) {
      bytes += Number((await c.match(keys[i]))?.headers.get("X-Cache-Bytes") ?? BYTE_LIMIT);
      if (keys.length-i > LIMIT || bytes > BYTE_LIMIT) await c.delete(keys[i]);
    }
  } catch { /* Browser quota/private mode cannot trigger extra network requests. */ }
}
function observe(body: any, cached = false) {
  const policy: PollDirective | undefined = body?.status?.usage ?? body?.usage;
  const current = pollingDirective();
  // A previous trial's cached payload is useful data, but cannot revoke or
  // extend a different, explicitly configured trial's current permission.
  if (cached && current.trialId && policy?.trialId !== current.trialId)
    return { ...body, usage: current, ...(body?.status ? { status: { ...body.status, usage: current } } : {}) };
  if (policy) applyPollingDirective(policy);
  else if (import.meta.env.PROD) applyPollingDirective({ mode: "paused", pollMs: 0, reason: "Usage accounting is unavailable" });
  return body;
}

/** Web Locks + shared CacheStorage serialize identical public GETs across tabs.
 * Fallback shares in-flight work within a tab; it never drives upstream refresh.
 * No credentials or private responses enter this cache.
 */
export async function cachedMarketRequest<T>(url: string, signal?: AbortSignal): Promise<T> {
  const pathname = new URL(url).pathname;
  const reusable = /^\/api\/companion\/(bazaar|auctions|snapshot|book)$/.test(pathname);
  const work = async () => {
    const old = reusable ? await read(url) : undefined;
    const firstRead = !seen.has(url); seen.add(url);
    const policy = pollingDirective();
    const savedDuringWait=(usage:PollDirective,error:string)=>({...old!.body,usage,error,
      status:{...old!.body.status,usage,error}});
    if(policy.retryAt&&Date.now()<policy.retryAt) {
      if(old)return savedDuringWait(policy,policy.reason??'Waiting for the app budget reset.');
      throw new Error(policy.reason??'Waiting for the app budget reset.');
    }
    if (policy.mode === "paused") {
      if (old) return observe({ ...old.body, status: { ...old.body.status, usage: policy } });
      throw new Error(`${PAUSED_MESSAGE}. No saved data is available for this view.`);
    }
    const sameRelease = import.meta.env.VITE_MARKET_OPERATING_MODE !== 'free-tier' || !policy.trialId ||
      (old?.body?.usage ?? old?.body?.status?.usage)?.trialId === policy.trialId;
    const sameSlot = import.meta.env.VITE_MARKET_OPERATING_MODE === 'free-tier'
      ? marketReadSlot(old?.at ?? 0, policy.pollMs) === marketReadSlot(Date.now(), policy.pollMs)
      : old && (Date.now() - old.at < policy.pollMs || firstRead);
    if (old && sameRelease && Date.now() - old.at >= 0 && sameSlot) return observe(old.body, true);
    const response = await fetch(url, {
      credentials: "omit", signal: AbortSignal.any([
        AbortSignal.timeout(Math.max(1,Math.floor(Math.min(20_000,(policy.expiresAt ?? Infinity)-Date.now())))),
        ...(signal?[signal]:[]),
      ]),
      // This header needs CORS preflight. 304s save bytes, not Cloud Run invocations.
      headers: old?.etag ? { "If-None-Match": old.etag } : {},
    });
    if (response.status === 304 && old) {
      await save(url, { ...old, at: Date.now() });
      return observe(old.body);
    }
    const body = await response.json();
    observe(body);
    if(response.status===429&&old&&pollingDirective().retryAt&&Date.now()<pollingDirective().retryAt!)
      return savedDuringWait(pollingDirective(),body.error??'Waiting for the app budget reset.');
    if (!response.ok) throw new Error(body.error ?? "Market service unavailable");
    if (reusable) await save(url, { at: Date.now(), etag: response.headers.get("ETag"), body });
    return body;
  };
  if (signal?.aborted) throw signal.reason;
  const existing = pending.get(url);
  if (existing) return existing;
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const result = locks ? locks.request(`market:${url}`, { signal }, work) : work();
  pending.set(url, result);
  try { return await result; }
  finally { if (pending.get(url) === result) pending.delete(url); }
}
