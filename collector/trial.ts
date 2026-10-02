import type { CacheStore } from "./cache-store";
import { assessUsage, googleMeters, type UsageState } from "./usage";

export type Counters = Record<string, number>;
export interface TrialState {
  version: 1;
  id: string;
  startsAt: number;
  expiresAt: number;
  baseline: UsageState;
  limits: Counters;
  reserved: Counters;
  observed: Counters;
  admissions: Record<
    string,
    { kind: "collector" | "browser"; at: number; finished?: boolean }
  >;
  stoppedAt?: number;
  stopReason?: string;
}
export class TrialStopped extends Error {
  override name = "TrialStopped";
}
export const TRIAL_MAX_MS = 15 * 60_000;
export const CLEANUP_INTERVAL_MS = Math.ceil(86_400_000 / 56);
export const trialLimits: Counters = {
  collectorInvocations: 15,
  browserRequests: 180,
  hypixelRequests: 1440,
  sellerRequests: 30,
  snapshotUploads: 64,
  storageListPages: 4,
  cleanupRuns: 1,
  upstreamResponseBytes: 2 * 1024 ** 3,
  runRequests: 195,
  cpuSeconds: 14_000,
  memoryGiBSeconds: 11_000,
  firestoreReads: 25_000,
  firestoreWrites: 8_000,
  firestoreDeletes: 0,
  storageClassA: 68,
  storageClassB: 1_800,
  egressBytes: 128 * 1024 ** 2,
  storageByteMonths: 512 * 1024 ** 2,
  storageEgressBytes: 20 * 1024 ** 3,
  firestoreStorageBytes: 1024 ** 2,
  firestoreEgressBytes: 3200 * 1024 ** 2,
  schedulerJobMonths: 0,
  buildMinutes: 0,
  artifactByteMonths: 0,
  logBytes: 8 * 1024 ** 2,
  monitoringReads: 0,
};
export const invocationEnvelope = (kind: "collector" | "browser"): Counters =>
  kind === "collector"
    ? {
        collectorInvocations: 1,
        runRequests: 1,
        cpuSeconds: 240,
        memoryGiBSeconds: 200,
        firestoreReads: 800,
        firestoreWrites: 256,
        firestoreDeletes: 0,
        storageClassA: 4,
        storageClassB: 16,
        snapshotUploads: 4,
        hypixelRequests: 96,
        sellerRequests: 0,
        storageListPages: 0,
        cleanupRuns: 0,
        upstreamResponseBytes: 128 * 1024 ** 2,
        storageByteMonths: 32 * 1024 ** 2,
        storageEgressBytes: 128 * 1024 ** 2,
        firestoreStorageBytes: 32 * 1024,
        firestoreEgressBytes: 100 * 1024 ** 2,
        egressBytes: 16 * 1024,
        logBytes: 128 * 1024,
      }
    : {
        browserRequests: 1,
        runRequests: 1,
        cpuSeconds: 50,
        memoryGiBSeconds: 40,
        firestoreReads: 64,
        firestoreWrites: 16,
        firestoreDeletes: 0,
        storageClassA: 0,
        storageClassB: 8,
        snapshotUploads: 0,
        hypixelRequests: 0,
        sellerRequests: 2,
        storageListPages: 0,
        cleanupRuns: 0,
        upstreamResponseBytes: 128 * 1024,
        storageByteMonths: 0,
        storageEgressBytes: 64 * 1024 ** 2,
        firestoreStorageBytes: 4096,
        firestoreEgressBytes: 8 * 1024 ** 2,
        egressBytes: 16 * 1024,
        logBytes: 16 * 1024,
      };

