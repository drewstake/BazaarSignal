import { createHash } from "node:crypto";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, relative, isAbsolute } from "node:path";

export const digest = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const fileDigest = (value) =>
  createHash("sha256").update(value).digest("hex");
const finite = (n) => Number.isFinite(n) && n >= 0;
const units = {
  cpuSeconds: "vCPU-seconds",
  memoryGiBSeconds: "GiB-seconds",
  artifactBytes: "byte-months",
};
const date = (s) => {
  const n = Date.parse(s);
  if (!Number.isFinite(n)) throw new Error("Invalid accounting date");
  return n;
};

export function parseBillingCsv(text) {
  const rows = [];
  let row = [],
    field = "",
    quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = !quoted;
    } else if (c === "," && !quoted) {
      row.push(field);
      field = "";
    } else if (c === "\n" && !quoted) {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Malformed billing CSV");
  if (field || row.length) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const header = rows.shift();
  if (
    !["SKU ID", "Usage amount", "Usage unit"].every((k) => header?.includes(k))
  )
    throw new Error("Missing billing columns");
  return rows
    .filter((r) => r.some(Boolean))
    .map((r) => Object.fromEntries(header.map((k, i) => [k, r[i] ?? ""])));
}

/** Reproducible, provisional compute settlement. Reporting uncertainty is budgeted
 * with an additional rollout hold, separately from the provider's 25% margin.
 * This is not a final invoice, a runtime grant, or permission to settle storage. */
