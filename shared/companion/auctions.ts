export function quantile(sorted: number[], p: number): number {
  const i = (sorted.length - 1) * p,
    lo = Math.floor(i),
    hi = Math.ceil(i);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (i - lo);
}
