# LEAN-G01 — Approval authority remediation review contract

**Status:** PROPOSED / independent review pending. **Gate:** LEAN-G01 BLOCKED.
**Scope:** Security contract and test evidence only. No authorization to edit production behavior or promote the gate.

## Observed RED acceptance baseline

| Boundary | Test file | Observed baseline | Required outcome |
|---|---|---|---|
| Inspector in-process host injection | `tests/security/host-approval-injection-acceptance.vitest.ts` | FAIL | Host supplies its scheduler approval authority to the worker tool executor |
| Daemon coordination host injection | Same | FAIL | Same authority instance shared at both authorization boundaries |
| Store worker-bound consumption without consumer ID | `tests/security/worker-approval-identity-acceptance.vitest.ts` | FAIL | Deny without consuming or changing approved state |
| Restricted worker-B port consumes worker-A approval | Same | FAIL | Deny; no transferable worker authority |
| Restricted worker-B port requests as worker A | Same | FAIL | Reject or force bound worker identity, preserving audit provenance |
| Wrong execution attempt | `tests/security/worker-approval-invocation-acceptance.vitest.ts` | FAIL | Deny mismatched attempt, preserving approved state |
| Invocation-bound record consumed with no expected invocation | Same | FAIL | Deny omission, not merely mismatching supplied identity |

**Passing controls:** explicit worker mismatch denial (identity suite 1/4); explicit invocation-argument mismatch denial and matching single-use consumption/replay denial (invocation suite 2/4). Host injection suite 0/2. Combined prospective tests: **7 RED / 3 GREEN**. This is not gate acceptance.

## Authority invariants requiring independent decision

1. **One approval authority per project host lifecycle.** Scheduler dispatch authorization and each concrete worker tool call must use the same durable store; the dispatch grant is never a blanket tool grant.
2. **Store is enforcement, not optional caller discipline.** If a persisted approval binds `workerId`, consumption without matching trusted consumer identity must fail. If it binds `workerAttempt`, mismatching or missing attempt must fail. Determine explicit legacy-record behavior; no implicit privilege escalation.
3. **Invocation integrity.** An invocation-bound approval must require a trusted current invocation identity and matching fingerprint. Omitting the identity cannot skip validation. Tool name, capability, args hash, workspace, session, and agent scope must not be prompt-controlled authority.
4. **Restricted worker ports.** The port must derive or verify worker identity from its immutable binding for request, consume, and outcome operations; cross-worker attribution or consumption must fail. Decide whether mismatched request identity throws or is rejected rather than silently rewritten.
5. **Fail closed on missing or broken store.** An ask decision without usable approval authority must never create an external effect. Approval store load failure must not turn into an implicit allow.
6. **Single use and crash safety.** A consumed approval must not authorize replay after restart; lost external-effect receipts require explicit reconciliation rather than blind retry. Cancellation prevents new effects after the cancellation boundary, with in-flight effects separately accounted for.
7. **Subagent separation.** Child-process workers have their own authority forwarding/identity seam; Inspector/daemon in-process constructor injection does not resolve that path.
8. **Durable evidence.** Request, decision, consumption, worker/run/attempt, invocation binding, execution outcome and recovery decisions must remain attributable across restarts.

## Reviewer decisions required before implementation

- **R1:** What trusted source establishes consumer worker ID and attempt at the store boundary? How do legacy callers with no worker binding remain compatible without allowing worker-bound approvals to bypass checks?
- **R2:** Does a restricted port reject conflicting worker identity or replace it? How is the decision recorded for audit?
- **R3:** When must `expectedInvocation` be mandatory, and how are legacy approvals with no fingerprint handled safely?
- **R4:** Which host composition roots share one store instance? How are failed store loads surfaced without weakening authorization?
- **R5:** What are the child/subagent identity and restart requirements, including cancellation and pending approval consumption?
- **R6:** Which end-to-end tests must pass for Inspector and daemon ask → pending → approve → consume → effect → restart, including negative and crash cases?

## Verification and promotion conditions

- RED prospective tests turn GREEN because of reviewed behavior changes, **not** relaxed assertions or skipped cases.
- Existing characterization tests that intentionally assert vulnerable behavior must be updated or retired only with explicit explanation; they are not security acceptance.
- Add behavioral host integration tests, worker-port identity negatives, correct-attempt happy path, exact invocation mismatch, duplicate consumption, cancellation/recovery, and child isolation tests. Verify persisted evidence and no unauthorized external effects.
- Re-run existing focused suites, relevant typechecks, and broader integration tests; preserve failing results and exact commands in immutable evidence.
- Obtain independent reviewer identity, dated decisions R1–R6, and explicit gate verdict. No self-certification.

## Change controls

This document is a **proposal**, not a code-change authorization. Keep existing dirty worktree intact; do not commit, push, alter production execution, or bypass any blocked operation without explicit approval. LEAN-G01 remains BLOCKED until independent review plus host-level proof and remaining benchmark requirements are satisfied.

## Review decision crosswalk — no duplicate sign-off authority

The pre-existing `worker-approval-independent-review-packet.md` **D1–D9** remains the sole independent decision record. The R1–R6 questions above are explanatory prompts, not another approval gate:

| This contract | Authoritative reviewer decisions |
|---|---|
| R1 trusted worker/attempt identity and legacy callers | D1, D2, D3, D6, D8 |
| R2 restricted port conflict behavior and attribution | D1, D4, D7 |
| R3 mandatory invocation and legacy fingerprint | D5, D6, D8 |
| R4 shared host store and fail-closed load | D2, D9 (host integration evidence) |
| R5 subagent identity, restart and cancellation | D1, D3, D7, D9 |
| R6 end-to-end scenarios and evidence | D9; also independent acceptance checklist |

Reviewers should record decisions and dissent **only in the D1–D9 packet**, with the exact reviewed revision and test evidence. Neither this crosswalk nor proposed defaults constitutes sign-off. Any host-injection authorization or production change still requires a separate explicit decision. LEAN-G01 remains BLOCKED.
