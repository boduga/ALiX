# SRAP-1 — Authenticated Remote Approval: Security Contract (G2-B amendment)

> **Dated hand-off record (`docs/AGENTS.md`), not a live contract.** The
> normative rules below are maintained in the owning `AGENTS.md` files
> (`src/governance/approvals/AGENTS.md`, `src/interfaces/server/AGENTS.md`,
> `src/governance/audit/AGENTS.md`,
> `src/governance/security/credentials/AGENTS.md`) and ADR-0015; where they
> differ, those win.
>
> Status: **G2-B architecture approved and reconciled; independent G2-C review
> BLOCKED on the decisions listed in the G2-C report. G3 remains blocked.
> Remote endpoint not implemented.**
> Reconciled against `main` @ `2c73b044`. Source cites are `path:line`;
> re-verify if the tree moved.
> Out of scope by design: WebAuthn/passkeys, biometrics, device enrollment,
> device registry/revocation, push, AFK, cryptographic action digests, new
> states, second authorities. See §13.
> Operator approval (2026-10-14): the decisions in §15 approved with two
> refinements — (R1) authentication-failure limiting must not let unauthenticated
> callers permanently exhaust an approval; (R2) a remote decision's success
> response must not precede durable decision evidence. Both are normative in §7/§4.

## 0. Objective

One narrow capability: an authenticated operator on a remote client (phone web
UI first) can decide a pending approval through the **existing** authority —
`ExecutionAuthorization.evaluate()` → `PolicyGate` → `ApprovalStore` →
ownership → audit — with the decision bound to the authenticated principal.
No state-machine change, no new authority, no biometric claim.

## 1. Reuse map (what already exists)

| Need | Exists | Location |
|------|--------|----------|
| Authorization boundary | `ExecutionAuthorization.evaluate()` | `src/runtime-state/runtime/execution-authorization.ts:41` |
| Approval lifecycle + dedup | `ApprovalStore` (`request`/`resolve`/`consumeApproved`/`expireDue`, `mutate()` lock) | `src/governance/approvals/approval-store.ts:315,392,623,726,791` |
| Binding hash (dedup, NOT signatures) | `computeBindingKey` SHA-256 canonical | `src/governance/approvals/approval-binding.ts:59` |
| Ledger authority | `approval.updated` full-record events | `src/governance/approvals/AGENTS.md` (R2.5) |
| Token auth + roles | `AuthTokenRole readonly\|operator\|admin`, per-request revalidation | `src/governance/security/inspector/auth-service.ts:29` |
| Route permission precedent | `coordination:execute` on detached POSTs | `src/interfaces/server/coordination-routes.ts:138,145` |
| Rate limiting | pre/post-auth limiters, origin policy | `src/interfaces/server/server.ts:36,132`, `security-middleware.ts` |
| Cookie posture | HttpOnly, SameSite=Strict, Secure-on-HTTPS | `src/interfaces/server/auth-routes.ts:14,194` |
| Body caps | 10KB auth bodies, 16KB headers | `auth-routes.ts:31`, `http-limits.ts:55` |
| Expiry | 30-min default `expiresAt` + sweeper | `approval-store.ts:414,726` |
| TLS posture | `node:http` + `requireTlsForRemote` (proxy-terminated) | `server.ts:3,145,298` |

## 2. New endpoint

`POST /api/approvals/:id/decision` — the **only** new mutating route in SRAP-1.

- Request: `{ decision: "approve" | "deny", reason?: string, nonce: string }`
  (≤16KB body cap, JSON). `nonce` is a client-generated single-use value
  recorded in authoritative decision evidence; replay protection at this tier is dedup + single
  transition, not cryptographic challenge (§11).
- Auth: Bearer token only. Cookie sessions are out of scope for SRAP-1. Role
  `operator` or `admin` is necessary but not sufficient.
  New permission `approvals:decide` (least privilege; alternative — reuse
  `coordination:execute` — rejected: over-broad).
