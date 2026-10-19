import type { Plugin } from "vite";
import { createCollector, marketHandler } from "../collector/http";
import { localWorkspaceHandler } from "./local-workspace";
import { loadEnv } from "vite";
import { MarketCollector } from "../collector/engine";
import { SqliteCache } from "../collector/cache-store";
import { sharedMarketHandler } from "./shared-market";
import { HistoryStore } from "../collector/history-store";
import { DailyCloseCollector } from "../collector/daily-close-collector";
import { cloudPriceHistoryHandler, priceHistoryHandler } from "./price-history";
export function companionPlugin(): Plugin {
  return {
    name: "bazaar-companion",
    async configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, "");
      const history = new HistoryStore(env.PRICE_HISTORY_FILE);
      const cloudHistory = env.LOCAL_CLOUD_HISTORY === "true";
      // Explicit local workspace starts the separately authorized daily archive.
      // UI tests, offline preview, and paid cloud collection never start it.
      const collecting =
        env.VITE_LOCAL_WORKSPACE === "true" &&
        env.LOCAL_SHARED_MARKET === "true" &&
        !cloudHistory &&
        env.LOCAL_DAILY_HISTORY !== "false";
      const dailyCollector = collecting
        ? new DailyCloseCollector(history)
        : undefined;
      server.middlewares.use(cloudHistory ? cloudPriceHistoryHandler() : priceHistoryHandler(history, collecting));
      dailyCollector?.start();
      server.httpServer?.once("close", () => {
        dailyCollector?.stop();
        history.close();
      });
      if (env.VITE_LOCAL_WORKSPACE === "true") {
        if (
          env.VITE_FIREBASE_PROJECT_ID !== "bazaarsignal" ||
          !env.VITE_FIREBASE_API_KEY
        )
          throw new Error(
            "Local workspace requires the existing BazaarSignal Google sign-in configuration.",
          );
        server.middlewares.use(
          localWorkspaceHandler(env.VITE_FIREBASE_API_KEY),
        );
      }
      if (env.LOCAL_SHARED_MARKET === "true") {
        server.middlewares.use(sharedMarketHandler());
        return; // No hourly market collector is opened in shared mode.
      }
      // The explicit preview must use disk, even if a remote store is configured.
      // Public routes only read saved snapshots; no tick/start is called here.
      const collector =
        env.VITE_LOCAL_MARKET_PREVIEW === "true"
          ? new MarketCollector(
              new SqliteCache(
                env.MARKET_CACHE_FILE ?? ".local/current-market.sqlite",
              ),
            )
          : await createCollector();
      // Portfolio release remains paused, including local development. Starting
      // collection needs a separately reviewed and authorized release.
      server.middlewares.use(marketHandler(collector));
      server.httpServer?.once("close", () => collector.stop());
    },
  };
}
