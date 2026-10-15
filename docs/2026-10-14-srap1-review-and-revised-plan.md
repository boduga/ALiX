# ALiX SRAP-1 — Independent Security Review and Revised Codex Plan

> **Dated hand-off record (`docs/AGENTS.md`), not a live contract.** Normative
> rules live in the owning `AGENTS.md` files and ADR-0015.

**Basis:** `2026-10-14-srap-1-contract-proposal.md`, `2026-10-14-srap-1-implementation-plan.md`, and the earlier `2026-10-14-srap-option-b-design.md` supplied in this conversation. **Review type:** document and architectural consistency review; repository implementation and line references have **not** been independently checked against current Git HEAD. **Status:** proposed amendments, not approved changes or implemented code.

## Executive decision

**Conditional GO for a G2 design spike; NO-GO for production endpoint implementation until the persistence and identity gates below are proven.** Preserve existing `ExecutionAuthorization`, `PolicyGate`, `ApprovalStore`, scheduler, and approval lifecycle. The proposed `approvals:decide` permission, default-off flag, and exclusion of passkeys/action digests are coherent with SRAP-1's limited scope.

## Findings (ranked)

| ID | Severity | Source | Finding | Required resolution |
|---|---|---|---|---|
| F1 | **Blocker** | Contract §4; Plan §5 | A `mutate()` lock serializes operations but does **not** make a separate audit append atomic with `approval.updated`. The phrase “same ledger-committing path” is only sufficient if both facts are one genuinely atomic durable commit. | Inspect storage implementations and crash semantics. Prefer a single durable event containing transition **and** required decision evidence, if the ledger schema/replay can support it. Otherwise design transactional outbox or explicit recovery protocol and return for review. Prove fsync/commit guarantees rather than assume append equals durable. |
| F2 | **Blocker** | Contract §4/§5; Plan §3 | “On any durability failure ... decision is treated as not-applied” is not always true. An append can commit and then throw/time out, or HTTP can fail after commit. | Treat uncertain outcomes as **unknown**, never automatically not-applied. Read back authoritative state by approval ID and correlate stable decision ID; never automatically retry as a new decision. |
| F3 | **High** | Contract §3; Plan M3 | A role is not a principal. Plan M3 proposes exposing role on `SecurityContext` to populate `decidedBy`, but role (`operator`) cannot identify the actual actor. | Trace authenticated token/session to a stable, unique, server-validated principal ID. If existing tokens are role-only and have no principal identity, design identity mapping/enrollment or block attributable remote decisions. Token ID is not automatically human identity. |
| F4 | **High** | Contract §6; Plan §4 | Cookie authentication has Origin/Host checks and SameSite but no explicit CSRF token or robust handling of missing Origin. Contract says “CSRF-resistant,” while plan relies on SameSite/Origin. | Prefer bearer-only for SRAP-1 to reduce surface, **or** specify fail-closed Origin + Fetch Metadata policy, trusted proxy handling, and anti-CSRF token for cookie requests. Test absent/null Origin and hostile subdomains. |
| F5 | **High** | Contract §9; Plan §2 | Client-generated `nonce` is described as single-use, yet first-seen recording, divergent-decision detection, and 409-on-all-retries are underspecified. A nonce alone is not an authentication or replay proof. | Define bounded nonce syntax, uniqueness scope, durable association with a committed `decisionId`, and duplicate/unknown-outcome semantics. Keep single transition authoritative. No cryptographic challenge claim. |
| F6 | **High** | Contract §7; Plan M9 | “Five failures per IP/principal” can still lock out users behind shared NAT or an attacker who knows an operator identifier; proxy-derived IP can be spoofed if trust is misconfigured. | Use existing rate-limit infrastructure, trusted peer IP only, short backoff, and separate coarse pre-auth from authenticated-principal buckets. Avoid global principal lockouts triggered by anonymous traffic. Define expiry/reset, cardinality caps, and observability. |
| F7 | **High** | Contract §2; Plan M1–M5 | The proposed handler flow “load pending → resolve” is race-prone unless `resolve()` performs the authoritative status/expiry/ownership checks under its existing lock. Endpoint-level checks are advisory only. | Put all decisive checks inside the atomic mutation boundary. Document actor authorization to the **specific approval**, not merely global `operator/admin` permission; verify tenant/run scope where applicable. |
| F8 | **Medium–High** | Contract §4; Plan §2 | Adding token IDs, nonce, reason, and User-Agent to full-record ledger events risks data minimization, log leakage, and unbounded input. “Audit record” vs “ledger event” remains ambiguous. | Specify mandatory minimal durable evidence schema, validation, length caps, token ID redaction/hash policy, retention, and which store is authoritative. Never store raw bearer secrets or arbitrary user-agent strings unbounded. |
| F9 | **Medium** | Plan §7–§9 | “G4 post-merge soak” versus “do not enable by default” is coherent only if test deployment is controlled. Rollback by flag cannot undo already committed decisions. | Separate code deployment, limited opt-in enablement, general enablement. State rollback stops **new** remote decisions; existing decisions remain effective subject to existing revoke/consume semantics. |
| F10 | **Medium** | Contract §13; Plan §6 | Test matrix names audit-failure and crash tests but lacks explicit durable-commit fault points and process restart/replay assertions. | Add fault injection at before append, partial write, after append/before acknowledgment, after commit/before response, restart, duplicate request, and mixed approve/deny races. Verify exactly one authoritative transition and evidence. |
| F11 | **Medium** | Contract §2; Plan §3 | `409` with current status can reveal sensitive approval state to a credential with general permission but insufficient record scope. | Verify record-level authorization before exposing status/details; use non-enumerating 404/403 where appropriate. |
| F12 | **Medium** | Contract §11; Option B design §§1–4 | Original Option B design requires exact-action digest, WebAuthn, and claimed/executing states. SRAP-1 intentionally omits them. This is a **scope distinction**, not an implementation contradiction, but risks confusing future readers. | Label Option B as target-state vision and SRAP-1 as explicitly limited transport milestone. Do not present SRAP-1 as phone-biometric approval or cryptographic transaction authorization. |

