# SRAP-1 G2-A Architecture and Security Verification

**Date:** 2026-10-14

**Verified baseline:** `main` / `2c73b044c5c71a63a3856b112ac9c7c8ccf18e5e`

**Review mode:** read-only source and test inspection

**Verdict:** **CONDITIONAL** — architecture can support SRAP-1 without another
approval authority or ledger, but contract correction and G2-B durability proof
are required before implementation.

## Scope and inputs

Read completely:

- `docs/2026-10-14-srap1-review-and-revised-plan.md`
- `docs/2026-10-14-srap-1-contract-proposal.md`
- `docs/2026-10-14-srap-1-implementation-plan.md`
- `docs/2026-10-14-srap-option-b-design.md`

Inspected approval persistence, runtime ledger, audit stores, authentication,
origin policy, proxy/TLS handling, route permissions, `PolicyGate`, and
`ExecutionAuthorization`. No production code, approval state, or repository
history changed during G2-A.

## Executive findings

1. `ApprovalStore` writes complete records as authoritative
   `approval.updated` events. One event can contain transition and mandatory
   remote-decision evidence.
2. `RuntimeLedger.append()` atomically commits event, entity version, and outbox
   row in one SQLite transaction.
3. JSONL audit is a separate persistence and integrity authority. SQLite and
   JSONL cannot share one atomic commit. Audit must be a recoverable projection
   for SRAP-1 evidence, not another approval authority.
4. Current authenticated context exposes credential/token ID, not stable human
   operator identity.
5. Current cookie-origin posture does not support the claimed SRAP-1 CSRF
   guarantee. Initial endpoint should be bearer-only.
6. Forwarded HTTPS is accepted without checking whether the immediate peer is a
   trusted proxy. Remote deployment is unsafe until corrected.
7. `ApprovalStore.resolve()` serializes status transition but does not check
   expiry, authenticated actor, or approval-specific eligibility.
8. Existing tests do not cover commit-before-response ambiguity, process death,
   restart, or authoritative evidence read-back.

## Verified findings matrix

