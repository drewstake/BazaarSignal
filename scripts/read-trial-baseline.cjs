// Read-only inventory and delayed usage counters. Never turns missing data into zero.
const fs = require("node:fs"),
  auth = require("firebase-tools/lib/auth");
const project = "bazaarsignal-510305";
(async () => {
  const account = auth
    .getAllAccounts()
    .find((a) => a.user.email === "drewstake3@gmail.com");
  if (!account) throw new Error("Expected deployment account unavailable");
  const token = await auth.getAccessToken(account.tokens.refresh_token, []);
  const now = new Date(),
    month = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    ).toISOString();
  const out = {
    at: now.toISOString(),
    monthStartUTC: month,
    project,
    apiCalls: 0,
    resources: {},
    metrics: {},
    blockingUnknowns: [],
  };
  async function get(url) {
    out.apiCalls++;
    try {
      const r = await fetch(url, {
        headers: { Authorization: `Bearer ${token.access_token}` },
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      const d = await r.json();
      return r.ok ? d : { error: d.error?.message, status: r.status };
    } catch (error) {
      return { error: error.message, status: "unverified" };
    }
  }
  const root = `projects/${project}`,
    region = `${root}/locations/us-central1`;
  const urls = {
    billing: `https://cloudbilling.googleapis.com/v1/${root}/billingInfo`,
    mainBilling:
      "https://cloudbilling.googleapis.com/v1/projects/bazaarsignal/billingInfo",
    jobs: `https://cloudscheduler.googleapis.com/v1/${region}/jobs`,
    run: `https://run.googleapis.com/v2/${region}/services`,
    databases: `https://firestore.googleapis.com/v1/${root}/databases`,
    buckets: `https://storage.googleapis.com/storage/v1/b?project=${project}`,
    artifacts: `https://artifactregistry.googleapis.com/v1/${region}/repositories`,
    builds: `https://cloudbuild.googleapis.com/v1/${region}/builds?pageSize=100`,
    logs: `https://logging.googleapis.com/v2/${root}/locations/global/buckets`,
    apiIam: `https://run.googleapis.com/v1/${region}/services/marketapi:getIamPolicy`,
  };
  for (const [key, url] of Object.entries(urls))
    out.resources[key] = await get(url);
  if (out.resources.billing.billingAccountName)
    out.resources.sharedProjects = await get(
      `https://cloudbilling.googleapis.com/v1/${out.resources.billing.billingAccountName}/projects`,
    );
  // No runtime environment, source archive or secret values are exported.
  if (out.resources.run.services)
    out.resources.run.services = out.resources.run.services.map((s) => ({
      name: s.name,
      uri: s.uri,
      updateTime: s.updateTime,
      template: {
        scaling: s.template.scaling,
        timeout: s.template.timeout,
        concurrency: s.template.maxInstanceRequestConcurrency,
        containers: s.template.containers.map((c) => ({
          resources: c.resources,
        })),
      },
    }));
  if (out.resources.jobs.jobs)
    out.resources.jobs.jobs = out.resources.jobs.jobs.map((j) => ({
      name: j.name,
      state: j.state,
      schedule: j.schedule,
      lastAttemptTime: j.lastAttemptTime,
      retryConfig: j.retryConfig,
    }));
  if (out.resources.builds.builds)
    out.resources.builds.builds = out.resources.builds.builds.map((b) => ({
      id: b.id,
      status: b.status,
      createTime: b.createTime,
      startTime: b.startTime,
      finishTime: b.finishTime,
      options: b.options,
    }));
  const types = [
    "run.googleapis.com/request_count",
    "run.googleapis.com/container/billable_instance_time",
    "run.googleapis.com/container/cpu/allocation_time",
    "run.googleapis.com/container/memory/allocation_time",
    "run.googleapis.com/container/network/sent_bytes_count",
    "firestore.googleapis.com/document/read_ops_count",
    "firestore.googleapis.com/document/write_ops_count",
    "firestore.googleapis.com/document/delete_ops_count",
    "firestore.googleapis.com/storage/data_and_index_storage_bytes",
    "storage.googleapis.com/api/request_count",
    "storage.googleapis.com/storage/total_bytes",
    "storage.googleapis.com/network/sent_bytes_count",
    "logging.googleapis.com/billing/bytes_ingested",
    "monitoring.googleapis.com/billing/time_series_billed_for_queries_count",
  ];
  for (const type of types) {
    const descriptor = await get(
      `https://monitoring.googleapis.com/v3/${root}/metricDescriptors/${type}`,
    );
    if (descriptor.error) {
      out.metrics[type] = descriptor;
      continue;
    }
    const gauge = descriptor.metricKind === "GAUGE";
    const q = new URLSearchParams({
      filter: `metric.type="${type}"`,
      "interval.startTime": month,
      "interval.endTime": out.at,
      pageSize: "1000",
      "aggregation.alignmentPeriod": "3600s",
      "aggregation.perSeriesAligner": gauge ? "ALIGN_MAX" : "ALIGN_SUM",
    });
    const data = await get(
      `https://monitoring.googleapis.com/v3/${root}/timeSeries?${q}`,
    );
    out.metrics[type] = {
      unit: descriptor.unit,
      kind: descriptor.metricKind,
      ...data,
    };
  }
  for (const [key, value] of Object.entries(out.resources))
    if (value.error || value.nextPageToken)
      out.blockingUnknowns.push(`${key}: error or incomplete pagination`);
  for (const [key, value] of Object.entries(out.metrics))
    if (value.error || value.nextPageToken || !value.timeSeries?.length)
      out.blockingUnknowns.push(`${key}: no complete measurement`);
  fs.mkdirSync(".local", { recursive: true });
  // Preserve the previous observation before updating the convenience pointer.
  // A later recheck must never silently change the evidence cited in a report.
  const previousPath = ".local/trial-baseline.json";
  if (fs.existsSync(previousPath)) {
    const previous = JSON.parse(fs.readFileSync(previousPath, "utf8"));
    if (!Number.isFinite(Date.parse(previous.at))) throw new Error("Previous baseline has no valid timestamp; preserve and review it before replacement");
    const archive = `.local/trial-baseline-${new Date(previous.at).toISOString().replace(/[:.]/g, "-")}.json`;
    if (!fs.existsSync(archive)) fs.copyFileSync(previousPath, archive);
  }
  fs.writeFileSync(`.local/trial-baseline-${out.at.replace(/[:.]/g, "-")}.json`, JSON.stringify(out, null, 2), { flag: "wx" });
  fs.writeFileSync(".local/trial-baseline.json", JSON.stringify(out, null, 2));
  console.log(
    JSON.stringify(
      {
        at: out.at,
        apiCalls: out.apiCalls,
        billing: out.resources.billing,
        sharedProjects: out.resources.sharedProjects,
        blockingUnknowns: out.blockingUnknowns,
        metrics: Object.fromEntries(
          Object.entries(out.metrics).map(([k, v]) => [
            k,
            {
              unit: v.unit,
              kind: v.kind,
              series: v.timeSeries?.length ?? 0,
              sum:
                v.kind === "DELTA"
                  ? v.timeSeries?.reduce(
                      (sum, s) =>
                        sum +
                        s.points.reduce(
                          (n, p) =>
                            n +
                            Number(
                              p.value.int64Value ?? p.value.doubleValue ?? 0,
                            ),
                          0,
                        ),
                      0,
                    )
                  : undefined,
            },
          ]),
        ),
      },
      null,
      2,
    ),
  );
})().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