export function computeSettlement(baseline, history, csv, scope) {
  if (
    scope.version !== 1 ||
    scope.billingAccount !== baseline.billingAccount ||
    scope.periodStart !== baseline.periodStart ||
    scope.periodEnd !== baseline.periodEnd ||
    !["allProjects", "allServices", "allSkus", "allLocations"].every(
      (k) => scope[k] === true,
    ) ||
    !scope.sourceUrl?.startsWith(
      `https://console.cloud.google.com/billing/${baseline.billingAccount.split("/")[1]}/reports`,
    ) ||
    history.project !== baseline.project ||
    history.errors?.length ||
    date(history.periodStart) > date(baseline.periodStart) ||
    date(history.at) < date(baseline.recordedThrough)
  )
    throw new Error("Incomplete billing or deployment scope");
  const run = history.queries?.["run.googleapis.com"];
  if (
    !run?.complete ||
    !history.queries?.["cloudfunctions.googleapis.com"]?.complete ||
    history.queries["cloudfunctions.googleapis.com"].entries.length
  )
    throw new Error("Incomplete or unsupported deployment history");
  const updates = run.entries.filter(
    (e) => e.method === "google.cloud.run.v2.Services.UpdateService",
  );
  // Other control-plane mutations cannot be silently treated as the known rollouts.
  if (
    run.entries.some(
      (e) =>
        ![
          "google.cloud.run.v2.Services.UpdateService",
          "/Services.UpdateService",
          "google.cloud.run.v1.Services.SetIamPolicy",
        ].includes(e.method),
    )
  )
    throw new Error("Unclassified deployment event");
  const groups = new Set();
  let completedThrough = 0;
  for (const e of updates) {
    const service = e.resource?.split("/").at(-1),
      image = e.requestedImages?.[0];
    const revisions = history.queries?.[`${service}-revisions`];
    if (
      !["marketapi", "refreshmarket"].includes(service) ||
      e.resource !==
        `projects/${baseline.project}/locations/us-central1/services/${service}` ||
      !image?.startsWith(
        `us-central1-docker.pkg.dev/${baseline.project}/gcf-artifacts/`,
      ) ||
      !image?.match(/\/market-trial@sha256:[a-f0-9]{64}$/) ||
      e.requestedImages.length !== 1 ||
      e.status?.code ||
      date(e.at) > date(baseline.recordedThrough) ||
      !revisions?.complete
    )
      throw new Error("Unresolved or out-of-scope rollout");
    const matches = revisions.revisions.filter(
      (r) =>
        r.name?.startsWith(`${e.resource}/revisions/`) &&
        r.images?.includes(image) &&
        date(r.createTime) >= date(e.at) &&
        date(r.createTime) - date(e.at) < 5 * 60000 &&
        r.conditions?.some(
          (c) => c.type === "Ready" && c.state === "CONDITION_SUCCEEDED",
        ),
    );
    if (matches.length !== 1)
      throw new Error("Rollout has no unique ready revision");
    const ready = run.entries.filter(
      (r) =>
        r.readyRevision === matches[0].name.split("/").at(-1) &&
        r.responseImages?.includes(image) &&
        date(r.at) >= date(e.at) &&
        r.conditions?.some((c) => c.type === "Ready" && c.status === "True"),
    );
    if (!ready.length) throw new Error("Missing terminal service evidence");
    completedThrough = Math.max(
      completedThrough,
      Math.min(...ready.map((r) => date(r.at))),
    );
    groups.add(image);
  }
  if (
    groups.size !== baseline.documentedAttempts ||
    !completedThrough ||
    date(scope.observedAt) - completedThrough < 48 * 3600000 ||
    date(scope.coveredThrough) < completedThrough ||
    date(scope.coveredThrough) > date(scope.observedAt)
  )
    throw new Error("Rollout coverage is incomplete or immature");
  const rows = parseBillingCsv(csv),
    meters = {};
  const computeRows = rows.filter(
    (r) =>
      /Cloud Run/i.test(r["Service description"]) &&
      /CPU|Memory/i.test(r["SKU description"]),
  );
  if (
    computeRows.length !== 2 ||
    computeRows.some(
      (r) => !["AD70-830E-0384", "769A-FA0B-B049"].includes(r["SKU ID"]),
    )
  )
    throw new Error(
      "Unsupported compute SKU; account scope must not be narrowed",
    );
  for (const [key, sku, unit] of [
    ["cpuSeconds", "AD70-830E-0384", "second"],
    ["memoryGiBSeconds", "769A-FA0B-B049", "gibibyte second"],
  ]) {
    const values = rows.filter((r) => r["SKU ID"] === sku);
    if (values.length !== 1 || values[0]["Usage unit"] !== unit)
      throw new Error("Missing or duplicate compute SKU");
    const text = values[0]["Usage amount"].replaceAll(",", ""),
      n = Number(text);
    if (!/^\d+(\.\d+)?$/.test(text) || !finite(n))
      throw new Error("Invalid billed amount");
    // Add a whole displayed unit, rather than treating a rounded CSV as exact.
    const precision = 10 ** -(text.split(".")[1]?.length ?? 0);
    meters[key] = {
      unit: units[key],
      coveredHold: baseline.holds[key],
      observedUpperBound: Number((n + precision).toFixed(8)),
      uncertainty: 10000,
    };
  }
  return {
    version: 1,
    id: `compute-${digest({ baseline, history, csv, scope }).slice(0, 24)}`,
    project: baseline.project,
    billingAccount: baseline.billingAccount,
    periodStart: baseline.periodStart,
    periodEnd: baseline.periodEnd,
    baselineSha256: digest(baseline),
    method: "mature-billing-export-and-ready-revisions",
    observedAt: scope.observedAt,
    coveredThrough: scope.coveredThrough,
    completedThrough: new Date(completedThrough).toISOString(),
    evidenceVerified: true,
    reconstructedDeployments: groups.size,
    serviceUpdates: updates.length,
    meters,
  };
}

