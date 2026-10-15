import type { Plugin } from "vite";
import { createCollector, marketHandler } from "../collector/http";
import { localWorkspaceHandler } from "./local-workspace";
import { loadEnv } from "vite";
import { MarketCollector } from "../collector/engine";
import { SqliteCache } from "../collector/cache-store";
import { sharedMarketHandler } from "./shared-market";
export function companionPlugin(): Plugin {
  return {
    name: "bazaar-companion",
    async configureServer(server) {
      const env = loadEnv(server.config.mode, server.config.root, "");
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
        return; // No collector or market store is opened in shared mode.
      }
      // The explicit preview must use disk, even if a remote store is configured.
      // Public routes only read saved snapshots; no tick/start is called here.
      const collector = env.VITE_LOCAL_MARKET_PREVIEW === "true"
        ? new MarketCollector(new SqliteCache(env.MARKET_CACHE_FILE ?? ".local/current-market.sqlite"))
        : await createCollector();
      // Portfolio release remains paused, including local development. Starting
      // collection needs a separately reviewed and authorized release.
      server.middlewares.use(marketHandler(collector));
      server.httpServer?.once("close", () => collector.stop());
    },
  };
}
