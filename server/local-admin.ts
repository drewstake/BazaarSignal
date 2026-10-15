import { createRequire } from "node:module";
import { resolve } from "node:path";
import { parseAdminReport, nextAdminRefresh } from "../shared/admin";
import { parseUsageReport, USAGE_OWNER_EMAIL } from "../shared/published-usage";

/** Local mode reads the published private reports. It cannot mutate production
 * records or trigger cloud measurements with the local operator credential. */
export async function readLocalAdmin(history = false) {
  const require = createRequire(resolve("package.json")),
    auth = require("firebase-tools/lib/auth");
  const account = auth
    .getAllAccounts()
    .find((a: any) => a.user.email === USAGE_OWNER_EMAIL);
  if (!account)
    throw Error("Local owner reporting credentials are unavailable.");
  const token = (await auth.getAccessToken(account.tokens.refresh_token, []))
    .access_token;
  const root =
    "https://firestore.googleapis.com/v1/projects/bazaarsignal/databases/(default)/documents";
  const get = async (path: string) => {
    const r = await fetch(`${root}/${path}`, {
      headers: { Authorization: `Bearer ${token}` },
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    if (!r.ok) throw Error("Published Admin report is unavailable.");
    const text = await r.text();
    if (text.length > 256 * 1024)
      throw Error("Published report exceeds its limit");
    return JSON.parse(text);
  };
  const owner = (await get("config/access")).fields?.ownerUid?.stringValue;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(owner ?? ""))
    throw Error("Invalid owner report location");
  const json = (
    await get(`owners/${owner}/reports/${history ? "usage" : "admin"}`)
  ).fields?.json?.stringValue;
  if (history) return parseUsageReport(json);
  const report = parseAdminReport(JSON.parse(json));
  return {
    ...report,
    schedule: "daily" as const,
    nextRefreshAt: nextAdminRefresh(report.checkedAt),
    failures: [
      ...report.failures,
      "Local workspace: this is the published daily snapshot. Collection runs on the server clock; opening Admin cannot request new measurements.",
    ],
  };
}
