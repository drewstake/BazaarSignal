import { applyPollingDirective, PAUSED_MESSAGE, pollingDirective, type PollDirective } from "./polling";
import { marketReadSlot } from '../../shared/market-schedule';
import type { BazaarItem } from '../../shared/companion/types';
import { localPreviewMarketRead } from './local-market-preview';

export type SavedBazaarBook = Pick<BazaarItem, 'id' | 'asks' | 'bids' | 'upstreamAt' | 'observedAt'>;

type Entry = { at: number; etag: string | null; body: any; bytes?: number };
const memory = new Map<string, Entry>();
const partialFailures = new Map<string, number>();
type Pending = { promise: Promise<any>; controller: AbortController; readers: number; delivering: boolean };
const pending = new Map<string, Pending>();
const CACHE = "bazaarsignal-public-market-v1";
const LIMIT = 12;
const BYTE_LIMIT = 32 * 1024 * 1024;
const seen = new Set<string>();
function remember(url: string, entry: Entry) {
  memory.delete(url); memory.set(url, entry);
  while (memory.size > LIMIT || [...memory.values()].reduce((n, e) => n + (e.bytes ?? 0), 0) > BYTE_LIMIT)
    memory.delete(memory.keys().next().value!);
}
async function cache() {
  try { return typeof caches === "undefined" ? null : await caches.open(CACHE); }
  catch { return null; }
}
async function read(url: string, locked = false): Promise<Entry | undefined> {
  const local = memory.get(url);
  const c = await cache();
  try {
    const r = await c?.match(url);
    if (r) {
      const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
      if (!r.headers.has('X-Cache-At') && locks && !locked)
        return locks.request(`market:${url}`, () => read(url, true));
      // Check metadata on every lookup so other tabs can publish a newer book,
      // but avoid decoding megabytes again when the in-memory copy is current.
      const at = Number(r.headers.get('X-Cache-At'));
      if (local && r.headers.has('X-Cache-At') && at === local.at) return local;
      const legacy = !r.headers.has('X-Cache-At') && locks && locked ? r.clone() : null;
      const saved = await r.json() as Entry;
      if (saved && Number.isFinite(saved.at) && saved.at > 0 && saved.body &&
          typeof saved.body === 'object' && !Array.isArray(saved.body) && (!local || saved.at > local.at)) {
        const storedBytes = Number(r.headers.get('X-Cache-Bytes'));
        const bytes = Number.isFinite(storedBytes) && storedBytes > 0
          ? storedBytes : JSON.stringify(saved).length * 2;
        if (bytes > 16 * 1024 * 1024) return local;
        saved.bytes = bytes;
        remember(url, saved);
        if (!r.headers.has('X-Cache-At') && locks && locked) {
          // Upgrade legacy metadata under the writer lock. Never change its
          // sample/read time or TTL, or overwrite a concurrent tab publication.
          try {
            await c!.put(url, new Response(legacy!.body, { headers: {
              'Content-Type': 'application/json', 'X-Cache-Bytes': String(saved.bytes), 'X-Cache-At': String(saved.at),
            } }));
          } catch { /* Read-only/quota-limited storage still has usable data. */ }
        }
        return saved;
      }
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
  remember(url, entry);
  const c = await cache();
  try {
    if (!c) return;
    await c.delete(url);
    await c.put(url, new Response(serialized, { headers: { "Content-Type": "application/json", "X-Cache-Bytes": String(entry.bytes), 'X-Cache-At': String(entry.at) } }));
    const keys = await c.keys();
    let bytes = 0;
    for (let i=keys.length-1; i>=0; i--) {
      bytes += Number((await c.match(keys[i]))?.headers.get("X-Cache-Bytes") ?? BYTE_LIMIT);
      if (keys.length-i > LIMIT || bytes > BYTE_LIMIT) await c.delete(keys[i]);
    }
  } catch { /* Browser quota/private mode cannot trigger extra network requests. */ }
}
function observe(body: any, cached = false, savedAt?: number) {
  const policy: PollDirective | undefined = body?.status?.usage ?? body?.usage;
  const current = pollingDirective();
  // A previous trial's cached payload is useful data, but cannot revoke or
  // extend a different, explicitly configured trial's current permission.
  // Nor can a pre-recovery snapshot clear a newer server backoff directive.
  if (cached && ((current.trialId && policy?.trialId !== current.trialId) ||
      (current.retryAt !== undefined && (savedAt ?? 0) < current.retryAt)))
    return { ...body, usage: current, ...(body?.status ? { status: { ...body.status, usage: current } } : {}) };
  if (policy) applyPollingDirective(policy);
  else if (import.meta.env.PROD) applyPollingDirective({ mode: "paused", pollMs: 0, reason: "Usage accounting is unavailable" });
  return body;
}

/** Read only already-downloaded public books, including portfolio subsets. Never
 * call a full-market endpoint to fill a search cache miss. Scope to this backend. */
export async function savedBazaarBook(baseUrl: string, itemId: string) {
  const base = new URL(baseUrl);
  const origin = base.origin;
  const prefix = base.pathname.slice(0, base.pathname.lastIndexOf('/') + 1);
  const eligible = (url: string) => {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return false; }
    if (parsed.origin !== origin) return false;
    if (parsed.pathname === prefix + 'bazaar' || parsed.pathname === prefix + 'snapshot') return true;
    if (parsed.pathname === prefix + 'book') return parsed.searchParams.get('itemId') === itemId;
    return parsed.pathname === prefix + 'portfolio-prices' &&
      (parsed.searchParams.get('assets') ?? '').split(',').includes(`bz_${itemId}`);
  };
  // Share a portfolio read already in flight instead of racing a second GET.
  await Promise.allSettled([...pending].filter(([url]) => eligible(url)).map(([, work]) => work.promise));
  const urls = new Set([...memory.keys()].filter(eligible));
  try {
    for (const key of await (await cache())?.keys() ?? []) if (eligible(key.url)) urls.add(key.url);
  } catch { /* CacheStorage is optional; memory remains usable. */ }
  let best: { at: number; item: SavedBazaarBook; stale: boolean; error: string | null; trialId?: string } | undefined;
  let bestBody: any;
  for (const url of urls) {
    const entry = await read(url);
    if (!entry) continue;
    const body = entry.body;
    const items = body.bazaar ?? body.items;
    let item: SavedBazaarBook | undefined = Array.isArray(items) ? items.find((item: BazaarItem) => item?.id === itemId) : undefined;
    const book = body.book ?? body.books?.[itemId];
    if (!item && book) item = { id: itemId, asks: book.buy, bids: book.sell,
      upstreamAt: body.timestamp ?? body.status?.lastUpdated,
      observedAt: body.observedAt ?? body.status?.observedAt ?? body.status?.lastSuccess };
    if (!item || !Array.isArray(item.asks) || !Array.isArray(item.bids)) continue;
    if (!best || (item.upstreamAt || 0) > (best.item.upstreamAt || 0) ||
        (item.upstreamAt === best.item.upstreamAt && entry.at > best.at)) {
      best = { at: entry.at, item, stale: body.stale === true || body.status?.stale === true,
        error: body.error ?? body.status?.error ?? null,
        trialId: (body.usage ?? body.status?.usage)?.trialId };
      bestBody = body;
    }
  }
  if (best) observe(bestBody, true, best.at);
  return best;
}

/** Web Locks + shared CacheStorage serialize identical public GETs across tabs.
 * Fallback shares in-flight work within a tab; it never drives upstream refresh.
 * No credentials or private responses enter this cache.
 */
export async function cachedMarketRequest<T>(url: string, signal?: AbortSignal): Promise<T> {
  signal?.throwIfAborted();
  let entry = pending.get(url);
  if (entry) return subscribe<T>(url, entry, signal);
  const controller = new AbortController();
  const pathname = new URL(url).pathname;
  const localPreview = localPreviewMarketRead(url);
  const reusable = /^\/(?:live-market\/)?api\/companion\/(bazaar|snapshot|book|portfolio-prices)$/.test(pathname);
  const deliver = (body: any, cached = false, savedAt?: number) => {
    // A complete reply may itself pause polling. That must stop future I/O
    // without discarding the saved book/error that explains the pause.
    if (entry) entry.delivering = true;
    return observe(body, cached, savedAt);
  };
  const work = async () => {
    const old = reusable ? await read(url, true) : undefined;
    if (old && old.at > (partialFailures.get(url) ?? Infinity)) partialFailures.delete(url);
    controller.signal.throwIfAborted();
    const firstRead = !seen.has(url); seen.add(url);
    const policy = pollingDirective();
    const savedDuringWait=(usage:PollDirective,error:string)=>({...old!.body,usage,error,
      status:{...old!.body.status,usage,error}});
    if(!localPreview&&policy.retryAt&&Date.now()<policy.retryAt) {
      if(old)return savedDuringWait(policy,policy.reason??'Waiting for the app budget reset.');
      throw new Error(policy.reason??'Waiting for the app budget reset.');
    }
    if (policy.mode === "paused") {
      if (old) return deliver({ ...old.body, status: { ...old.body.status, usage: policy } });
      if (!localPreview) throw new Error(`${PAUSED_MESSAGE}. No saved data is available for this view.`);
    }
    const budgeted = ['free-tier','paid-budget'].includes(import.meta.env.VITE_MARKET_OPERATING_MODE ?? '');
    const sameRelease = !budgeted || !policy.trialId ||
      (old?.body?.usage ?? old?.body?.status?.usage)?.trialId === policy.trialId;
    const sameSlot = budgeted
      ? marketReadSlot(old?.at ?? 0, policy.pollMs) === marketReadSlot(Date.now(), policy.pollMs)
      : old && (Date.now() - old.at < policy.pollMs || firstRead);
    // A same-slot response saved before the retry deadline cannot prove that
    // the service recovered. A newer response from another tab can be reused.
    const recoveryDue = policy.retryAt !== undefined && Date.now() >= policy.retryAt &&
      (!old || old.at < policy.retryAt);
    if (old && sameRelease && Date.now() - old.at >= 0 && sameSlot && !recoveryDue && !partialFailures.has(url)) return deliver(old.body, true, old.at);
    const response = await fetch(url, {
      credentials: "omit", signal: AbortSignal.any([
        AbortSignal.timeout(localPreview ? 20_000 : Math.max(1,Math.floor(Math.min(20_000,(policy.expiresAt ?? Infinity)-Date.now())))),
        controller.signal,
      ]),
      // This header needs CORS preflight. 304s save bytes, not Cloud Run invocations.
      headers: old?.etag ? { "If-None-Match": old.etag } : {},
      // A preview can only read the loopback SQLite handler, even if a local
      // proxy is misconfigured to redirect to an external market service.
      ...(localPreview ? { redirect: "error" as const } : {}),
    });
    if (response.status === 304 && old) {
      partialFailures.delete(url);
      if (entry) entry.delivering = true;
      await save(url, { ...old, at: Date.now() });
      return deliver(old.body);
    }
    const body = await response.json();
    deliver(body);
    if((response.status===429||response.status===503)&&old&&pollingDirective().retryAt&&Date.now()<pollingDirective().retryAt!)
      return savedDuringWait(pollingDirective(),body.error??'Waiting for the app budget reset.');
    if (!response.ok) throw new Error(body.error ?? "Market service unavailable");
    const requested = pathname.endsWith('/portfolio-prices') ? (new URL(url).searchParams.get('assets') ?? '').split(',') : [];
    const partialFailure = requested.length > 0 && (body.error || body.stale) &&
      (!Array.isArray(body.bazaar) || requested.some(id => !body.bazaar.some((item: BazaarItem) => `bz_${item.id}` === id)));
    if (partialFailure) {
      partialFailures.delete(url); partialFailures.set(url, Date.now());
      while (partialFailures.size > LIMIT) partialFailures.delete(partialFailures.keys().next().value!);
    } else partialFailures.delete(url);
    // Do not turn a transient partial reply into a same-slot cache hit that
    // defeats the caller's bounded failure backoff. Retain the prior envelope.
    if (reusable && !partialFailure) await save(url, { at: Date.now(), etag: response.headers.get("ETag"), body });
    return body;
  };
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  const result = locks ? locks.request(`market:${url}`, { signal: controller.signal }, work) : work();
  entry = { promise: result, controller, readers: 0, delivering: false };
  pending.set(url, entry);
  const current = entry;
  const settled = () => { if (pending.get(url) === current) pending.delete(url); };
  void result.then(settled, settled);
  return subscribe<T>(url, entry, signal);
}

/** Cancellation belongs to each subscriber; only the last departure aborts I/O. */
function subscribe<T>(url: string, entry: Pending, signal?: AbortSignal): Promise<T> {
  entry.readers++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = () => {
      if (finished) return false;
      finished = true;
      signal?.removeEventListener('abort', abort);
      entry.readers--;
      return true;
    };
    const abort = () => {
      if (entry.delivering) return;
      if (!finish()) return;
      reject(signal?.reason);
      if (!entry.readers && pending.get(url) === entry) {
        pending.delete(url);
        entry.controller.abort();
      }
    };
    signal?.addEventListener('abort', abort, { once: true });
    entry.promise.then(value => { if (finish()) resolve(value); }, error => { if (finish()) reject(error); });
  });
}
