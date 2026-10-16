# SRAP-1 G3-A′ — principal identity implementation plan

Status: **SHIPPED (as-built record).** Implemented per rev 3; see
`src/governance/security/inspector/AGENTS.md`. G3-C (remote decision route)
remains blocked.

**Spec:** `../specs/2026-10-15-srap-g3a-prime-principal-identity-design.md`

**Goal:** a stable, server-generated operator `principalId` that survives
credential rotation, is separate from credential identity, whose disablement
denies **all** authentication for bound credentials — without a second credential
authority, and with real cross-process serialization.

**Boundary:** the principal store owns operator identity/status; `auth-store.ts`
keeps owning credential verification/revocation **and is the single authority for
the credential→principal binding** (`StoredToken.principalId`).

## Rev 3 — how each required amendment is discharged

| # | Required change | Where |
| --- | --- | --- |
| 1 | Bound credentials fail **all** authentication when the principal is disabled/missing/unverifiable; only unbound legacy keeps ordinary access | §Auth decision matrix; T7; T8 |
| 2 | Cross-process-safe read-modify-write for **both** stores; re-read **after** the lock; documented lock ordering | §Concurrency contract; T1; T2; T3 |
| 3 | Authentication-audit ordering, failure acknowledgement, crash/partial-write behavior; no success without audit evidence | §Mutation + audit durability; T4; T5; T6; T9 |
| 4 | Revocation **preserves `StoredToken.principalId`** for historical attribution | §Revocation preserves identity; T6 |
| 5 | Migration races vs rotation, revocation, disablement, **and concurrent migration**; deterministic outcomes, no stale-snapshot overwrite; `--principal` status-check commit boundary | §Migration race contract; T9 |
| 6 | Owning AGENTS.md contracts + parity/concurrency/crash test matrix | T10 |

## Global constraints

- No second secret/token authority; principals hold no secrets.
- Do not cache principal status in tokens/sessions — read fresh at auth time.
- `principalId` is never a credential id and never derived from one.
- **Revocation removes authentication eligibility, never the identity binding**;
  `principalId` survives on a revoked credential for historical attribution.
- Legacy tokens: absence of `principalId` is valid for ordinary authentication but
  invalid for any principal-required capability; **no implicit identity
  substitution**; no global auth cutover.
- Every read-modify-write is serialized by the shared cross-process lock
  (`src/governance/security/audit/audit-lock.ts`); lock order **principal →
  token**; **authoritative state is re-read after acquiring the lock**.
- Every mutation is a **revision CAS** under the lock; no lost updates.
- Auth mutations are **write-ahead audited**; no unaudited mutation; a failed
  audit write is never acknowledged as success; no cross-file transaction claimed.
- Preserve all existing role/permission/workspace semantics and tests.
- Every step: GitNexus `impact` before edits; `detect-changes` before commit;
  clean build + focused tests; owning-contract updates in the same change.

## Auth decision matrix (binding on T7/T8)

The critical distinction is between **no principal binding** and **a binding whose
principal cannot be verified**:

| Credential | Ordinary Inspector | Principal-required operation |
| --- | --- | --- |
| unbound legacy credential | existing access policy | **deny** |
| bound to active principal | existing access policy; `SecurityContext.principalId` set | eligible |
| bound to disabled principal | **deny** | **deny** |
| bound to missing principal | **deny** | **deny** |
| bound, principal store unavailable | **deny** | **deny** |
| revoked credential | **deny** | **deny** |

A bound credential never falls back to ordinary access; only a genuinely unbound
legacy credential does.

## Concurrency contract (binding on T1/T2/T3)

- `AuthStore` and `PrincipalStore` each take a cross-process lock for the whole
  read-modify-write: `<authStateDir>/auth-store.lock`, `<authStateDir>/principals.lock`.
- **Re-read authoritative state after acquiring the lock** — never mutate from a
  snapshot taken before the lock.
- **Lock order: principal → token**, never reversed; release in reverse. An
  operation needing both takes principal first.
- Stale/held lock → **fail closed** (`staleRecovery: "manual"`), no write.
- `revision` CAS: assert expected revision under the lock, write `+1`; mismatch
  refused.
- Concurrency tests use **separate store instances** (and, where feasible, a
  spawned second process) to prove update isolation — atomic rename alone is not
  tested as sufficient.

## Mutation + audit durability contract (binding on T4/T5/T6/T9)

`acquire locks → write-ahead audit intent → authoritative writes → release`.

- Audit is appended **first**; a failed append returns `audit_write_failed` and
  **writes nothing**. A security mutation is **never** acknowledged as successful
  when its audit evidence failed.
- The operation is successful only when **all** its authoritative writes complete.
- No cross-file transaction is claimed; sequencing + ordering is what makes the
  reachable partial state inert.

| Operation | Commit point | Crash / failure between writes |
| --- | --- | --- |
| Enroll | principal **and** first credential durable | principal-only → inert **incomplete enrollment** (zero credentials), reported by `reconcile` |
| Rotate | credential durable | credential unchanged (audit intent discarded) |
| Revoke | credential marked revoked | credential unchanged |
| Disable / Enable | principal status durable | status unchanged |
| Migrate | per-token: binding durable | already-bound tokens stay bound; remainder unbound; resumable |

**Revocation preserves identity.** `revokeToken` records `revocation`
(`revokedAt`/reason) and **keeps `StoredToken.principalId`**. Historical
attribution survives; authentication eligibility is removed by the revoked state,
not by deleting the binding. A principal whose credentials are all revoked is
reported by `reconcile` as **no active credentials** (distinct from incomplete
enrollment).

## Migration race contract (binding on T9)

