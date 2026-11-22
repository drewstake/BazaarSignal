import { isFresh } from "../market";
import { positive } from "../workflow";
import {
  validPortfolioHolding,
  type Holding,
  type HoldingValue,
} from "./portfolio";

export interface NotificationInput {
  // Fixed targets use coins per item. Acquisition and sample targets use percentages.
  baseline: "fixed" | "acquisition" | "sample";
  up: number | null;
  down: number | null;
}
export interface HoldingNotification extends NotificationInput {
  id: string;
  portfolioId: string;
  holdingId: string;
  holdingName: string;
  revision: number;
  enabled: boolean;
  deleted: boolean;
  capturedPrice: number | null;
  capturedAt: number | null;
  source: string;
  createdAt: number;
  updatedAt: number;
}
export interface CrossingState {
  configRevision: number;
  holdingRevision: number;
  source: string;
  lastSample: number;
  upArmed: boolean;
  downArmed: boolean;
  prime: boolean;
  sequence: number;
}
export type CrossingQuote = {
  direction: "up" | "down";
  price: number;
  sampledAt: number;
  source: string;
} & (
  | { targetPrice: number; baseline?: never; percent?: never }
  | { targetPrice?: never; baseline: number; percent: number }
);
export type Crossing = CrossingQuote & { id: string };
export function validateNotification(input: NotificationInput) {
  if (input?.baseline === "fixed") {
    if (input.up === null && input.down === null) throw new Error("Enter at least one target price in coins.");
    if (input.up !== null) positive(input.up, "Upper target price");
    if (input.down !== null) positive(input.down, "Lower target price");
    return;
  }
  const threshold = (v: unknown, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0.01 && v <= max;
  if (
    !input ||
    !["acquisition", "sample"].includes(input.baseline) ||
    (input.up === null && input.down === null) ||
    (input.up !== null && !threshold(input.up, 1e6)) ||
    (input.down !== null && !threshold(input.down, 99.99))
  )
    throw new Error(
      "Use an upward percentage of at least 0.01% or a downward percentage from 0.01% to 99.99%.",
    );
}
export const blankCrossing = (): CrossingState => ({
  configRevision: 0,
  holdingRevision: 0,
  source: "",
  lastSample: 0,
  upArmed: false,
  downArmed: false,
  prime: true,
  sequence: 0,
});
export function eligibleSample(
  value: HoldingValue,
  now: number,
  fixture = false,
) {
  return (
    !fixture &&
    value.freshness === "fresh" &&
    typeof value.referencePrice === "number" &&
    Number.isFinite(value.referencePrice) &&
    value.referencePrice > 0 &&
    value.sampledAt !== null &&
    isFresh(value.sampledAt, now)
  );
}
export function notificationBaseline(
  notification: HoldingNotification,
  holding: Holding,
) {
  if (notification.baseline === "fixed") return null;
  return notification.baseline === "acquisition"
    ? holding.costBasis / holding.quantity
    : notification.capturedPrice;
}
/** Pure transition. The caller atomically persists state and outbox before delivery. */
export function evaluateNotification(
  notification: HoldingNotification,
  holding: Holding,
  value: HoldingValue,
  previous: CrossingState,
  now: number,
  options: {
    fixture?: boolean;
    portfolioDeleted?: boolean;
    emailEnabled?: boolean;
  } = {},
) {
  let state = { ...previous };
  const events: Crossing[] = [];
  if (
    notification.deleted ||
    !notification.enabled ||
    holding.deleted ||
    options.portfolioDeleted ||
    options.emailEnabled === false ||
    !validPortfolioHolding(holding)
  )
    return { state: { ...state, prime: true }, events, reason: "paused" };
  if (!eligibleSample(value, now, options.fixture))
    return {
      state: { ...state, prime: true },
      events,
      reason: "waiting for fresh evidence",
    };
  if (notification.source !== value.source)
    return {
      state: { ...state, prime: true },
      events,
      reason: "valuation source changed; edit and enable again",
    };
  const baseline = notificationBaseline(notification, holding);
  if (notification.baseline !== "fixed" && (baseline === null || !Number.isFinite(baseline) || baseline <= 0))
    return {
      state: { ...state, prime: true },
      events,
      reason: "baseline unavailable",
    };
  const changed =
    state.configRevision !== notification.revision ||
    state.source !== value.source ||
    (notification.baseline === "acquisition" &&
      state.holdingRevision !== holding.revision);
  if (!changed && value.sampledAt! <= state.lastSample)
    return { state, events, reason: "sample already evaluated" };
  const price = value.referencePrice!;
  const relative = baseline === null ? null : { baseline, percent: ((price - baseline) / baseline) * 100 };
  const above = notification.up !== null && (relative ? relative.percent >= notification.up : price >= notification.up),
    below = notification.down !== null && (relative ? relative.percent <= -notification.down : price <= notification.down);
  const prime = state.prime || changed;
  if (!prime)
    for (const direction of ["up", "down"] as const) {
      if (
        direction === "up" ? above && state.upArmed : below && state.downArmed
      ) {
        state.sequence++;
        events.push({
          id: `${notification.id}:${notification.revision}:${state.sequence}`,
          direction,
          ...(relative ?? { targetPrice: notification[direction]! }),
          price,
          sampledAt: value.sampledAt!,
          source: value.source,
        });
      }
    }
  state = {
    ...state,
    configRevision: notification.revision,
    holdingRevision: holding.revision,
    source: value.source,
    lastSample: value.sampledAt!,
    upArmed: notification.up !== null && !above,
    downArmed: notification.down !== null && !below,
    prime: false,
  };
  return {
    state,
    events,
    reason: prime
      ? "baseline primed; waiting for a new crossing"
      : events.length
        ? "threshold crossed"
        : "watching",
  };
}
