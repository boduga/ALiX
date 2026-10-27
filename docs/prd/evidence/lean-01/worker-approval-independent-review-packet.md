# LEAN-G01 — Independent review packet: worker approval identity

**Review status: PENDING independent reviewer.** This is a review request, not a gate approval or authorization to implement production changes. Baseline `d412ea15`, dirty worktree; reviewers must inspect the current diff and revision.

## Review objective

Determine the required fail-closed identity contract for coordination worker approval creation, reuse, consumption, and execution-outcome reporting, including isolated subagents, `PolicyGate`, and legacy non-coordination approval compatibility.

## Reproduction and evidence

- `docs/prd/evidence/lean-01/approval-consumption-audit.md`: verified call sites, limitations, and test qualification.
- `docs/prd/evidence/lean-01/worker-approval-remediation-design.md`: proposed boundaries and acceptance tests.
- `tests/security/worker-approval-identity-characterization.vitest.ts`: four passing **defect-characterization** tests, NOT security acceptance tests. Isolated disposable workspaces; no shell side effects.
- `tests/security/worker-approval-port.vitest.ts`: existing 16/16 passed; compiled Node crash recovery and legacy single-use suites 17/17 passed, but compiled artifacts were not rebuilt in that run.

## Specific source seams to inspect

1. `src/governance/approvals/approval-store.ts`: `requestBound`, `requestOrReusePending`, `request`, `consumeApproved`, `recordExecutionOutcome`.
2. `src/governance/approvals/worker-approval-port.ts`: bound `workerId` used for outcome reporting but not enforced in forwarded request/consume calls.
3. `src/governance/policy/policy-gate.ts`: coordination binding includes `workerId` and `workerAttempt`, but exact-binding consumption passes empty `{}`; coordination pending request persists those fields.
4. `src/governance/approvals/approval-binding.ts`: deterministic hash includes optional worker/run/attempt/claims; `invocationMatches` fails closed if invoked on a record without fingerprint, but `consumeApproved` checks it only if caller supplies expected invocation.
5. `src/governance/approvals/approval-types.ts`: `ApprovalRecord` optional worker identity and invocation fingerprint; `single_use` policy, consumed receipt fields.
6. `src/agents/subagent-cli.ts`: isolated worker opens restricted approval port on spawned workspace, fails closed on open failure.

## Reviewer decisions required

| Decision | Choices requiring explicit sign-off | Suggested default (proposal only) |
|---|---|---|
| D1 Identity provenance | caller-supplied vs trusted execution context | Trusted worker context only |
| D2 Worker-bound consumption | missing consumer identity allowed vs denied | Deny missing/mismatched |
| D3 Worker-attempt identity | mandatory match, legacy exception, or documented alternative | Match whenever attempt-bound |
| D4 Worker request attribution | reject conflicts vs rewrite vs compatibility exception | Reject conflicts |
| D5 Invocation validation | require fingerprint on invocation-bound records vs rely solely on coordination binding | Explicitly versioned contract, fail closed on missing required identity |
| D6 Legacy compatibility | separate legacy API/path vs permissive common method | Separate reviewed legacy path |
| D7 Read visibility | cross-worker metadata reads allowed vs worker-scoped | Scope where feasible; independently assess confidentiality |
| D8 Migration | preexisting approved worker-bound records lacking expected fields | Fail closed or explicit operator reapproval, never silent privilege widening |
| D9 Evidence | test-only reproduction sufficient vs end-to-end demonstration | End-to-end PolicyGate/isolated worker negative and restart tests required |

## Independent acceptance checklist

- [ ] Reviewer verifies code paths and reproduction independently, including the actual `PolicyGate` branch.
- [ ] Reviewer signs off D1–D9 or documents dissent and alternate design.
- [ ] Negative tests cover missing/wrong worker ID, wrong attempt, wrong invocation, request spoofing, replay, and legacy compatibility.
- [ ] End-to-end tests cover approved worker, denied worker, process restart, and crash-after-consume fail-closed outcome.
- [ ] No authority escalation from child worker to operator decision methods.
- [ ] Production implementation is separately authorized under the appropriate phase gate; no LEAN-G01 self-certification.

## Reviewer record (intentionally blank)

Reviewer identity / independence: **PENDING**

Review date and source revision: **PENDING**

Decision D1–D9: **PENDING**

Verdict (approve / changes requested / reject): **PENDING**

Supporting test runs and immutable references: **PENDING**

**LEAN-G01: BLOCKED.** This packet does not close the larger baseline qualification requirements.
