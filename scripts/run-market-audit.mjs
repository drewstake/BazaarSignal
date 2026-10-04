import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
// Historical before/after reports are preserved. Audit only the supported collector.
if (process.argv.length > 2)
  throw new Error("This audit replays the current Bazaar implementation only.");
mkdirSync(".local/market-audit", { recursive: true });
const outfile = ".local/market-audit/bazaar-only.mjs";
await build({
  entryPoints: ["scripts/audit-market-local.ts"],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
});
execFileSync(process.execPath, [outfile], { stdio: "inherit" });