function valid(state: TrialState | null, now: number) {
  if (
    !state ||
    state.version !== 1 ||
    !state.id ||
    ![state.startsAt, state.expiresAt, now].every(Number.isFinite) ||
    state.expiresAt <= state.startsAt ||
    state.expiresAt - state.startsAt > TRIAL_MAX_MS ||
    now < state.startsAt ||
    now >= state.expiresAt ||
    state.stoppedAt !== undefined
  )
    throw new TrialStopped(
      state?.stopReason ?? "Trial is missing, stopped or expired",
    );
  if (
    !state.limits ||
    !state.reserved ||
    !state.observed ||
    !state.admissions ||
    !state.baseline
  )
    throw new TrialStopped("Trial accounting is incomplete");
  for (const [key, maximum] of Object.entries(trialLimits)) {
    const limit = state.limits[key],
      used = state.reserved[key] ?? 0;
    if (
      !Number.isFinite(limit) ||
      limit < 0 ||
      limit > maximum ||
      !Number.isFinite(used) ||
      used < 0 ||
      used > limit
    )
      throw new TrialStopped(`Invalid trial ceiling: ${key}`);
  }
}
function reserve(state: TrialState, costs: Counters, now: number) {
  valid(state, now);
  for (const [key, cost] of Object.entries(costs)) {
    if (
      !Number.isFinite(cost) ||
      cost < 0 ||
      !Number.isFinite(state.limits[key]) ||
      state.limits[key] < 0 ||
      !Number.isFinite(state.reserved[key] ?? 0) ||
      (state.reserved[key] ?? 0) < 0 ||
      (state.reserved[key] ?? 0) + cost > state.limits[key]
    )
      throw new TrialStopped(`Trial reservation limit: ${key}`);
  }
  // Pass all costs, including meters with no historical baseline. Skipping an
  // absent meter here could conceal a violated no-additional-usage proof.
  const accounted = Object.fromEntries(googleMeters.map(key =>
    [key, (state.reserved[key] ?? 0) + (costs[key] ?? 0)]));
  const decision = assessUsage(state.baseline, now, accounted);
  if (decision.mode === "paused")
    throw new TrialStopped(decision.reason ?? "Allowance headroom unavailable");
  for (const [key, cost] of Object.entries(costs))
    state.reserved[key] = (state.reserved[key] ?? 0) + cost;
  return decision;
}

/** One shared reservation per invocation, never refunded. Local limits spend only
 * that pre-reserved envelope, including when the owner crashes or loses its reply.
 * Admission itself and Cloud Run startup are covered by separate baseline headroom.
 */
export class TrialLedger {
  constructor(
    private store: CacheStore,
    private clock = Date.now,
  ) {}
  private async now() {
    return this.store.time ? this.store.time() : this.clock();
  }
  async read() {
    const raw = await this.store.read("trial");
    return raw ? (JSON.parse(raw) as TrialState) : null;
  }
  async admit(kind: "collector" | "browser", id: string) {
    if (
      !/^[a-zA-Z0-9:_-]{1,160}$/.test(id) ||
      ["__proto__", "constructor", "prototype"].includes(id)
    )
      throw new TrialStopped("Invalid invocation identity");
    for (let attempt = 0; attempt < 8; attempt++) {
      const now = await this.now(),
        raw = await this.store.read("trial");
      const state: TrialState | null = raw ? JSON.parse(raw) : null;
      valid(state, now);
      if (Object.hasOwn(state!.admissions, id)) return null; // Redeliveries cannot claim a second envelope.
      if (Object.keys(state!.admissions).length >= 195)
        throw new TrialStopped("Trial admission count exhausted");
      if (
        kind === "collector" &&
        Object.values(state!.admissions).some(
          (a) => a.kind === "collector" && now - a.at < 60_000,
        )
      )
        return null;
      const costs = invocationEnvelope(kind);
      const decision = reserve(state!, costs, now);
      state!.admissions[id] = { kind, at: now };
      if (await this.store.commit("trial", raw, JSON.stringify(state)))
        return new TrialSession(
          this,
          state!.id,
          id,
          state!.expiresAt,
          costs,
          this.clock,
          now - this.clock(),
          decision.mode,
        );
    }
    throw new TrialStopped("Concurrent trial admission did not settle");
  }
  async add(trialId: string, costs: Counters) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const now = await this.now(),
        raw = await this.store.read("trial"),
        state = raw ? (JSON.parse(raw) as TrialState) : null;
      if (state?.id !== trialId)
        throw new TrialStopped("Trial identity changed");
      reserve(state, costs, now);
      if (await this.store.commit("trial", raw, JSON.stringify(state))) return;
    }
    throw new TrialStopped("Concurrent trial reservation did not settle");
  }
  async finish(trialId: string, id: string, observed: Counters) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const raw = await this.store.read("trial"),
        state = raw ? (JSON.parse(raw) as TrialState) : null;
      if (
        !state ||
        state.id !== trialId ||
        !state.admissions[id] ||
        state.admissions[id].finished
      )
        return;
      for (const [key, value] of Object.entries(observed)) {
        if (!Number.isFinite(value) || value < 0)
          throw new Error("Invalid trial measurement");
        state.observed[key] = (state.observed[key] ?? 0) + value;
      }
      state.admissions[id].finished = true;
      if (await this.store.commit("trial", raw, JSON.stringify(state))) return;
    }
    throw new Error(
      "Trial measurements could not be persisted; reservations remain spent",
    );
  }
  async stop(reason: string) {
    for (let attempt = 0; attempt < 8; attempt++) {
      const raw = await this.store.read("trial");
      if (!raw) return;
      const state = JSON.parse(raw) as TrialState;
      state.stoppedAt ??= await this.now();
      state.stopReason ??= reason;
      if (await this.store.commit("trial", raw, JSON.stringify(state))) return;
    }
    throw new TrialStopped(
      "Could not persist stop; infrastructure shutdown still required",
    );
  }
}

