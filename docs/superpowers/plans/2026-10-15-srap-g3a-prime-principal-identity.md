# SRAP-1 G3-A′ — principal identity implementation plan

Status: **PROPOSED (rev 2) — for operator review before coding.** Ships as its own
PR(s). G3-C blocked until this is implemented and reviewed.

**Spec:** `../specs/2026-10-15-srap-g3a-prime-principal-identity-design.md`

**Goal:** a stable, server-generated operator `principalId` that survives
credential rotation, is separate from credential identity, whose disablement
denies **all** authentication for bound credentials — without a second credential
authority, and with real cross-process serialization.

**Boundary:** the principal store owns operator identity/status; `auth-store.ts`
keeps owning credential verification/revocation **and is the single authority for
the credential→principal binding** (`StoredToken.principalId`).

## Global constraints

- No second secret/token authority; principals hold no secrets.
- Do not cache principal status in tokens/sessions — read fresh at auth time.
- `principalId` is never a credential id and never derived from one.
- Legacy tokens: absence of `principalId` is valid for ordinary authentication but
  invalid for any principal-required capability; **no implicit identity
  substitution**; no global auth cutover.
- Every read-modify-write is serialized by the shared cross-process lock
  (`src/governance/security/audit/audit-lock.ts`); lock order **principal →
  token**; stale lock fails closed.
- Every mutation is a **revision CAS** under the lock; no lost updates.
- Auth mutations are **write-ahead audited**; no unaudited mutation; no
  cross-file transaction claimed.
- Preserve all existing role/permission/workspace semantics and tests.
- Every step: GitNexus `impact` before edits; `detect-changes` before commit;
  clean build + focused tests; owning-contract updates in the same change.

## Tasks

- [ ] **T1 — Shared store lock.** Thin `withStoreLock(authStateDir, which, fn)`
  helper in the inspector subsystem over `audit-lock.ts` `acquire`/`release`:
  lock files `principals.lock` / `auth-store.lock`, `staleRecovery: "manual"`,
  bounded timeout, **fail closed** (no write) on a held/stale lock. Exposes the
  two-lock helper that acquires **principal then token** and releases in reverse.
- [ ] **T2 — PrincipalStore.** `src/governance/security/inspector/principal-store.ts`:
  `PrincipalRecord` (`id`/`name`/`status`/`createdAt`/`disabledAt?`/
  `disabledReason?`/`revision`; **no `credentialIds`**), load/save (atomic
  temp+rename, `0o600`, **explicit `lstatSync` symlink rejection** of the file and
  parent — the shared JSON primitive lacks it), bounded count (mirrors
  `MAX_CREDENTIAL_ENTRIES`), `create`/`get`/`list`/`setStatus` — all mutations
  lock + CAS.
- [ ] **T3 — Token store lock + fields.** `StoredToken` gains `principalId?: string`
  and `revision: number` (`auth-store.ts`); `AuthStore` read-modify-write runs
  under `auth-store.lock`; `createTokenRecord`/normalization/snapshot version
  updated. `principalId` is the single binding authority.
- [ ] **T4 — Enrollment.** `AuthService.createToken` (and `--principal <id>`
  adoption): locks principal → token, **write-ahead audit**, then principal write,
  then credential write. A crash after the principal leaves an inert **incomplete
  enrollment** surfaced by `reconcile`.
- [ ] **T5 — Rotation.** `rotateToken` takes the token lock, write-ahead audit,
  inherits `principalId` from the rotated credential; unbound token rotates to an
  unbound credential.
- [ ] **T6 — Revocation, disablement, enablement.** `revokeToken` (token lock)
  marks the credential terminal. `disablePrincipal`/`enablePrincipal` (principal
  lock) flip status with write-ahead audit.
- [ ] **T7 — Auth-time status check.** `verifyToken`/`verifyPrincipalStatus`
  resolve the credential's current principal: unbound → ordinary; bound + active →
  ordinary + `principalId`; bound + disabled/missing/unavailable → **deny all
  authentication**. `AuthPrincipal` gains `principalId`; `verifyTokenForRequest`
  stays shaped, now principal-aware.
- [ ] **T8 — SecurityContext + middleware.** `SecurityContext.principalId?`
  (`src/governance/security/inspector/security-context.ts`); `createSecurityContext`
  option; `src/interfaces/server/security-middleware.ts` populates it on bearer +
  cookie and denies bound credentials whose principal is not active.
- [ ] **T9 — Migration + CLI + reconcile.** `alix inspector auth migrate
  [--principal <id>]` (locks principal → token for the batch; in-lock re-read; bind
  only unbound, non-revoked, non-expired tokens; `--principal` active re-check
  under lock; CAS write; never resurrect). `alix inspector auth principal
  disable|enable|remove` and `alix inspector auth reconcile` (reports incomplete
  enrollments + dangling bindings; **never silently deletes**).
- [ ] **T10 — Contracts + verification.** Update the forward contracts in
  `src/interfaces/server/AGENTS.md` and
  `src/interfaces/cli/commands/security/AGENTS.md`; ship the full test matrix
  (spec §Test matrix) including the concurrency, durability, and parity suites.

## Sequencing

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10. Each is independently
committable; T7/T8 (auth behaviour) and T9 (migration races) must land with their
parity/concurrency tests.

## Verification

- Focused: principal-store, auth-service, auth-store, browser-session, server
  workspace-authorization, CLI `inspector auth` suites.
- **Concurrency:** two-writer no-lost-update, CAS refusal, lock-order
  principal→token (no deadlock) under interleaved enrollment+migration+disable,
  stale-lock fail-closed.
- **Durability:** audit-intent failure writes nothing; crash → inert orphan +
  reconcile report (never deleted).
- Architecture: `layer-boundaries`, `r1-boundary-freeze`.
- Static: `typecheck`, `typecheck:unused`, `check:dead`, `check:dox`, `verify:deps`.
- Parity table (spec §Test matrix) broader than the handler.

## Explicitly out of scope

- G3-C (the remote decision route) and its endpoints/parity table.
- Any change to HMAC evidence or audit projection (A/B are merged).
- Second credential authority, secret store, or token-hashing change.
- A cross-file transaction layer; relocating the shared lock module.
