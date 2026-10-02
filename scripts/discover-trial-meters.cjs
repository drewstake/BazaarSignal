// Read-only descriptor discovery; does not query time-series or mutate resources.
const fs = require("node:fs");
const auth = require("firebase-tools/lib/auth");
(async () => {
  const account = auth
    .getAllAccounts()
    .find((a) => a.user.email === "drewstake3@gmail.com");
  if (!account) throw new Error("Expected account unavailable");
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  const results = {};
  for (const prefix of [
    "monitoring.googleapis.com/billing/",
    "firestore.googleapis.com/storage/",
  ]) {
    const q = new URLSearchParams({
      filter: `metric.type = starts_with("${prefix}")`,
      pageSize: "1000",
    });
    const response = await fetch(
      `https://monitoring.googleapis.com/v3/projects/bazaarsignal-510305/metricDescriptors?${q}`,
      { headers: { Authorization: `Bearer ${token.access_token}` } },
    );
    const data = await response.json();
    if (!response.ok || data.nextPageToken)
      throw new Error(`Incomplete metric discovery: ${response.status}`);
    results[prefix] = (data.metricDescriptors ?? []).map((d) => ({
      type: d.type,
      kind: d.metricKind,
      unit: d.unit,
      description: d.description,
    }));
  }
  fs.writeFileSync(
    ".local/trial-meter-descriptors.json",
    JSON.stringify(results, null, 2),
  );
  console.log(JSON.stringify(results, null, 2));
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