export function reconcileDeploymentEvidence(
  baseline,
  history,
  csv,
  scope,
  storage,
) {
  const settlement = computeSettlement(baseline, history, csv, scope);
  if (!storage) return settlement;
  const resources = storage.resources,
    repo = `projects/${baseline.project}/locations/us-central1/repositories/gcf-artifacts`;
  if (
    storage.errors?.length ||
    !resources?.repository ||
    resources.repository.name !== repo ||
    !resources.files ||
    resources.files.nextPageToken ||
    (resources.files.files ?? []).length ||
    (resources.repository.sizeBytes !== undefined &&
      Number(resources.repository.sizeBytes) !== 0) ||
    !resources.packages ||
    resources.packages.nextPageToken ||
    date(storage.at) < date(scope.coveredThrough) ||
    date(storage.at) - date(scope.observedAt) > 24 * 3600000
  )
    throw new Error("Current artifact retention is not verified empty");
  const rows = parseBillingCsv(csv),
    storageRows = rows.filter((r) => r["SKU ID"] === "8502-299A-ABAF");
  if (
    storageRows.length !== 1 ||
    storageRows[0]["Usage unit"] !== "gibibyte month"
  )
    throw new Error("Missing historical artifact byte-month usage");
  const otherStorage = rows.filter(
    (r) =>
      r["Service description"] === "Artifact Registry" &&
      /Storage/i.test(r["SKU description"]) &&
      r["SKU ID"] !== "8502-299A-ABAF",
  );
  if (otherStorage.length) throw new Error("Unclassified artifact storage SKU");
  const text = storageRows[0]["Usage amount"].replaceAll(",", ""),
    amount = Number(text);
  if (!/^\d+(\.\d+)?$/.test(text) || !finite(amount))
    throw new Error("Invalid artifact usage");
  const points =
    resources.sizeHistory?.timeSeries?.flatMap((s) => s.points ?? []) ?? [];
  const samples = points.map((p) =>
    Number(p.value.int64Value ?? p.value.doubleValue),
  );
  if (samples.some((n) => !finite(n)))
    throw new Error("Invalid artifact size sample");
  // Do not integrate sparse gauges or turn their missing intervals into zero.
  // Budget the larger of the entire original storage hold and observed peak
  // throughout the uncovered interval PLUS two days of billing uncertainty.
  const retentionUpperBound = Math.max(
    baseline.holds.artifactBytes,
    ...samples,
  );
  const gapMs = Math.max(0, date(storage.at) - date(scope.coveredThrough));
  const uncertainty =
    Math.ceil(
      (retentionUpperBound * (gapMs + 48 * 3600000)) /
        (date(baseline.periodEnd) - date(baseline.periodStart)),
    ) +
    1024 ** 2;
  const precision = 10 ** -(text.split(".")[1]?.length ?? 0);
  settlement.meters.artifactBytes = {
    unit: "byte-months",
    coveredHold: baseline.holds.artifactBytes,
    observedUpperBound: Math.ceil((amount + precision) * 1024 ** 3),
    uncertainty,
    retentionUpperBound,
    uncoveredIntervalMs: gapMs,
    reportingBufferMs: 48 * 3600000,
    currentFileCount: 0,
    metadataRetentionReserve: 1024 ** 2,
  };
  settlement.id = `rollouts-${digest({ baseline, history, csv, scope, storage }).slice(0, 24)}`;
  return settlement;
}

/** Never edit a receipt to settle it. The recovered floor also survives a new checkout.
 * New/unknown attempts stay additive. Only the explicitly covered baseline can settle. */
export function deploymentBalance(
  baseline,
  receipts,
  settlements,
  periodStart,
  periodEnd,
) {
  const start = date(periodStart),
    end = date(periodEnd);
  if (end <= start || end - start > 32 * 86400000)
    throw new Error("Invalid accounting period");
  const applicable =
    date(baseline.periodStart) === start && date(baseline.periodEnd) === end;
  const older = {},
    newer = {};
  for (const receipt of receipts) {
    if (!receipt.apply || !receipt.reservations) continue;
    const at = date(receipt.at);
    if (at < start || at >= end) continue;
    const target =
      applicable && at <= date(baseline.recordedThrough) ? older : newer;
    for (const [key, meter] of Object.entries(receipt.reservations)) {
      if (!finite(meter.hold)) throw new Error("Invalid reservation");
      target[key] = (target[key] ?? 0) + meter.hold;
    }
  }
  const keys = new Set([
    ...Object.keys(applicable ? baseline.holds : {}),
    ...Object.keys(older),
    ...Object.keys(newer),
  ]);
  const original = Object.fromEntries(
    [...keys].map((key) => [
      key,
      Math.max(applicable ? (baseline.holds[key] ?? 0) : 0, older[key] ?? 0) +
        (newer[key] ?? 0),
    ]),
  );
  const unresolved = { ...original },
    observed = {},
    uncertainty = {},
    applied = [];
  const covered = new Set(),
    ids = new Set();
  for (const s of settlements) {
    if (date(s.periodStart) !== start || date(s.periodEnd) !== end) continue;
    if (
      !applicable ||
      s.version !== 1 ||
      !s.id ||
      ids.has(s.id) ||
      s.baselineSha256 !== digest(baseline) ||
      s.project !== baseline.project ||
      s.billingAccount !== baseline.billingAccount
    )
      throw new Error("Settlement identity, period or baseline mismatch");
    ids.add(s.id);
    if (
      s.method !== "mature-billing-export-and-ready-revisions" ||
      !s.evidenceVerified ||
      !s.evidenceFiles?.length ||
      date(s.observedAt) - date(s.completedThrough) < 48 * 3600000 ||
      date(s.coveredThrough) < date(s.completedThrough) ||
      date(s.coveredThrough) > date(s.observedAt)
    )
      throw new Error("Settlement evidence is incomplete or immature");
    for (const [key, m] of Object.entries(s.meters ?? {})) {
      // The loader reconstructs these values from hashed source evidence.
      // Neither a current empty repository nor a billing row alone is sufficient.
      if (
        !Object.hasOwn(units, key) ||
        covered.has(key) ||
        m.unit !== units[key] ||
        m.coveredHold !== baseline.holds[key] ||
        (older[key] ?? 0) > m.coveredHold ||
        !finite(m.observedUpperBound) ||
        !finite(m.uncertainty) ||
        m.uncertainty < (key === "artifactBytes" ? 1024 ** 2 : 10000) ||
        (key === "artifactBytes" &&
          (m.currentFileCount !== 0 ||
            m.reportingBufferMs < 48 * 3600000 ||
            !finite(m.retentionUpperBound)))
      )
        throw new Error(
          `Unsupported, duplicate or underfunded settlement: ${key}`,
        );
      covered.add(key);
      unresolved[key] -= m.coveredHold;
      observed[key] = m.observedUpperBound;
      uncertainty[key] = m.uncertainty;
    }
    applied.push(s.id);
  }
  return { original, unresolved, observed, uncertainty, applied };
}

