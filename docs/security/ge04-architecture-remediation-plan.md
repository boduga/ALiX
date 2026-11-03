# GE-04 architecture remediation — security-preserving plan

Status: **proposed; no production enablement or automatic reconciliation**.

## Blocking evidence

The existing `r1-boundary-freeze` import test rejects three GE-04 edges: execution filesystem authorization importing the concrete `ApprovalStore` and `OwnershipRegistry`, and execution filesystem recovery importing `ApprovalStore`. The same failures propagate into `node-tests` and coverage. The privileged `ge04-cross-uid-denial` job passes, but that does not waive the architecture failures.

## Invariants that must survive the refactor

1. A caller cannot inject a permissive approval or ownership stand-in; keep the real-store identity guarantee and module-private trusted-verifier brand. Do **not** replace `instanceof` with a duck-typed object or a string constructor-name check.
2. `consumeApproved` remains the sole atomic single-use claim, bound to policy revision, worker identity and invocation fingerprint. Failed prechecks must not consume the claim.
3. The ownership lease fence remains the durable exclusive-write revocation synchronization point. Policy revision and expiry are still not fenced through the native syscall; do not claim otherwise.
4. Recovery remains read-only, reloads the authoritative ledger, and never automatically settles an uncertain claim without trusted terminal evidence.
5. The existing architecture test and its allowlist remain unchanged; no dynamic-import or reflection bypass.

## Proposed seam ownership

- **Governance/approvals:** expose a narrow trusted GE-04 approval-claim and read-only uncertain-claims port, minted only by a governance-owned factory that validates the real `ApprovalStore`. The port must not allow arbitrary caller-defined `consumeApproved` implementations. Keep claim lifecycle and expiry classification here.
- **Coordination/ownership:** expose a narrow trusted live-exclusive-lease and fence port, minted only by a coordination-owned factory that validates the real `OwnershipRegistry`. Retain scope containment and lease validity checks under this owner.
- **Execution/filesystem:** consume only those trusted ports and policy revision inputs. Keep scoped path validation, invocation hashing and native execution here. No concrete lifecycle store imports.
- **Composition root:** instantiate both real stores and mint both trusted ports in the existing trusted host setup, not in arbitrary worker requests. Preserve module-private brands or an equivalent unforgeable trusted-composition mechanism; test forged plain objects fail closed.

## Bounded implementation order

1. Introduce governance-owned approval port and negative tests (forged port, stale policy, expired approval, consumed claim). Do not change execution yet.
2. Introduce coordination-owned ownership port and negative tests (forged port, revoked/expired lease, scope escape, concurrent revocation).
3. Change execution verifier to require both trusted ports; move concrete identity checks into the two owning factories. Update existing integration tests to compose real stores through those factories.
4. Move recovery ledger read behind the governance-owned read-only port; preserve reload-failure propagation and `eligibleForAutomaticTransition: false`.
5. Run `r1-boundary-freeze`, full native mutation tests, crash/recovery tests, privileged cross-UID CI, node-tests and coverage. Any failed or skipped required test blocks closure.

## Out of scope / remaining security hold

This architectural repair alone does not establish pidfd-bound helper lifetime, immutable executable bytes, atomic policy/lease expiry fencing, authenticated durable terminal receipts, or safe crash reconciliation. Those remain independent GE-04 release blockers. Keep the production backend unavailable and PR #1039 unmerged.
