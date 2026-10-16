# SRAP-1 G3 — remote approval decision endpoint (implementation plan)

Status: **G3 OPEN (2026-10-16).** Workstreams **A and B are implemented**; **C is
BLOCKED** on a missing principal-identity subsystem (see "Execution status"
below). Remote decisions remain disabled. No route exists yet.

**Owning contracts (normative; this plan implements them, never overrides):**
- `src/governance/approvals/AGENTS.md` — eligibility predicate + parity requirement
- `src/interfaces/server/AGENTS.md` — canonical workspace identity, the sole
  browser write exception
- `src/governance/audit/AGENTS.md` — projection crash-consistency + mechanics
- `src/governance/security/credentials/AGENTS.md` — `srap-evidence` HMAC lifecycle
- `docs/architecture/adrs/ADR-0015-*.md` — one-ledger decision evidence
- `docs/2026-10-15-srap-p5-g2c-rereview.md` §7 caveat 3 — the forward items

## Execution status (2026-10-16)

- **A — HMAC `srap-evidence` lifecycle:** DONE (`feat(credentials): add
  srap-evidence versioned HMAC key lifecycle`; 12 tests).
- **B — audit-owned idempotent projection:** DONE (library) — `feat(audit): project
  remote approval decisions into the audit chain`; 10 tests; plus
  `RemoteDecisionEvidence` + `ApprovalStore.resolveWithEvidence`. **Deferred to
  C:** the inline attempt after commit, the bounded startup/operator repair
  trigger, and alert wiring. They are only reachable once the route commits a
  decision, so B lands as the callable projector and C adds the triggers.
- **C — the route:** BLOCKED. The eligibility predicate and evidence require a
  stable `principalId` separate from credential identity (G2-C review §3;
  approvals/credentials contracts). **No persistent operator/principal store
  exists** — `StoredToken` is credential-only and `SecurityContext` carries no
  `principalId`. Using `tokenId` as `principalId` is rejected (breaks identity
  continuity across rotation). C waits on a dedicated **A′ principal-identity**
  workstream (design + plan, separate PR); do not start C until A′ is reviewed.


## Goal

Add exactly one default-off, non-executing browser route — `POST
/api/approvals/:id/decision` — that resolves a pending approval through the
existing `ApprovalStore`, carrying authenticated remote-decision evidence into
the authoritative `approval.updated` ledger event. No new approval authority,
ledger, scheduler, state machine, or execution path.

## Verified current surfaces (checked at `faac184d`)

| Surface | State |
| --- | --- |
| `ApprovalStore.resolve(id, status, reason)` (`approval-store.ts:623`) | ledger-authoritative; resolves only a `pending` record; emits `approval.resolved`. **No evidence param today** — must be extended. |
| `ApprovalStore.mutate()` (`:269/:286`) | appends the classified diff to `runtime-ledger.db` inside the lock; append failure throws. |
| `routeRegistry` (`route-policy.ts:194`) | a module-level `RoutePolicyRegistry`; descriptors registered top-to-bottom. |
| server route dispatch (`server.ts:475`) | `if (url.pathname === "/api/approvals")` — approval reads exist; **no decision POST**. |
| `approvals:decide` permission | **does not exist**; `derivePermissions` grants only `approvals:read` today. |
| `SecurityContext.workspaceIds` | present (P3); `verifyTokenForRequest` wired. |
| HMAC `srap-evidence` keys | **no code** — contract only. |
| audit projection (`decisionId` dedup + checkpoint) | **no code** — contract only; `runtime_outbox` exists but has no production consumer. |
| trusted-proxy CIDRs / client-address | `client-address.ts`, `remote-access-policy.ts` exist. |

## Workstreams

Three separable pieces. Each is independently reviewable; the route composes them.

### A. HMAC `srap-evidence` lifecycle (`src/governance/security/credentials/`)

- New module: generate/activate/rotate/retire versioned keys in the CredentialStore
  namespace `srap-evidence`, label `hmac-key:v<N>` (32 random bytes).
- `credentialRef = hmac-sha256:v<N>:<base64url(HMAC(key_vN, credentialRecordId))>`.
- Sign only with the active version; keep old versions resolvable while retained
  approval evidence may reference them. Retirement has **two gates**: eligibility
  (inactive + no retained reference; retention is count-based, so the caller
  supplies the retained-reference count) and explicit operator execution —
  never automatic.
- **Fail-closed:** active key unavailable → no decision committed.
  Retired-version ref → reported unverifiable, never accepted, never a reversal.
- Key material is reachable only through audited `sign`/`verify` accessors whose
  `audit` sink is **mandatory**; no second secret authority; HMAC computed in the
  owning subsystem, not the store.
- Tests: generation/rotation overlap/retirement gates/fail-closed/mandatory audit/
  unverifiable-old-ref.

### B. Audit-owned idempotent projection (`src/governance/audit/`)

- Read committed `approval.updated` remote evidence; project one-way into the
  audit chain, keyed idempotently by `decisionId`.
