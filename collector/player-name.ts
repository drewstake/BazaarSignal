import { randomUUID } from "node:crypto";
import type { CacheStore } from "./cache-store";
import { retryAfter } from "./policy";
interface Names {
  calls: number[];
  blockedUntil: number;
  entries: Record<
    string,
    { name?: string; until: number; owner?: string; error?: string }
  >;
}
/** Separate provider, shared CAS, leases, positive/negative cache and global request budget. */
export class PlayerNames {
  private offset = 0;
  private now: () => number;
  constructor(
    private store: CacheStore,
    private network: typeof fetch = fetch,
    private clock = Date.now,
    private limit = Number(process.env.MOJANG_REQUESTS_PER_MINUTE ?? 30),
  ) {
    this.now = () => this.clock() + this.offset;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw new Error("Invalid Mojang request budget");
  }
  private async change<T>(fn: (s: Names) => T): Promise<T> {
    for (let i = 0; i < 200; i++) {
      if (this.store.time)
        this.offset = (await this.store.time()) - this.clock();
      const old = await this.store.read("player-names");
      const s: Names = old
        ? JSON.parse(old)
        : { calls: [], blockedUntil: 0, entries: {} };
      s.calls = s.calls.filter((t) => t > this.now() - 60000);
      for (const [id, e] of Object.entries(s.entries))
        if (e.until < this.now()) delete s.entries[id];
      const result = fn(s);
      if (old !== null && JSON.stringify(s) === old) return result;
      if (await this.store.commit("player-names", old, JSON.stringify(s)))
        return result;
    }
    throw new Error("Seller lookup busy. Please try again shortly.");
  }
  async resolve(uuid: string): Promise<string> {
    if (!/^[a-f0-9]{32}$/i.test(uuid))
      throw new Error("Seller identity unavailable.");
    const id = uuid.toLowerCase(),
      owner = randomUUID();
    for (let wait = 0; wait < 120; wait++) {
      const claim = await this.change((s) => {
        const e = s.entries[id];
        if (e?.name) return { name: e.name };
        if (e?.error) throw new Error(e.error);
        if (e?.owner) return { waiting: true };
        if (s.blockedUntil > this.now() || s.calls.length >= this.limit)
          throw new Error(
            "Seller name service is cooling down. Please try again shortly.",
          );
        if (Object.keys(s.entries).length >= 2000)
          throw new Error("Seller cache is full. Please try again shortly.");
        s.calls.push(this.now());
        s.entries[id] = { owner, until: this.now() + 30000 };
        return { claimed: true };
      });
      if (claim.name) return claim.name;
      if (!claim.claimed) {
        await new Promise((r) => setTimeout(r, 100));
        continue;
      }
      try {
        const response = await this.network(
          `https://sessionserver.mojang.com/session/minecraft/profile/${id}`,
          { signal: AbortSignal.timeout(10000) },
        );
        if (response.status === 429 || response.headers.has("Retry-After")) {
          await this.change((s) => {
            s.blockedUntil = Math.max(
              s.blockedUntil,
              this.now() + 60000,
              retryAfter(response.headers.get("Retry-After"), this.now()),
            );
          });
        }
        if (!response.ok)
          throw new Error(
            "Couldn’t look up the seller’s username. Please try again shortly.",
          );
        const p = await response.json();
        if (
          p.id?.toLowerCase() !== id ||
          typeof p.name !== "string" ||
          !/^[A-Za-z0-9_]{1,16}$/.test(p.name)
        )
          throw new Error("Seller username unavailable.");
        await this.change((s) => {
          if (s.entries[id]?.owner !== owner)
            throw new Error("Seller lookup lease expired.");
          s.entries[id] = { name: p.name, until: this.now() + 3600000 };
        });
        return p.name;
      } catch (e) {
        if(e instanceof Error && e.name === 'TrialStopped')throw e;
        await this.change((s) => {
          if (s.entries[id]?.owner === owner)
            s.entries[id] = {
              error:
                e instanceof Error ? e.message : "Seller username unavailable.",
              until: this.now() + 60000,
            };
        });
        throw e;
      }
    }
    throw new Error(
      "Seller lookup is still in progress. Please try again shortly.",
    );
  }
}
