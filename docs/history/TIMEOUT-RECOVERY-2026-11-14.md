# Timeout recovery repair — November 14, 2026

One browser timeout on November 12 entered the market runtime's terminal failure
path. It persisted a stop in `marketCache/market-operations`, paused both collection
jobs, and removed the public API invoker. Restoring IAM alone returned a 503 and
repeated shutdown because the stop was still present. Initial recovery preserved
all accounting, cleared only that timeout stop with a Firestore version
precondition, resumed the existing jobs, collected fresh prices, and restored the
API. The signed-in portfolio then displayed current Summoning Eye prices.

## Permanent behavior

Structured transport timeouts now use the existing transient-failure path. An
incomplete response returns HTTP 503 with `Retry-After: 60` and a nonterminal
polling directive; a price response already prepared before accounting times out
can still be delivered. The collector fails that invocation and remains scheduled.
Neither path stops the ledger, pauses jobs, or removes API access. Uncertain writes
are not replayed and their full reservations and deduplication receipts remain.

Per-invocation deadlines are distinct from an actual operating-period expiry.
Timeout identity also survives a failed additional reservation. History-request
timeouts include the retry directive so the frontend does not interpret a missing
directive as a terminal market pause. Real operator stops, expired pilots, invalid
configuration, quota/authentication failures, and exhausted reservation bounds
retain their existing terminal handling. A transient outage can still delay a
price; this change prevents that outage from permanently disabling the service.

## Source and verification

The owner pushed MacBook commit `4334818` on
`feature/continuous-market-service`. It was merged with the November 10 reporting
repair on `feature/market-timeout-recovery`. This reconciles the source mismatch
recorded in the earlier reporting repair; SSH access was not needed to retrieve it.

Regression tests cover read, admission, finish, already-committed write, streamed
body, additional-reservation, history, and per-invocation deadline failures in
both pilot and continuous modes. They assert no shutdown, no repeated uncertain
writes, preserved accounting, and successful subsequent reads. A frontend test
verifies saved prices keep their timestamps, requests wait for the recovery
deadline, and fresh prices replace them without a reload. The full suite passed
968 tests initially with one Admin merge-import failure; that import was repaired
and all 15 focused Admin/resource tests passed (969 passing tests across the final
results, one optional test skipped). Frontend, collector, market backend, and Apps
Script typechecks passed.

The locally built image boots both handlers in all four supported modes with
outbound networking blocked. Its immutable digest is
`sha256:9f27922b4ec1a662559c56e93cb57390e725cc394da8c521368d3497f4cddfa4`.
The image-only release tool is `scripts/deploy-continuous-market-update.mjs`;
inspection is its default, and deployment requires `--apply`. It preserves
environment, resource limits, traffic policy, IAM, schedules, all ledgers, Hosting,
and Apps Script. It saves the original service configuration and operation IDs
under `.local/continuous-timeout-release-*/` and retains a named registry tag.
Initial incident recovery receipts are in `.local/price-access-repair/`.

The release completed with API revision `marketapi-00034-qgd` and collector
revision `refreshmarket-00031-vhf`, each serving 100% of its traffic. Verification
at 18:40 UTC returned HTTP 200 for portfolio prices and 195 Summoning Eye history
points. The API retained its public invoker, the collector remained private,
both existing schedules were enabled, the operational ledger had no stop flag,
and the historical ledger hashes were unchanged. Hosting and Apps Script were not
deployed. The snapshot at this check came from before the code rollout; this is
API/read-path verification, not evidence of a new natural collection on the new
collector revision.

Rollback can route traffic back to the saved prior ready revisions without
resetting ledgers or redeploying obsolete source. The old runtime still contains
the shutdown-on-timeout bug, so rollback is not a repair for this incident.