| ID | Result | Verification and evidence | Required correction |
|---|---|---|---|
| F1 — lock does not make SQLite + audit atomic | **Confirmed** | `ApprovalStore.mutate()` appends ledger first, then writes compatibility projection (`src/governance/approvals/approval-store.ts:315-371`). `resolve()` performs JSONL audit only after lock release and suppresses failure (`approval-store.ts:637-655`). Audit DOX forbids mirroring audit authority into runtime ledger (`src/governance/audit/AGENTS.md:21-30`). | Put transition and mandatory evidence in one `approval.updated` event. JSONL becomes recoverable projection. |
| F2 — durability failure may be unknown outcome | **Confirmed** | Ledger append is the approval commit before projection and response (`approval-store.ts:342-355`). A process/network failure after commit cannot mean “not applied.” No decision ID/read-back protocol exists in `resolve()` (`approval-store.ts:623-658`). | Commit once; on missing acknowledgement, authenticate and read authoritative event or retry exact nonce without creating another transition. |
| F3 — role/token ID is not human identity | **Confirmed** | `SecurityContext` contains `tokenId` and permissions only (`src/governance/security/inspector/security-context.ts:25-43`). Middleware maps token record ID into `tokenId` and discards name, role, and workspace scope (`src/interfaces/server/security-middleware.ts:376-386`). Auth service returns token record ID, name, role, and workspace IDs (`src/governance/security/inspector/auth-service.ts:479-489`); none is a guaranteed human principal. | Add stable server-validated `principalId`, separate `credentialId`, role, permissions, and authorized scope. |
| F4 — cookie CSRF contract insufficient | **Confirmed** | Missing `Origin` is accepted even for credentialed cookie requests (`src/governance/security/inspector/origin-policy.ts:159-168`). Missing `Sec-Fetch-Site` is also accepted (`origin-policy.ts:238-248`). Data routes call validation without a required fetch-site relationship (`src/interfaces/server/security-middleware.ts:224-258`). | Bearer-only SRAP-1. Cookie approval requires separate anti-CSRF contract and tests. |
| F5 — nonce semantics underspecified | **Confirmed** | `ApprovalRecord` has request correlation and `decidedBy`, but no durable remote nonce or decision ID (`src/governance/approvals/approval-types.ts:35-62`). `resolve()` accepts only ID, status, and reason (`approval-store.ts:623-627`). | Bounded nonce as idempotency metadata; persist with decision ID, principal, decision, and bounded request content in authoritative event. |
| F6 — abuse controls/proxy-derived identity risk | **Partially confirmed** | Existing middleware already has separate pre/post-auth limiting and post-auth keys use token ID plus resolved address (`src/interfaces/server/security-middleware.ts:399-409`). Trusted proxy CIDRs exist for client-address resolution, but proposed five-failure approval behavior is not implemented. TLS trust still bypasses this boundary (F13 below). | Reuse existing buckets; use trusted source address and authenticated principal; bounded temporary backoff; never mutate approval eligibility. |
| F7 — endpoint precheck cannot replace locked checks | **Confirmed** | `resolve()` checks only record existence and `pending` status inside `mutate()` (`approval-store.ts:628-634`). It does not check expiry, actor, credential, workspace/run scope, or retry evidence. `consumeApproved()` later checks status, expiry, binding, and worker under lock (`approval-store.ts:791-810`), but that does not authorize the earlier remote decision. | Put expiry, record eligibility, actor attribution, and idempotency checks inside approval mutation boundary. |
| F8 — evidence minimization/store ambiguity | **Confirmed** | Full approval record is copied into every authoritative approval event (`approval-store.ts:267-281`). Unbounded remote metadata added to record would therefore enter ledger history. Existing audit write contains only approval ID and reason (`approval-store.ts:651-655`). | Define bounded evidence schema; forbid raw bearer/session values and arbitrary user-agent storage; apply approval retention. |
| F9 — rollout/rollback wording | **Confirmed** | Feature-off rollback can stop a future route but cannot undo already committed authoritative events. Current lifecycle remains `pending → approved/denied → consumed/expired`; no rollback transition exists. | Separate code deploy, controlled enablement, and general rollout. State that rollback stops new remote decisions only. |
| F10 — crash tests missing | **Confirmed** | Existing storage tests cover transaction and replay mechanics, while approval tests cover ledger/projection behavior; inspected suites did not test kill after commit/before HTTP acknowledgement, restart, and evidence read-back as one SRAP scenario. | Add transaction failure, commit-before-ack, process kill, restart/read-back, duplicate retry, and mixed-decision tests. |
| F11 — `409` status disclosure | **Confirmed** | Proposed global route permission has no record-level authorization seam. Current context drops `workspaceIds` (`security-middleware.ts:376-386`) even though auth service returns them (`auth-service.ts:483-488`). | Authenticate and authorize target approval before exposing terminal state. Unauthorized response must be non-enumerating. |
| F12 — Option B differs from SRAP-1 | **Confirmed as scope distinction, not defect** | Option B target state includes stronger authenticators, action digest, and additional lifecycle concepts. SRAP-1 deliberately excludes them. Existing execution authority remains `ExecutionAuthorization.evaluate()` → `PolicyGate` → ownership (`src/runtime-state/runtime/execution-authorization.ts:35-115`). | Label Option B as target-state vision. Never describe SRAP-1 as biometric or cryptographically transaction-bound approval. |
| F13 — forwarded TLS trust boundary | **Confirmed; deployment blocker** | `detectConnectionSecurity()` treats a single `X-Forwarded-Proto: https` value as proxy TLS without verifying immediate peer (`src/governance/security/inspector/remote-access-policy.ts:109-116`). Remote validation then trusts that classification (`remote-access-policy.ts:151-172`). | Accept forwarded scheme only from configured trusted-proxy CIDRs; reject untrusted, missing, conflicting, or multi-valued evidence. |

## G2 persistence decision

### Decision

Use one authoritative SQLite `approval.updated` event containing:

