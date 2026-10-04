import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { companionPlugin } from './server/companion';
export default defineConfig({
  plugins: [react(), companionPlugin()],
  server: { port: 5173 },
  build: {
    sourcemap: false,
    rollupOptions: {
      input: {
        app: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
});
