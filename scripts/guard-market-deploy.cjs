// A source guard prevents accidental redeployment, not billing protection.
// There is deliberately no command-line override or billing-enable path.
console.error('Deployment remains blocked during local free-tier preparation. Collection, evaluation, email and scheduled work must stay paused. Complete scope-aware capacity evidence and separate activation authorization are required; see docs/FREE-TIER-PREPARATION.md.');
process.exitCode = 1;