## Corrected G2 persistence contract

**Invariant:** An authoritative remote approval transition must never be durably committed without the mandatory identity-attributed decision evidence needed to reconstruct and audit it. A `200` may be returned only after that joint durable fact is confirmed. Failure to confirm does not imply non-commit; report an **unknown outcome** and require read-back.

**Preferred investigation:** determine whether `approval.updated` can itself be the authoritative, atomic, append-only decision-evidence fact by embedding a validated, minimal `remoteDecisionEvidence` object in that **same event**. If so, one event append (with verified durability/replay guarantees) may satisfy coupled persistence without a second audit write in the critical path. The existing auxiliary audit projection may be derived/reconciled from the authoritative event; verify whether policy requires a separate independently durable audit sink. If yes, a single-event approach alone is insufficient: stop and propose a transactional/outbox design.

**Acceptance:** Demonstrate durability on the actual filesystem/storage path, including restart recovery and the ambiguous-commit window. Do not assume a lock, successful `write()`, or event emitter acknowledgment equals a durable atomic transaction.

## Corrected identity and security contract

1. Require authenticated, unique `principalId` established server-side and bound to an active credential/session; `role` and `tokenId` are distinct fields. If a role-only token cannot establish actor identity, block SRAP-1 decision access until identity is defined.
2. `approvals:decide` is necessary, not sufficient: also check scope over the target approval and avoid information disclosure on failures.
3. Prefer **bearer-token-only** for initial endpoint. Cookie sessions require a separate explicit CSRF specification and tests before enabling.
4. Derive IP only from trusted proxy configuration; separate IP-based abuse controls from authenticated principal throttling. Five failed auth attempts trigger temporary, bounded backoff, never approval invalidation.
5. Use a client nonce as an idempotency correlation value only; the server remains responsible for single-transition checks and durable decision identity. Do not claim nonce is cryptographic authorization.
6. Keep default-off flag and TLS enforcement; fail closed on missing/ambiguous reverse-proxy TLS evidence. Never permit loopback development auth bypass on the route.

## Dependency-ordered implementation plan

### Gate G2-A — repository verification (read-only)

- Inspect current HEAD and source of truth for approval persistence, ledger append, replay, audit append, token/session identity, route permissions, origin/CSRF, trusted proxy, and lock semantics.
- Map exact transaction boundary and distinguish append success, flush, fsync, and crash recovery.
- Produce source-cited evidence for each finding. If storage semantics differ from document assumptions, update contract before coding.

### Gate G2-B — durable evidence proof (small isolated spike)

