import {
  grassMechanics,
  previewDay,
  releaseDay,
  type MarketEffect,
  type PriceComparison,
} from "../shared/flip-updates";
import { archiveLookback, quantile, type DailyQuote } from "../shared/flips";

type Observation = [number, number, number];
function observations(points: DailyQuote[], first: number, last: number) {
  return points.filter(
    (q): q is Observation =>
      q[0] >= first &&
      q[0] <= last &&
      q[2] !== null &&
      q[1] !== null &&
      q[2] > 0 &&
      q[1] >= q[2],
  );
}
function medianBid(points: Observation[]) {
  return quantile(
    points.map((q) => q[2]),
    0.5,
  );
}
function sustainedBreak(pre: Observation[], post: Observation[]) {
  if (pre.length < 5 || !post.length) return;
  const reference = medianBid(pre),
    offer = quantile(
      pre.map((q) => q[1]),
      0.5,
    );
  let run: Observation[] = [],
    last = -Infinity;
  for (const q of post) {
    if (q[0] - last > 10 || q[2] > 0.85 * reference || q[1] > 0.9 * offer)
      run = [];
    if (q[2] <= 0.85 * reference && q[1] <= 0.9 * offer) run.push(q);
    last = q[0];
  }
  if (
    run.length < 3 ||
    run[0][2] > reference * 0.8 ||
    run[2][0] - run[0][0] < 2
  )
    return;
  return {
    onset: run[0][0],
    confirmedOn: run[2][0],
    reference,
    recent: medianBid(run),
    observations: run.length,
    beforeCount: pre.length,
    lastBefore: pre.at(-1)![0],
  };
}

function compare(
  id: string,
  points: DailyQuote[],
  before: Set<number>,
  after: Set<number>,
): PriceComparison[] {
  const valid = observations(points, -Infinity, Infinity);
  const a = valid.filter((q) => before.has(q[0])),
    b = valid.filter((q) => after.has(q[0]));
  if (a.length < 3 || b.length < 2) return [];
  return [
    {
      id,
      before: a.length,
      after: b.length,
      pct: (medianBid(b) / medianBid(a) - 1) * 100,
    },
  ];
}
export function marketEffect(
  id: string,
  histories: Map<string, DailyQuote[]>,
  through: number,
  directDay?: number,
): MarketEffect | undefined {
  const history = histories.get(id) ?? [];
  if (
    id === grassMechanics.demand.item &&
    through >= previewDay &&
    through <= releaseDay + archiveLookback
  ) {
    const beforeRelease = observations(
      history,
      releaseDay - 14,
      Math.min(through, releaseDay - 1),
    );
    const afterRelease = observations(
      history,
      releaseDay + 1,
      Math.min(through, releaseDay + 14),
    );
    const releaseWindow =
      through >= releaseDay
        ? {
            before: beforeRelease.length,
            after: afterRelease.length,
            pct:
              beforeRelease.length >= 3 && afterRelease.length >= 3
                ? (medianBid(afterRelease) / medianBid(beforeRelease) - 1) * 100
                : null,
          }
        : undefined;
    const anchors =
      through >= releaseDay ? [previewDay, releaseDay] : [previewDay];
    for (const anchor of anchors) {
      const pre = observations(history, anchor - 14, anchor - 1),
        post = observations(history, anchor, through);
      const change = sustainedBreak(pre, post);
      if (!change || Math.abs(change.onset - anchor) > 4) continue;
      const before = new Set(pre.map((q) => q[0])),
        after = new Set(
          post.filter((q) => q[0] >= change.onset).map((q) => q[0]),
        );
      const comparisons = [
        ...grassMechanics.related,
        ...grassMechanics.controls,
      ].flatMap((peer) =>
        compare(peer, histories.get(peer) ?? [], before, after),
      );
      const controls = comparisons.filter((c) =>
        grassMechanics.controls.includes(c.id),
      );
      const pct = (change.recent / change.reference - 1) * 100;
      // The item must fall at least ten points further than the control median.
      const supported =
        controls.length > 0 &&
        pct + 10 <=
          quantile(
            controls.map((c) => c.pct),
            0.5,
          );
      return {
        kind: "demand",
        ...change,
        comparisons,
        cutoff: supported ? change.onset : undefined,
        releaseWindow,
      };
    }
    return {
      kind: "demand",
      releaseWindow,
      observations: observations(history, previewDay, through).length,
    };
  }
  const recent = observations(
    history,
    Math.max(through - archiveLookback + 1, (directDay ?? -Infinity) + 1),
    through,
  );
  // A known direct change already explains a break that straddles its date.
  for (let i = 5; i < recent.length - 2; i++) {
    const onset = recent[i][0];
    // A sequence of small declines can cross the same threshold as a one-day shock.
    const before = recent
      .slice(Math.max(0, i - 14), i)
      .filter((q) => q[0] >= onset - 14);
    if (before.length < 5 || recent[i][2] > medianBid(before) * 0.8) continue;
    const change = sustainedBreak(before, recent.slice(i));
    if (change?.onset === onset)
      return { kind: "unknown", ...change, cutoff: onset };
  }
}
export function fallingBids(
  points: DailyQuote[],
  through: number,
  cutoff = -Infinity,
) {
  const recent = observations(
    points,
    Math.max(cutoff + 1, through - 13),
    through,
  );
  if (recent.length < 5) return false;
  const last = recent.slice(-3),
    prior = recent.slice(-6, -3);
  return (
    medianBid(last) < medianBid(prior) * 0.9 && last.at(-1)![2] < last[0][2]
  );
}
