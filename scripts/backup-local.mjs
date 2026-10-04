import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { completedExportTime, recoverLocalExport } from "./local-export.mjs";

const require = createRequire(import.meta.url);
const started = Date.now();
spawnSync(process.execPath, [
  require.resolve("firebase-tools/lib/bin/firebase.js"),
  "emulators:export", ".local/local-workspace-data", "--project", "bazaarsignal", "--force",
], { stdio: "inherit", windowsHide: true });
recoverLocalExport();
if (completedExportTime(".local/local-workspace-data") >= started) {
  console.log("Local portfolios backed up to .local/local-workspace-data.");
} else {
  console.error("Local backup did not complete. Keep the workspace running and retry.");
  process.exitCode = 1;
}
