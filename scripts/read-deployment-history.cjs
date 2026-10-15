// Bounded, read-only evidence collection; credentials and container env are never saved.
const fs = require("node:fs"),
  auth = require("firebase-tools/lib/auth");
(async () => {
  const [periodStart, output] = process.argv.slice(2);
  if (
    !periodStart ||
    !Number.isFinite(Date.parse(periodStart)) ||
    Date.now() - Date.parse(periodStart) <= 0 ||
    Date.now() - Date.parse(periodStart) > 32 * 86400000 ||
    !/^\.local\/[a-z0-9-]+\.json$/.test(output ?? "")
  )
    throw new Error(
      "Usage: node scripts/read-deployment-history.cjs <period-start-ISO> .local/<new-evidence>.json",
    );
  if (fs.existsSync(output))
    throw new Error("Evidence already saved; do not overwrite");
  const account = auth
    .getAllAccounts()
    .find((a) => a.user.email === "drewstake3@gmail.com");
  if (!account) throw new Error("Existing owner login unavailable");
  const token = (await auth.getAccessToken(account.tokens.refresh_token, []))
    .access_token;
  const report = {
    at: new Date().toISOString(),
    periodStart,
    project: "bazaarsignal-510305",
    calls: 0,
    queries: {},
    errors: [],
  };
  const save = () => fs.writeFileSync(output, JSON.stringify(report, null, 2));
  fs.writeFileSync(output, JSON.stringify(report), { flag: "wx" });
  async function request(url, body) {
    if (++report.calls > 20) throw new Error("Evidence call bound exhausted");
    save();
    const r = await fetch(url, {
      method: body ? "POST" : "GET",
      redirect: "error",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20000),
    });
    const parts = [];
    let size = 0;
    for await (const chunk of r.body) {
      size += chunk.length;
      if (size > 8 * 1024 ** 2)
        throw new Error("Evidence response exceeded bound");
      parts.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(parts).toString());
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${data.error?.status}`);
    return data;
  }
  for (const service of [
    "run.googleapis.com",
    "cloudfunctions.googleapis.com",
    "artifactregistry.googleapis.com",
  ]) {
    const q = (report.queries[service] = { entries: [], complete: false });
    try {
      let pageToken;
      for (let page = 0; page < 5; page++) {
        const data = await request(
          "https://logging.googleapis.com/v2/entries:list",
          {
            resourceNames: [`projects/${report.project}`],
            filter: `timestamp >= "${report.periodStart}" AND timestamp <= "${report.at}" AND protoPayload.serviceName="${service}" AND (log_id("cloudaudit.googleapis.com/activity") OR log_id("cloudaudit.googleapis.com/system_event"))`,
            pageSize: 300,
            orderBy: "timestamp asc",
            ...(pageToken ? { pageToken } : {}),
          },
        );
        for (const e of data.entries ?? []) {
          const p = e.protoPayload ?? {},
            res = p.response ?? {},
            req = p.request ?? {};
          const svc = req.service ?? req;
          q.entries.push({
            at: e.timestamp,
            insertId: e.insertId,
            operation: e.operation,
            method: p.methodName,
            resource: p.resourceName,
            status: p.status,
            responseName: res.name ?? res.metadata?.name,
            readyRevision:
              res.latestReadyRevision ?? res.status?.latestReadyRevisionName,
            conditions: res.terminalCondition ?? res.status?.conditions,
            requestedImages: (
              svc.template?.containers ??
              svc.spec?.template?.spec?.containers ??
              []
            )
              .map((c) => c.image)
              .filter(Boolean),
            responseImages: (
              res.template?.containers ??
              res.spec?.template?.spec?.containers ??
              []
            )
              .map((c) => c.image)
              .filter(Boolean),
          });
        }
        pageToken = data.nextPageToken;
        save();
        if (!pageToken) {
          q.complete = true;
          break;
        }
      }
      if (!q.complete)
        report.errors.push(`${service}: pagination bound reached`);
    } catch (e) {
      report.errors.push(`${service}: ${e.message}`);
    }
    save();
  }
  for (const name of ["marketapi", "refreshmarket"]) {
    try {
      const data = await request(
        `https://run.googleapis.com/v2/projects/${report.project}/locations/us-central1/services/${name}/revisions?pageSize=1000`,
      );
      report.queries[`${name}-revisions`] = {
        complete: !data.nextPageToken,
        revisions: (data.revisions ?? []).map((r) => ({
          name: r.name,
          createTime: r.createTime,
          updateTime: r.updateTime,
          conditions: r.conditions,
          images: r.containers?.map((c) => c.image),
          resources: r.containers?.map((c) => c.resources),
          scaling: r.scaling,
          timeout: r.timeout,
          logUri: r.logUri,
        })),
      };
    } catch (e) {
      report.errors.push(`${name}: ${e.message}`);
    }
    save();
  }
  console.log(
    JSON.stringify(
      {
        file: output,
        at: report.at,
        calls: report.calls,
        errors: report.errors,
        queries: Object.fromEntries(
          Object.entries(report.queries).map(([key, q]) => [
            key,
            {
              complete: q.complete,
              count: (q.entries ?? q.revisions ?? []).length,
              methods: q.entries
                ? Object.fromEntries(
                    [...new Set(q.entries.map((e) => e.method))].map((m) => [
                      m,
                      q.entries.filter((e) => e.method === m).length,
                    ]),
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
