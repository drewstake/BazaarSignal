export interface UsageRow {
  id: string; project: string; resource: string; purpose: string; unit: string;
  measured: number | null; state: 'measured' | 'unavailable' | 'not-reported';
  allowance: number | null; allowanceLabel: string; scope: string;
  periodStart: number; periodEnd: number; periodLabel: string;
  percent: number | null; remaining: number | null; projected: number | null;
  reservation: number | null; budget: number | null; reservationPeriod: string;
  measuredAt: number | null; source: string; sourceUrl: string; note: string;
  coverage?: 'permission' | 'delay' | 'setup' | 'not-exposed' | 'incomplete' | 'error';
  coverageDetail?: string;
  kind?: 'daily' | 'monthly' | 'capacity' | 'rolling';
  resetAt?: number | null;
  allowanceComparable?: boolean;
  measurementBasis?: 'artifact-registry-sizeBytes';
}

/** Retire the unsuitable Monitoring image gauge without resetting the shared cache lease. */
export function verifiedUsageSnapshot(snapshot: UsageDashboard): UsageDashboard {
  return {...snapshot, rows: snapshot.rows.map(row => row.id !== 'images' || row.measurementBasis === 'artifact-registry-sizeBytes' ? row : {
    ...row, state: 'unavailable', measured: null, measuredAt: null, percent: null, remaining: null, projected: null,
    coverage: 'delay', coverageDetail: 'The storage measurement source was corrected. Waiting for the next eligible cached report; the earlier value cannot establish allowance use.',
    source: 'Artifact Registry repository metadata · sizeBytes (awaiting cached reading)',
  })};
}
export interface UsageDashboard {
  publishedReport?: boolean;
  localReport?: string;
  localNextAttemptAt?: number;
  generatedAt: number; nextMeasurementAt: number; stale?: boolean;
  rows: UsageRow[];
  spending: { state: 'unavailable' | 'not-reported'; month: null; total: null;
    coverage: string; reason: string; setup: string; sourceUrl: string; checkedAt: string };
  collection: { state: string; reason: string; pressure: number | null;
    hourlyTrialEndsAt?: number;
    reviewAt: number | null; lastSuccessAt: number | null; nextCollectionAt: number | null;
    scheduler: string; cleanup: string; measuredAt: number };
}
