import { HistoryStore } from "../collector/history-store";
import { DailyCloseCollector } from "../collector/daily-close-collector";

const store = new HistoryStore();
const collector = new DailyCloseCollector(store);
collector.start();
// Standalone runner stays alive even though the embeddable collector unrefs its timer.
const keepAlive = setInterval(() => {}, 60_000);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    collector.stop();
    clearInterval(keepAlive);
    store.close();
  });
console.log(
  "Daily close collector running. Keep this process and host awake at 23:59 EST (UTC-05:00). Data stays in .local/price-history.sqlite.",
);
