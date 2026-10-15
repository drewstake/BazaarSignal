import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, sep } from "node:path";
// @ts-expect-error Directly executable operator utility.
import {
  computeSettlement,
  reconcileDeploymentEvidence,
  deploymentBalance,
  deploymentUsed,
  verifyDeploymentAccounting,
  digest,
  fileDigest,
  loadDeploymentAccounting,
  parseBillingCsv,
} from "../scripts/deployment-accounting.mjs";

const baseline = {
  version: 1,
  id: "baseline",
  project: "bazaarsignal-510305",
  billingAccount: "billingAccounts/012803-EA91BE-8DCD32",
  periodStart: "2026-10-01T07:00:00.000Z",
  periodEnd: "2026-11-01T07:00:00.000Z",
  recordedThrough: "2026-10-04T22:02:00.000Z",
  documentedAttempts: 1,
  holds: {
    cpuSeconds: 10000,
    memoryGiBSeconds: 10000,
    artifactBytes: 100000000,
    logBytes: 16777216,
  },
};
const image = `us-central1-docker.pkg.dev/bazaarsignal-510305/gcf-artifacts/market-trial@sha256:${"a".repeat(64)}`;
const revision =
  "projects/bazaarsignal-510305/locations/us-central1/services/marketapi/revisions/marketapi-00001-one";
const history = () => ({
  project: baseline.project,
  periodStart: baseline.periodStart,
  at: "2026-10-12T00:00:00Z",
  errors: [],
  queries: {
    "run.googleapis.com": {
      complete: true,
      entries: [
        {
          method: "google.cloud.run.v2.Services.UpdateService",
          at: "2026-10-02T00:00:00Z",
          resource: `projects/${baseline.project}/locations/us-central1/services/marketapi`,
          requestedImages: [image],
          status: {},
        },
        {
          method: "/Services.UpdateService",
          at: "2026-10-02T00:00:10Z",
          readyRevision: revision.split("/").at(-1),
          responseImages: [image],
          conditions: [{ type: "Ready", status: "True" }],
        },
      ],
    },
    "cloudfunctions.googleapis.com": { complete: true, entries: [] },
    "marketapi-revisions": {
      complete: true,
      revisions: [
        {
          name: revision,
          createTime: "2026-10-02T00:00:01Z",
          images: [image],
          conditions: [{ type: "Ready", state: "CONDITION_SUCCEEDED" }],
        },
      ],
    },
  },
});
const csv =
  "Service description,SKU description,SKU ID,Usage amount,Usage unit\r\n" +
  'Cloud Run Functions,CPU,AD70-830E-0384,"1,683.7",second\r\n' +
  'Cloud Run Functions,Memory,769A-FA0B-B049,"1,683.7",gibibyte second\r\n';
const scope = () => ({
  version: 1,
  billingAccount: baseline.billingAccount,
  periodStart: baseline.periodStart,
  periodEnd: baseline.periodEnd,
  observedAt: "2026-10-12T00:00:00Z",
  coveredThrough: "2026-10-11T00:00:00Z",
  allProjects: true,
  allServices: true,
  allSkus: true,
  allLocations: true,
  sourceUrl:
    "https://console.cloud.google.com/billing/012803-EA91BE-8DCD32/reports;grouping=GROUP_BY_SKU",
});
const settlement = () => ({
  ...computeSettlement(baseline, history(), csv, scope()),
  evidenceFiles: [{ path: "proof", sha256: "placeholder" }],
});
const balance = (receipts: any[] = [], settlements: any[] = []) =>
  deploymentBalance(
    baseline,
    receipts,
    settlements,
    baseline.periodStart,
    baseline.periodEnd,
  );

