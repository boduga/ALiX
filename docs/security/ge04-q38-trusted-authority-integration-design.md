# GE-04 Q3.8 — Trusted authority integration design (HOLD)

Status: design + synthetic pure qualification only. No production credential path modified.

## Verified source-of-truth seams

- `src/coordination/kernel/coordination-store.ts`: `claimPendingWorker(runId, workerId, expectedAttempt, patch)` serializes under the per-run lock, requires pending/unblocked worker with the expected attempt, and persists `running` with `attempt = expectedAttempt + 1`.
- `src/coordination/kernel/coordination-scheduler.ts`: dispatch calls `claimPendingWorker` after authorization and ownership checks; execution starts only after a successful claim. A pre-claim snapshot is not authority for credential issuance.
- `src/coordination/kernel/subagent-worker-executor.ts`: `taskForWorker` propagates `worker.coordinationRunId` and `worker.attempt` into the subagent task.
- `src/agents/subagent-manager.ts`: the current FD-3 credential payload still contains all resolved plaintext API keys for coordination workers. Nothing in Q3.8 narrows that behavior.
- `src/coordination/kernel/coordination-types.ts`: worker records include status, attempt, executionOwnerId, authorizationEvidence, and the run has planRevision. Neither record establishes a persisted concrete authorized model route or credential grant by itself.

## Required authoritative flow (not implemented)

1. Scheduler successfully claims worker using the existing durable coordination store.
2. Trusted grant service re-reads the persisted run/worker under a suitable consistency boundary; checks run/worker/attempt, running status, owner and plan revision, plus policy/authorization evidence. A mere unprotected read followed by issuance risks TOCTOU; use a lock/transaction or revalidate at the final issuance boundary.
3. Trusted model resolution produces a concrete, versioned routing decision bound to that same execution attempt and plan revision. **Current coordination records lack this complete binding.** Define its durable authority and lifecycle before production work.
4. Compute provider grant from that authorized route; do not accept worker-proposed models or fallback chains.
5. Issue/consume with authenticated service identity and durable replay protection; reject stale owner, changed plan, retries, or revoked authorization. Preserve existing approval consumption semantics.
6. Only after same-UID config/keychain access is isolated or brokered may FD-3 minimization be described as confidentiality enforcement. `loadConfig` must not resolve excluded credentials from alternate stores or environment.

## Synthetic Q3.8 gate

`src/agents/worker-grant-record-check.ts` performs pure record-shape/identity/status/owner/revision comparison. `tests/agents/worker-grant-record-check.vitest.ts` tests positive and fail-closed negatives. Caller-supplied record authenticity, atomicity, route authorization, process isolation and production wiring are **not** tested or claimed.

## Stop conditions

No real secrets, production grant wiring, FD-3 replacement, approval bypass, or GE-04 HOLD release. Require an approved source-of-truth route design and separate isolation qualification before implementation.
