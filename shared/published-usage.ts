import { verifiedUsageSnapshot, type UsageDashboard } from './usage-dashboard';

export const USAGE_REPORT_LIMIT = 256 * 1024;
export const USAGE_OWNER_EMAIL = 'drewstake3@gmail.com';
export const ownerUsagePath = (uid: string) => {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(uid)) throw new Error('Invalid report owner.');
  return `owners/${uid}/reports/usage`;
};

export function parseUsageReport(json: unknown): UsageDashboard {
  // Apps Script has no TextEncoder; count UTF-8 without a platform dependency.
  if (typeof json !== 'string' || json.length > USAGE_REPORT_LIMIT ||
    [...json].reduce((n,c)=>n+(c.codePointAt(0)!<128?1:c.codePointAt(0)!<2048?2:c.codePointAt(0)!<65536?3:4),0)>USAGE_REPORT_LIMIT)
    throw new Error('The saved usage report is invalid.');
  const report = JSON.parse(json) as UsageDashboard;
  if (!report || !Number.isFinite(report.generatedAt) || report.generatedAt <= 0 ||
    !Number.isFinite(report.nextMeasurementAt) || report.nextMeasurementAt <= report.generatedAt ||
    !Array.isArray(report.rows) || report.rows.length > 100 ||
    !report.rows.every(row => row && typeof row.id === 'string' && typeof row.resource === 'string') ||
    !report.collection || typeof report.collection.state !== 'string' || !report.spending)
    throw new Error('The saved usage report is invalid.');
  return verifiedUsageSnapshot(report);
}

/** Publication cannot make a previous observation newer or claim a live feed. */
export function publishableUsageReport(snapshot: UsageDashboard) {
  const {localReport: _local, localNextAttemptAt: _attempt, ...report} = snapshot;
  return parseUsageReport(JSON.stringify({...report, publishedReport: true}));
}
