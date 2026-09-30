import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { liveMarketPlugin } from "./server/live-market";
import { fileURLToPath } from "node:url";
import { companionPlugin } from './server/companion';
export default defineConfig({
  plugins: [react(), liveMarketPlugin(), companionPlugin()],
  server: { port: 5173 },
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
        kits: fileURLToPath(new URL('./ui-kits.html', import.meta.url)),
      },
    },
  },
});
