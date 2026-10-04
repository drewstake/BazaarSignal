import { describe, expect, it } from "vitest";
import {
  portfolioCompact,
  portfolioPercent,
} from "../src/companion/portfolio-format";

describe("portfolio summary display", () => {
  it("keeps enough precision to distinguish billion-coin positions", () => {
    expect(portfolioCompact(3487668984.8)).toBe("3.488B");
    expect(portfolioCompact(3489200000)).toBe("3.489B");
    expect(portfolioCompact(-1531015.2)).toBe("-1.531M");
  });
  it("distinguishes small returns from zero and unavailable prices", () => {
    expect(portfolioPercent((-1531015.2 / 3489200000) * 100)).toBe("-0.04%");
    expect(portfolioPercent(6.557)).toBe("+6.6%");
    expect(portfolioPercent(0)).toBe("0.0%");
    expect(portfolioPercent(-0.001)).toBe("−<0.01%");
    expect(portfolioPercent(0.001)).toBe("+<0.01%");
    expect(portfolioPercent(null)).toBe("—");
    expect(portfolioPercent(NaN)).toBe("—");
  });
});
