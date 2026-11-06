# GE-04 Q3.13 — Actual CoordinationStore claim qualification

Status: real store tests, **not** route-authorization integration. GE-04 SECURITY HOLD remains active.

## Tested

`tests/kernel/ge04-q313-coordination-claim-ledger.test.ts` exercises the real ledger-backed `CoordinationStore` with a temporary workspace:

- Eight concurrent `claimPendingWorker` calls on the same pending worker yield exactly one successful claim and one ledger version increment.
- Replacing the JSON projection file with a directory forces projection rename failure. The ledger commit succeeds, projection failure is reported, and a fresh store reads the claimed worker from ledger authority.
- A revision-guarded update cancels a worker before a stale claim. The claim is rejected with no new ledger fact.

These tests run against real store persistence, but do not inject a crash inside ledger append, simulate OS power loss, or establish durable route authorization. Existing cross-process claim tests live in `tests/kernel/coordination-scheduler-concurrent-ticks.test.ts` and are not replaced by these tests.

## Integration finding

The production `claimPendingWorker` currently commits status, attempt and scheduler patch, but does not include a scheduler-owned resolved route snapshot. A ledger-backed worker claim is therefore **not** a credential-grant authority. The Q3.11/Q3.12 snapshot and claim simulations are separate from the actual store.

## Next required implementation

Introduce an explicitly typed route snapshot into the worker record and validate it inside the same locked claim transition before the ledger commit. The scheduler must resolve the canonical route before claim; replan, retries, owner handoff and revocation must invalidate authority. Test real replay, concurrency, rejection on invalid route, and fail-closed broker/runtime use. No credential delivery changes until isolation and authenticated authority are proven.