Migration holds **principal → token** locks for the batch and re-reads inside the
lock. Per candidate token it binds only when: `principalId` absent (idempotent),
not revoked, not expired, and (for `--principal <id>`) the principal is **active at
commit time** (re-checked under the lock). The write is a `revision` CAS.

| Race | Deterministic outcome |
| --- | --- |
| vs disablement | serialized on the principal lock; migration never binds to a now-disabled principal |
| vs rotation | serialized on the token lock; only token ids present at lock time are considered; superseded/expired tokens skipped |
| vs revocation | revoked token skipped; migration never un-revokes or re-binds a terminal credential |
| vs concurrent migration | serialized on principal → token; the second batch re-reads and skips already-bound/revoked/expired tokens — idempotent, no double-bind |

Migration never un-disables a principal, un-revokes a credential, or overwrites an
existing `principalId`.

## Tasks

- [ ] **T1 — Shared store lock.** Thin `withStoreLock(authStateDir, which, fn)`
  over `audit-lock.ts` `acquire`/`release`: lock files `principals.lock` /
  `auth-store.lock`, `staleRecovery: "manual"`, bounded timeout, **fail closed**
  (no write) on a held/stale lock. A two-lock helper acquires **principal then
  token** and releases in reverse. The helper hands the callback the lock, and
  **the callback re-reads the authoritative record inside the lock**.
- [ ] **T2 — PrincipalStore.** `src/governance/security/inspector/principal-store.ts`:
  `PrincipalRecord` (`id`/`name`/`status`/`createdAt`/`disabledAt?`/
  `disabledReason?`/`revision`; **no `credentialIds`**), load/save (atomic
  temp+rename, `0o600`, **explicit `lstatSync` symlink rejection** — the shared
  JSON primitive lacks it), bounded count, `create`/`get`/`list`/`setStatus`. All
  mutations lock + **re-read + CAS**.
- [ ] **T3 — Token store lock + fields.** `StoredToken` gains `principalId?: string`
  and `revision: number` (`auth-store.ts`); `AuthStore` read-modify-write runs
  under `auth-store.lock` with **re-read + CAS**; `createTokenRecord`/
  normalization/snapshot version updated. `principalId` is the single binding
  authority.
- [ ] **T4 — Enrollment.** `AuthService.createToken` (and `--principal <id>`
  adoption): locks principal → token, **write-ahead audit intent**, then principal
  write, then credential write. A crash after the principal leaves an inert
  **incomplete enrollment** surfaced by `reconcile`.
- [ ] **T5 — Rotation.** `rotateToken` takes the token lock, **re-reads**, writes
  the write-ahead audit intent, then inherits `principalId` from the rotated
  credential; an unbound token rotates to an unbound credential.
- [ ] **T6 — Revocation, disablement, enablement.** `revokeToken` (token lock,
  write-ahead audit) marks the credential revoked and **preserves `principalId`**
  for historical attribution. `disablePrincipal`/`enablePrincipal` (principal
  lock, write-ahead audit) flip status.
- [ ] **T7 — Auth-time status check.** `verifyToken`/`verifyPrincipalStatus`
  implement the **Auth decision matrix** exactly: unbound → ordinary; bound +
  active → ordinary + `principalId`; bound + disabled/missing/unavailable →
  **deny all authentication**; revoked → deny. `AuthPrincipal` gains `principalId`;
  `verifyTokenForRequest` keeps its shape, now principal-aware.
- [ ] **T8 — SecurityContext + middleware.** `SecurityContext.principalId?`
  (`src/governance/security/inspector/security-context.ts`);
  `createSecurityContext` option; `src/interfaces/server/security-middleware.ts`
  populates it on bearer + cookie and enforces the matrix (bound credentials with
  a non-active/unverifiable principal are denied wherever they would otherwise
  pass).
- [ ] **T9 — Migration + CLI + reconcile.** `alix inspector auth migrate
  [--principal <id>]` per the **Migration race contract**. `alix inspector auth
  principal disable|enable|remove`; `alix inspector auth reconcile` reports
  incomplete enrollments, **no-active-credentials** principals, and dangling
  bindings — **never silently deletes**.
- [ ] **T10 — Contracts + verification.** Update the forward contracts in
  `src/interfaces/server/AGENTS.md` and
  `src/interfaces/cli/commands/security/AGENTS.md`; ship the full test matrix
  (spec §Test matrix) including the concurrency, durability, crash, and parity
  suites.

## Sequencing

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10. Each is independently
committable; T7/T8 (auth behaviour) and T9 (migration races) must land with their
parity/concurrency tests.

## Verification

- Focused: principal-store, auth-service, auth-store, browser-session, server
  workspace-authorization, CLI `inspector auth` suites.
- **Concurrency (separate store instances / processes):** two-writer
  no-lost-update; CAS revision refusal; re-read-after-lock; lock order
  principal→token with no deadlock; stale-lock fail-closed; concurrent migration
  idempotent.
- **Durability/crash:** audit-intent failure writes nothing and is not reported
  successful; crash between principal and credential → inert orphan + reconcile
  report (never deleted).
- **Attribution:** revoked credential preserves `principalId`; revoked denies
  ordinary + principal-required.
- Architecture: `layer-boundaries`, `r1-boundary-freeze`.
- Static: `typecheck`, `typecheck:unused`, `check:dead`, `check:dox`, `verify:deps`.
- Parity table (spec §Test matrix) broader than the handler.

## Explicitly out of scope

- G3-C (the remote decision route) and its endpoints/parity table.
- Any change to HMAC evidence or audit projection (A/B are merged).
- Second credential authority, secret store, or token-hashing change.
- A cross-file transaction layer; relocating the shared lock module.
