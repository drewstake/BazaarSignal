import type { UsageRow } from "./usage-dashboard";

export type UsageStatus =
  "Within allowance" | "Getting close" | "Over allowance" | "Unknown";
export const kindOf = (r: UsageRow) =>
  r.kind ??
  (r.periodLabel.startsWith("Latest")
    ? "capacity"
    : r.periodLabel.startsWith("Rolling")
      ? "rolling"
      : r.periodLabel.startsWith("Daily")
        ? "daily"
        : "monthly");
export function currentStatus(row: UsageRow, stale = false): UsageStatus {
  if (
    row.id === "images" &&
    row.measurementBasis !== "artifact-registry-sizeBytes"
  )
    return "Unknown";
  if (
    stale ||
    row.allowanceComparable === false ||
    row.state !== "measured" ||
    row.measured === null ||
    !Number.isFinite(row.measured) ||
    row.measured < 0 ||
    !row.allowance ||
    !Number.isFinite(row.allowance) ||
    row.allowance <= 0
  )
    return "Unknown";
  const ratio = row.measured / row.allowance;
  return ratio > 1
    ? "Over allowance"
    : ratio >= 0.8
      ? "Getting close"
      : "Within allowance";
}
export function projectionStatus(row: UsageRow): UsageStatus {
  return kindOf(row) === "capacity" || kindOf(row) === "rolling"
    ? "Unknown"
    : currentStatus({ ...row, measured: row.projected });
}
export function needsAttention(row: UsageRow, stale = false) {
  return (
    ["Getting close", "Over allowance"].includes(currentStatus(row, stale)) ||
    (!stale &&
      ["Getting close", "Over allowance"].includes(projectionStatus(row)))
  );
}
export function sortResources(rows: UsageRow[]) {
  // Use the same reported percentage as the fill bars, including stale reports.
  const used = (row: UsageRow) =>
    currentStatus(row) === "Unknown" ? -1 : row.measured! / row.allowance!;
  return [...rows].sort(
    (a, b) =>
      used(b) - used(a) ||
      a.resource.localeCompare(b.resource) ||
      a.id.localeCompare(b.id),
  );
}
export function imageStorageEstimate(row: UsageRow) {
  // Published USD/GiB-hour, expressed as a typical 730-hour month. Not billed cost.
  if (
    row.id !== "images" ||
    row.measurementBasis !== "artifact-registry-sizeBytes" ||
    row.state !== "measured" ||
    row.measured === null ||
    !Number.isFinite(row.measured) ||
    row.measured < 0
  )
    return null;
  return Math.max(0, row.measured / 1024 ** 3 - 0.5) * 0.000136986 * 730;
}
