import type { Plugin } from "vite";
import { createCollector, marketHandler } from "../collector/http";
export function companionPlugin(): Plugin {
  return {
    name: "bazaar-companion",
    configureServer(server) {
      const collector = createCollector();
      server.middlewares.use(marketHandler(collector));
      server.httpServer?.once("close", () => collector.stop());
    },
  };
}
