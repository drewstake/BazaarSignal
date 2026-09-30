import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import type {
  CollectorHealth,
  Sale,
  Valuation,
} from "../shared/companion/types";

export interface HistoryStore {
  mode: "local" | "firestore";
  load(): Promise<{ sales: Sale[]; health: CollectorHealth | null }>;
  commit(
    sales: Sale[],
    health: CollectorHealth,
    aggregates: Map<string, Valuation>,
  ): Promise<void>;
}
export class LocalHistory implements HistoryStore {
  mode = "local" as const;
  constructor(private path = resolve(".local/collector/history.json")) {}
  async load() {
    try {
      const saved = JSON.parse(await readFile(this.path, "utf8"));
      return {
        sales: saved.sales as Sale[],
        health: saved.health as CollectorHealth,
      };
    } catch (e: any) {
      if (e.code === "ENOENT") return { sales: [], health: null };
      throw e;
    }
  }
  async commit(sales: Sale[], health: CollectorHealth) {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(
      `${this.path}.next`,
      JSON.stringify({ version: 1, sales, health }),
    );
    await rename(`${this.path}.next`, this.path);
  }
}
export class FirestoreHistory implements HistoryStore {
  mode = "firestore" as const;
  private knownSales = new Set<string>();
  private variants = new Map<string, number>();
  private aggregates = new Map<string, string>();
  private db: any;
  private cleanupAt = 0;
  private checkpoint = 0;
  private checkpointSuccess = 0;
  async connect() {
    if (this.db) return;
    const { initializeApp, applicationDefault, getApps } =
      await import("firebase-admin/app");
    const { getFirestore } = await import("firebase-admin/firestore");
    const app =
      getApps().find((a) => a.name === "collector") ??
      initializeApp(
        {
          credential: applicationDefault(),
          projectId: process.env.GOOGLE_CLOUD_PROJECT,
        },
        "collector",
      );
    this.db = getFirestore(app);
  }
  async load() {
    await this.connect();
    const [events, status] = await Promise.all([
      this.db
        .collection("completedSales")
        .where("soldAt", ">=", Date.now() - 14 * 86400000)
        .orderBy("soldAt", "desc")
        .limit(10000)
        .get(),
      this.db.doc("collectorStatus/main").get(),
    ]);
    const sales = events.docs.map((d: any) => d.data() as Sale);
    sales.forEach((s: Sale) => {
      this.knownSales.add(s.id);
      this.variants.set(
        s.variant.fingerprint,
        Math.max(
          this.variants.get(s.variant.fingerprint) ?? 0,
          s.observedAt - 86400001,
        ),
      );
    });
    const health = status.exists ? (status.data() as CollectorHealth) : null;
    this.checkpoint = health?.endedUpstreamAt ?? 0;
    this.checkpointSuccess = health?.lastEndedSuccess ?? 0;
    if (health && sales.length >= 10000) {
      health.error =
        "Startup history capped at 10,000 records; narrow collection scope.";
      health.missedMs += 1;
    }
    return { sales, health };
  }
  async commit(
    sales: Sale[],
    health: CollectorHealth,
    aggregates: Map<string, Valuation>,
  ) {
    await this.connect();
    // Persist a budget counter as part of each bounded batch. A single collector
    // instance owns this project; never run multiple writers against this budget.
    const newSales = sales.filter((s) => !this.knownSales.has(s.id));
    for (const sale of newSales) {
      const updateVariant =
        sale.observedAt - (this.variants.get(sale.variant.fingerprint) ?? 0) >
        86400000;
      const writes = updateVariant ? 3 : 2;
      if (health.writesToday + writes + 1 > health.writeLimit) {
        health.error =
          "Daily write budget reached; collection coverage is incomplete.";
        health.missedMs += 30000;
        break;
      }
      const batch = this.db.batch();
      // create is idempotent across restarts; ALREADY_EXISTS never overwrites evidence.
      batch.create(this.db.doc(`completedSales/${sale.id}`), {
        ...sale,
        fingerprint: sale.variant.fingerprint,
        itemId: sale.variant.itemId,
      });
      if (updateVariant)
        batch.set(this.db.doc(`itemVariants/${sale.variant.fingerprint}`), {
          ...sale.variant,
          lastSeenAt: sale.observedAt,
        });
      health.writesToday += writes;
      // Do not advance the durable feed cursor before all events in this feed
      // have been attempted. A crash resumes from the prior committed window.
      batch.set(this.db.doc("collectorStatus/main"), {
        ...health,
        endedUpstreamAt: this.checkpoint,
        lastEndedSuccess: this.checkpointSuccess,
      });
      try {
        await batch.commit();
      } catch (e: any) {
        if (e.code !== 6) throw e;
      }
      this.knownSales.add(sale.id);
      if (updateVariant)
        this.variants.set(sale.variant.fingerprint, sale.observedAt);
    }
    for (const [id, value] of aggregates) {
      // Window endpoints move each tick; exclude them from unchanged detection.
      const { windowStart, windowEnd, ...statistics } = value;
      const signature = JSON.stringify(statistics);
      if (
        this.aggregates.get(id) === signature ||
        health.writesToday + 3 > health.writeLimit
      )
        continue;
      const batch = this.db.batch();
      batch.set(this.db.doc(`comparablePrices/${id}`), {
        ...value,
        updatedAt: Date.now(),
      });
      health.writesToday += 2;
      batch.set(this.db.doc("collectorStatus/main"), {
        ...health,
        endedUpstreamAt: this.checkpoint,
        lastEndedSuccess: this.checkpointSuccess,
      });
      await batch.commit();
      this.aggregates.set(id, signature);
    }
    if (
      Date.now() - this.cleanupAt > 3600000 &&
      health.writesToday + 203 < health.writeLimit
    ) {
      for (const [collection, field, days] of [
        ["completedSales", "soldAt", 14],
        ["comparablePrices", "updatedAt", 14],
        ["itemVariants", "lastSeenAt", 30],
      ] as const) {
        if (health.writesToday + 203 >= health.writeLimit) break;
        const expired = await this.db
          .collection(collection)
          .where(field, "<", Date.now() - days * 86400000)
          .limit(200)
          .get();
        if (!expired.empty) {
          const b = this.db.batch();
          expired.docs.forEach((d: any) => b.delete(d.ref));
          health.writesToday += expired.size + 1;
          b.set(this.db.doc("collectorStatus/main"), {
            ...health,
            endedUpstreamAt: this.checkpoint,
            lastEndedSuccess: this.checkpointSuccess,
          });
          await b.commit();
        }
      }
      this.cleanupAt = Date.now();
    }
    if (health.writesToday < health.writeLimit) {
      health.writesToday++;
      await this.db.doc("collectorStatus/main").set(health);
      this.checkpoint = health.endedUpstreamAt;
      this.checkpointSuccess = health.lastEndedSuccess;
    }
    const retained = new Set(sales.map((s) => s.id));
    for (const id of this.knownSales)
      if (!retained.has(id)) this.knownSales.delete(id);
  }
}