- Semantics: authenticate → authorize the principal for this approval → load and
  decide under the store lock. Never reveal approval existence or state before
  record-level authorization. Exact committed retries use §9 semantics.
- Loopback-dev auth bypass MUST NOT apply to this route: remote decisions
  require a real token even when the server runs in development posture.

## 3. Server-derived identity

`ApprovalStore.resolve()` today writes `decidedAt` + `decisionReason` only
(`approval-store.ts:623-644`); `decidedBy` exists on the type
(`approval-types.ts:53`) but no runtime-queue writer populates it. SRAP-1 sets
`decidedBy` to a stable human/operator `principalId`, server-derived from auth
context and never from request input. `principalId` is separate from
`credentialId` and role: credentials rotate or revoke; roles authorize classes
of action; neither uniquely identifies a human. Current token IDs therefore
cannot satisfy this contract without an identity mapping.

The existing Inspector auth store is extended, not replaced: persistent active
operator records own `principalId`; credentials bind to one principal. Enrollment
is explicit CLI administration. Principal disablement rejects every bound
credential on the next request; credential rotation preserves `principalId`;
credential revocation affects that credential only. Legacy credentials without
an active principal binding cannot decide approvals.

## 4. Mandatory durable evidence

Every remote decision stores one bounded `remoteDecisionEvidence` object inside
the same full-record `approval.updated` payload as the transition:
`{ decisionId, principalId, credentialRef, decision, nonce, decidedAt,
transport:"bearer", reason? }`. Retention follows the existing approval
retention policy. Raw tokens, cookies, and unbounded user-agent data are
forbidden. `credentialRef` is
`hmac-sha256:<keyVersion>:<base64url(HMAC(key, credentialRecordId))>`. Versioned
keys live only in the existing credential store; old versions remain available
for correlation through the approval-retention window.

**Durability ordering (R2 — normative).** The endpoint MUST NOT return a
success response before decision evidence is durable. Existing best-effort
audit appends (`.catch(()=>{})`) are insufficient for the remote path.
Required ordering, per request:

1. `ApprovalStore.resolve()` validates the transition, authorization binding,
   and evidence inside its existing lock.
2. `mutate()` appends one `approval.updated` event containing transition and
   evidence. SQLite atomically commits that event, entity version, and existing
   outbox row. Append failure means neither transition nor evidence committed.
3. The endpoint returns `200` only after append returns. A lost response after
   commit is an unknown outcome, not proof the decision was not applied; the
   client re-reads or retries with the same nonce under §9.
4. JSONL audit is an idempotent, recoverable projection keyed by `decisionId`,
   attempted inline after commit and repaired by extending existing approval
   reconciliation. Current outbox has no production consumer and MUST NOT be
   described as an existing recovery guarantee. Reconciliation detects missing
   and duplicate audit rows and appends a missing row idempotently. Audit is not
   a second approval authority and cannot share SQLite atomicity.

Rationale: a 200 that a client treats as "approved" while evidence is missing
is a silent authorization-record loss — worse than a fail-closed 5xx.

## 5. Fail-closed handling

Deny (do not queue/retry as approval) on: missing/invalid/expired bearer token,
insufficient role or approval eligibility, unknown/expired/consumed approval id,
body over cap, rate-limit breach, ledger/store failure, origin-policy failure.
Lost connectivity client-side MUST
surface as unknown-outcome (client re-reads record state; never assumes
approval). `ApprovalWatcher`/scheduler tick consumes the decision through the
unchanged path.

Eligibility is fail-closed:

`authenticated ∧ approvals:decide ∧ activePrincipal ∧ workspaceScope ∧ approvalScope`.

`workspaceScope` requires an explicit match to the server's canonical workspace;
missing or empty scope is denied for SRAP even where other Inspector routes allow
an unscoped token. `approvalScope` derives from the existing project-local
ApprovalStore, approval binding, run/session/worker context, and ownership claims.
It introduces no independent approval-owner registry.

