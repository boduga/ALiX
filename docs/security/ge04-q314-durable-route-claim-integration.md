# GE-04 Q3.14 — Opt-in durable route snapshot on worker claim

Status: store integration qualification only. **GE-04 SECURITY HOLD remains active.**

## Changes

- `WorkerAssignment.trustedRouteSnapshot` is an optional versioned snapshot field.
- `CoordinationStore.claimPendingWorkerWithRoute` is an opt-in route-aware claim entrypoint. It shares the existing per-run serialized mutation and durable lock with `claimPendingWorker`.
- It rejects stale `planRevision`, missing execution owner, or pre-existing snapshot; validates route and revision before changing the worker; then commits worker status, incremented attempt, owner and snapshot as a **single ledger run fact**.
- The existing `claimPendingWorker` path is unchanged for scheduler callers and does not implicitly issue route authority.

## Test evidence and boundaries

`tests/kernel/ge04-q314-durable-route-claim.test.ts` verifies single ledger-version commit with route replay after forced projection failure, competing same-run claims, stale-plan/invalid-route rejection without append, and legacy claim compatibility. Existing Q3.13 store tests remain green.

**Not proven:** caller authenticity, trusted scheduler resolution, child CLI route enforcement, grant issuance, durable revocation, restart-to-dispatch integration, credential isolation, crash/power-loss durability, or tamper resistance. The route snapshot uses Q3.9 synthetic evidence and a non-authenticating fingerprint. The method is deliberately not wired into the production scheduler or credential sender. A caller that can invoke the new method can supply arbitrary `model`; the snapshot must not be treated as an authenticated authorization.

## Next gate

Q3.15 should establish a trusted scheduler-owned model route input and narrow authority API, and ensure a durable route snapshot is checked against actual scheduler claim state at dispatch. Replan, retry, owner changes, revocation and terminal states must invalidate grant eligibility. No credential-delivery change until same-UID credential-store/config/environment access is contained and broker authorization is independently authenticated.
