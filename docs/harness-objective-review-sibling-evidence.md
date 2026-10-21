# Worker objective review — evidence isolation and approval diagnosis

**Status:** Local regressions pass; real-model validation blocked by provider quota.
**Updated:** 2026-10-21

## Evidence isolation

`reviewDefaultWorkerResult` now restricts persisted mutation evidence to the
worker's owned paths through `ownedPathsForWorker` and `isWithinOwnedScope`.
A regression supplies mixed sibling mutation events and requires only the owned
artifact to reach the reviewer. It failed before the change.

`captureWorkerEventLog` already captures invocation-local appends; its concurrent
capture regression passes. A shared durable session log alone does not prove that
this capture leaks sibling events. Ownership filtering adds a defensive boundary
at review entry; an end-to-end capture leak has not been reproduced here.

## Approval failure: confirmed mechanism

Instrumented the previously passing integration test with spies on
`ApprovalStore.consumeApproved` and `PolicyGate.evaluateToolCall`:

1. Scheduler dispatch approval was consumed for worker attempt 0.
2. `file.create` was allowed by `owned-path-rule`; no write approval existed.
3. Review's `file.read` requested a separate approval and failed immediately.
4. Scheduler retried the worker. The test approved that retry's dispatch approval,
   incorrectly calling it a file-mutation approval.
5. The retry completed without a new write; review had no persisted mutation paths.

Both consumed approval IDs belonged to dispatch (attempts 0 and 1). The read
approval stayed pending. **The reviewer did not consume a write approval.**
The previous approval-theft hypothesis is disproved for this reproducer.

## Fix and regression coverage

- Internal persisted-output reads use a cloned config that permits ask reads.
  Explicit/default read denials, protected paths, and workspace containment still
  apply. Host permissions stay unchanged.
- Read-policy parity covers default ask, explicit ask, explicit allow over default
  deny, explicit deny, default deny, and protected output paths; no review approval
  may remain pending.
- Integration uses the host approval store, expects only dispatch consumption,
  asserts owned-write authorization, requires success on the first execution
  attempt, and rejects orphaned approval records.
- Review still uses `worker.goalPrompt`; malformed contradictory verdicts retain
  their existing retry behavior.

## Verification

- Worker-review suite: 15/15 pass. Coordination runtime integration: 6/6 pass.
- Build, unused check, architecture layer/boundary tests, and DOX audit pass.
- Real restart harness used current default `intern/deepseek-v4-flash-0731`.
  The six-second startup kill created no resumable run; a 30-second window did.
  Run `coord_3e140d34-4531-4281-b4ac-687d07926c49` was running at kill, with zero
  falsely completed workers. Resume recovered one orphan, then ended failed:
  worker A exhausted attempts; workers B/C reported `API error 429: quota exceeded`.
  No usage records were observed; cost remains unknown. This is not successful
  stratum-8 evidence. Record:
  `benchmark/evidence/coordination/restart-review-quota-blocked.json`.

Gate B remains HOLD. Retry the real harness after provider quota is restored;
do not substitute another model silently or promote this failed run.