export class TrialSession {
  readonly observed: Counters = {};
  private spent: Counters = {};
  private started: number;
  private finished = false;
  private refusal?: TrialStopped;
  private cancellation = new AbortController();
  constructor(
    private ledger: Pick<TrialLedger, "add" | "finish">,
    readonly trialId: string,
    readonly invocationId: string,
    readonly expiresAt: number,
    private envelope: Counters,
    private clock: () => number,
    private offset: number,
    readonly mode: "normal" | "warning" | "slow" | "paused",
  ) {
    this.started = clock();
  }
  assertOpen() {
    if (this.refusal) throw this.refusal;
    if (this.clock() + this.offset >= this.expiresAt)
      this.refuse("Trial deadline reached");
  }
  private refuse(reason: string): never {
    this.refusal ??= new TrialStopped(reason);
    this.cancellation.abort(this.refusal);
    throw this.refusal;
  }
  signal(timeoutMs = 20_000, parent?: AbortSignal | null) {
    this.assertOpen();
    const left = this.expiresAt - (this.clock() + this.offset);
    return AbortSignal.any([
      this.cancellation.signal,
      AbortSignal.timeout(Math.max(1, Math.floor(Math.min(left, timeoutMs)))),
      ...(parent ? [parent] : []),
    ]);
  }
  take(costs: Counters, measured = true) {
    this.assertOpen();
    for (const [key, value] of Object.entries(costs))
      if (
        !Number.isFinite(value) ||
        value < 0 ||
        (this.spent[key] ?? 0) + value > (this.envelope[key] ?? 0)
      )
        this.refuse(`Invocation reservation exhausted: ${key}`);
    for (const [key, value] of Object.entries(costs)) {
      this.spent[key] = (this.spent[key] ?? 0) + value;
      if (measured) this.count(key, value);
    }
  }
  count(key: string, value = 1) {
    if (!Number.isFinite(value) || value < 0)
      throw new Error("Invalid measurement");
    this.observed[key] = (this.observed[key] ?? 0) + value;
  }
  async extend(costs: Counters) {
    this.assertOpen();
    try {
      await this.ledger.add(this.trialId, costs);
    } catch (error) {
      this.refuse(
        error instanceof Error ? error.message : "Shared reservation failed",
      );
    }
    for (const [key, value] of Object.entries(costs))
      this.envelope[key] = (this.envelope[key] ?? 0) + value;
  }
  policy() {
    this.assertOpen();
    return {
      mode: this.mode,
      pollMs: this.mode === "slow" ? 60_000 : 20_000,
      expiresAt: this.expiresAt,
      trialId: this.trialId,
      serverNow: this.clock() + this.offset,
    };
  }
  async finish() {
    if (this.finished) return;
    this.finished = true;
    this.count("observedHandlerMs", Math.max(0, this.clock() - this.started));
    await this.ledger.finish(this.trialId, this.invocationId, this.observed);
  }
  network(fetcher: typeof fetch = fetch): typeof fetch {
    return async (input, init) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      const hypixel = url.hostname === "api.hypixel.net";
      if (
        url.protocol !== "https:" ||
        url.port ||
        (!hypixel && url.hostname !== "sessionserver.mojang.com")
      )
        this.refuse("Unbudgeted upstream host");
      this.take({ [hypixel ? "hypixelRequests" : "sellerRequests"]: 1 });
      let response: Response;
      try {
        response = await fetcher(input, {
          ...init,
          redirect: "error",
          signal: this.signal(12_000, init?.signal),
        });
      } catch (error) {
        this.assertOpen();
        throw error;
      }
      this.count(`upstreamHttp${response.status}`);
      if (!response.body) return response;
      let size = 0;
      const stream = response.body.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform: (chunk, controller) => {
            this.assertOpen();
            size += chunk.byteLength;
            if (size > (hypixel ? 16 * 1024 ** 2 : 64 * 1024))
              this.refuse("Upstream response exceeds size limit");
            this.take({ upstreamResponseBytes: chunk.byteLength });
            controller.enqueue(chunk);
          },
        }),
      );
      return new Response(stream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      });
    };
  }
}