/** The measured baseline appears once; uncovered reservations remain additive.
 * Callers must still add the untouched market ledger and the proposed rollout. */
export function deploymentUsed(balance, key, measured = 0) {
  if (!finite(measured)) throw new Error("Invalid measured usage");
  return (
    Math.max(measured, balance.observed[key] ?? 0) +
    (balance.unresolved[key] ?? 0) +
    (balance.uncertainty[key] ?? 0)
  );
}

export function verifyDeploymentAccounting(plan, balance, marketReserved = {}) {
  for (const key of Object.keys(balance.original)) {
    const market = marketReserved[key] ?? 0;
    if (
      !finite(market) ||
      !finite(plan.meters?.[key]?.used) ||
      plan.meters[key].used < deploymentUsed(balance, key) + market
    )
      throw new Error(
        `Deployment omits retained rollout or market reservations: ${key}`,
      );
  }
}

export function loadDeploymentAccounting(
  periodStart,
  periodEnd,
  directory = ".local",
) {
  const baseline = JSON.parse(
    readFileSync(
      new URL("./deployment-reservations.json", import.meta.url),
      "utf8",
    ),
  );
  const names = existsSync(directory) ? readdirSync(directory) : [];
  const receipts = names
    .filter((n) => /^private-release-.*-apply\.json$/.test(n))
    .map((n) => JSON.parse(readFileSync(resolve(directory, n), "utf8")));
  const settlements = names
    .filter((n) => /^deployment-settlement-.*\.json$/.test(n))
    .map((n) => {
      const record = JSON.parse(readFileSync(resolve(directory, n), "utf8"));
      // Prior periods cannot authorize current work and need not keep local evidence online.
      if (
        date(record.periodStart) !== date(periodStart) ||
        date(record.periodEnd) !== date(periodEnd)
      )
        return record;
      for (const ref of record.evidenceFiles ?? []) {
        const path = resolve(directory, ref.path),
          rel = relative(resolve(directory), path);
        if (
          isAbsolute(rel) ||
          rel === ".." ||
          rel.startsWith("..\\") ||
          rel.startsWith("../") ||
          fileDigest(readFileSync(path)) !== ref.sha256
        )
          throw new Error("Settlement evidence missing or changed");
      }
      const evidence = (role) => {
        const refs = record.evidenceFiles.filter((ref) => ref.role === role);
        if (refs.length !== 1)
          throw new Error("Settlement evidence role missing or duplicated");
        return readFileSync(resolve(directory, refs[0].path), "utf8");
      };
      const rebuilt = reconcileDeploymentEvidence(
        baseline,
        JSON.parse(evidence("deployment-history")),
        evidence("billing-csv"),
        JSON.parse(evidence("billing-scope")),
        record.evidenceFiles.some((ref) => ref.role === "storage-inventory")
          ? JSON.parse(evidence("storage-inventory"))
          : undefined,
      );
      const { evidenceFiles: _files, ...core } = record;
      if (digest(core) !== digest(rebuilt))
        throw new Error("Settlement does not match its source evidence");
      return record;
    });
  return deploymentBalance(
    baseline,
    receipts,
    settlements,
    periodStart,
    periodEnd,
  );
}
