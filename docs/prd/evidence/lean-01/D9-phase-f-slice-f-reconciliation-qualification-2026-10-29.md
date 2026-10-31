# D9 Phase F Slice F — effect reconciliation qualification

Date: 2026-10-29 (America/Edmonton)
Status: ACCEPTED at Slice F implementation scope; Phase F remains HOLD
Implementation commit: `db9bf8777d3937c140be3ad4958f4642be552d9c`
Implementation tree: `11fa201169c0cf1ab8e4c46c69e37ad2436ac254`

## Scope

This packet qualifies the audited recovery/reconciliation path for unresolved D9 effect-journal entries. It does **not** qualify Linux ARM64, close Slice G governance/evidence reconciliation, clear Harness Gate E, or clear Phase F.

## Implemented contract

- Every effect-journal generation carries a random `generationId`.
- Reconciliation authority is a dedicated single-use `effect.reconcile` capability bound to the exact `effectKey`, `generationId`, requested outcome, evidence hash/reference, actor identity and policy revision.
- Reconciliation snapshots caller-controlled authority input before the first await.
- Guarded execution snapshots nested effect-bearing arguments with `structuredClone` before the first await; journal identity and adapter dispatch use that same snapshot while the live AbortSignal remains observable.
- Execution and reconciliation share one OS-managed exact-effect lock. A live adapter therefore cannot be reconciled concurrently.
- Journal state is re-read under that lock after approval-store awaits before authority is consumed into a state transition.
- `applied` transitions to durable `reconciled_success` and remains replay-quarantined.
- `not_applied` transitions to durable `reconciled_not_applied`; only that durable state may be archived to release the exact effect for a fresh attempt.
- Reconciliation evidence is retained in an fsync'd append-only JSONL history with generation, actor, approval, policy and evidence identity.
- Age, PID, a fresh invocation id, or a new unrelated approval cannot clear an uncertain effect.

## Adversarial defects found and remediated during review

Independent review iterations found and the final tree addresses:

1. mutation of reconciliation input after authority binding;
2. contradictory concurrent reconcilers overwriting one another;
3. reconciliation releasing quarantine while the original adapter was still live;
4. request identity mutation across reconciliation awaits;
5. reuse of unused generation-1 reconciliation authority against a later generation;
6. nested non-shell tool arguments mutating during lock acquisition so journal identity A could protect adapter effect B.

The sixth defect was independently reproduced as adapter effects `B, B` before the fix. The final implementation synchronously deep-snapshots `request.args` before any await and dispatches the same snapshot used for effect identity.

## Qualification execution

Writable-tree targeted run after the final snapshot fix:

```sh
pnpm build
pnpm exec vitest run \
  tests/security/effect-journal.vitest.ts \
  tests/security/effect-reconciliation.vitest.ts \
  tests/security/effect-journal-executor.vitest.ts \
  tests/security/effect-journal-dispatch-matrix.vitest.ts \
  --reporter=dot
```

Result: **4/4 files, 48/48 tests PASS**.

Covered cases include authority subject/binding rejection, generation isolation, contradictory reconciler serialization, live-adapter lock exclusion, applied/not-applied outcomes, exact replay quarantine/release, crash-order injection, nested request snapshot identity, cancellation boundaries and dispatch ambiguity.

Final repository gates:

```text
pnpm typecheck:unused  PASS
pnpm check:dox         PASS
git diff --check       PASS
```

## Independent security verdict

A read-only post-fix Codex review inspected the current Slice F implementation after the nested-argument exploit was repaired and returned:

> VERDICT ACCEPT
>
> Reported A→B exploit is closed: synchronous deep cloning binds journal identity and adapter dispatch to the same snapshot.
>
> No HIGH or MEDIUM defects found in reconciliation authority, generation binding, locking, or crash-release ordering.

The reviewer could not rerun write-requiring Vitest suites inside its read-only sandbox; this is an environment limitation, not a failed test result. The authoritative writable-tree run above is 48/48 PASS.

## Residual blockers outside Slice F

- Linux ARM64 native qualification remains required by ADR-0017 / Master PRD Q10.
- Slice G governance/evidence reconciliation remains open.
- PRE-R024 OS process/rubric isolation remains independently HOLD and is not closed by this effect-journal work.
- Phase F and Harness Gate E remain HOLD until their full required evidence is present.
