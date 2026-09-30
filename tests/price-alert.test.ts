import { expect, it } from "vitest";
import { confirmation, newPriceAlert, validatePriceAlert } from "../shared/price-alert";
import { DEFAULT_SETTINGS, type PriceAlertInput } from "../shared/model";
import { trigger } from "../functions/src/engine";
import { due } from "../functions/src/delivery";
const input: PriceAlertInput = { requestId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", itemId: "SUMMONING_EYE", side: "buy", quantity: 2, target: 110, taxRate: 1.25 };
const book = { buy: [{amount: 1, pricePerUnit: 100, orders: 1}, {amount: 2, pricePerUnit: 120, orders: 2}], sell: [{amount: 10, pricePerUnit: 120, orders: 2}] };
it("finishes a single buy alert at the exact weighted threshold and does not trigger twice", () => {
  const now = Date.now(), w = newPriceAlert("a", "Summoning Eye", input, now);
  const result = trigger(w, book, now, DEFAULT_SETTINGS, "https://example.test", now)!;
  expect(result.workflow.stage).toBe("completed");
  expect(trigger(result.workflow, book, now, DEFAULT_SETTINGS, "", now)).toBeNull();
  expect(trigger({...w, quantity: 4}, book, now, DEFAULT_SETTINGS, "", now)).toBeNull();
  expect(trigger(w, book, now-180001, DEFAULT_SETTINGS, "", now)).toBeNull();
});
it("watches sell prices directly using the alert's own tax rate", () => {
  const now = Date.now(), w = newPriceAlert("a", "Eye", {...input, side:"sell", taxRate: 10, target:108}, now);
  expect(w.purchaseCost).toBeNull();
  expect(trigger(w, book, now, DEFAULT_SETTINGS, "", now)?.workflow.stage).toBe("completed");
  expect(trigger({...w, sellTarget:108.01}, book, now, DEFAULT_SETTINGS, "", now)).toBeNull();
});
it("builds a confirmation with a disable link and rejects unsafe alert values", () => {
  const event = confirmation(newPriceAlert("a", "Eye", input, 1), "https://example.test/#disable=token", 1);
  expect(event.message).toContain("at or below 110 coins");
  expect(event.message).toContain("https://example.test/#disable=token");
  expect(event.deliveries.email?.status).toBe("queued");
  for (const change of [{quantity:1.5}, {quantity:Infinity}, {taxRate:100}, {target:NaN}, {itemId:"../secret"}, {side:"other"}]) expect(() => validatePriceAlert({...input,...change} as PriceAlertInput)).toThrow();
  expect(due({status:"cancelled",attempts:0,nextAttempt:0,leaseUntil:0,error:null},1)).toBe(false);
});