- resulting approval record/status;
- stable `decisionId`;
- server-derived `principalId`;
- minimal credential reference;
- decision and bounded nonce;
- decision timestamp and bearer transport;
- bounded reason when policy retains it.

This is smallest safe design because `ApprovalStore` already persists the full
record (`approval-store.ts:267-281`) and treats the ledger append as commit
(`approval-store.ts:342-355`). `RuntimeLedger.append()` uses one database
transaction for event, entity version, and outbox (`src/runtime-state/storage/runtime-ledger.ts:119-194`). No new ledger, state machine, scheduler, or approval authority is needed.

### Audit relationship

JSONL audit stays its existing independently verifiable store. SRAP decision
audit rows are projections from committed approval evidence, idempotent by
`decisionId`. Projection loss or lag cannot invalidate, authorize, or reverse an
approval. Recovery must extend existing approval reconciliation/outbox
infrastructure; storage DOX notes no production outbox consumer currently exists
(`src/runtime-state/storage/AGENTS.md:9-15`).

### Crash-recovery state table

| Failure point | Authoritative state | Client result | Recovery |
|---|---|---|---|
| Before transaction | unchanged | failure | Safe retry with same nonce. |
| During transaction/pre-commit | rollback: no transition/evidence/outbox | failure | Safe retry. |
| Commit succeeds, process dies before acknowledgement | transition + evidence + outbox committed | unknown | Restart and read ledger by approval ID; exact authorized retry returns same result. |
| HTTP response lost after commit | committed | unknown | Same read-back/exact retry rule. |
| JSONL projection fails | committed ledger remains authoritative | success may still be returned after ledger commit | Observe lag; repair projection idempotently. |
| Conflicting retry | original commit remains | `409` after authorization | No mutation. |
| Unauthorized retry/read | undisclosed | `401/403` or non-enumerating response | No read or mutation. |

Durability caveat discovered during follow-up: ledger constructor sets WAL but
does not explicitly set SQLite `synchronous` (`runtime-ledger.ts:101-110`). G2-B
must verify reopened-database settings and power-loss contract; process-crash
recovery alone is insufficient.

## Authentication and authorization decision

Required security context:

```text
principalId     stable operator/human identity
credentialId    rotating or revocable credential identity
role            broad authorization class
permissions     includes approvals:decide
authorizedScope workspace/tenant/run/owner eligibility
```

Required decision order:

1. Require bearer credential; reject cookie/session authentication.
2. Resolve stable principal and active credential server-side.
3. Require `approvals:decide`; role alone is insufficient.
4. Check principal scope over target approval before revealing its state.
5. Inside `ApprovalStore.mutate()`, check pending state, expiry, eligibility
   binding, and exact-retry evidence.
6. Append transition plus evidence once.
7. Return `200` only after confirmed commit.

Exact retry may return `200` only for same authorized principal, nonce, decision,
and bounded request content. Mismatch returns `409` without bypassing record
authorization. Nonce is correlation/idempotency data, not cryptographic proof.

## Proxy and CSRF decision

- SRAP-1 decisions are bearer-only.
- Direct TLS remains valid.
- Forwarded TLS evidence is valid only when immediate peer matches configured
  trusted-proxy CIDR.
- Reject ambiguous/multi-valued `X-Forwarded-Proto`, untrusted forwarding,
  missing scheme behind trusted proxy, and cleartext remote bearer requests.
- Origin policy remains defense in depth for bearer calls, not authentication.
- Cookie support is postponed until explicit CSRF token, fail-closed Origin, and
  Fetch Metadata rules are separately approved.

## Contract and plan amendments required

1. Replace two-store atomicity language with one authoritative
   transition-plus-evidence event.
2. Define JSONL as recoverable audit projection, not atomic approval authority.
3. Replace “durability failure means not applied” with unknown-outcome/read-back
   semantics.
4. Replace token/role attribution with stable `principalId` plus separate
   `credentialId` and role.
5. Make initial endpoint bearer-only.
6. Require approval-specific eligibility before state disclosure or mutation.
7. Define exact authenticated retry `200`; conflicting retry `409`.
8. Add trusted-proxy TLS correction as deployment prerequisite.
9. Define bounded evidence schema, pseudonymization decision, and retention.
10. Add crash/restart, proxy-spoof, authorization parity, projection repair,
    and rollback tests.

