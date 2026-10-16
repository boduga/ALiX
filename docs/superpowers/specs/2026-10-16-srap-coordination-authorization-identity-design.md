# SRAP — Coordination authorization identity: source-backed contract (PR A design)

> **Status:** PROPOSED contract, written **before implementation** per operator
> authorization of 2026-10-16. Scope: PR A (fix coordination authorization
> identity propagation and approval-binding continuity). Part of
> `SRAP-G3-ACCEPT`. Not an acceptance run; no new approval authority.
>
> Durable rules this materializes will be promoted into the owning
> `AGENTS.md` files (`src/coordination/kernel`, `src/governance/policy`,
> `src/governance/approvals`) at implementation close-out.

## 1. Problem

A coordination worker that needs approval is blocked with
`blockReason: "approval_required"` and **never resumes**, even after the exact
approval record is human-approved. Two independent, source-confirmed defects
cause this. Both must be fixed; fixing either alone leaves the worker blocked.

**Defect 1 — coordination identity never reaches the policy gate.**
`authorizeWorker` supplies the worker's coordination identity
(`coordinationRunId`, `workerId`, `workerAttempt`) only inside the generic
`metadata` bag of the evaluation request
(`src/coordination/kernel/coordination-authorization.ts:60-71`). The
authorization boundary drops it: `ExecutionAuthorization.evaluate` forwards
`requestId`, `capability`, `sessionMode`, `nodeId`, `graphId`, `sessionId`,
`agentId`, `source` to `PolicyGate.evaluateCapability` — **not** `metadata` and
**not** any coordination field
(`src/runtime-state/runtime/execution-authorization.ts:59-68`).
`PolicyGate.evaluateCapability` therefore sees `coordinationRunId === undefined`
and takes the legacy approval path
(`src/governance/policy/policy-gate.ts:416,437-445`).

**Defect 2 — the coordination branch computes a binding it never persists.**
Even when coordination context *is* supplied, `handleAskDecision` computes
`bindingKey` correctly (`policy-gate.ts:506-515`) but creates the record through
the **legacy** `store.request(...)` (`policy-gate.ts:534`), which derives and
commits its *own* legacy binding at `approval-store.ts:595-605`. The branch then
mutates the returned record's fields **after** `mutate()` has already
committed (`policy-gate.ts:536-542`). Consequences, all observed:

- The authoritative `approval.created` ledger append and the JSON projection
  carry the **legacy** binding; a reload returns the legacy record
  (`approval-store.ts:267-282,315-377`).
- The in-memory binding index (`byBindingKey`) was built during `mutate()`
  before the post-commit mutation (`approval-store.ts:340`), so even in memory
  `findExact`/`findPendingByBindingKey` cannot see the coordination binding.
- The returned `decision.bindingKey` (coordination) matches **no** stored
  record.

Net effect: `evidence.bindingKey` is never populated (Defect 1), and the
approval that *is* stored carries a legacy binding that reconciliation cannot
match to the worker (Defect 2). The WIP commit `ea629183` adds a fail-closed
guard on `evidence.bindingKey`, which is correct **given** a populated binding,
but neither defect is fixed by it — so it changes no observable behavior.

Evidence: D2 qualification record
`/tmp/opencode/alix-srap-accept/20261016T071552Z-d2/.../ledger/approval-record.json`
shows `requestFingerprint: "legacy:filesystem.write:::coord_…"`,
`policyRevision: "legacy"`, and no `coordinationRunId`/`workerId` on the stored
approval — i.e. created via the legacy path.

## 2. Trusted origin, validation, propagation (the contract)

**Origin (trusted runtime, never model-authored).** A coordination worker's
identity is minted by the scheduler when it authorizes a worker:
`run.id`, `worker.id`, `worker.attempt` in
`src/coordination/kernel/coordination-authorization.ts:37-110`. This is
runtime state, not tool arguments; the model never supplies it.

**Canonical identity tuple.**

```
CoordinationIdentity = { coordinationRunId: string; workerId: string; workerAttempt: number }
```

All three are required together and are non-empty (`attempt` an integer ≥ 0).
Partial/conflicting identity is a **rejection**, never a silent fallback to
legacy authorization.

**Layer-by-layer contract.**

