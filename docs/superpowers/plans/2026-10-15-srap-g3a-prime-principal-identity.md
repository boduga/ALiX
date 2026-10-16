# SRAP-1 G3-A′ — principal identity implementation plan

Status: **PROPOSED — for operator review before coding.** Ships as its own PR(s).
G3-C blocked until this is implemented and reviewed.

**Spec:** `../specs/2026-10-15-srap-g3a-prime-principal-identity-design.md`

**Goal:** introduce a stable, server-generated operator `principalId` that
survives credential rotation, is separate from credential identity, and whose
disablement rejects every bound credential — without adding a second credential
authority.

**Boundary:** the principal store owns operator identity/status; the existing
`auth-store.ts` keeps owning credential verification/revocation **and is the
single authority for the credential→principal binding** (`StoredToken.principalId`).

## Global constraints

- No second secret/token authority; principals hold no secrets.
- Do not cache principal status in tokens/sessions — read fresh at auth time.
- `principalId` is never a credential id and never derived from one.
- Legacy tokens: absence of `principalId` is valid for ordinary authentication but
  invalid for any principal-required capability; **no implicit identity
  substitution**; no global auth cutover.
- Never claim a cross-file transaction or lock that does not exist; order writes
  so a partial failure is inert.
- Preserve all existing role/permission/workspace semantics and tests.
- Every step: GitNexus `impact` before edits; `detect-changes` before commit;
  clean build + focused tests; owning-contract updates in the same change.

## Tasks

- [ ] **T1 — PrincipalStore.** `src/governance/security/inspector/principal-store.ts`:
  `PrincipalRecord` (id/name/status/createdAt/disabledAt?/disabledReason?,
  **no `credentialIds`**), load/save (atomic temp+rename, `0o600`, **explicit
  `lstatSync` symlink rejection of the file and its parent** — the shared JSON
  primitive lacks this), bounded principal count (mirrors
  `MAX_CREDENTIAL_ENTRIES`), `create`, `get`, `list`, `setStatus`. Idempotent
  load. Store location `<authStateDir>/principals.json`.
- [ ] **T2 — Token ↔ principal link.** `StoredToken.principalId?: string`
  (`auth-store.ts`); update `createTokenRecord`, normalization, and the snapshot
  schema version. Additive; `principalId` is the **single** binding authority.
- [ ] **T3 — Enrollment.** `AuthService.createToken` creates a principal (or
  adopts `--principal <id>` if supplied) then the first credential, **principal
  written before the credential** so a partial failure is an inert orphan.
  `createAuthService` / `handleInspectorAuthCreate` wire `--name` to the
  principal and accept the optional `--principal`.
- [ ] **T4 — Rotation.** `AuthService.rotateToken` inherits `principalId` from the
  rotated credential; writes only the token file. An unbound token rotates to an
  unbound credential (never binds implicitly).
- [ ] **T5 — Revocation vs disablement.** `revokeToken` unbinds the credential
  (nothing else to update — membership is derived). New `disablePrincipal` /
  `enablePrincipal`; auth denies every credential whose **currently resolved**
  principal is disabled.
- [ ] **T6 — Auth-time status check.** `verifyToken` / `verifyPrincipalStatus`
  resolve the credential's `principalId`, load the current principal, and fail
  the **principal-required** decision unless it exists and is active (ordinary
  access is unaffected). `AuthPrincipal` gains `principalId`. `verifyTokenForRequest`
  keeps its shape, now principal-aware.
- [ ] **T7 — SecurityContext + middleware.** `SecurityContext.principalId?`
  (`src/governance/security/inspector/security-context.ts`); `createSecurityContext`
  option; `src/interfaces/server/security-middleware.ts` populates it for bearer
  and cookie transports.
- [ ] **T8 — Legacy migration + CLI.** `alix inspector auth migrate
  [--principal <id>]` binds unbound tokens. Per-token idempotent; not-found /
  disabled / unavailable all fail closed with no change; partial batches are
  resumable and never rolled back. No auto-bind at auth time.
- [ ] **T9 — Contracts + verification.** Update `src/interfaces/server/AGENTS.md`
  (middleware/context), `src/interfaces/cli/commands/security/AGENTS.md`
  (`alix inspector auth`), and root `AGENTS.md` if a durable rule changes. Ship
  the full test matrix (spec §Test matrix) including the **role × workspace ×
  principal-status parity table** and an explicit test that existing
  roles/permissions/workspace stay enforced.

## Sequencing

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9. Each is independently committable;
T5/T6/T7 are the behaviour-changing steps that must land with their parity tests.

## Verification

- Focused: principal-store, auth-service, auth-store, browser-session, server
  workspace-authorization, and CLI `inspector auth` suites (existing named suites
  under `tests/security/inspector/`, `tests/cli/inspector-workspace.test.ts`).
- Architecture: `layer-boundaries`, `r1-boundary-freeze`.
- Static: `typecheck`, `typecheck:unused`, `check:dead`, `check:dox`, `verify:deps`.
- Parity table (spec §Test matrix) broader than the handler.

## Explicitly out of scope

- G3-C (the remote decision route) and its endpoints/parity table.
- Any change to HMAC evidence or audit projection (A/B already reviewed).
- Second credential authority, secret store, or token-hashing change.
- A cross-file transaction/lock layer.
