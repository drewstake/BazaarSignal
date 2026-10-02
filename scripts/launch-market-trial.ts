import { readFileSync, writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { prepareTrial } from "../collector/trial-preflight";
import { launchTrial } from "../collector/trial-launch";
import { googleTrialControl, type GoogleTrialPlan } from "../collector/trial-launch-google";
import { trialGoogleStore } from "../collector/trial-google";

// This command never creates a plan, refreshes a deadline, grants shutdown
// permissions, deploys a release or edits billing. The operator supplies the
// already-reviewed complete evidence. Default mode only reads cloud state.
async function main() {
  const args = process.argv.slice(2);
  const file = args.find(arg => !arg.startsWith("--"));
  if (!file || args.some(arg => arg.startsWith("--") && arg !== "--apply") || args.filter(arg => !arg.startsWith("--")).length !== 1)
    throw new Error("Usage: npm run trial:launch -- <verified-plan.json> [--apply]. No verified plan is currently available; see docs/MARKET-TRIAL.md.");
  const path = realpathSync(file);
  const plan: GoogleTrialPlan = JSON.parse(readFileSync(path, "utf8"));
  prepareTrial(plan); // No authentication or cloud calls for invalid evidence.
  const require = createRequire(resolve("package.json"));
  const auth = require("firebase-tools/lib/auth");
  const account = auth.getAllAccounts().find((a: any) => a.user.email === "drewstake3@gmail.com");
  if (!account) throw new Error("Expected deployment account unavailable");
  const credentials = await auth.getAccessToken(account.tokens.refresh_token, []);
  const token = async () => credentials.access_token as string;
  const control = googleTrialControl({ token }, plan);
  const operations: Record<string, number> = {};
  const store = trialGoogleStore({
    project: plan.project, bucket: `${plan.project}-market-cache`, token,
    onAttempt(costs) { for (const [key, n] of Object.entries(costs)) operations[key] = (operations[key] ?? 0) + n; },
  });
  const report: Record<string, unknown> = { at: new Date().toISOString(), id: plan.id, apply: args.includes("--apply") };
  try {
    report.result = await launchTrial(plan, store, control, args.includes("--apply"));
  } catch (error) {
    // Do not export tokens, entire plans, response payloads or private records.
    report.error = error instanceof Error ? error.message : "Launch failed";
    throw error;
  } finally {
    report.finishedAt = new Date().toISOString();
    report.ledgerOperations = operations;
    await store.close();
    mkdirSync(".local", { recursive: true });
    writeFileSync(`.local/trial-launch-${Date.now()}.json`, JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
}
main().catch(error => { console.error(error instanceof Error ? error.message : "Launch failed"); process.exitCode = 1; });
