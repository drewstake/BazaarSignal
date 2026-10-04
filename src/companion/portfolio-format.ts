const summaryNumber = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 3,
});

export function portfolioCompact(value: number) {
  return Number.isFinite(value) ? summaryNumber.format(value) : "—";
}

// Keep small changes visible instead of presenting a nonzero loss as -0.0%.
export function portfolioPercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) return "—";
  if (value !== 0 && Math.abs(value) < 0.005)
    return `${value < 0 ? "−" : "+"}<0.01%`;
  return `${value > 0 ? "+" : ""}${value.toFixed(value !== 0 && Math.abs(value) < 0.1 ? 2 : 1)}%`;
}