## 6. Origin and CSRF

- Bearer-token calls only; browser cookie authentication MUST be rejected for
  this route. Origin policy and rate limits remain defense in depth.
- No token or session material in push payloads, URLs, or logs (see §9).

## 7. Rate limits and transport

Reuse the existing pre-auth (per-IP) and post-auth (per-principal) limiters.

**Authentication-failure limiting (R1 — normative).** The ceiling counts
**failed authentication/authorization attempts only** — never a valid
authorized decision, never a transient server error (5xx), never a
store/evidence failure. It MUST be keyed to a trustworthy security context —
the authenticated principal (post-auth) and/or the source IP (pre-auth) — and
MUST NOT be stored as, or derived from, a field on the `ApprovalRecord`.
Concretely:

- An approval's `status` is never mutated by failed auth. Authentication-failure
  counters are separate state from approval-state transitions.
- Five failures from one principal/IP trigger a **temporary lockout with
  backoff** for that principal/IP, not permanent invalidation of the approval.
  The legitimate operator, presenting valid credentials from a different
  trusted context (or after the lockout window), can still decide; the
  approval becomes `expired` only via its own `expiresAt`.
- This prevents an unauthenticated attacker from exhausting an approval's
  eligibility and denying service to the operator (the R1 refinement).

Require TLS for non-loopback. Forwarded scheme/address headers count only when
the immediate peer matches an explicitly configured trusted-proxy CIDR.
Untrusted, conflicting, multi-valued, or missing forwarded scheme evidence
fails closed. The deployment MUST terminate TLS at that trusted proxy with a
valid certificate. No new crypto.

## 8. Lifecycle reuse (no new states)

`pending → approved/denied → consumed/expired` unchanged. No `claimed` /
`executing` states, no record versioning in SRAP-1. The approve→consume window
is narrowed by the existing `consumeApproved` checks (status + expiry +
bindingKey + worker, under lock) — §11 states what this does NOT prove.

## 9. Concurrency and idempotency

`resolve()` is lock-guarded and only transitions from `pending`, so concurrent
decides collapse to one winner. An exact retry returns authenticated idempotent
`200` only after repeating the same approval-specific authorization and matching
the committed principal, nonce, decision, and bounded request content.
Different principal, nonce, decision, or content returns `409`. Authentication
and authorization precede either response so terminal state is not disclosed.

## 10. BindingKey semantics (explicit non-strengthening)

`bindingKey` = SHA-256 over canonicalized
(run/worker/attempt/capabilities/ownershipClaims/requestFingerprint/policyRevision).
It is a **dedup hash, not an approval of exact executable arguments**: full
tool args are NOT in the digest, and `requestFingerprint` is free-form. SRAP-1
preserves current execution scope exactly and MUST NOT claim transaction
binding. Cryptographic action digests are a later milestone with their own
threat model and review.

## 11. What SRAP-1 does NOT stop (accepted residual risk)

Without passkeys/nonces-as-challenge/digests, SRAP-1 does not stop: a stolen
bearer credential (mitigated by short expiry + revocation + per-principal/IP
attempt ceiling, not by identity proof); operator
approving the wrong action after misreading the preview (mitigated by
full-evidence UI requirement, not cryptography); replay of a captured valid
request within its single-transition window (narrowed, not eliminated).
These are the documented reasons passkeys + digests follow — not reasons to
widen SRAP-1.

## 12. CLI-first contract revision (scoped — APPROVED wording)

`src/governance/approvals/AGENTS.md` currently: "Approvals are CLI-first. No
browser POST endpoints for write actions." **Approved** SRAP-1 amendment:
"Approvals are CLI-first. The single exception is
`POST /api/approvals/:id/decision`, bearer-only, restricted to an eligible
`operator|admin` principal with `approvals:decide`, trusted-proxy TLS validated,
rate-limited, and durably evidenced in the approval ledger; all
other approval writes stay CLI/TUI-local." Apply the amendment as part of the
implementation PR, not before.

