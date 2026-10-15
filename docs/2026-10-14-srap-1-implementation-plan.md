# SRAP-1 — Implementation Plan (planning only; no production code)

> **Dated hand-off record (`docs/AGENTS.md`), not a live contract.** Normative
> rules live in the owning `AGENTS.md` files and ADR-0015; where they differ,
> those win.
>
> Status: **Independent G2-C review BLOCKED; not SRAP endpoint implementation.** Reconciled
> against `main` @ `2c73b044`. G2-B durability remediation is green; G3 remains
> blocked pending independent review and performance-risk acceptance.
>
> **G2-E reconciliation (2026-10-14):** the live normative rules now live in the
> owning DOX, not in this planning draft — `src/governance/approvals/AGENTS.md`
> (eligibility predicate), `src/governance/audit/AGENTS.md` (projection + chain
> crash window), `src/governance/security/credentials/AGENTS.md` (HMAC key
> lifecycle), `src/interfaces/server/AGENTS.md` (canonical workspace identity),
> `src/runtime-state/storage/AGENTS.md` (WAL + FULL). Where this plan differs,
> those contracts win. See `docs/2026-10-14-srap-g2-e-operational-verification.md`.
>
> Contract governs; where this plan and the contract differ, the contract wins.

## 0. Scope

One new mutating route, `POST /api/approvals/:id/decision`, through the existing
`ApprovalStore` → `ExecutionAuthorization` authority. No new authority,
scheduler, state, or execution permission. No passkeys/digests (later milestone).

Approved boundary:

```
Authenticated remote client (operator identity · TLS · request protections)
        ↓
Inspector API  (approvals:decide · validation · rate limits)
        ↓
Existing ApprovalStore  (decision persistence · principal attribution · evidence)
        ↓
Existing ExecutionAuthorization / PolicyGate  (policy revalidation · consume)
```

## 1. Modules to modify (exact)

| # | File | Change | Why |
|---|------|--------|-----|
| M1 | `src/governance/security/inspector/route-policy.ts` | Register route `api.approvals.id.decision` (POST, `pattern`, `auth:"authenticated"`, `permission:"approvals:decide"`, `routeClass:"data"`) | route table drives middleware authz |
| M2 | `src/interfaces/server/security-middleware.ts` | `derivePermissions()`: add `"approvals:decide"` to **admin** and **operator**; NOT `readonly` | least privilege; closed vocabulary |
| M3 | `auth-store.ts`, `auth-service.ts`, `security-context.ts`, Inspector auth CLI | add persistent operator records; bind credentials to stable `principalId`; expose separate credential identity, role, permission, explicit workspace scope; add enroll/disable lifecycle | server-derived attribution + record authorization |
| M4 | `src/interfaces/server/approval-routes.ts` (NEW) | bearer-only handler: authenticate → authorize approval scope → validate → rate guard → resolve → authoritative read-back/retry response | the only new surface |
| M5 | `src/interfaces/server/server.ts` | wire `handleApprovalRoutes(...)` into the dispatch chain (alongside `registerCoordinationRoutes`) | route registration |
| M6 | `src/governance/approvals/approval-store.ts` | `resolve()` accepts validated remote evidence; inside the existing lock enforce pending/expiry/eligibility/retry equality and append one full-record event | §3/§4/§9 |
| M7 | `src/governance/approvals/approval-types.ts` | add optional bounded `remoteDecisionEvidence` object to `ApprovalRecord` | additive schema |
| M8 | `src/governance/approvals/AGENTS.md` | apply the approved §12 contract amendment | governance contract |
| M9 | existing server rate-limiter integration | key temporary failure buckets by trustworthy source IP and authenticated principal; never approval state | §7 |
| M10 | `approval-ledger-reconcile.ts` + existing audit writer/startup hook | attempt projection inline; compare committed evidence to JSONL by `decisionId`; idempotently repair missing rows and report duplicates/lag. Do not claim current outbox is consumed | recoverable projection |
| M11 | `src/interfaces/server/remote-access-policy.ts` + shared trusted-proxy address logic | accept forwarded TLS evidence only from configured trusted proxy; reject ambiguous headers | remote TLS boundary |
| M12 | `src/runtime-state/storage/runtime-ledger.ts` | completed G2-B remediation: every connection pins and verifies WAL + `synchronous=FULL`; retain diagnostic seam | power-loss durability gate |

Existing single-worker seams confirmed: `SecurityContext` (`security-context.ts:25`),
`derivePermissions` (`security-middleware.ts:461`), route registry
(`route-policy.ts:640`), `ApprovalStore.resolve` (`approval-store.ts:623`).

## 2. Data / schema migrations

