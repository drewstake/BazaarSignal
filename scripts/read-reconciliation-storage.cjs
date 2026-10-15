// Read-only repository inventory and historical gauges; missing samples are not zero.
const fs = require("node:fs"),
  auth = require("firebase-tools/lib/auth");
(async () => {
  const [start, file] = process.argv.slice(2);
  if (
    !Number.isFinite(Date.parse(start)) ||
    Date.now() - Date.parse(start) <= 0 ||
    Date.now() - Date.parse(start) > 32 * 86400000 ||
    !/^\.local\/[a-z0-9-]+\.json$/.test(file ?? "")
  )
    throw new Error(
      "Usage: node scripts/read-reconciliation-storage.cjs <period-start-ISO> .local/<new-evidence>.json",
    );
  if (fs.existsSync(file)) throw new Error("Evidence exists");
  const a = auth
    .getAllAccounts()
    .find((a) => a.user.email === "drewstake3@gmail.com");
  const token = (await auth.getAccessToken(a.tokens.refresh_token, []))
    .access_token;
  const r = {
    at: new Date().toISOString(),
    start,
    calls: 0,
    resources: {},
    errors: [],
  };
  fs.writeFileSync(file, JSON.stringify(r), { flag: "wx" });
  async function get(name, url) {
    r.calls++;
    try {
      const response = await fetch(url, {
        redirect: "error",
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(15000),
      });
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 4 * 1024 ** 2) throw new Error("Response bound exceeded");
        chunks.push(chunk);
      }
      const d = JSON.parse(Buffer.concat(chunks).toString());
      if (!response.ok)
        throw new Error(`HTTP ${response.status}: ${d.error?.status}`);
      r.resources[name] = d;
      if (d.nextPageToken) r.errors.push(`${name}: incomplete page`);
    } catch (e) {
      r.errors.push(`${name}: ${e.message}`);
    }
    fs.writeFileSync(file, JSON.stringify(r, null, 2));
  }
  const repo =
    "projects/bazaarsignal-510305/locations/us-central1/repositories/gcf-artifacts";
  await get("repository", `https://artifactregistry.googleapis.com/v1/${repo}`);
  await get(
    "files",
    `https://artifactregistry.googleapis.com/v1/${repo}/files?pageSize=1000`,
  );
  await get(
    "packages",
    `https://artifactregistry.googleapis.com/v1/${repo}/packages?pageSize=1000`,
  );
  const type = "artifactregistry.googleapis.com/repository/size";
  await get(
    "sizeDescriptor",
    `https://monitoring.googleapis.com/v3/projects/bazaarsignal-510305/metricDescriptors/${type}`,
  );
  const q = new URLSearchParams({
    filter: `metric.type="${type}"`,
    "interval.startTime": r.start,
    "interval.endTime": r.at,
    "aggregation.alignmentPeriod": "3600s",
    "aggregation.perSeriesAligner": "ALIGN_MAX",
    pageSize: "1000",
  });
  await get(
    "sizeHistory",
    `https://monitoring.googleapis.com/v3/projects/bazaarsignal-510305/timeSeries?${q}`,
  );
  console.log(
    JSON.stringify(
      {
        file,
        calls: r.calls,
        errors: r.errors,
        files: r.resources.files,
        packages: r.resources.packages,
        descriptor: r.resources.sizeDescriptor,
        series: r.resources.sizeHistory?.timeSeries?.map((s) => ({
          resource: s.resource,
          points: s.points?.length,
          oldest: s.points?.at(-1),
          latest: s.points?.[0],
          nonzero: s.points?.filter(
            (p) => Number(p.value.int64Value ?? p.value.doubleValue) > 0,
          ).length,
        })),
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
