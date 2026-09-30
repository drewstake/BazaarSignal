import type { FeeContext } from "../shared/companion/types";
export function feeContextFromElection(raw: any, now = Date.now()): FeeContext {
  const mayor = raw?.mayor;
  if (!mayor?.name || !Array.isArray(mayor.perks))
    return {
      mayor: "Unknown",
      multiplier: null,
      checkedAt: now,
      explanation: "Current election data is unavailable.",
    };
  const perks = [
    ...mayor.perks,
    ...(mayor.minister?.perk ? [mayor.minister.perk] : []),
  ];
  const relevant = perks.filter((p: any) =>
    /tax|auction.*fee|bazaar.*fee|perkpocalypse/i.test(
      `${p.name} ${p.description}`,
    ),
  );
  // Fail closed for unmodeled account-specific/progressive or rotating tax perks.
  if (relevant.length)
    return {
      mayor: mayor.name,
      multiplier: null,
      checkedAt: now,
      explanation: `Tax-affecting perk requires a verified fee profile: ${relevant.map((p: any) => p.name).join(", ")}. Profit recommendations withheld.`,
    };
  return {
    mayor: mayor.name,
    multiplier: 1,
    checkedAt: now,
    explanation: `Current mayor ${mayor.name}: no tax-affecting active perk reported by the election API. Standard fees with your selected account tier.`,
  };
}
