# Initial ledger v2 paid CPU admission — October 26, 2026

The initial CPU blocker is resolved in the migration tooling through an **explicit, narrowly scoped paid admission policy**. An isolated replay of the October 26 snapshot now reserves the release at **181,100 → 191,100 retained CPU seconds**, preserves every historical hold and counter, and supports a later contained fallback at 277,960 seconds. Production was not contacted or changed during this task.

The default migration path still rejects that initial state against its 180,000-second cumulative CPU gate. The new path must be explicitly selected and included in the reviewed plan; existing plans and approvals do not acquire it automatically. This updates the tooling limitation in the [rollout refresh](LEDGER-V2-ROLLOUT-REFRESH-2026-10-26.md), not its historical observations or authorization status.

## Why this is a paid admission check

The ledger's CPU total accumulates conservative request and deployment reservations that are never refunded. It is not measured CPU consumption or a provider bill. The existing paid release implementation already checks bounded rollout work against a $0.50 gross-cost allowance rather than using the free-tier consumption test for paid admission. The migration coordinator had applied a cumulative CPU allowance test to these retained paid reservations.

The new plan field is `cpuAdmission: "initial-paid-ledger-v2"`. It uses the existing paid-work pricing policy for this one transition. It does **not** claim that 191,100 is below 180,000, change the CPU counter, substitute Monitoring measurements, raise a numeric limit, or remove the ordinary rollout gate. The prepared packet's work estimate is approximately **$0.280594** under the existing reservation rates; the full **$0.50** remains reserved and required as spending headroom.

## Conditions and retained evidence

| Control | Required behavior |
| --- | --- |
| Scope | An unreserved v1 ledger, with no previous migration recovery record. A second release cannot reuse the exception before or after activation. An old same-ID hold cannot be adopted or backfilled. |
| Explicit selection | The new policy is part of the plan hash. The existing approval cannot authorize a plan with the field added. Draft approval remains false and owner evidence incomplete. |
| Billing | Valid Google billing identity, no feed error, and a report within the reviewed age limit, at most 24 hours. The same requirement applies to continued rollout and rollback. |
| Spending margin | `max(0, reported cost) + $0.50 < $4.50`, including fallback work. Credits cannot enlarge the margin. Missing billing, $4.00 or more reported cost, a recorded stop or expiry blocks this path. The $5 budget and $4.50 application stop are unchanged. |
| Work allowance | The complete CPU, memory, artifact and log estimate must fit the existing $0.50 hold. CPU and memory holds remain at least 10,000 each; logs at least 16 MiB; verified image storage must be covered. The adapter and admission checker share the same cost calculation. |
| Other meters | Existing cumulative memory, artifact and log gates still apply. The new mode also rejects raised numeric meter limits and unknown/unpriced meters. |
| Accounting | One conditional reservation write adds exactly $0.50 and every prepared meter hold. No subtraction, refund, reset or measured-usage replacement. All prior deployments, admissions, observed counters, legacy data, billing identity and delivery state remain. |
| Concurrency and maintenance | Existing CAS, accounting continuity, owner checkpoint, authenticated-writer containment, completion/drain evidence, call limits and durable reconciliation remain required. |
| Runtime and expiry | Existing 4,000-admission bound, demand review, document limits, fixed November 1, 07:00 UTC expiry, service configuration and runtime budget controls remain. No application runtime code was changed. |

The reservation records recovery-proof **version 2**. It binds the candidate/fallback descriptions and original holds/limits, preserves the full retained CPU basis, and adds the admission-time billing evidence, gross work estimate, billing-age limit, and pre-hold dollar/meter amounts. The production adapter independently reconstructs this record from its current read before accepting the exact reservation write. A caller-supplied cheaper billing value or refunded counter is rejected.

After reservation, every use verifies that the whole hold remains retained, the proof still matches, billing identity has not changed, reports have not moved backwards and fresh spending headroom remains. The original billing snapshot must itself have supported admission at the reservation time. This is evidence attached to the original write, not a later reconstruction from smaller counters.

## Preparing a future rollout or fallback

Only local draft preparation is shown here. It does not contact production or authorize execution:

