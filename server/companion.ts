import type { Plugin } from "vite";
import { createCollector, marketHandler } from "../collector/http";
import { localWorkspaceHandler } from "./local-workspace";
import { loadEnv } from "vite";
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
      const collector = await createCollector();
      // Portfolio release remains paused, including local development. Starting
      // collection needs a separately reviewed and authorized release.
      server.middlewares.use(marketHandler(collector));
      server.httpServer?.once("close", () => collector.stop());
    },
  };
}
