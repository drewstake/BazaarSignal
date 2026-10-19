import { HistoryStore } from "./history-store";
import { historyDownload } from "./history-download";
import { dailyReducer } from "./history-sources";
import {
  historyDay,
  historyDayStart,
  HISTORY_DAY_MS,
} from "../shared/daily-price-history";
import { parseBook } from "../shared/market";

/** Local-only collector: one all-item request on the first start each day, plus
 * the closing snapshot at 23:59 fixed EST. No cloud services or paid-pilot calls.
 * Daily rows remain provisional until the day ends. Off days stay absent. */
export class DailyCloseCollector {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  constructor(
    private store: HistoryStore,
    private network: typeof fetch = fetch,
    private now = Date.now,
  ) {}
  async tick() {
    if (this.running || this.stopped) return;
    this.running = true;
    try {
      const now = this.now(),
        day = historyDay(now);
      const untilClose = historyDayStart(day) + HISTORY_DAY_MS - now;
      const closing = untilClose <= 60_000;
      const last = JSON.parse(this.store.state("last-success") ?? "null");
      if (closing && last?.day === day && last?.closing) return;
      // Three bounded attempts at 23:59:00/:20/:40; no retry loops or catch-up
      // requests for days when the host was asleep. Multiple processes share claims.
      const slot = closing
        ? `close-${Math.floor((60_000 - untilClose) / 20_000)}`
        : "startup";
      if (!this.store.claim(`attempt:${day}:${slot}`)) return;
      try {
        const raw = JSON.parse(
          (
            await historyDownload(
              "https://api.hypixel.net/v2/skyblock/bazaar",
              16 * 1024 ** 2,
              this.network,
            )
          ).toString("utf8"),
        );
        const checkedAt = this.now();
        if (this.stopped) return;
        if (
          !raw.success ||
          !Number.isSafeInteger(raw.lastUpdated) ||
          raw.lastUpdated > checkedAt ||
          checkedAt - raw.lastUpdated > 5 * 60_000 ||
          !raw.products ||
          Array.isArray(raw.products) ||
          typeof raw.products !== "object" ||
          Object.keys(raw.products).length > 20_000
        )
          throw new Error("Upstream snapshot is stale or malformed");
        const reduced = dailyReducer(
          "bazaarsignal",
          "https://api.hypixel.net/v2/skyblock/bazaar",
          checkedAt,
        );
        for (const [id, product] of Object.entries(raw.products)) {
          try {
            const book = parseBook(product);
            reduced.add(
              id,
              raw.lastUpdated,
              book.buy[0]?.pricePerUnit ?? null,
              book.sell[0]?.pricePerUnit ?? null,
            );
          } catch {
            /* Malformed products stay missing; never fill them from yesterday. */
          }
        }
        if (!reduced.rows.size) throw new Error("No valid Bazaar prices");
        this.store.save(reduced.rows.values());
        this.store.setState("last-success", {
          at: raw.lastUpdated,
          checkedAt,
          day: historyDay(raw.lastUpdated),
          closing: closing && historyDay(raw.lastUpdated) === day,
          items: reduced.rows.size,
        });
        this.store.setState("last-error", null);
        console.log(
          `[daily history] Saved ${reduced.rows.size} item prices; ${closing ? "closing" : "provisional"} sample ${new Date(raw.lastUpdated).toISOString()}`,
        );
      } catch (error) {
        if (this.stopped) return;
        this.store.setState("last-error", {
          at: this.now(),
          message: String(error),
        });
        console.error(`[daily history] ${String(error)}`);
      }
    } finally {
      this.running = false;
    }
  }
  start() {
    if (this.timer) return;
    this.stopped = false;
    void this.tick().catch((error) => console.error("[daily history]", error));
    this.timer = setInterval(
      () =>
        void this.tick().catch((error) =>
          console.error("[daily history]", error),
        ),
      15_000,
    );
    this.timer.unref();
  }
  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }
}
