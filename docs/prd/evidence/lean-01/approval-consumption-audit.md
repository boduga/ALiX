# LEAN-G01 — Approval consumption identity audit

Status: **source-confirmed contract gaps, runtime exploitability unproven**. Revision `d412ea15` with dirty worktree. No production modifications.

## Verified call paths

| Path | Consumer worker identity | Expected invocation | Finding |
|---|---|---|---|
| `WorkerApprovalPort.consumeApproved` (`worker-approval-port.ts`) | Caller-supplied; facade does not inject bound workerId | Caller-supplied | Restricted facade does not enforce its own bound identity on consumption |
| `PolicyGate` exact-binding reuse (`policy-gate.ts:794`) | Explicit `{}` | Omitted | Worker identity and optional invocation match unavailable at consume |
| `ApprovalStore.consumeApproved` (`approval-store.ts:943-973`) | Rejects mismatch only if record and consumer both have workerId | Validates only when provided | Omitted consumer workerId bypasses identity comparison, but status, expiry, binding key still checked |
| `WorkerApprovalPort.recordExecutionOutcome` | Facade checks record workerId against bound workerId | N/A | Reporter ownership checked, but separate from consumption identity |

## Constraints and uncertainty

- Approval can only be consumed from `approved` status, while unexpired, with exact binding key, under store mutation lock. Consumption is single-use.
- Exact-binding key construction and `PolicyGate` request context may constrain cross-worker reuse even when consumer workerId is missing. **No cross-worker side effect demonstrated.**
- `requestOrReusePending` and legacy `request` are directly forwarded from the worker facade; bound worker identity is not inserted there either. Read methods expose records without per-worker filtering. Determine intended legacy and coordination trust scopes before labeling these exploitable.
- `PolicyGate` may have other consumption paths. This report describes the verified exact-binding reuse call.

## Required negative tests before remediation approval

1. Bound worker A creates request; operator approves; bound worker B attempts to consume with the same binding key and omitted worker identity — expected DENY.
2. Bound worker A attempts to consume with conflicting supplied identity B — expected DENY.
3. A worker-bound approval consumed with no consumer workerId — expected DENY at store boundary.
4. Legacy unbound approval behavior remains compatible only where explicitly specified.
5. Exact invocation differs while binding key remains constant — expected DENY for invocation-bound records.
6. Cross-process restart: first consumption wins; replay remains denied; outcome/receipt integrity preserved.
7. Exercise actual `PolicyGate` call site, not just `ApprovalStore` in isolation.

## Candidate design after gate

Require a bound consumer identity when the approval record is worker-bound; inject/validate the port's workerId at the facade; require exact invocation for invocation-bound records; update PolicyGate to pass identity and invocation from its execution context. Retain a documented legacy pathway only if independently reviewed.

**LEAN-G01 BLOCKED — do not promote based on static evidence alone.**

## Existing-test qualification — 2026-10-25

Command: `pnpm exec vitest run tests/security/worker-approval-port.vitest.ts tests/security/approval-crash-recovery.test.ts tests/security/legacy-approval-single-use.test.ts --reporter=dot`. Exit 0; **one Vitest file, 16/16 tests passed** (16.79s). `vitest.config.mts` includes only `tests/**/*.vitest.ts`, so the two `.test.ts` files were **not executed**. They belong to the separate Node test workflow and remain unqualified by this command.

Existing `worker-approval-port.vitest.ts` covers facade method exclusions, operator decision visibility, cross-store single-use consumption, wrong binding key, and outcome reporting ownership. It does **not** establish rejection of consumption with omitted `consumer.workerId` for a worker-bound approval: existing positive consumption tests pass `{}` and expect success. This is an explicit gap relative to the proposed stricter contract, not a failing current test.

Next verification: run Node test workflow for the two `.test.ts` files using the repo's supported build/test path, then record exact counts and exit status. Do not treat Vitest success as Node test coverage.

## Node security test qualification — 2026-10-25

Executed: `node --test --test-timeout=30000 dist/tests/security/approval-crash-recovery.test.js dist/tests/security/legacy-approval-single-use.test.js` — exit **0**, **17/17 pass**, three suites, no skips or failures, duration 15.64s. Compiled artifacts timestamp Oct 25 20:46; no rebuild was performed in this pass. Thus the result qualifies the existing `dist` artifacts, not necessarily the current dirty source tree.

Coverage demonstrated: crash-after-consume unverified/replay denial; terminal outcome integrity; concurrent exactly-once claim/effect behavior in covered fixtures; changed arguments, capability and agent identity; legacy invocation mismatch; continuation one-shot and concurrent resume. Combined with the earlier restricted-port Vitest **16/16**, total **33 passing tests** across distinct runners.

**Still not qualified:** negative tests requiring rejection of a missing `consumer.workerId` on a worker-bound approval, forced worker identity at the port boundary, and end-to-end worker identity through `PolicyGate`. Existing tests passing does not close the source-confirmed identity contract gap.

## Reproduction — identity characterization tests (2026-10-25)

New test-only file: `tests/security/worker-approval-identity-characterization.vitest.ts`. Ran `pnpm exec vitest run tests/security/worker-approval-identity-characterization.vitest.ts --reporter=verbose`: **4/4 PASS**, exit 0, 4.52s. These tests explicitly assert **current insecure behavior**, so passing is defect reproduction, NOT security acceptance.

1. `ApprovalStore.consumeApproved` accepted a worker-A-bound approval with `{}` consumer identity.
2. Store correctly rejected an explicitly supplied mismatched worker-B identity.
3. A `WorkerApprovalPort` bound to worker B consumed an approved worker-A record when given its binding key and `{}`; worker B could not subsequently report worker A's outcome.
4. Worker-B-bound port forwarded a `requestOrReusePending` input specifying worker A, preserving that identity.

All tests used disposable temporary workspaces. No real command side effect or full end-to-end exploit was demonstrated. This upgrades the identity finding from static suspicion to **runtime-reproduced approval-consumption and request-binding contract gaps**. Fix requires changing the characterization assertions into negative security acceptance tests and implementing the guarded contract, after authorized phase transition.
