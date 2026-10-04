import { build } from "esbuild";
import { execFileSync } from "node:child_process";
import { resolve, relative } from "node:path";
import { mkdirSync } from "node:fs";

// Capture the original implementation without modifying the user's checkout.
// HEAD was clean when this audit began. Baseline revision is explicit/recorded.
const revision = process.argv[2] ?? "HEAD";
const sha = execFileSync("git", ["rev-parse", "--verify", revision], {
  encoding: "utf8",
}).trim();
console.log(`Offline baseline: ${sha}`);
mkdirSync(".local/market-audit", { recursive: true });
for (const label of ["before", "after"]) {
  const outfile = resolve(`.local/market-audit/${label}.mjs`);
  await build({
    entryPoints: ["scripts/audit-market-local.ts"],
    outfile,
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    plugins:
      label === "before"
        ? [
            {
              name: "original-collector",
              setup(build) {
                build.onLoad(
                  { filter: /[/\\]collector[/\\].*\.ts$/ },
                  (args) => ({
                    contents: execFileSync(
                      "git",
                      [
                        "show",
                        `${sha}:${relative(process.cwd(), args.path).replaceAll("\\", "/")}`,
                      ],
                      { encoding: "utf8" },
                    ),
                    loader: "ts",
                  }),
                );
              },
            },
          ]
        : [],
  });
  execFileSync(process.execPath, ["--expose-gc", outfile, label], {
    stdio: "inherit",
  });
}
