import { expect, it } from "vitest";
import { validPortfolio } from "../shared/companion/portfolio";
import { parseCoinAmount } from "../shared/companion/positions";

it("accepts available coins including zero without permitting zero purchase costs", () => {
  for (const [input, expected] of [
    ["0", 0],
    ["0.00M", 0],
    ["250m", 250e6],
    ["1.5B", 1.5e9],
    ["12,500", 12500],
  ] as const)
    expect(parseCoinAmount(input, true)).toBe(expected);
  for (const input of ["", "-1", "NaN", "Infinity", "1,25", "1000000000000001"])
    expect(parseCoinAmount(input, true)).toBeNull();
  expect(parseCoinAmount("0")).toBeNull();
});

it("keeps legacy portfolios readable and validates optional buying power", () => {
  const portfolio = {
    id: "default",
    name: "Test",
    createdAt: 1,
    updatedAt: 1,
    revision: 1,
    deleted: false,
  };
  expect(validPortfolio(portfolio)).toBe(true);
  for (const buyingPower of [0, 0.5, 250e6, 1e15])
    expect(validPortfolio({ ...portfolio, buyingPower })).toBe(true);
  for (const buyingPower of [
    -1,
    NaN,
    Infinity,
    1e15 + 1,
    "250m",
    null,
    undefined,
  ])
    expect(validPortfolio({ ...portfolio, buyingPower })).toBe(false);
  expect(validPortfolio({ ...portfolio, buyingPower: 10, extra: true })).toBe(
    false,
  );
});
