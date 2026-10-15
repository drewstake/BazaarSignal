// Offline and append-only. Never uploads, deploys, changes IAM or edits runtime counters.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";
import {
  reconcileDeploymentEvidence,
  fileDigest,
  loadDeploymentAccounting,
} from "./deployment-accounting.mjs";

const args = process.argv.slice(2);
const write = args.at(-1) === "--write";
if (write) args.pop();
const [historyPath, csvPath, scopePath, storagePath] = args;
if (args.length < 3 || args.length > 4 || args.some((a) => a.startsWith("--")))
  throw new Error(
    "Usage: node scripts/reconcile-deployments.mjs <history.json> <billing.csv> <scope.json> [storage.json] [--write]",
  );
const baseline = JSON.parse(
  readFileSync(
    new URL("./deployment-reservations.json", import.meta.url),
    "utf8",
  ),
);
const inputs = [
  historyPath,
  csvPath,
  scopePath,
  ...(storagePath ? [storagePath] : []),
].map((path, i) => {
  const absolute = resolve(path),
    local = relative(resolve(".local"), absolute);
  if (
    isAbsolute(local) ||
    local === ".." ||
    local.startsWith("..\\") ||
    local.startsWith("../")
  )
    throw new Error("Keep private settlement evidence inside .local");
  const bytes = readFileSync(absolute);
  return {
    text: bytes.toString("utf8"),
    ref: {
      role: [
        "deployment-history",
        "billing-csv",
        "billing-scope",
        "storage-inventory",
      ][i],
      path: local,
      sha256: fileDigest(bytes),
    },
  };
});
const settlement = {
  ...reconcileDeploymentEvidence(
    baseline,
    JSON.parse(inputs[0].text),
    inputs[1].text,
    JSON.parse(inputs[2].text),
    inputs[3] ? JSON.parse(inputs[3].text) : undefined,
  ),
  evidenceFiles: inputs.map((i) => i.ref),
};
const output = `.local/deployment-settlement-${settlement.id}.json`;
const data = JSON.stringify(settlement, null, 2) + "\n";
if (write) {
  // Verify all prior records before adding another. Same evidence is idempotent.
  const prior = loadDeploymentAccounting(
    baseline.periodStart,
    baseline.periodEnd,
  );
  if (existsSync(output)) {
    if (readFileSync(output, "utf8") !== data)
      throw new Error("Existing settlement differs; never overwrite");
  } else {
    if (prior.applied.length)
      throw new Error("Baseline is already settled; do not credit it twice");
    writeFileSync(output, data, { flag: "wx" });
  }
}
console.log(
  JSON.stringify(
    {
      written: write,
      output,
      settlement,
      ...(write
        ? {
            balance: loadDeploymentAccounting(
              baseline.periodStart,
              baseline.periodEnd,
            ),
          }
        : {}),
      note: "Provisional evidence-backed settlement with separate uncertainty buffers. Uncovered holds and the market ledger remain; this is not deployment or activation approval.",
    },
    null,
    2,
  ),
);