describe("deployment reconciliation", () => {
  it("recovers the documented floor when original local receipts are absent", () => {
    expect(balance().unresolved).toEqual(baseline.holds);
    expect(deploymentUsed(balance(), "cpuSeconds", 100)).toBe(10100);
  });
  it("reconstructs terminal deployments and rounds usage upward, preserving a separate uncertainty hold", () => {
    const s = settlement();
    expect(s.reconstructedDeployments).toBe(1);
    expect(s.meters.cpuSeconds.observedUpperBound).toBe(1683.8);
    expect(s.meters.cpuSeconds.uncertainty).toBe(10000);
    const b = balance([], [s]);
    expect(b.unresolved.cpuSeconds).toBe(0);
    expect(b.unresolved.artifactBytes).toBe(100000000);
    expect(b.unresolved.logBytes).toBe(16777216);
    expect(deploymentUsed(b, "cpuSeconds", 1658.9)).toBe(11683.8);
    expect(deploymentUsed(b, "cpuSeconds", 2000)).toBe(12000); // Later observations count once.
    expect(baseline.holds.cpuSeconds).toBe(10000);
  });
  it("does not double count recovered old receipts; future and ambiguous attempts stay reserved", () => {
    const old = {
      apply: true,
      at: "2026-10-02T00:00:00Z",
      reservations: { cpuSeconds: { hold: 10000 } },
    };
    const later = {
      apply: true,
      at: "2026-10-10T00:00:00Z",
      error: "unknown outcome",
      reservations: { cpuSeconds: { hold: 10000 } },
    };
    const b = balance([old, later], [settlement()]);
    expect(b.original.cpuSeconds).toBe(20000);
    expect(b.unresolved.cpuSeconds).toBe(10000);
    expect(deploymentUsed(b, "cpuSeconds")).toBe(21683.8);
    expect(() => balance([old, old], [settlement()])).toThrow("underfunded");
    expect(balance([old, old]).unresolved.cpuSeconds).toBe(20000);
  });
  it("rejects repeat credits, edited baselines, reduced uncertainty and storage settlement", () => {
    const s = settlement();
    expect(() => balance([], [s, s])).toThrow();
    expect(() => balance([], [s, { ...s, id: "again" }])).toThrow("duplicate");
    expect(() => balance([], [{ ...s, baselineSha256: digest({}) }])).toThrow(
      "baseline",
    );
    expect(() =>
      balance(
        [],
        [
          {
            ...s,
            meters: { cpuSeconds: { ...s.meters.cpuSeconds, uncertainty: 0 } },
          },
        ],
      ),
    ).toThrow();
    expect(() =>
      balance(
        [],
        [
          {
            ...s,
            meters: {
              artifactBytes: {
                unit: "bytes",
                coveredHold: 100000000,
                observedUpperBound: 0,
                uncertainty: 0,
              },
            },
          },
        ],
      ),
    ).toThrow();
  });
  it("refuses partial histories, missing terminal events, wrong counts and incomplete billing scope", () => {
    for (const change of [
      (h: any) => {
        h.queries["run.googleapis.com"].complete = false;
      },
      (h: any) => {
        h.queries["run.googleapis.com"].entries.pop();
      },
      (h: any) => {
        h.queries["marketapi-revisions"].revisions[0].conditions[0].state =
          "CONDITION_PENDING";
      },
      (h: any) => {
        h.errors = ["partial"];
      },
      (h: any) => {
        h.queries["run.googleapis.com"].entries[0].resource =
          "projects/other/locations/us-central1/services/marketapi";
      },
      (h: any) => {
        h.queries["cloudfunctions.googleapis.com"].entries = [
          { method: "create" },
        ];
      },
    ]) {
      const h = history();
      change(h);
      expect(() => computeSettlement(baseline, h, csv, scope())).toThrow();
    }
    expect(() =>
      computeSettlement(
        { ...baseline, documentedAttempts: 2 },
        history(),
        csv,
        scope(),
      ),
    ).toThrow("coverage");
    expect(() =>
      computeSettlement(baseline, history(), csv, {
        ...scope(),
        allProjects: false,
      }),
    ).toThrow("scope");
    expect(() =>
      computeSettlement(baseline, history(), csv, {
        ...scope(),
        observedAt: "2026-10-02T01:00:00Z",
      }),
    ).toThrow("immature");
  });
  it("does not treat a rounded bill, missing compute row or new region/SKU as complete evidence", () => {
    expect(parseBillingCsv(csv)[0]["Usage amount"]).toBe("1,683.7");
    for (const input of [
      csv.replace("gibibyte second", "gibibyte month"),
      csv.split("\r\n").slice(0, 2).join("\r\n"),
      csv + "Cloud Run,CPU Europe,UNKNOWN,100,second\r\n",
      csv + "Cloud Run Functions,CPU,AD70-830E-0384,1,second\r\n",
    ])
      expect(() =>
        computeSettlement(baseline, history(), input, scope()),
      ).toThrow();
  });
  it("does not carry monthly compute credits to a new period or reset receipt counters", () => {
    const b = deploymentBalance(
      baseline,
      [],
      [settlement()],
      "2026-11-01T07:00:00.000Z",
      "2026-12-01T08:00:00.000Z",
    );
    expect(b.applied).toEqual([]);
    expect(b.original).toEqual({});
  });
  it("settles storage only with historical byte-month usage and a complete empty file inventory", () => {
    const storage: any = {
      at: "2026-10-12T00:00:00Z",
      errors: [],
      resources: {
        repository: {
          name: `projects/${baseline.project}/locations/us-central1/repositories/gcf-artifacts`,
        },
        files: {},
        packages: { packages: [] },
        sizeHistory: {
          timeSeries: [{ points: [{ value: { int64Value: "1588252852" } }] }],
        },
      },
    };
    const report =
      csv +
      "Artifact Registry,Artifact Registry Storage,8502-299A-ABAF,0.02,gibibyte month\r\n";
    const s = {
      ...reconcileDeploymentEvidence(
        baseline,
        history(),
        report,
        scope(),
        storage,
      ),
      evidenceFiles: [{ path: "proof" }],
    };
    expect(s.meters.artifactBytes.observedUpperBound).toBe(32212255);
    expect(s.meters.artifactBytes.uncertainty).toBeGreaterThan(150000000);
    expect(balance([], [s]).unresolved.artifactBytes).toBe(0);
    expect(() =>
      reconcileDeploymentEvidence(baseline, history(), csv, scope(), storage),
    ).toThrow("byte-month");
    for (const mutation of [
      (v: any) => {
        delete v.resources.files;
      },
      (v: any) => {
        v.resources.files.nextPageToken = "more";
      },
      (v: any) => {
        v.resources.files.files = [{ sizeBytes: "1" }];
      },
      (v: any) => {
        v.resources.repository.sizeBytes = "1";
      },
      (v: any) => {
        v.errors = ["incomplete"];
      },
    ]) {
      const v = structuredClone(storage);
      mutation(v);
      expect(() =>
        reconcileDeploymentEvidence(baseline, history(), report, scope(), v),
      ).toThrow();
    }
  });
  it("keeps the market ledger additive when the release consumes a settlement", () => {
    const b = balance([], [settlement()]);
    const plan = {
      meters: Object.fromEntries(
        Object.keys(b.original).map((key) => [
          key,
          { used: deploymentUsed(b, key) },
        ]),
      ),
    };
    expect(() => verifyDeploymentAccounting(plan, b)).not.toThrow();
    expect(() =>
      verifyDeploymentAccounting(plan, b, { cpuSeconds: 8340 }),
    ).toThrow("market");
    plan.meters.cpuSeconds.used += 8340;
    expect(() =>
      verifyDeploymentAccounting(plan, b, { cpuSeconds: 8340 }),
    ).not.toThrow();
  });
  it("fails closed if saved evidence is absent or changed on another checkout", () => {
    const dir = mkdtempSync(join(tmpdir(), "bazaarsignal-settlement-"));
    try {
      const liveBaseline = JSON.parse(
        readFileSync(
          new URL("../scripts/deployment-reservations.json", import.meta.url),
          "utf8",
        ),
      );
      const record = {
        ...settlement(),
        baselineSha256: digest(liveBaseline),
        evidenceFiles: [{ path: "proof", sha256: fileDigest("original") }],
      };
      writeFileSync(
        join(dir, "deployment-settlement-test.json"),
        JSON.stringify(record),
      );
      expect(() =>
        loadDeploymentAccounting(baseline.periodStart, baseline.periodEnd, dir),
      ).toThrow();
      writeFileSync(join(dir, "proof"), "changed");
      expect(() =>
        loadDeploymentAccounting(baseline.periodStart, baseline.periodEnd, dir),
      ).toThrow("evidence");
    } finally {
      if (
        !resolve(dir).startsWith(
          resolve(tmpdir()) + sep + "bazaarsignal-settlement-",
        )
      )
        throw new Error("Unsafe test cleanup");
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
