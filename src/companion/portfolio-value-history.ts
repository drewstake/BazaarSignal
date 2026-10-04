import type { portfolioTotals } from "../../shared/companion/portfolio";

export type PortfolioValuePoint = {
  at: number;
  value: number;
  sampledAt: number;
  stale: boolean;
};
export type PortfolioValueHistory = {
  version: 1;
  signature: string;
  points: PortfolioValuePoint[];
};
export type PortfolioValueSnapshot = Omit<PortfolioValuePoint, "at"> & {
  signature: string;
};
export const HISTORY_DAYS = 90;
export const HISTORY_LIMIT = 5000;
const DAY = 86_400_000;
export const emptyValueHistory = (): PortfolioValueHistory => ({
  version: 1,
  signature: "",
  points: [],
});
export const portfolioValueHistoryKey = (uid: string, portfolioId: string) =>
  `bazaarsignal-private-value-v1:${encodeURIComponent(uid)}:${encodeURIComponent(portfolioId)}`;

/** A snapshot is a complete observed valuation, never an invented backfill or
 * a partial total that would look like the portfolio lost its missing assets. */
export function portfolioValueSnapshot(
  totals: ReturnType<typeof portfolioTotals>,
): PortfolioValueSnapshot | null {
  if (
    !totals.rows.length ||
    totals.missing ||
    totals.value === null ||
    !Number.isFinite(totals.value)
  )
    return null;
  const rows = [...totals.rows].sort((a, b) =>
    a.holding.id.localeCompare(b.holding.id),
  );
  const samples = rows.map(({ valuation }) => valuation.sampledAt);
  if (samples.some((at) => at === null || !Number.isFinite(at) || at <= 0))
    return null;
  return {
    value: totals.value,
    sampledAt: Math.min(...(samples as number[])),
    stale: totals.stale,
    // Source timestamps distinguish new real samples even when prices are flat.
    // Age alone does not manufacture a new point on each render/timer tick.
    signature: JSON.stringify(
      rows.map(({ holding, valuation }) => [
        holding.id,
        holding.quantity,
        holding.revision,
        valuation.value,
        valuation.sampledAt,
        valuation.source,
      ]),
    ),
  };
}

export function parseValueHistory(
  raw: string | null,
  now = Date.now(),
): PortfolioValueHistory {
  try {
    if (!raw || raw.length > 2_000_000) return emptyValueHistory();
    const data = JSON.parse(raw);
    if (
      data.version !== 1 ||
      typeof data.signature !== "string" ||
      data.signature.length > 100_000 ||
      !Array.isArray(data.points)
    )
      return emptyValueHistory();
    const points: PortfolioValuePoint[] = data.points
      .filter(
        (point: PortfolioValuePoint) =>
          point &&
          Number.isFinite(point.at) &&
          point.at > now - HISTORY_DAYS * DAY &&
          point.at <= now + 60_000 &&
          Number.isFinite(point.value) &&
          point.value >= 0 &&
          Number.isFinite(point.sampledAt) &&
          point.sampledAt > 0 &&
          point.sampledAt <= point.at + 60_000 &&
          typeof point.stale === "boolean",
      )
      .sort((a: PortfolioValuePoint, b: PortfolioValuePoint) => a.at - b.at)
      .filter(
        (
          point: PortfolioValuePoint,
          index: number,
          all: PortfolioValuePoint[],
        ) => !index || point.at !== all[index - 1].at,
      )
      .slice(-HISTORY_LIMIT);
    return {
      version: 1,
      signature: points.length ? data.signature : "",
      points,
    };
  } catch {
    return emptyValueHistory();
  }
}

export function appendValueSnapshot(
  history: PortfolioValueHistory,
  snapshot: PortfolioValueSnapshot,
  now = Date.now(),
): PortfolioValueHistory {
  const last = history.points.at(-1);
  if (history.signature === snapshot.signature || (last && now <= last.at))
    return history;
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(snapshot.value) ||
    snapshot.value < 0 ||
    !Number.isFinite(snapshot.sampledAt) ||
    snapshot.sampledAt <= 0 ||
    snapshot.sampledAt > now + 60_000
  )
    return history;
  return {
    version: 1,
    signature: snapshot.signature,
    points: [
      ...history.points.filter((point) => point.at > now - HISTORY_DAYS * DAY),
      {
        at: now,
        value: snapshot.value,
        sampledAt: snapshot.sampledAt,
        stale: snapshot.stale,
      },
    ].slice(-HISTORY_LIMIT),
  };
}

export function visibleValuePoints(
  points: PortfolioValuePoint[],
  duration: number | null,
  now = Date.now(),
) {
  return points.filter(
    (point) => point.at > now - (duration ?? HISTORY_DAYS * DAY),
  );
}
