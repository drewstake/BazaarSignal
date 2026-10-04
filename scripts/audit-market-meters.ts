// Read-only operator meters, deliberately bypassing the dashboard cache writer.
// No market handler, collector, alert worker or billing mutation is invoked.
import { createRequire } from "node:module";
import { writeFileSync, mkdirSync } from "node:fs";
import { measureDashboard } from "../collector/usage-dashboard";
import { trialGoogleStore } from "../collector/trial-google";
const require = createRequire(import.meta.url),
  auth = require("firebase-tools/lib/auth");
const account = auth
  .getAllAccounts()
  .find((a: any) => a.user.email === "drewstake3@gmail.com");
if (!account) throw new Error("Existing authorized operator login required");
const credential = await auth.getAccessToken(account.tokens.refresh_token, []);
const token = async () => credential.access_token;
const report = await measureDashboard({
  store: trialGoogleStore({
    project: "bazaarsignal-510305",
    bucket: "bazaarsignal-510305-market-cache",
    token,
  }),
  token,
});
mkdirSync(".local/market-audit", { recursive: true });
writeFileSync(
  ".local/market-audit/meters.json",
  JSON.stringify(report, null, 2),
);
console.log(
  JSON.stringify(
    {
      at: report.generatedAt,
      collection: report.collection,
      rows: report.rows.map((r) => ({
        id: r.id,
        state: r.state,
        measured: r.measured,
        at: r.measuredAt,
      })),
    },
    null,
    2,
  ),
);
