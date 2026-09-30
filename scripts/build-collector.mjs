import { build } from "esbuild";
await build({
  entryPoints: ["collector/main.ts"],
  outfile: ".local/collector-runner.mjs",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  packages: "external",
});
