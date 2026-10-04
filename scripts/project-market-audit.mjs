// The old full-market projection included retired auction scans and must never
// be used for admission or pricing. Existing reports remain historical evidence.
throw new Error(
  "Full-market projection retired. Use collector/capacity-plan.ts with fresh, complete per-resource evidence. node scripts/run-market-audit.mjs measures the supported Bazaar path offline.",
);