```powershell
node scripts/prepare-ledger-v2-migration.mjs <verified-packet.json> <fresh-read-only-evidence.json> <new-release-id> .local/<new-draft-directory> --paid-cpu
```

Without `--paid-cpu`, the preparer retains its original policy. The option checks the new paid eligibility conditions but still leaves remaining demand for review, owner evidence unverified and approval false. It does not waive the other cumulative meter gates, which full coordinator validation must pass. A stale snapshot is rejected; the historical draft generated for this task is explicitly rehearsal-only.

A later recovery uses the same reserved release ID and unchanged packet:

```powershell
node scripts/prepare-ledger-v2-migration.mjs <verified-packet.json> <fresh-read-only-evidence.json> <original-release-id> .local/<new-rollback-directory> --rollback
```

The preparer restores the matching policy from the retained version-2 proof and verifies it. Version-1 proofs from the [previous rollback fix](LEDGER-V2-ROLLBACK-CPU-GATE-2026-10-26.md) retain their original behavior. Old holds without proof still fail closed. Rollback adds no new hold and ends contained; candidate deployment, original-v1 rollback, API reopening and collection/daily/mail resumption remain forbidden in a rollback-only plan. Original-v1 rollback is also rejected under the new initial paid policy.

Before a future production window, refresh the live evidence, recalculate demand, complete the owner/writer review and obtain new approval tied to the finalized plan and packet. Preserve and reconcile the original execution journal before opening a new recovery window. Transition both API and collector while contained, then require natural scheduled-run acceptance before any separately authorized reopening. The existing packet is unchanged; its candidate and fallback still share the cloud ledger implementation, so a defect common to that image needs a contained forward fix.

## Isolated verification

**194 targeted tests passed**, including **58 new cases**, covering the initial paid gate, prior rollback gate, coordinator, production adapter, management transport, packet integrity and existing paid release guards. Root TypeScript checking and syntax checks passed. The new tests prohibit global network access; production-adapter writes use synthetic in-memory management responses and synthetic credentials. The real paid runtime proof-preservation test uses the isolated cache-store fixture.

The new cases include full margin boundaries, absent/stale/failed/wrong-scope billing, stops and expiry, malformed policy, raised limits, under-reserved or over-priced work, second-migration attempts, old same-ID holds, demand exhaustion, unknown writers, late accounting writes, forged proof, refunds of CPU/memory/dollars, changed artifacts, rollback spending headroom, a lost successful CAS response and a process crash immediately after CAS. Tests verify that old approval does not transfer and that recovery neither repeats the reservation nor restores stale delivery state.

The six existing packet-bound rehearsal scenarios passed. Two additional packet-bound rehearsals copied the October 26 saved ledger into an isolated fixture:

- Initial paid admission, simulated natural acceptance, then three days of synthetic runtime growth and a contained fallback. All 1,163 original admissions and ten historical deployment holds survive; a single synthetic new admission creates the expected v2 receipt.
- API deployment failure after the collector transition, followed by the exact v2-compatible fallback while contained, with only one added release hold.

The copied snapshot, simulated future billing and simulated scheduled evidence are test inputs, **not fresh production observations or a live eligibility claim**. No real collection or script function was invoked, and no email was sent.

Evidence: [test results](../.local/ledger-v2-initial-cpu-oct26/verified-tests.json), [existing rehearsals](../.local/ledger-v2-initial-cpu-oct26/existing-rehearsals/summary.json), [new packet rehearsals](../.local/ledger-v2-initial-cpu-oct26/packet-rehearsal-final/summary.json), [preservation receipt](../.local/ledger-v2-initial-cpu-oct26/validation.json).

Only three pre-existing tooling files changed: [coordinator](../scripts/ledger-v2-migration.mjs), [production adapter](../scripts/ledger-v2-production.mjs), and [draft preparer](../scripts/prepare-ledger-v2-migration.mjs). The [new tests](../tests/ledger-v2-initial-cpu.test.ts) and this report were added. All other pre-existing workspace files, the release packet, earlier drafts, and previous validation receipts were preserved.

Production readiness still requires fresh state, writer containment/drain evidence and explicit authorization. The earlier v1 reader-size risk remains unresolved in production until an authorized migration or other reviewed action occurs. Delayed billing remains delayed billing; this change does not promise a hard invoice cap.
