# SRAP-1 G3-A′ — principal identity implementation plan

Status: **PROPOSED — for operator review before coding.** Ships as its own PR(s).
G3-C blocked until this is implemented and reviewed.

**Spec:** `../specs/2026-10-16-srap-g3a-prime-principal-identity-design.md`

**Goal:** introduce a stable, server-generated operator `principalId` that
survives credential rotation, is separate from credential identity, and whose
disablement rejects every bound credential — without adding a second credential
authority.

**Boundary:** principal store owns operator identity/lifecycle; the existing
`auth-store.ts` keeps owning credential verification and revocation.

## Global constraints

- No second secret/token authority; principals hold no secrets.
- Do not cache principal status in tokens/sessions — read fresh at auth time.
- `principalId` is never a credential id and never derived from one.
- Legacy tokens: no implicit identity substitution.
- Preserve all existing role/permission/workspace semantics and tests.
- Every step: GitNexus `impact` before edits; `detect-changes` before commit;
  clean build + focused tests; owning-contract updates in the same change.

## Tasks

- [ ] **T1 — PrincipalStore.** `src/governance/security/inspector/principal-store.ts`:
  `PrincipalRecord`, load/save (atomic, `0o600`, shared JSON primitive),
  `create`, `get`, `list`, `bindCredential`, `unbindCredential`,
  `setStatus(active|disabled)`. Bounded principal count. Update
  `src/governance/security/inspector/AGENTS.md`? (nearest owning doc — the
  security CLI AGENTS covers `inspector auth`). Idempotent load.
- [ ] **T2 — Token ↔ principal link.** `StoredToken.principalId?: string`
  (`auth-store.ts`); update `createTokenRecord`, normalization, and any snapshot
  version bump. Type-only change plus additive field.
- [ ] **T3 — Enrollment.** `AuthService.createToken` gains a principal: create
  principal + first credential atomically under the auth lock; audit both.
  `createAuthService` / `handleInspectorAuthCreate` wire `--name` to the
  principal name and create the principal.
- [ ] **T4 — Rotation.** `AuthService.rotateToken` inherits `principalId` from the
  rotated credential; no operator input.
- [ ] **T5 — Revocation vs disablement.** `revokeToken` unbinds the credential
  only. New `disablePrincipal` / `enablePrincipal`; auth rejects any credential
  whose bound principal is disabled.
- [ ] **T6 — Auth-time status check.** `verifyToken` and `verifyPrincipalStatus`
  load the bound principal and fail closed unless active; `AuthPrincipal` gains
  `principalId`. `verifyTokenForRequest` unchanged in shape, now principal-aware.
- [ ] **T7 — SecurityContext + middleware.** `SecurityContext.principalId?`;
  `createSecurityContext` option; middleware populates it for bearer and cookie.
- [ ] **T8 — Legacy migration + CLI.** `alix inspector auth migrate
  [--principal <id>]` binds unbound tokens; no auto-bind. Document policy.
- [ ] **T9 — Contracts + tests.** Update credentials/inspector/server/approvals
  AGENTS; ship the full test matrix from the spec §Test matrix (read the spec).

## Sequencing

T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9. Each is independently committable;
T6/T7 are the behaviour-changing steps that must land with their parity tests.

## Verification

- Focused: principal-store, auth-service, auth-store, browser-session, server
  workspace-authorization, CLI inspector-workspace suites.
- Architecture: `layer-boundaries`, `r1-boundary-freeze`.
- Static: `typecheck`, `typecheck:unused`, `check:dead`, `check:dox`, `verify:deps`.
- Parity table (spec §Test matrix) broader than the handler.

## Explicitly out of scope

- G3-C (the remote decision route) and its endpoints/parity table.
- Any change to HMAC evidence or audit projection (A/B already merged).
- Second credential authority, secret store, or token-hashing change.