## 13. Tests (required before merge of any implementation)

Positive-path: `decidedBy` == stable operator principal (never client value);
the authoritative ledger event contains transition + evidence; the audit
projection is produced or repaired; CLI/TUI parity remains.

Negative security tests (each MUST fail closed):
- **Authorization bypass:** anonymous, `readonly`, expired/revoked/rotated
  token, wrong-scope token → 401/403, no state change.
- **Loopback-dev bypass attempt:** remote decision without a valid token on a
  dev-posture server → rejected (bypass never applies to this route).
- **CSRF/auth surface:** every cookie-session decision is rejected; bearer with
  invalid origin metadata still follows the configured defense-in-depth policy.
- **Replay:** exact authorized same-principal/same-nonce/same-decision/content
  retry → `200` and one event; every conflicting retry → `409`.
- **Duplicate decisions:** concurrent approve/deny from two principals →
  exactly one winner, loser `409`.
- **Expiry:** decide on expired approval → `410/409`, no transition.
- **Cross-id:** decide a different approval than the one authorized → rejected.
- **Atomic failure (R2):** inject transaction failure → neither transition nor
  evidence/outbox commit.
- **Commit-before-ack (R2):** terminate after commit and before response; restart
  read-back proves one authoritative decision and exact retry reconciliation.
- **Projection failure:** JSONL failure never reverses ledger authority; existing
  repair infrastructure emits one audit record by `decisionId`.
- **SQLite settings:** reopen the real database and assert WAL plus the approved
  synchronous setting; do not infer the setting from a newly created handle.
- **Proxy spoof:** untrusted `X-Forwarded-Proto`, conflicting/multi-valued
  headers, and untrusted peer addresses fail TLS validation.
- **Concurrency:** N parallel decides under lock → one durable transition.
- **Attempt-limit (R1):** 5 failed auth attempts from one principal → lockout
  with backoff; a valid operator from another context can still decide; the
  `ApprovalRecord` is unchanged by failures.
- **Oversized body / rate-limit breach / origin failure / store failure** →
  fail-closed.

Extend `tests/architecture/r15-authorization.test.ts` + new
`srap-decide.test.ts`. Existing governance suites stay green.

## 14. Rollback and deployment

- Rollback: feature-flag the future route off (default-off until approved
  deployment); additive-only schema means rollback is a route toggle.
- Crash recovery: ledger replay reconstructs the decision and evidence together.
  Existing reconciliation/outbox infrastructure may repair a missing JSONL
  projection idempotently; it never replays an approval transition from audit.
- Deployment: daemon + reverse proxy with TLS; loopback-dev posture MUST NOT
  be used for remote access; token issuance/rotation/revocation via existing
  Inspector auth service; runbook entry for revocation propagation
  (effective next-request) and unknown-outcome client recovery.

## 15. Decisions and G2-B amendment status

1. **`approvals:decide`** — new least-privilege permission (NOT
   `coordination:execute`). ✅ approved
2. **AGENTS.md amendment** — narrow, explicit (§12 wording). ✅ approved
3. **Authentication-failure limiting** — configurable, default 5, keyed to
   principal/IP, **never permanently exhausting an approval** (R1). ✅ approved
4. **Deployment** — default-off, authenticated principal, enforced TLS. ✅ approved
5. **WebAuthn challenges** — deferred to the passkey milestone; replay,
   expiry, concurrency, idempotency safeguards RETAINED in SRAP-1. ✅ approved

Refinements folded in: R1 (§7), R2 (§4). Implementation plan: separate
document (Task C).

The five decisions above remain approved. G2-B additions are also approved:
one-ledger evidence, bearer-only auth, persistent operator identity in Inspector
auth, fail-closed workspace and approval scope, versioned HMAC credential
references, trusted-proxy validation, exact-retry `200`, `synchronous=FULL`, and
narrow DOX exceptions. G2-C independent review remains mandatory before G3.
