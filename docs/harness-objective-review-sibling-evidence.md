# Worker objective review — evidence isolation and approval diagnosis

**Status:** Root cause found and fixed; the real-model crash/restart run now
passes 3/3 workers.
**Updated:** 2026-10-22

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
- The earlier quota-blocked run is preserved at
  `benchmark/evidence/coordination/restart-review-quota-blocked.json`.

## Root cause of the review rejection (2026-10-22)

The review was not mis-scoped. **A worker wrote every sibling's file, because
the owned-scope rule was unreachable.**

`PolicyGate.evaluateToolCall` returned the tool-permission allow at step 5 and
evaluated the owned-path rule only at step 5.5. The write capability's
permission resolves to "allow" under auto/bypass session modes — the default
for a coordination run — so the rule never ran. On a real gpt-4o run a worker
whose owned scope was `docs/a.md` created `docs/a.md`, `docs/b.md` AND
`docs/c.md` with 26 tool calls and zero denials. Its siblings then found their
deliverables already present, produced no mutation evidence in their own
attempt, and were rejected for work they never owned — the rejection looked
like a review bug and was an authorization hole.

`FileToolRouter.file.create` had the matching gap: only the OVERWRITE branch
consulted the owned scope, so a NEW file outside the scope was created with no
denial.

Fixed in `bf29449b`: an allowed capability now falls through to the owned-path
rule when the request declares owned paths for a write tool (an explicit
capability deny still wins), and `file.create` applies the owned-scope backstop
to new files as well. Pinned by `tests/policy/policy-gate.test.ts` (the
allow-listed capability × session-mode case, plus deny-wins),
`tests/executor.test.ts` (bypass session mode), and the `file.create`
owned-scope parity table in `tests/tools/tool-router.test.ts`.

The re-run passes: killed on a persisted running worker with zero workers
completed at kill, resume recovered one orphan, final run `completed` /
`success` with all three workers completed and each artifact holding exactly
its marker. Evidence `benchmark/evidence/coordination/stratum8-gpt4o.json`, cost
`benchmark/evidence/cost/stratum8-restart.json` ($0.211623).

The owned-scope rule demonstrably decided: worker B (owned `docs/b.md`) tried to
write `docs/a.md` and `docs/c.md` and was denied both times — the run's only
two tool failures, and the reason its siblings' deliverables stayed intact.

## Cross-attempt evidence (fixed)

The review's mutation evidence was scoped to the CURRENT attempt. A retry whose
deliverable already existed from an earlier attempt therefore had no
persisted-output evidence, even though the deliverable was on disk and correct,
so root AGENTS.md ("Durable progress survives failed retries") was not honoured
there. The trigger was structural, not incidental: re-creating identical
content returns `changed: false` BEFORE the router writes, so it emits no
mutation event at all and an attempt-scoped evidence set is empty.

Fixed: the review's mutation evidence is now the union of the current attempt's
events and the run's DURABLE session log, still restricted to the worker's
owned scope through the shared ownership matcher. The durable set carries an
earlier attempt's proof (and a killed attempt's, since the log outlives the
process); the owned scope keeps a sibling's artifact out of this worker's
evidence. The child worker executor seeds its durable write progress the same
way, so a retry is not reported as having made no progress and never reaches
the review with an empty set.

Pinned by `tests/kernel/default-worker-review.vitest.ts` ("keeps an earlier
attempt's durable evidence when the retry mutates nothing") and
`tests/agents/subagent-cli-completion.vitest.ts` (the same case for the child
worker executor). Both fail without the change.

Gate B and publication remain HOLD. Do not substitute another model silently or
promote a failed run.
