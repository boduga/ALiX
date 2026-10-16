# SRAP-1 G3-A′ — persistent operator principal identity

Status: **PROPOSED design — for operator review before any code.** G3-C (the
remote decision route) stays blocked until this lands and passes its own gate.

**Context:** G3 Workstreams A (HMAC `srap-evidence` lifecycle) and B (audit
projection) are implemented in PR #959. C is blocked because the eligibility
predicate and evidence require a **stable `principalId` separate from credential
identity**, and no persistent operator/principal store exists.

**Owning contracts this must satisfy:** `src/governance/approvals/AGENTS.md`
(eligibility `activePrincipal`), `src/governance/security/credentials/AGENTS.md`
(no second secret authority), `src/interfaces/server/AGENTS.md` (canonical
workspace; session revalidation). G2-C review §3 is the origin.

## Problem

Inspector authentication today is **credential-only**:

- `StoredToken` (`src/governance/security/inspector/auth-store.ts`): `id`,
  `hash`, `name`, `role`, `workspaceIds?`, `createdAt`, `expiresAt?`,
  `rotatedFrom?`, `revocation?`, `schemaVersion`. There is no operator
  identity — `id` is the *credential* id.
- `SecurityContext` (`src/governance/security/inspector/security-context.ts`):
  `tokenId`, `permissions`, `workspaceIds?` — no `principalId`.
- Rotation (`AuthService.rotateToken`) mints a **new token id**; nothing links
  the old and new credential to one human.
- Revocation disables a credential. There is no way to disable a *person* across
  every credential they hold.

Consequence: "who authorised this decision, durably, independent of which token
they happened to hold" cannot be answered. Using `tokenId` as `principalId` is
rejected (breaks identity continuity across rotation; would let a rotated
credential be attributed as a different operator).

## Decision (proposed)

Add a **persistent operator-principal layer** that owns operator *identity and
lifecycle only*. The existing auth store keeps owning credential *verification
and revocation*. No second secret authority; no change to how tokens are hashed
or verified.

### Core invariants (freeze before coding)

| Concern | Required behaviour |
| --- | --- |
| Principal identity | Stable, server-generated `principalId` (opaque, `prin_<12 base64url>`), never equal to a credential id |
| Credential binding | A credential record carries `principalId`; ≥1 credential per principal |
| Enrollment | Creates a principal **and** its first credential, ordered so a partial write is inert |
| Rotation | New credential inherits the **same** `principalId` |
| Credential revocation | Revokes only that credential; principal stays usable via others |
| Principal disablement | Rejects **every** credential bound to it (checked at auth time) |
| Authorization | role + permissions + workspace + **current principal status** |
| Audit attribution | Durable `principalId`, with `credentialRef` where appropriate |
| Legacy tokens | Explicit migration/compat policy; **no implicit identity substitution** |
| Concurrency | One authoritative record mutated per operation; no cross-file transaction is claimed |
| Status source of truth | Auth reads the **current** principal record; never trusts an `enabled` flag copied into a token or session |

### The legacy-token invariant (normative)

> **Absence of `principalId` is valid for legacy authentication but invalid
> anywhere an operator principal is required. No fallback from token identity
> to operator principal identity is permitted.**

Operationally:

```text
legacy unbound token
    ├─ ordinary pre-existing auth/access → continues under existing roles/permissions/workspace
    └─ principal-required capability      → denied until explicitly migrated/bound
```

There is **no global authentication cutover**. A legacy token keeps working for
everything it could already reach; it is simply ineligible for capabilities that
assert an authenticated operator principal (remote approval decisions are the
first). `alix inspector auth migrate` is the explicit transition. This keeps
"no implicit identity substitution" true, keeps existing roles/permissions/
workspace enforced, and fails remote decisions closed without breaking operator
tooling.

### Ownership boundaries

