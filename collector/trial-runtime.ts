import { createHash, randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { CacheStore } from "./cache-store";
import { MarketCollector } from "./engine";
import { defaultPolicy } from "./policy";
import { marketHandler, type MarketResponder } from "./routes";
import { demandJobs, type Demand } from './portfolio-demand';
import {
  CLEANUP_INTERVAL_MS,
  TrialLedger,
  TrialStopped,
  TRIAL_MAX_MS,
  type TrialSession,
  type Counters,
} from "./trial";

export interface TrialRuntimeConfig {
  trialId: string;
  startsAt: number;
  expiresAt: number;
  store: (
    session?: TrialSession,
    onAttempt?: (costs: Counters) => void,
  ) => CacheStore & { cleanup?: (interval: number) => Promise<boolean> };
  shutdown: () => Promise<void>;
  network?: typeof fetch;
  now?: () => number;
  report?: (measurement: Record<string, unknown>) => void;
  portfolioDemand?: (session: TrialSession) => Promise<Demand>;
}
export function createTrialRuntime(config: TrialRuntimeConfig) {
  const now = config.now ?? Date.now;
  async function stop(ledger: TrialLedger | undefined, reason: string) {
    const outcomes = await Promise.allSettled([
      config.shutdown(),
      ledger?.stop(reason),
    ]);
    const errors = outcomes.filter(
      (r): r is PromiseRejectedResult => r.status === "rejected",
    );
    if (errors.length)
      throw new AggregateError(
        errors.map((r) => r.reason),
        "Shutdown could not be fully verified",
      );
  }
  function open() {
    if (
      !/^[a-zA-Z0-9_-]{1,100}$/.test(config.trialId) ||
      ![config.startsAt, config.expiresAt].every(Number.isFinite) ||
      config.expiresAt <= config.startsAt ||
      config.expiresAt - config.startsAt > TRIAL_MAX_MS ||
      now() < config.startsAt ||
      now() >= config.expiresAt
    )
      throw new TrialStopped(
        "Trial release is missing, not started or expired",
      );
  }
  async function run(
    kind: "collector" | "browser",
    id: string,
    work: (
      session: TrialSession,
      collector: MarketCollector,
      store: ReturnType<TrialRuntimeConfig["store"]>,
    ) => Promise<void>,
  ) {
    let session: TrialSession | undefined, ledger: TrialLedger | undefined;
    const accounting: Counters = {};
    let failure: unknown;
    try {
      open();
      const raw = config.store(undefined, (costs) => {
        for (const [k, v] of Object.entries(costs))
          accounting[k] = (accounting[k] ?? 0) + v;
      });
      ledger = new TrialLedger(raw, now);
      // The final minute is reserved for control-plane shutdown, including API
      // latency. The same durable schedule supplies the deadline invocation;
      // neither the handler nor an instance sleeps between collection runs.
      if (kind === "collector" && now() >= config.expiresAt - 60_000)
        throw new TrialStopped("Trial shutdown window reached");
      const state = await ledger.read();
      if (
        !state ||
        state.id !== config.trialId ||
        state.expiresAt > config.expiresAt ||
        state.startsAt < config.startsAt
      )
        throw new TrialStopped("Trial ledger does not match this release");
      session = (await ledger.admit(kind, id)) ?? undefined;
      if (!session) return;
      session.count(
        kind === "collector" ? "collectorInvocations" : "browserRequests",
      );
      const store = config.store(session);
      const collector = new MarketCollector(
        store,
        defaultPolicy,
        session.network(config.network),
        now,
        Math.random,
        (key, value) => session!.count(key, value),
      );
      await work(session, collector, store);
    } catch (error) {
      failure = error;
      // Failed accounting, uncertain transport and exhausted limits all close the
      // trial. No optional operation is retried to obtain a nicer measurement.
      await stop(
        ledger,
        error instanceof Error ? error.message : "Trial failed",
      );
      throw error;
    } finally {
      if (session) {
        try {
          await session.finish();
        } catch (error) {
          failure ??= error;
          await stop(ledger, "Measurement persistence failed");
          throw error;
        } finally {
          // Includes every ledger RPC, including finish(), whose own I/O cannot
          // be included in the atomic document it is writing. No payloads/IDs.
          config.report?.({
            event: "market_trial",
            trial: session.trialId,
            kind,
            at: now(),
            failed: !!failure,
            observed: session.observed,
            ledgerAttempts: accounting,
          });
        }
      }
    }
  }
  const respond =
    (session: TrialSession): MarketResponder =>
    async (req, res, status, body) => {
      session.assertOpen();
      const policy = session.policy();
      delete (policy as any).serverNow;
      const json =
        body === undefined
          ? ""
          : JSON.stringify({ ...(body as object), usage: policy });
      if (Buffer.byteLength(json) > 8 * 1024 ** 2)
        throw new TrialStopped("Browser response exceeds trial size limit");
      const etag = `"${createHash("sha256").update(json).digest("hex")}"`;
      const unchanged = status === 200 && req.headers["if-none-match"] === etag;
      const zipped =
        !unchanged &&
        json &&
        /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
      const payload = unchanged
        ? Buffer.alloc(0)
        : zipped
          ? gzipSync(json)
          : Buffer.from(json);
      const transfer = payload.length + 2048;
      if (transfer > 16 * 1024)
        await session.extend({ egressBytes: transfer - 16 * 1024 });
      session.take({ egressBytes: transfer }, false);
      session.count("apiBodyBytes", payload.length);
      session.count(`apiHttp${unchanged ? 304 : status}`);
      if (status === 200) res.setHeader("ETag", etag);
      if (zipped) res.setHeader("Content-Encoding", "gzip");
      res.setHeader("Vary", "Origin, Accept-Encoding");
      res.setHeader("Content-Length", payload.length);
      res.writeHead(unchanged ? 304 : status).end(payload);
    };
  return {
    async collect(eventId: string) {
      await run(
        "collector",
        `schedule-${createHash("sha256").update(eventId).digest("hex")}`,
        async (session, collector, store) => {
          const jobs=config.portfolioDemand?demandJobs(await config.portfolioDemand(session),now()):undefined;
          if(!jobs||jobs.length)await collector.tick(jobs);
          // At most one cleanup admission in this short trial, while the durable
          // cleanup key retains the requested maximum of 56/day between trials.
          if (store.cleanup) {
            const previous = await store.read("cleanup");
            if (!previous || JSON.parse(previous).nextAt <= now()) {
              await session.extend({
                cleanupRuns: 1,
                storageClassA: 4,
                storageListPages: 4,
              });
              session.take({ cleanupRuns: 1 });
              if (await store.cleanup(CLEANUP_INTERVAL_MS))
                session.count("cleanupRunsCompleted");
            }
          }
        },
      );
    },
    async handle(req: IncomingMessage, res: ServerResponse) {
      try {
        await run("browser", randomUUID(), async (session, collector) => {
          // Route all requests through admission, including OPTIONS and invalid URLs.
          if (
            !req.url?.startsWith("/api/companion/") &&
            req.url?.split("?")[0] !== "/api/market"
          )
            await respond(session)(req, res, 404, {
              error: "Unknown market route",
            });
          else await marketHandler(collector, respond(session))(req, res);
        });
      } catch {
        if (!res.headersSent) {
          res.setHeader("Cache-Control", "no-store");
          res.setHeader("Content-Type", "application/json");
          res
            .writeHead(503)
            .end(
              JSON.stringify({
                error: "Updates paused to protect the free allowance",
                usage: { mode: "paused", pollMs: 0 },
              }),
            );
        }
      }
    },
  };
}
