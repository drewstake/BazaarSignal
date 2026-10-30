# Retained CPU and contained rollback — October 26, 2026

> Historical record. Dates, deployment versions, service status, costs and approvals below apply only to the recorded work. They are not current setup instructions or authorization to operate services. See the [documentation index](../README.md).


The migration tools now distinguish a new rollout from a rollback using an allowance retained when that rollout was first reserved. This resolves the later-rollback CPU limitation identified in the [October 23 Cloud checks](LEDGER-V2-CLOUD-ROLLOUT-CHECKS-2026-10-23.md) **for holds created with the new reservation evidence**. No existing ledger was modified or retroactively credited.

## Behavior and safeguards

Previously, every migration operation compared the current cumulative retained CPU total against the 180,000-second gate. Normal paid runtime work could grow that total beyond the gate and block fallback, although the original release had already reserved its rollout work.

The original reservation CAS now also stores a small `recovery` record on the existing deployment hold:

- CPU retained before the reservation, the conservative CPU basis used for admission, and the original meter holds and limits.
- A digest binding both complete candidate and fallback artifact descriptions.
- A version identifying this evidence format. The existing release ID, timestamp, image digest and $0.50 hold remain.

The production adapter independently reconstructs this record from the current ledger and approved plan before accepting the reservation. A caller cannot supply a cheaper invented CPU basis. The normal runtime preserves this record while admitting and finishing v2 receipts.

A fresh plan with `operation: "rollback"` may use that original CPU allowance only when the retained record still matches. The allowance must have fitted within the original cap, which cannot exceed 180,000 seconds; the original CPU hold must be at least 10,000 seconds, and the cumulative ledger must still contain it. Current CPU usage remains visible in the fresh plan and is never lowered in storage.

| Control | Result |
| --- | --- |
| New rollout CPU gate | Unchanged: current retained usage plus any new hold must fit. Fresh reported spending of $0 does not bypass it. |
| Retained reservations | No subtraction, refund, reset, conversion to measured usage, or second rollback hold. |
| Paid budget | Existing $5 identity and $4.50 reported-cost stop remain enforced. Recorded stops, invalid billing and expired pilots remain blocked. |
| Billing freshness | A rollback-only plan requires a Google cost observation with no recorded feed error, within its reviewed age limit, at most 24 hours. This remains delayed billing evidence, not a spending guarantee. |
| Other meters | Memory, artifact storage and logs still use their existing current-usage gates. Their holds and limits must match the original reservation evidence. |
| Admission/document limits | Existing receipt consistency, remaining demand, 4,000 admissions and document-size checks remain. |
| Maintenance | Fresh owner evidence, authenticated-writer containment, completion/drain evidence, accounting continuity, conditional writes and bounded calls remain required. |
| Allowed operations | A rollback-only plan can contain writers and restore the exact retained v2 fallback. Both the coordinator and production adapter enforce this restriction. |
| Reopening | Candidate deployment, original-v1 rollback, new reservation, collection/daily resumption, API reopening and mail resumption are rejected under that plan, even if an approval lists broader capabilities. The operation ends contained. |

Sources: [coordinator and reservation validation](../../scripts/ledger-v2-migration.mjs), [production enforcement](../../scripts/ledger-v2-production.mjs), [draft preparation](../../scripts/prepare-ledger-v2-migration.mjs).

**Older holds without the recovery record fail closed.** The tools do not infer, backfill or forge reservation-time evidence from today's counters. This change does not make a new release eligible if its current retained CPU already exceeds the cap, and does not bypass a spending stop or expiry to perform a code rollback.

## Preparing a later rollback

For a separately authorized future maintenance window, obtain fresh read-only evidence and use the **same release ID and unchanged verified packet** that created the retained hold. The local preparation command accepts an optional final `--rollback` flag:

```powershell
node scripts/prepare-ledger-v2-migration.mjs <packet.json> <fresh-evidence.json> <original-release-id> .local/<new-rollback-draft> --rollback
```

This command prepares files locally; it does not authorize execution or contact production. It keeps current usage in the draft, restores the original reviewed holds/caps from the retained evidence, and refuses missing or mismatched proof. Remaining admission demand is still null for review, owner evidence is incomplete, and approval is false.

The new plan needs fresh, explicit approval bound to its hash and packet. Its plan and approval retain the existing 30-minute freshness windows. Review and resolve any outstanding operations in the prior journal before opening a new recovery window. Preserve that journal; a changed plan must not be inserted into it. Use a separate private journal for the newly approved rollback plan, with a fresh owner checkpoint. Within that plan, an interrupted action resumes through its own existing reconciliation path, without repeating verified substeps.

This task created no real execution approval or production rollback draft. It did not refresh live evidence; the October 23 observations remain historical. The existing application release packet and previously prepared plans were preserved unchanged.

## Isolated verification

**136 tests passed** across the rollback gate, migration coordinator, production adapter, management transport, packet integrity and existing paid-release guards. The new file adds 32 cases. All new tests prohibit global network access; management writes use the in-memory REST fixture with synthetic credentials, and runtime writes use the isolated cache-store fixture.

The main regression starts with **146,440 retained CPU seconds**, reserves 10,000 within the 180,000-second gate, then simulates three days of runtime growth to **277,960**. A fresh ordinary rollout is rejected. A fresh rollback-only plan succeeds, preserves the entire accounting hash and newer delivery-state hash, adds no hold, selects the verified fallback, and leaves the worker, schedules and API contained.

Negative cases cover absent/legacy proof, changed artifacts or allowance, an originally over-limit reservation, current counters below the retained hold, missing/stale/failed billing, an increased billing-age allowance, the $4.50 stop, explicit stops, expiry, stale plans, admission exhaustion, unknown/active writers, other meter limits, and writes during drainage. Integration cases independently reject forged reservation evidence and prohibited actions at the adapter boundary. A lost worker-source response is reconciled after a simulated restart without a duplicate write or reservation.

The existing six packet-bound rollout/rollback rehearsals passed, plus a seventh retained-CPU rehearsal using the actual prepared candidate/fallback artifact descriptions. No staged application was invoked against production. Root TypeScript checking also passed. One initial parallel test run hit the default five-second limit on the restart integration case; it passed in isolation, then the complete suite passed with one worker and a 15-second limit for that case.

Local evidence:

- Test results (local evidence: `.local/ledger-v2-rollback-gate-oct26/tests.json`)
- Six existing release rehearsals (local evidence: `.local/ledger-v2-rollback-gate-oct26/rehearsal/summary.json`)
- Retained-CPU rehearsal and journal (local evidence: `.local/ledger-v2-rollback-gate-oct26/retained-cpu-rehearsal.json`)
- Preservation and validation receipt (local evidence: `.local/ledger-v2-rollback-gate-oct26/validation.json`)

Only three pre-existing tooling files were edited: the coordinator, production adapter and local draft preparer. The new regression test and this document were added. All other pre-existing workspace files, application fixes, release artifacts and existing plans were preserved. No deployment, production change, collection trigger or email occurred.