## Dependency-ordered implementation sequence

1. Approve corrected G2-B contract and persistence ADR.
2. Decide SQLite journal/synchronous durability requirement.
3. Define stable principal source, credential correlation, and approval-specific
   eligibility rule.
4. Correct trusted-proxy TLS classification and tests.
5. Add bounded evidence schema and locked `ApprovalStore.resolve()` checks.
6. Add idempotent audit projection through existing infrastructure.
7. Add closed permission vocabulary, route policy, and default-off flag.
8. Add bearer-only endpoint last; it must orchestrate existing authority only.
9. Run independent G3 security/architecture review.
10. Perform G4 controlled rollout and rollback drills.

## Governance and ownership conflicts

- Approval DOX says no browser POST write endpoints
  (`src/governance/approvals/AGENTS.md:14-17`). A narrow SRAP exception requires
  explicit amendment during implementation.
- Inspector DOX limits mutating/execution POSTs
  (`src/interfaces/server/AGENTS.md:12-30`). New route requires explicit owning
  contract amendment and permission gate.
- Audit DOX prohibits mirroring audit into runtime ledger
  (`src/governance/audit/AGENTS.md:21-32`). Mandatory decision evidence must be
  approval-domain evidence; JSONL audit remains audit integrity authority.
- Runtime storage owns mechanics only, not domain validation
  (`src/runtime-state/storage/AGENTS.md:12-19`). Evidence validation belongs in
  `ApprovalStore`, not `RuntimeLedger`.
- Existing `ExecutionAuthorization`, `PolicyGate`, ownership checks, consume
  path, lifecycle, and scheduler must remain authoritative. Direct endpoint
  execution or a new approval authority would violate subsystem ownership.

## Acceptance tests and review gates

### G2-B — contract and durability

- Transaction failure commits neither transition, evidence, nor outbox.
- Commit-before-ack process termination survives restart and authoritative
  read-back.
- Reopened SQLite database reports approved journal and synchronous settings.
- Projection failure and repair produce exactly one JSONL record.
- Operator approves identity, authorization, proxy, privacy, and durability
  contract amendments.

### G2-C — implementation-plan approval

- Exact modules and migration compatibility pinned.
- Authorization parity table covers role × principal scope × state × retry.
- No new ledger, state machine, scheduler, or authority.
- DOX amendments identified and approved.

### G3 — independent implementation review

- Default-off flag proven.
- Anonymous, readonly, cookie, revoked, expired, wrong-scope, cross-record, and
  loopback-bypass attempts fail closed.
- Exact retry, conflict, expiry, concurrent mixed decisions, crash, audit repair,
  proxy spoofing, rate limits, size limits, and log hygiene pass.
- Existing governance, architecture, approval, ledger, and execution tests pass.

### G4 — controlled validation/deployment

- Trusted-proxy canary only.
- Restart, unknown-outcome, revocation, projection repair, feature-off rollback,
  and CLI/TUI/Inspector visibility drills pass.
- Feature rollback stops future remote writes; committed approvals remain subject
  to existing consume/revoke/expiry rules.
- Explicit operator go/no-go before broader enablement.

## Remaining operator blockers at G2-A close

1. Approve one-ledger transition-plus-evidence contract amendment.
2. Approve bearer-only posture.
3. Select stable principal identity source and approval eligibility semantics.
4. Approve trusted-proxy model.
5. Approve exact-retry semantics and minimal evidence retention/privacy.
6. Complete durability proof, including SQLite synchronous policy.
7. Approve required Approval and Inspector DOX exceptions.

## Final G2-A verdict

**CONDITIONAL.** ALiX can guarantee atomic approval transition plus mandatory
decision evidence without another persistence authority by storing both in one
existing SQLite `approval.updated` event. G3 remains closed until corrected
contract approval, stable identity and record authorization design, proxy TLS
repair, and crash/power-loss durability evidence pass independent review.