| Layer | File | Contract |
| --- | --- | --- |
| Origin | `coordination-authorization.ts:authorizeWorker` | Supplies a **typed** `coordination` object on the evaluation request (no longer only `metadata`). |
| Request type | `runtime-state/runtime/execution-decision.ts:ExecutionDecisionRequest` | Adds an explicit typed `coordination?: CoordinationIdentity` field. |
| Boundary | `runtime-state/runtime/execution-authorization.ts:evaluate` | **Validates** the identity (shape + completeness) and forwards it to `evaluateCapability`/`evaluateToolCall`. Malformed ⇒ deny, fail closed, no approval created. |
| Policy | `governance/policy/policy-gate.ts:evaluateCapability` | Receives `coordinationRunId`/`workerId`/`workerAttempt`/`ownershipClaims`/`requestFingerprint`; enters the coordination branch. |
| Creation | `governance/policy/policy-gate.ts:handleAskDecision` | Persists the approval through `ApprovalStore` with the **computed coordination binding** committed atomically (not a post-commit field patch). |
| Persistence | `governance/approvals/approval-store.ts` | The stored record and the `approval.created` ledger payload carry the coordination binding, `requestFingerprint`, `policyRevision`, and `coordinationRunId`/`workerId`/`workerAttempt`. |
| Evidence | `coordination-authorization.ts` | Retains the WIP work: `evidence.bindingKey`/`requestFingerprint` are set from the created approval. |
| Reconciliation | `coordination-scheduler.ts:isApproved` | Reconciles on `evidence.bindingKey` (no reconstruction); independently verifies run/worker/attempt/capabilities **plus ownership claims and policy revision** against the stored record; absent/legacy evidence fails closed. |

**Non-coordination behavior is unchanged.** Requests without a coordination
identity keep the legacy path exactly (`policy-gate.ts:546-591`), including
de-dup by `requestId` and pending reuse.

## 3. Fix list (implementation)

1. **Typed identity.** Add `coordination?: { coordinationRunId; workerId;
   workerAttempt }` to `ExecutionDecisionRequest`. Have `authorizeWorker` pass
   it (keep `metadata` for observability, but the typed field is authoritative).
2. **Boundary validation + propagation.** In `ExecutionAuthorization.evaluate`,
   validate the identity and forward it (with `ownershipClaims` derived from
   the worker, and `requestFingerprint`) into `evaluateCapability`. Malformed
   identity ⇒ `decisionDenied`, audited, no store side effect.
3. **Atomic creation.** Replace the coordination branch's
   `store.request(...)` + post-commit mutation with an atomic
   `ApprovalStore.requestOrReusePending({ bindingKey, requestFingerprint,
   policyRevision, capabilities, ownershipClaims, coordinationRunId, workerId,
   workerAttempt, reason, sessionId, agentId, requestId })`. The reuse check
   becomes part of the same locked mutate (closes the check-then-create race).
4. **Reconciliation verification.** Keep the WIP fail-closed guard and secure
   key matching; extend independent verification to compare
   `computeOwnershipClaimsHash(record.ownershipClaims)` against the worker's
   claims, and the stored `policyRevision` against the current policy revision.
5. **Regression tests against real components** (no `isApproved: () => true`,
   no fabricated binding): one end-to-end test driving
   `authorizeWorker → ExecutionAuthorization → PolicyGate → ApprovalStore →
   scheduler reconciliation → resumption`, plus security negatives.

## 4. Verification sequence (evidence required per stage)

| Stage | Required evidence |
| --- | --- |
| Context propagation | `PolicyGate.evaluateCapability` receives the correct run/worker/attempt |
| Creation | stored approval carries the coordination binding/fingerprint/revision |
| Persistence | worker evidence retains `bindingKey` across a store reload |
| Blocking | scheduler records `approval_required` |
| Approval | the existing authority approves the exact record |
| Reconciliation | scheduler matches the persisted binding and consumes it |
| Resumption | the same worker resumes and reaches a successful terminal outcome |
| Security negatives | wrong run/worker/attempt/capability/ownership/revision, expired, consumed ⇒ rejected |
| Compatibility | non-coordination authorization unchanged |
| Full validation | build, static checks, focused tests, required CI |

## 5. Authorization limits (unchanged from operator message)

Redesign/implement PR A and the authorization-context plumbing: authorized.
Real integration + security regression tests: authorized. Unrelated
authorization/governance changes: **not** authorized. Push/open PR A: after
local verification. Merge: review + green CI. D2 re-qualification: after PR A
merge. PR B, D3, D4: not authorized.

## 6. Note on the "known failure" in the WIP hand-off

The WIP commit attributed a `coordination-scheduler` failure to the new
fail-closed guard. That is **incorrect**. The cited test
(`"a settling worker wakes the loop promptly and completes"`) uses
`allowAllAuth()` and never enters the approval path; it fails only under
full-suite load as a pre-existing timing flake (`blocked` vs `completed`) and
reproduces identically on `main`. It must not be reported as a PR A regression
without independent evidence.

## 7. PR A acceptance

PR A is complete when the §4 sequence passes with the end-to-end test proving
resumption against real components, security negatives rejected, non-coordination
behavior unchanged, and build/static/focused/full CI green — with the timing
flake tracked separately from the branch's results.