- **Additive only.** No new store, no new ledger, no state machine.
- `ApprovalRecord` keeps `decidedBy` and adds one optional bounded
  `remoteDecisionEvidence` object: `decisionId`, `principalId`, `credentialRef`,
  `decision`, `nonce`, `decidedAt`, `transport:"bearer"`, and bounded `reason?`.
- Ledger compatibility: `approval.updated` already carries the full
  `ApprovalRecord` payload (R2.5), so new optional fields flow without an event
  schema bump. No migration script; legacy records read as `undefined`.
- No approval-record `schemaVersion` bump: additive optional fields are
  backward-compatible. Auth-store format needs its own explicit versioned reader.

Inspector auth migration is additive but explicit:

- Extend existing auth-store schema with persistent operator records
  (`principalId`, display label, status, workspace scopes, created/disabled
  timestamps) and add `principalId` to credential records.
- Enrollment/disablement is CLI-administered and audit-fail-closed. No remote
  self-enrollment and no approval-specific user authority.
- Rotation copies `principalId`; credential revocation leaves principal active;
  principal disablement invalidates every bound credential on next verification.
- Legacy credentials remain valid for existing non-SRAP behavior but are denied
  SRAP until explicitly bound to an active operator. Migration never infers a
  human identity from token name, role, or token ID.
- Versioned HMAC keys use existing restricted credential-store references. Old
  key versions remain readable through approval retention, then may be retired.

## 3. API and permission changes

- **Route:** `POST /api/approvals/:id/decision`, body `{ decision:"approve"|"deny",
  reason?, nonce }`, ≤16KB JSON cap.
- **Permission:** `approvals:decide` (new) — granted to `operator`+`admin`.
  Explicitly NOT `coordination:execute`, NOT `readonly`.
- **Responses:** `200` new durable decision or exact authorized retry; `401/403`
  auth/authz without approval-state disclosure; `409` conflicting retry or
  terminal conflict; `410` authorized expired record; `413` oversize; `429`
  rate/lockout; `5xx` fail-closed durability failure.
- **Loopback-dev bypass:** the handler MUST re-check `ctx.authenticated` for this
  route regardless of global dev posture; anonymous remote decisions rejected.

## 4. Security controls

- TLS required for non-loopback (`requireTlsForRemote`, `server.ts:145`).
- Bearer authentication only; cookie/session authentication is rejected.
- Forwarded HTTPS counts only from a configured trusted-proxy CIDR. Reject
  untrusted, conflicting, multi-valued, or missing forwarded scheme evidence.
- Reuse `client-address.ts` CIDR parsing and bounded chain syntax, but add a
  strict SRAP verdict: immediate peer must be trusted; `X-Forwarded-Proto` must
  contain exactly one `https`; walk `X-Forwarded-For` right-to-left and require
  every proxy hop to be trusted. Malformed, overlong, or ambiguous chains deny
  instead of falling back to the socket peer.
- Record-level eligibility is checked before record state is returned or changed.
- Eligibility is exactly `authenticated ∧ approvals:decide ∧ activePrincipal ∧
  workspaceScope ∧ approvalScope`. SRAP requires an explicit canonical-workspace
  match; missing/empty/ambiguous scope denies. Approval scope derives from the
  existing project store, binding, run/session/worker context, and ownership
  claims—no separate approval ownership authority.
- `decidedBy` = stable `ctx.principalId`; NEVER request input. Reason is bounded.
- `credentialRef` is versioned HMAC-SHA-256 over credential record ID. HMAC keys
  stay in the existing restricted credential store; raw tokens/IDs never enter
  decision evidence. Rotation retains old key versions through evidence retention.
- R1: auth-failure counter keyed to principal/IP, separate from `ApprovalRecord`;
  5 failures → temporary lockout with backoff; approval stays `pending` (never
  invalidated by failures); transient 5xx not counted.
- R2: no `200` before evidence durable (§5).
- Deny precedence and `consumeApproved` checks unchanged.

## 5. Durable evidence ordering (R2) — selected design

One `approval.updated` event carries the transition and validated evidence.
`RuntimeLedger.append()` atomically commits the event, entity version, and
existing outbox row. JSONL audit is an idempotent projection from the committed
event, repaired by existing infrastructure; it is never an authority.

G2-B remediation pins and verifies WAL + `synchronous=FULL` on every ALiX ledger
connection. Four durability probes pass. Benchmark (3 × 250 sequential commits,
workspace filesystem): 279.7 → 14.0 writes/s; 3.59 → 76.86 ms/write. Warm FULL
rounds reached 16.4 writes/s / 61 ms. G2-C must accept or mitigate this cost
without weakening durability. ADR:
`docs/architecture/adrs/ADR-0015-srap-one-ledger-decision-evidence.md`.

