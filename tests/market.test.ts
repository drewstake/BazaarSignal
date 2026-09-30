import { describe, expect, it } from "vitest";
import { estimate, evaluate, isFresh, parseBook } from "../shared/market";
import { DEFAULT_SETTINGS, type Workflow } from "../shared/model";
import {
  updateWorkflow,
  validateSettings,
  validateTargets,
} from "../shared/workflow";
import { trigger } from "../functions/src/engine";
import { due, failedAttempt, pending } from "../functions/src/delivery";
import { isOwner } from "../functions/src/security";
const now = 1_800_000_000_000;
const book = parseBook({
  buy_summary: [
    { amount: 2, pricePerUnit: 1100000, orders: 1 },
    { amount: 3, pricePerUnit: 1200000, orders: 2 },
  ],
  sell_summary: [
    { amount: 2, pricePerUnit: 1250000, orders: 1 },
    { amount: 3, pricePerUnit: 1200000, orders: 1 },
  ],
});
const workflow: Workflow = {
  id: "w1",
  itemId: "SUMMONING_EYE",
  itemName: "Summoning Eye",
  quantity: 2,
  buyTarget: 1100000,
  sellTarget: 1200000,
  stage: "watching_buy",
  paused: false,
  channels: ["email", "discord"],
  generation: 0,
  revision: 0,
  purchaseCost: null,
  createdAt: now,
  updatedAt: now,
};
describe("quantity-aware pricing", () => {
  it("maps API books to instant buy and instant sell, sorting correctly", () => {
    expect(book.buy[0].pricePerUnit).toBe(1100000);
    expect(book.sell[0].pricePerUnit).toBe(1250000);
    expect(estimate(book, 2, "buy")?.total).toBe(2200000);
    expect(estimate(book, 2, "sell")?.total).toBe(2468750);
  });
  it("walks multiple price levels and uses an average", () => {
    expect(estimate(book, 4, "buy")).toEqual({
      gross: 4600000,
      total: 4600000,
      unit: 1150000,
    });
  });
  it("refuses insufficient liquidity and invalid quantities", () => {
    for (const quantity of [6, 0, -1, 1.5, NaN])
      expect(estimate(book, quantity, "buy")).toBeNull();
  });
  it("rejects missing and malformed prices without coercing strings", () => {
    for (const p of [
      null,
      {},
      {
        buy_summary: [{ amount: 1, pricePerUnit: "100", orders: 1 }],
        sell_summary: [],
      },
    ])
      expect(() => parseBook(p)).toThrow();
  });
  it("triggers at exact thresholds", () => {
    expect(evaluate(workflow, book, now, 1.25, now)?.side).toBe("buy");
    expect(
      evaluate({ ...workflow, quantity: 4 }, book, now, 1.25, now),
    ).toBeNull();
  });
  it("suppresses stale, missing, future, and paused snapshots", () => {
    expect(isFresh(now - 180001, now)).toBe(false);
    expect(isFresh(now + 31000, now)).toBe(false);
    expect(evaluate(workflow, book, now - 180001, 1.25, now)).toBeNull();
    expect(
      evaluate({ ...workflow, paused: true }, book, now, 1.25, now),
    ).toBeNull();
    expect(evaluate(workflow, undefined, now, 1.25, now)).toBeNull();
  });
});
describe("one-shot workflow", () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    discordTested: true,
    discordEnabled: true,
  };
  it("requires manual purchase confirmation before selling and explicit rearm after firing", () => {
    const buy = trigger(
      workflow,
      book,
      now,
      settings,
      "https://example.test",
      now,
    )!;
    expect(buy.workflow.stage).toBe("awaiting_purchase");
    expect(
      trigger(buy.workflow, book, now, settings, "https://example.test", now),
    ).toBeNull();
    const purchased = updateWorkflow(
      buy.workflow,
      { type: "confirmPurchase", id: "w1", quantity: 2, purchaseCost: 2200000 },
      now,
    );
    expect(purchased.stage).toBe("watching_sell");
    const sell = trigger(
      purchased,
      book,
      now,
      settings,
      "https://example.test",
      now,
    )!;
    expect(sell.workflow.stage).toBe("completed");
    expect(sell.event.message).toContain("268,750");
    expect(
      trigger(sell.workflow, book, now, settings, "https://example.test", now),
    ).toBeNull();
    const rearmed = updateWorkflow(
      sell.workflow,
      { type: "rearm", id: "w1" },
      now,
    );
    expect(
      trigger(rearmed, book, now, settings, "https://example.test", now)!.event
        .id,
    ).not.toBe(sell.event.id);
  });
  it("does not fire a sell alert before a purchase", () =>
    expect(
      evaluate(
        { ...workflow, stage: "awaiting_purchase" },
        book,
        now,
        1.25,
        now,
      ),
    ).toBeNull());
  it("does not consume a target while all delivery channels or monitoring are disabled", () => {
    expect(
      trigger(
        workflow,
        book,
        now,
        { ...settings, monitoringPaused: true },
        "",
        now,
      ),
    ).toBeNull();
    expect(
      trigger(
        workflow,
        book,
        now,
        { ...settings, emailEnabled: false, discordEnabled: false },
        "",
        now,
      ),
    ).toBeNull();
  });
  it("rejects repeated confirmation and changing owned quantity through edit", () => {
    const w = {
      ...workflow,
      stage: "watching_sell" as const,
      purchaseCost: 200,
    };
    expect(() =>
      updateWorkflow(
        w,
        { type: "confirmPurchase", id: "w1", quantity: 2, purchaseCost: 1 },
        now,
      ),
    ).toThrow();
    expect(() =>
      updateWorkflow(
        w,
        {
          type: "edit",
          id: "w1",
          quantity: 3,
          buyTarget: 1,
          sellTarget: 2,
          channels: ["email"],
        },
        now,
      ),
    ).toThrow();
  });
  it("validates targets and requires a Discord test before activation", () => {
    expect(() =>
      validateSettings(
        { type: "settings", ...DEFAULT_SETTINGS, discordEnabled: true },
        DEFAULT_SETTINGS,
      ),
    ).toThrow();
    expect(() =>
      validateTargets({
        type: "create",
        itemId: "X",
        quantity: 1,
        buyTarget: NaN,
        sellTarget: 1,
        channels: ["email"],
      }),
    ).toThrow();
  });
});
describe("delivery and security", () => {
  const delivery = {
    status: "queued" as const,
    attempts: 1,
    nextAttempt: now,
    leaseUntil: 0,
    error: null,
  };
  it("never retries a sent channel and retries a failed channel with backoff", () => {
    expect(due({ ...delivery, status: "sent" }, now)).toBe(false);
    const retry = failedAttempt(delivery, "temporary error", now);
    expect(due(retry, now)).toBe(false);
    expect(due(retry, now + 60000)).toBe(true);
    expect(
      pending({ email: { ...delivery, status: "sent" }, discord: retry }),
    ).toBe(true);
  });
  it("honors leases and stops after five attempts", () => {
    expect(due({ ...delivery, leaseUntil: now + 1 }, now)).toBe(false);
    const terminal = failedAttempt(
      { ...delivery, attempts: 5 },
      "blocked",
      now,
    );
    expect(terminal.status).toBe("failed");
    expect(due(terminal, now + 1e9)).toBe(false);
    expect(
      pending({ email: { ...delivery, status: "sent" }, discord: terminal }),
    ).toBe(false);
  });
  it("denies anonymous, unverified, and other users", () => {
    expect(isOwner(undefined, "owner")).toBe(false);
    expect(
      isOwner({ uid: "other", token: { email_verified: true } }, "owner"),
    ).toBe(false);
    expect(
      isOwner({ uid: "owner", token: { email_verified: false } }, "owner"),
    ).toBe(false);
    expect(
      isOwner({ uid: "owner", token: { email_verified: true } }, "owner"),
    ).toBe(true);
  });
});
