// A source guard prevents accidental redeployment, not billing protection.
// There is deliberately no command-line override or billing-enable path.
console.error('Generic Firebase Functions deployment is blocked. The user authorized a conservative live free-tier profile; deploy its reviewed image and allowance ledger through private-trial-release.mjs and activate-live-market.ts. This guard prevents accidentally replacing the live budget controls with an unreviewed release.');
process.exitCode = 1;