Audit projection recovery contract:

1. After authoritative commit, attempt one JSONL append using `decisionId` as
   idempotency key; projection failure never changes approval outcome.
2. Extend existing approval reconciliation to scan ledger remote evidence and
   audit rows, report missing/duplicate IDs and projection lag, then append only
   missing rows through the existing locked/hash-chained `AuditStore` path.
3. Run repair at Inspector startup and explicit CLI reconcile; retry failures on
   next startup/reconcile without a new scheduler.
4. Add an atomic check-and-append seam in the audit owner so concurrent inline
   and recovery attempts cannot duplicate a `decisionId`.
5. **Crash consistency is chain-anchored.** The dedup index and checkpoint are
   advisory; recovery re-derives from `verifyIntegrity()` plus a bounded ledger
   scan. A checkpoint must never advance past evidence present in the verified
   chain. Implements the audit-DOX invariant and repairs the known audit-chain
   stale-head window (`src/governance/audit/AGENTS.md`; repro
   `scripts/probe-audit-chain-crash.mjs`).
6. Current generic outbox `delivered_at` is not multi-consumer projection state
   and has no production consumer. Do not mark it delivered for SRAP or claim it
   provides retries unless a separately reviewed multi-consumer design exists.

## 6. Test coverage

- New `tests/server/srap-decide.test.ts` (positive + all negative cases from
  contract §13: authz matrix, loopback-bypass attempt, CSRF/origin, replay,
  duplicate/concurrent, expiry, cross-id, audit-failure, attempt-limit,
  oversize, rate-limit, store-failure).
- Extend `tests/architecture/r15-authorization.test.ts` (boundary unchanged).
- Extend `tests/approvals/approval-store.test.ts` (attribution + evidence order).
- Extend `tests/governance/` security suite for the new permission vocabulary.
- `tests/storage/srap-approval-durability.test.ts`: transaction rollback,
  commit-before-ack kill, restart/read-back, WAL and synchronous gate.
- Proxy regression table: direct TLS, trusted proxy HTTPS, spoofed untrusted
  forwarding, conflicting/multi-valued headers, and missing scheme.
- Authorization parity table: role × workspace/owner eligibility × state ×
  retry identity, broader than handler implementation cases.
- Parity: remote decision visible via CLI (`alix approvals`) and Inspector GET.

## 7. Feature-flag rollout

- New config flag (default **off**), e.g. `config.approvals.remoteDecision`.
  When off, the route returns `404`/`403` and is not advertised.
- Rollout after G4 only: off → bearer-only loopback verification → trusted-proxy
  canary with one eligible operator principal → general. No data migration.

## 8. Rollback

- Toggle the flag off → route inert; additive fields remain readable, ignored.
- No migration to reverse. Projection repair is additive and safe to leave
  running; it must not replay approval transitions.

## 9. Independent review gates

- **G2-A** Architecture/persistence verification complete at `2c73b044`.
- **G2-B** Complete: approved contract direction, FULL configured, four probes
  green, DOX exceptions prepared. Performance cost recorded.
- **G2-C** Independent plan review pins exact modules, migration compatibility,
  test matrix, rollout, and rollback. No unresolved ownership exceptions.
- **G3** Implement behind default-off flag. Independent security review requires
  authorization parity, bearer rejection cases, replay/concurrency, proxy spoof,
  transaction/crash, audit-repair, and existing governance suites green.
- **G4** Validate in a trusted-proxy canary: restart/read-back, projection repair,
  revocation propagation, metrics, feature-off rollback, then deployment approval.

## 10. Unresolved security risks (carried from contract §11)

- No cryptographic exact-action binding while `bindingKey` is dedup-only
  (explicitly not claimed).
- Stolen bearer credential: mitigated by short expiry, revocation, eligibility,
  and lockout; not eliminated — stronger authenticators are later work.
- Operator misreading the preview: UI/evidence requirement, not crypto.
- FULL sequential-commit throughput dropped ~95% in local workspace benchmark;
  supported-storage behavior and batching opportunities need review.
- Persistent operator schema and legacy-token enrollment require additive auth
  migration; unbound legacy tokens must be ineligible for SRAP.
- JSONL projection repair is specified but not implemented; current outbox has no
  production consumer. G3 must add idempotent detection/repair and observability.

## 11. Estimated complexity

- **Small–medium.** ~M1–M5 is routine route+permission wiring (1–2 days);
  M6/M7 attribution+evidence and M9 R1 locking are the real work (2–3 days);
  negative test matrix (M—tests) is substantial (2–3 days). Total ≈ **1–1.5
  weeks** for one engineer with review gates, excluding passkey follow-on.
- Risk concentration: M6/M9 (durability + lockout correctness), both squarely
  testable.
