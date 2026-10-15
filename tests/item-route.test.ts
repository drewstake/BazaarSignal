import { expect, it } from "vitest";
import { itemPageHash, itemPageUrl } from "../src/companion/item-route";

it("creates a stable static-host item link without private state or preview parameters", () => {
  expect(itemPageHash("BOOSTER_COOKIE")).toBe("#view=item&item=BOOSTER_COOKIE");
  expect(itemPageUrl("BOOSTER_COOKIE", "https://bazaarsignal.web.app/?fixtures=1&token=private#view=settings&portfolio=private"))
    .toBe("https://bazaarsignal.web.app/#view=item&item=BOOSTER_COOKIE");
});

it("encodes item IDs and preserves the host's base path", () => {
  const url = new URL(itemPageUrl("X&view=admin", "http://127.0.0.1:5173/app/?preview=1"));
  expect(url.pathname).toBe("/app/");
  const parameters = new URLSearchParams(url.hash.slice(1));
  expect(parameters.get("item")).toBe("X&view=admin");
  expect(parameters.getAll("view")).toEqual(["item"]);
});
