import type { Plugin } from "vite";
import { createCollector, marketHandler } from "../collector/http";
export function companionPlugin(): Plugin {
  return {
    name: "bazaar-companion",
    async configureServer(server) {
      const collector = await createCollector();
      if (process.env.MARKET_SCHEDULER_DISABLED !== "1") collector.start();
      server.middlewares.use(marketHandler(collector));
      server.httpServer?.once("close", () => collector.stop());
    },
  };
}