```text
src/governance/security/inspector/
  principal-store.ts        NEW — PrincipalRecord persistence + lifecycle.
                            Owns: id generation, status (active|disabled).
                            Does NOT own: token hashing, secret material, or
                            the credential→principal binding (that is StoredToken).
  auth-store.ts             CHANGE — StoredToken gains `principalId?: string`.
                            Still owns credential verification/revocation, and is
                            the SINGLE authority for credential→principal binding.
  auth-service.ts           CHANGE — enrollment creates principal + credential;
                            rotation preserves principalId; verify revalidates the
                            current principal and rejects disabled principals.
  security-context.ts       CHANGE — add `principalId?: string`.

src/interfaces/server/
  security-middleware.ts    CHANGE — populate ctx.principalId from the verified
                            principal for bearer AND cookie transports.
```

**Binding has one authority: `StoredToken.principalId`.** There is no
`PrincipalRecord.credentialIds`. Membership ("which credentials belong to this
principal") is **derived** by scanning tokens by `principalId`, so the two
records cannot drift and `AuthStore.cleanup()` deleting a token can never leave
dangling reverse membership. Disablement is checked by resolving the credential's
current `principalId` → current `PrincipalRecord.status`; the scan is only for
operator tooling/listing.

**Rejected:** a second credential/token authority; copying principal status into
the token hash store; deriving `principalId` from `tokenId`; a separate secret
store for principals (they hold no secrets); a cross-file transaction or lock
(`auth-store.ts` has none today and none is added — see Enrollment below).

**Naming note.** The word "principal" already appears in `AuthPrincipal`
(`auth-service.ts`), where `AuthPrincipal.id` is the **credential** id, and in
the connection-limiter's `byPrincipal` (keyed by token id). The new
`PrincipalRecord.id` is the **operator** identity, a different concept sharing
the word. `AuthPrincipal` gains a separate `principalId` field; the two ids are
never interchangeable, and every call site that needs operator identity uses
`principalId`, never `id`.

### Data model (proposed)

```ts
// principal-store.ts
export interface PrincipalRecord {
  id: string;                 // prin_<12 base64url>, server-generated
  schemaVersion: 1;
  name: string;               // human label
  status: "active" | "disabled";
  createdAt: string;
  disabledAt?: string;
  disabledReason?: string;
}

export interface PrincipalStoreData {
  version: 1;
  principals: PrincipalRecord[];   // bounded, mirrors MAX_CREDENTIAL_ENTRIES
}
```

Storage: the user state dir, sibling to `auth-store.json`
(`<authStateDir>/principals.json`), `0o600`, atomic temp+rename, **and the same
symlink rejection `auth-store.ts` performs** (`lstatSync` on the file and its
parent, rejecting a symlinked store path). The shared `writeJsonFileAtomicSync`
primitive provides the atomic write but **not** the symlink check, so the
principal store must add it explicitly — do not present the shared primitive as
equivalent to `auth-store.ts`'s discipline.

### Lifecycle

- **Enroll** (`alix inspector auth create`): write the `PrincipalRecord` (name,
  active) **first**, then the credential whose `StoredToken.principalId` points
  at it. Ordered deliberately: a crash after the principal write but before the
  credential write leaves an **inert orphan principal** (no credential resolves
  to it) that is harmless and ignored on load; the reverse order would leave a
  credential pointing at a nonexistent principal. **No cross-file transaction is
  claimed** — each file write is atomic on its own, and the ordering makes the
  only reachable partial state inert.
- **Rotate**: read the rotated credential's `principalId`, mint the new
  credential with the same `principalId`, and write **only the token file** (the
  principal record is unchanged) — a single-file atomic write. An *unbound*
  legacy token rotates to a new unbound credential (`principalId` stays absent);
  rotation never binds implicitly.
- **Revoke**: mark the credential in the token file and unbind it. Nothing else
  to update (membership is derived). If it was the last credential, the principal
  survives (enroll another).
- **Disable** (`disablePrincipal(id, reason)`): set `status: "disabled"` +
  `disabledAt`/`disabledReason` in the principal file — a single-file atomic
  write. **Enable** (`enablePrincipal(id)`) is the inverse and exists because
  disablement must be reversible without deleting identity; `disabledReason` is
  kept because disablement is an audited operator action.

### Authentication-time status check

`verifyToken` / `verifyPrincipalStatus` (and thus `verifyTokenForRequest` and the
cookie path) additionally resolve the credential's `principalId` and load the
bound principal, then fail the *principal-required* decision unless the principal
exists and `status === "active"`. The principal status is read fresh from the
store on every authentication (never cached in the token/session), so a disable
takes effect on the next request across processes — mirroring the existing
source-token revalidation. For ordinary access, an unbound/legacy credential is
allowed per the legacy-token invariant above (no principal question is asked).

### Legacy-token migration and failure semantics

`alix inspector auth migrate [--principal <id>]` binds unbound tokens:

- **Default:** one new principal per legacy token id.
- **`--principal <id>`:** adopt an existing principal (idempotent if already
  bound to it).
- **Failure semantics (all fail closed, no partial binding silently accepted):**
  - `--principal <id>` not found or disabled → error, **no change**.
  - Principal-store unavailable on write → error, **no change**.
  - A batch that stops partway leaves the already-bound tokens bound and the
    remainder unbound (each bind is ordered principal-consult → token write);
    re-running is idempotent and completes the rest. Binding is per-token, never
    all-or-nothing, and is never rolled back (a bound token is not un-bound by a
    later failure).
  - Rotating a still-unbound token never binds it (see Rotate).
- **No silent auto-bind at auth time** — only the explicit command creates the
  link.

## Test matrix (all must ship)

| Area | Cases |
| --- | --- |
| Enrollment | creates principal + first credential; ordered; a principal-without-credential partial write is inert and ignored |
| Rotation | new credential keeps `principalId`; old credential still verifies in grace; unbound token stays unbound |
| Credential revocation | only that credential dies; principal usable via others; no dangling membership (derived) |
| Principal disablement | every bound credential rejected (bearer + cookie); re-enable restores |
| Status freshness | disable from a **separate store instance** takes effect next request |
| Legacy tokens | unbound token: ordinary access continues; principal-required capability denied; no implicit principal created |
| Migration | binds unbound tokens; `--principal` adoption idempotent; not-found/disabled/unavailable all fail with no change; partial batch resumable |
| Cross-process | concurrent enroll/rotate/disable safe; restart persistence |
| Fail-closed | principal store unavailable → principal-required checks fail closed, no principal assumed |
| Context | `SecurityContext.principalId` populated on bearer + cookie transports |
| Parity | role × workspace scope × principal status table, broader than the handler (mirrors `tests/ownership/path-scope.test.ts`) |

**Auth audit** for enrollment/rotation/revocation/disable/migrate goes through the
existing `AuthAuditStore` (`AuthAuditStore` appends and rethrows so a mutation
cannot succeed without its audit record). This is **not** the SRAP audit
projection (workstream B) and does not touch it.

## Migration & rollback

- Additive and compatible: existing stores load unchanged (missing `principalId`
  → unbound/legacy). Ordinary access is unchanged; only principal-required
  capabilities deny until bound.
- Rollout: ships alongside A/B; the remote route (C) still requires A′ + explicit
  scope + active principal, and stays default-off.
- Rollback: removing A′ leaves credentials intact; unbound tokens keep their
  ordinary access; no remote decisions were ever enabled.

## Out of scope

- The remote decision route (G3-C) and its parity table.
- Any second credential authority or secret store.
- Changing token hashing, roles, or workspace semantics.
- A cross-file transaction layer.

## Open questions — RESOLVED before coding

1. Enrollment default → `auth create` **always creates a new principal**, with
   `--principal <id>` to bind to an existing one.
2. Principal store location → `<authStateDir>/principals.json` (user state dir,
   sibling to `auth-store.json`).
3. Legacy migration trigger → **explicit command only** (`alix inspector auth
   migrate`); no auto-bind.
4. `auth rotate` principal → **inferred from the rotated credential**, no
   operator input.
