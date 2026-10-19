import { spawn, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { existsSync, readdirSync } from "node:fs";
import { resolve, delimiter } from "node:path";
import { loadEnv } from "vite";
import { recoverLocalExport } from "./local-export.mjs";
import { localMarketEnvironment } from "./local-market-config.mjs";

const require = createRequire(import.meta.url);
const env = { ...process.env, ...loadEnv("development", process.cwd(), "") };
if (
  env.VITE_FIREBASE_PROJECT_ID !== "bazaarsignal" ||
  !env.VITE_FIREBASE_API_KEY
) {
  throw new Error(
    "Configure the existing BazaarSignal Google sign-in values in .env.local. Local storage uses the Firestore emulator; no cloud rules are deployed.",
  );
}
if (spawnSync("java", ["-version"], { env, windowsHide: true }).error) {
  const root = resolve(".local/java21");
  const java =
    existsSync(root) &&
    readdirSync(root)
      .map((dir) => resolve(root, dir, "bin"))
      .find((dir) =>
        existsSync(
          resolve(dir, process.platform === "win32" ? "java.exe" : "java"),
        ),
      );
  if (!java)
    throw new Error(
      "Java 21 is required for local Firestore. Set JAVA_HOME or add Java to PATH.",
    );
  env.PATH = java + delimiter + (env.PATH ?? env.Path ?? "");
  delete env.Path;
}
Object.assign(env, {
  ...localMarketEnvironment(process.argv.includes("--offline")),
  VITE_LOCAL_WORKSPACE: "true",
  VITE_USE_EMULATORS: "false",
  VITE_APPS_SCRIPT_URL: "",
  VITE_CONFIG_NATIVE_IGNORE_WARNING: "true",
  MARKET_SCHEDULER_DISABLED: "1",
});
// Use the real Google identity with a separate LOCAL database namespace.
// Daily price history comes from the scheduled cloud archive.
const data = ".local/local-workspace-data";
if (recoverLocalExport()) console.log("Recovered the last completed local Firestore export.");
const args = [
  require.resolve("firebase-tools/lib/bin/firebase.js"),
  "emulators:exec",
  "--only",
  "firestore",
  "--project",
  "bazaarsignal",
  ...(existsSync(resolve(data, "firebase-export-metadata.json"))
    ? ["--import", data]
    : []),
  "--export-on-exit",
  data,
  "node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5173 --strictPort",
];
console.log(
  "Local workspace: real Google sign-in and local portfolios. Cached market reads and cloud daily history enabled unless --offline. Local collection and email disabled.",
);
const child = spawn(process.execPath, args, {
  env,
  stdio: "inherit",
  windowsHide: true,
});
child.on("exit", (code) => {
  if (recoverLocalExport()) console.log("Recovered the completed local Firestore export after a Windows rename failure.");
  process.exitCode = code ?? 1;
});
child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
