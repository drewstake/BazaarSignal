import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { localMarketEnvironment } from "./local-market-config.mjs";

const require = createRequire(import.meta.url);
// Public prices only. No sign-in, private database, mail or local collection.
const offline = process.argv.includes("--offline");
console.log(offline
  ? "Local preview: saved SQLite snapshot; no cloud market requests."
  : "Local preview: shared website prices on demand, hourly browser cache; local collection disabled.");
const child = spawn(
  process.execPath,
  [
    resolve(dirname(require.resolve("vite/package.json")), "bin/vite.js"),
    "--host",
    "127.0.0.1",
    "--port",
    "5173",
    "--strictPort",
  ],
  {
    env: {
      ...process.env,
      ...localMarketEnvironment(offline),
      VITE_LOCAL_WORKSPACE: "false",
      VITE_FIREBASE_API_KEY: "",
      VITE_FIREBASE_AUTH_DOMAIN: "",
      VITE_FIREBASE_PROJECT_ID: "",
      VITE_FIREBASE_APP_ID: "",
      VITE_APPS_SCRIPT_URL: "",
      VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
    },
    stdio: "inherit",
    windowsHide: true,
  },
);
child.on("exit", (code) => {
  process.exitCode = code ?? 1;
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
