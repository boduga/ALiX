# GE-04 Q3.12 — Atomic worker claim and route consistency

Status: synthetic state-transition qualification only. GE-04 SECURITY HOLD remains active.

## Verified production boundary

`CoordinationStore.claimPendingWorker` uses a durable per-run lock and commits the worker's running status and incremented attempt in the run snapshot. The scheduler calls it after policy/ownership checks, then dispatches. The claim does **not** currently carry a trusted resolved route snapshot. A separate later route write would permit an observable claim-without-route gap.

## Synthetic contract

`simulateAtomicRouteClaim` validates pending status, expected attempt, expected plan revision, empty prior snapshot, owner, and route before returning a new paired claim+snapshot state. Failed qualification leaves the input unchanged. `assertSyntheticClaimReplay` rejects a missing snapshot, invalid worker status, stale owner/revision/attempt, changed route or revoked snapshot. Five tests cover these cases.

This is not an actual concurrent store, a transaction implementation, or a crash-injection test. The caller supplies the initial state and model, and can forge both. No production authorization is conferred.

## Required production design before integration

1. Resolve route in a trusted scheduler context, before claim; ensure provider fallback ordering is preserved and runtime adapter enforcement uses exactly that resolved route.
2. Extend the *same* per-run locked claim transition and ledger snapshot with a versioned, validated route authority record; no separate post-claim write. Include run ID, worker ID, new attempt, owner, plan revision, route revision, and immutable candidate list.
3. Define authoritative replay from ledger after process crash, including incomplete projection and ledger failure behavior. Reject running workers without valid route records; do not reconstruct authority from worker CLI flags.
4. Enforce claim CAS under contention and ensure rejected competing claims cannot publish a snapshot or issue a grant. Explicitly invalidate on replan, retry, owner handoff, revocation and terminal status.
5. Recheck route authority at final broker issuance and model dispatch; prove credential-store/config/process isolation, single-use grants and TOCTOU resistance.
6. Add real CoordinationStore concurrency, crash injection, replay, replan and revocation integration tests before any production credential delivery changes.

No store schema, ledger, CLI, FD-3, or credential delivery code was modified in Q3.12.