- Dedup index + projection cursor (last projected `ledger_seq`), written
  atomically together; re-scan overlaps by a bounded window.
- Crash consistency: the cursor MUST NOT advance past evidence provably present
  in the **verified** chain (P1's `reconcileHead` makes the chain a sound anchor);
  missing/duplicate `decisionId` re-derived by `verifyIntegrity()` + bounded scan.
  An `approval.updated` presenting evidence that fails validation is a
  **projection failure** (counted, cursor held) — never a silent skip.
- Inline: one attempt after the authoritative commit (failure never changes the
  approval outcome). Repair: bounded startup trigger + operator command; retry on
  next trigger; no new scheduler.
- Counters: `projected` / `skipped_duplicate` / `projection_failed`; lag =
  ledger high-water `ledger_seq` − cursor; alert on lag growth / duplicate /
  chain-verify failure.
- **Never** mark the generic `runtime_outbox.delivered_at` as projection state.
- Tests: idempotent re-run, crash-before-checkpoint overlap (absent AND stale
  cursor), duplicate drop, malformed-evidence refusal, corrupt-chain refuse, lag
  before/after.

### C. The route + evidence plumbing

1. **Permission.** Add `approvals:decide` and grant it to `admin` + `operator`
   only (not `readonly`) in `derivePermissions` (`security-middleware.ts:474`).
   Contract + `tests/server/derive-permissions.test.ts` parity.
2. **Route descriptor.** Register `POST /api/approvals/:id/decision`, `auth:
   "authenticated"`, `permission: "approvals:decide"`, `routeClass: "data"`.
   `tests/server/route-coverage.test.ts` enforces registration.
3. **Eligibility predicate** (verbatim from the contract):
   `authenticated ∧ token.permissions ∋ approvals:decide ∧ principal active ∧
   canonicalWorkspace(server) ∈ token.workspaceIds (explicit, nonempty) ∧
   approval.status == "pending" ∧ approval.expiresAt > now`. Scope read from
   `SecurityContext.workspaceIds`; a request never sets it.
4. **Evidence + resolve.** Build `remoteDecisionEvidence {decisionId, principalId,
   credentialRef, decision, nonce, decidedAt, transport}`; extend
   `ApprovalStore.resolve` (or a sibling `resolveWithEvidence`) to write it into
   the same ledger commit as the transition. Raw bearer tokens/cookies/credential
   IDs are forbidden in evidence.
5. **Idempotency.** Exact retry (same principal/nonce/decision/content) re-runs
   auth + scope + eligibility, then returns `200`; conflicting retry → `409`
   with no state disclosure. Authorize **before** any state disclosure.
6. **Ordering.** Attempt the audit projection inline after commit; a projection
   failure never changes the outcome. Acknowledge success only after the
   authoritative append returns.
7. **Trust transport.** Trust forwarded TLS/client address only from configured
   immediate-peer proxy CIDRs; parse one unambiguous HTTPS scheme + validated
   address chain; fail closed. Direct TLS remains valid.
8. **Default-off.** The route is registered but disabled unless an explicit
   config flag enables it.

## The parity table (non-negotiable; blocks the PR)

Ship `tests/approvals/remote-decision-parity.test.ts` broader than the handler —
**role × workspace scope × approval state × exact-retry identity** — with, at
minimum: allow (active operator/admin with scope); deny anonymous, `readonly`,
missing `approvals:decide`, revoked/disabled principal, cross-workspace,
missing/empty scope, cross-record, expired/decided, conflicting retry,
loopback-dev without token, cookie session. Model on
`tests/ownership/path-scope.test.ts`. The contract states this is a requirement,
not an implemented claim.

## Sequencing and gates

1. A (HMAC lifecycle) — standalone, testable, no route.
2. B (audit projection) — standalone, testable, no route.
3. C (route) — composes A + B; not mergeable without the parity table.
4. Independent review of the composed route before merge (same discipline as P5).

Each step: impact-analyze before edits; `detect-changes` before commit; clean
build + focused tests; owning-contract updates in the same change.

## Explicitly out of scope

- Any execution route or execution authority.
- Group commit / latency work (ADR-0016 keeps it separate).
- Power-loss durability testing (P5 §7 caveat 2; hardware).
- Widening any other browser write surface.
- A per-approval principal grant or per-agent/per-run operator ownership.

## Open questions — RESOLVED before G3 opened

1. Config flag name + default for enabling the route → `inspector.remoteDecisions.enabled`, **default false**.
2. Approval-retention window (bounds HMAC-key retirement) → retention is **count-based** (`maxTerminalRecords`, default 1000); there is no wall-clock window, so key retirement is an explicit operator action behind the two gates above.
3. Whether exact-retry identity includes request body bytes or only
   `{principalId, nonce, decision}` → **only `{principalId, nonce, decision}`** (`remoteDecisionRetryKey`).
4. Startup repair trigger timing (server boot vs first request) → **server boot**, plus an explicit operator command (both land with C).
