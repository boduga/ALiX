# GE-04 Q3.11 — Scheduler-owned route snapshot lifecycle

Status: synthetic contract and integration design only. GE-04 SECURITY HOLD remains active.

## Verified store boundary

`CoordinationStore.claimPendingWorker` serializes the run mutation, acquires `CoordinationRunLock`, checks pending status, block reason and expected attempt, then writes a running worker with incremented attempt through ledger and JSON projection. `updateRunWithRevisionCheck` separately guards run-level replanning with `planRevision` CAS. Neither path currently stores a trusted resolved model/fallback route bound to the claim. A later independent snapshot write would introduce a crash/TOCTOU gap.

## Q3.11 synthetic contract

`src/agents/worker-route-snapshot.ts` captures schema version 1, a positive route revision, Q3.9 evidence, and revoked state. Verification rejects stale route revisions, changed attempts, owners, plan revisions, model/fallback candidates, and revoked snapshots. Tests use caller-provided fixtures and do not prove storage provenance, revocation persistence, atomic CAS, or isolation.

## Production integration prerequisites

1. Scheduler selects and concretely resolves the entire authorized route before dispatch. Do not trust child CLI flags, child config or worker-proposed route.
2. Extend the *same* durable claim mutation to persist an immutable versioned route snapshot with worker attempt, execution owner, plan revision and route revision, or prove equivalent transactional semantics. Reject claim if route qualification cannot be completed.
3. Make restart/replay reconstruct the authoritative route from the ledger. Define explicit invalidation on retry, owner handoff, replan, policy revocation and run termination; avoid orphaned grants.
4. Final credential issuance and actual model adapter dispatch must recheck the current trusted snapshot under an appropriate consistency boundary. Prevent races between verification and issuance, including concurrent consumers.
5. Enforce isolation from workspace config, credential store and process environment. A fingerprint is not an authentication mechanism; same-UID access and parent/child resolver divergence remain blockers.
6. Add crash-injection, replay, concurrency and integration tests before changing credential delivery or lifting HOLD.

No production store/schema/FD-3 mutation is authorized by this milestone.
