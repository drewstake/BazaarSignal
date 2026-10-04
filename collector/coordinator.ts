import { randomUUID } from "node:crypto";
import type { CacheStore } from "./cache-store";
import { backoff, retryAfter, routineLimit, type MarketPolicy } from "./policy";

export interface JobState {
  nextAt: number;
  upstreamAt: number;
  observedAt: number;
  snapshotVersion?: string;
  /** Successful source verification; independent of immutable payload publication. */
  lastCheckedAt?: number;
  durationMs: number;
  lastAttemptDurationMs?: number;
  failures: number;
  error: string | null;
  pages: number;
  intervalMs: number;
  cadenceMs: number;
}
export interface Control {
  revision: number;
  policy: MarketPolicy;
  lease: { owner: string; until: number } | null;
  requests: { at: number; retry: boolean; path: string }[];
  totalRequests: number;
  blockedUntil: number;
  header: { limit: number; remaining: number; resetAt: number } | null;
  jobs: Record<string, JobState>;
  responses?: Record<
    string,
    {
      at: number;
      status: number;
      cacheControl: string | null;
      rateLimit: string | null;
      remaining: string | null;
      reset: string | null;
    }
  >;
}
export const emptyJob = (): JobState => ({
  nextAt: 0,
  upstreamAt: 0,
  observedAt: 0,
  durationMs: 0,
  failures: 0,
  error: null,
  pages: 0,
  intervalMs: 0,
  cadenceMs: 60000,
});
export class Deferred extends Error {
  constructor(
    message: string,
    public until: number,
  ) {
    super(message);
  }
}
export class Coordinator {
  readonly owner = randomUUID();
  private offset = 0;
  readonly now: () => number;
  private changes: Promise<unknown> = Promise.resolve();
  constructor(
    public store: CacheStore,
    public policy: MarketPolicy,
    private clock = Date.now,
    public random = Math.random,
  ) {
    this.now = () => this.clock() + this.offset;
  }
  private async syncClock() {
    if (this.store.time) this.offset = (await this.store.time()) - this.clock();
  }
  empty(): Control {
    return {
      revision: 0,
      policy: this.policy,
      lease: null,
      requests: [],
      totalRequests: 0,
      blockedUntil: 0,
      header: null,
      jobs: {},
    };
  }
  async state() {
    const raw = await this.store.read("control");
    await this.syncClock();
    return JSON.parse(
      raw ?? JSON.stringify(this.empty()),
    ) as Control;
  }
  change<T>(
    work: (c: Control) => {
      result: T;
      payload?: { key: string; value: string };
    },
  ): Promise<T> {
    // Parallel accounting requests share this owner. Avoid self-inflicted conflicts;
    // independent owners still require durable CAS for every mutation.
    const result = this.changes.then(() => this.changeOnce(work));
    this.changes = result.catch(() => {});
    return result;
  }
  private async changeOnce<T>(work: (c: Control) => {
    result: T; payload?: { key: string; value: string };
  }): Promise<T> {
    for (let attempt = 0; attempt < 200; attempt++) {
      const old = await this.store.read("control");
      await this.syncClock();
      const c: Control = old ? JSON.parse(old) : this.empty();
      // Keep the stored policy and all accounting intact. The retired auction
      // interval has no executable consumer; every active policy field must match.
      const { auctionMinMs: _retired, ...activePolicy } = c.policy as MarketPolicy & { auctionMinMs?: number };
      if (JSON.stringify(activePolicy) !== JSON.stringify(this.policy))
        throw new Error(
          "Collector policy differs from the shared policy. Stop all workers before changing configuration.",
        );
      c.requests = c.requests.filter(
        (r) => r.at > this.now() - this.policy.windowMs,
      );
      const { result, payload } = work(c);
      // A rejected duplicate lease need not write the hot control document. The
      // actual winning claim and every request charge still use atomic CAS.
      if (!payload && old !== null && JSON.stringify(c) === old) return result;
      c.revision++;
      if (await this.store.commit("control", old, JSON.stringify(c), payload))
        return result;
    }
    throw new Error("Market coordination busy; no upstream request issued.");
  }
  acquire(dueKeys?: string[]) {
    return this.change((c) => {
      if (c.lease && c.lease.until > this.now()) return { result: false };
      if (c.blockedUntil > this.now()) return { result: false };
      if (
        dueKeys?.length &&
        dueKeys.every((key) => c.jobs[key]?.nextAt > this.now())
      )
        return { result: false };
      c.lease = { owner: this.owner, until: this.now() + this.policy.leaseMs };
      return { result: true };
    });
  }
  assert(c: Control) {
    if (c.lease?.owner !== this.owner || c.lease.until <= this.now())
      throw new Error("Refresh lease lost; publication refused.");
  }
  release() {
    return this.change((c) => {
      if (c.lease?.owner === this.owner) c.lease = null;
      return { result: undefined };
    });
  }
  /** Every physical request, including retries, is charged BEFORE network I/O. */
  charge(path: string, retry: boolean) {
    return this.change((c) => {
      this.assert(c);
      const now = this.now();
      if (c.blockedUntil > now)
        throw new Deferred("Upstream cooldown", c.blockedUntil);
      if (c.header && c.header.resetAt > now && c.header.remaining <= 0)
        throw new Deferred(
          "Upstream header budget exhausted",
          c.header.resetAt,
        );
      const used = retry
        ? c.requests.length
        : c.requests.filter((r) => !r.retry).length;
      if (
        c.requests.length >= this.policy.requestLimit ||
        used >= (retry ? this.policy.requestLimit : routineLimit(this.policy))
      )
        throw new Deferred(
          "Shared request budget exhausted",
          (c.requests[0]?.at ?? now) + this.policy.windowMs + 1,
        );
      c.requests.push({ at: now, retry, path });
      c.totalRequests++;
      if (c.header && c.header.resetAt > now) c.header.remaining--;
      c.lease!.until = now + this.policy.leaseMs;
      return { result: undefined };
    });
  }
  async capacity(required: number) {
    const c = await this.state(),
      now = this.now();
    this.assert(c);
    const requests = c.requests.filter(
      (r) => r.at > now - this.policy.windowMs,
    );
    const remaining = Math.min(
      this.policy.requestLimit - requests.length,
      routineLimit(this.policy) - requests.filter((r) => !r.retry).length,
      c.header && c.header.resetAt > now ? c.header.remaining : Infinity,
    );
    const readyAt = (used: typeof requests, limit: number) => {
      const deficit = used.length + required - limit;
      if (deficit <= 0) return 0;
      // A full snapshot needs enough slots, not merely the first expired slot.
      return (used[Math.min(deficit, used.length) - 1]?.at ?? now) + this.policy.windowMs + 1;
    };
    if (remaining < required)
      throw new Deferred(
        `Insufficient shared budget for ${required} requests`,
        Math.max(
          now + 1000,
          readyAt(requests, this.policy.requestLimit),
          readyAt(requests.filter(r => !r.retry), routineLimit(this.policy)),
          c.header && c.header.remaining < required && c.header.resetAt > now
            ? c.header.resetAt
            : 0,
        ),
      );
  }
  headers(response: Response, failures: number, path = "unknown") {
    return this.change((c) => {
      this.assert(c);
      const now = this.now(),
        h = response.headers;
      (c.responses ??= {})[path.split("?")[0]] = {
        at: now,
        status: response.status,
        cacheControl: h.get("Cache-Control"),
        rateLimit: h.get("RateLimit-Limit"),
        remaining: h.get("RateLimit-Remaining"),
        reset: h.get("RateLimit-Reset"),
      };
      const num = (key: string) =>
        h.has(key) && Number.isFinite(Number(h.get(key)))
          ? Number(h.get(key))
          : null;
      const limit = num("RateLimit-Limit"),
        remaining = num("RateLimit-Remaining"),
        reset = num("RateLimit-Reset");
      if (remaining !== null && reset !== null) {
        // Parallel page responses may arrive out of order. Never restore tokens in
        // an active minute merely because an older response reports more remaining.
        c.header = {
          limit: Math.max(0, limit ?? remaining),
          remaining: Math.max(
            0,
            Math.min(
              remaining,
              limit ?? remaining,
              c.header && c.header.resetAt > now
                ? c.header.remaining
                : Infinity,
            ),
          ),
          resetAt: Math.max(
            c.header?.resetAt ?? 0,
            now + Math.max(0, reset) * 1000,
          ),
        };
      }
      const requested = retryAfter(h.get("Retry-After"), now);
      if (response.status === 429 || requested > now)
        c.blockedUntil = Math.max(
          c.blockedUntil,
          requested,
          now + backoff(failures, this.random),
        );
      return { result: c.blockedUntil };
    });
  }
  async fetchJson(path: string, network: typeof fetch = fetch) {
    for (let attempt = 0; ; attempt++) {
      await this.charge(path, attempt > 0);
      try {
        const r = await network(`https://api.hypixel.net/v2/${path}`, {
          signal: AbortSignal.timeout(this.policy.timeoutMs),
          headers: process.env.HYPIXEL_API_KEY
            ? { "API-Key": process.env.HYPIXEL_API_KEY }
            : {},
        });
        const blockedUntil = await this.headers(r, attempt + 1, path);
        if (r.status === 429 || blockedUntil > this.now())
          throw new Deferred(
            "Hypixel throttled; automatic retry scheduled",
            blockedUntil,
          );
        if (!r.ok) {
          if (r.status < 500)
            throw new Deferred(`Hypixel HTTP ${r.status}`, this.now() + 60000);
          throw new Error(`Hypixel HTTP ${r.status}`);
        }
        const data = await r.json();
        if (data.success !== true)
          throw new Error("Hypixel response unsuccessful");
        const maxAge =
          Number(
            /(?:^|[,\s])max-age=(\d+)/i.exec(
              r.headers.get("Cache-Control") ?? "",
            )?.[1] ?? 0,
          ) * 1000;
        return { data, maxAge };
      } catch (e) {
        if (
          e instanceof Deferred ||
          (e instanceof Error && e.name === 'TrialStopped') ||
          attempt >= this.policy.maxRetries ||
          String(e).includes("lease")
        )
          throw e;
        await new Promise((resolve) =>
          setTimeout(
            resolve,
            Math.min(5000, 500 * 2 ** attempt) * (0.8 + this.random() * 0.2),
          ),
        );
      }
    }
  }
}