- Write a minimal test-only proof of atomic **transition plus evidence** using the existing ledger if possible.
- Inject failures at all commit boundaries and restart/replay; show invariant holds.
- If separate audit persistence is mandatory, produce a design choice (single-ledger authoritative fact + audit projection vs transactional outbox vs ordered-write/reconciler), with failure tables. **Do not proceed without operator approval of a revised G2 design.**

### Phase SRAP-1A — identity, permission, and policy

- Define unique server-derived principal identity and record-level authorization; add `approvals:decide` to closed permission vocabulary and route policy.
- Add a default-off feature flag and hard denial of loopback-dev bypass.
- Define trusted proxy/TLS and bearer-only posture (or separately approve cookie CSRF design).
- Tests: role/permission matrix, cross-record scope, credential rotation/revocation, missing identity, proxy spoofing, flag-off.

### Phase SRAP-1B — approval decision domain

- Extend `ApprovalStore.resolve()` **additively**, under existing lock, with validated remote decision evidence and unique correlation ID.
- Preserve CLI/TUI behavior and historical event replay. No new state machine or scheduler.
- Ensure non-pending/expired/consumed checks are authoritative inside the mutation.
- Tests: schema compatibility, concurrent conflicting decisions, replay, crash recovery, audit projection.

### Phase SRAP-1C — remote API and abuse controls

- Add only `POST /api/approvals/:id/decision`, strict JSON schema and size limits, server-derived identity, trusted transport, scope checks, and controlled failure responses.
- Add bounded rate limits and nonce/idempotency rules without changing approval eligibility.
- Tests: 401/403/404/409/410/413/429, CSRF if cookies allowed, missing Origin, unknown outcome, stale credentials, log hygiene.

### Gate G3 — independent security review

- Verify negative tests and mandatory evidence; inspect any bypass of `PolicyGate`, `ExecutionAuthorization`, or existing consume path.
- Verify no claim of full-argument transaction binding and no self-approval or direct execution permission.
- Require passing architecture, governance, integration, unit, and supply-chain checks.

### Gate G4 — controlled rollout

- Deploy default off; enable only for authenticated test operator behind trusted TLS reverse proxy.
- Perform restart/unknown-outcome/rollback drills. Confirm decisions appear in CLI/TUI/Inspector.
- Disable the endpoint to roll back **future remote writes**, without pretending to undo committed approvals.
- Require explicit go/no-go before wider enablement.

## Codex CLI handoff (copy verbatim)

> Review the three SRAP documents and `2026-10-14-srap1-review-and-revised-plan.md`. Treat the approved security contract as normative except where the review identifies contradictions requiring explicit amendment. Start with **G2-A read-only verification** against current main. Prove the actual ledger, audit, and filesystem commit boundaries; determine whether one authoritative `approval.updated` event can atomically include required decision evidence, and whether a separate audit sink is mandatory. Verify unique authenticated principal identity (not merely role/token ID), record-level authorization, reverse-proxy TLS, CSRF/cookie posture, and nonce semantics. Produce a source-cited decision record, failure-state table, and exact contract redlines. Do not change production code, create a second authority, or implement the endpoint. Stop if atomicity or identity cannot be demonstrated. After review approval, perform only a small isolated G2-B durability test spike; keep G3/G4 closed.

## Proposed document redlines

- Contract §4: replace “on any durability failure ... decision is treated as not-applied” with “if durability cannot be confirmed, outcome is unknown; the client must query authoritative state; retries must not create a second decision.”
- Contract §4 and Plan §5: qualify Option (a) as **one atomic durable event/transaction**, not merely two writes under a lock.
- Contract §3 and Plan M3: require `principalId` independent of `role` and `tokenId`.
- Contract §6 and Plan §4: specify bearer-only SRAP-1 by default, or a separate cookie-CSRF contract.
- Contract §9: define `nonce` as correlation/idempotency metadata, not a cryptographic replay challenge; require durable correlation and bounded validation.
- Plan §8: flag rollback disables new remote decisions, not already committed decisions.
- Plan §9: split G2 into source-verification and proof gates; G3/G4 remain closed until verified.

## Evidence limits

This review checks the supplied documents and their internal claims. It **does not establish** that referenced source lines, Git HEAD, CI results, ledger atomicity, identity mapping, or proxy behavior match the current repository. Those are explicit G2-A verification tasks, not facts inferred from document text.
