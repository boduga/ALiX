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

- `StoredToken` (`auth-store.ts`): `id`, `hash`, `name`, `role`,
  `workspaceIds?`, `createdAt`, `expiresAt?`, `rotatedFrom?`, `revocation?`.
  There is no operator identity — `id` is the *credential* id.
- `SecurityContext` (`security-context.ts`): `tokenId`, `permissions`,
  `workspaceIds?` — no `principalId`.
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
| Principal identity | Stable, server-generated `principalId` (opaque, e.g. `prin_<12 base64url>`), never equal to a credential id |
| Credential binding | A credential record carries `principalId`; ≥1 credential per principal |
| Enrollment | Creates a principal **and** its first credential atomically |
| Rotation | New credential inherits the **same** `principalId` |
| Credential revocation | Revokes only that credential; principal stays usable via others |
| Principal disablement | Rejects **every** credential bound to it (checked at auth time) |
| Authorization | role + permissions + workspace + **current principal status** |
| Audit attribution | Durable `principalId`, with `credentialRef` where appropriate |
| Legacy tokens | Explicit migration/compat policy; **no implicit identity substitution** |
| Concurrency | Atomic principal/credential lifecycle ops, or safe recovery from a partial write |
| Status source of truth | Auth reads the **current** principal record; never trusts an `enabled` flag copied into a token/session |

### Ownership boundaries

```
src/governance/security/inspector/
  principal-store.ts        NEW — PrincipalRecord persistence + lifecycle.
                            Owns: id generation, bind/unbind, status, roles?
                            Does NOT own: token hashing, secret material.
  auth-store.ts             CHANGE — StoredToken gains `principalId?: string`.
                            Still owns credential verification/revocation.
  auth-service.ts           CHANGE — enrollment creates principal+credential;
                            rotation preserves principalId; verify resolves the
                            current principal and rejects disabled principals.
  security-context.ts       CHANGE — add `principalId?: string`.
  security-middleware.ts    CHANGE — populate ctx.principalId from the verified
                            principal for bearer AND cookie transports.
```

**Rejected:** a second credential/token authority; copying principal status into
the token hash store; deriving `principalId` from `tokenId`; a separate secret
store for principals (they hold no secrets).

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
  /** Credential ids currently bound (denormalised index; auth-store is the
   *  credential-of-record, this is the reverse link). */
  credentialIds: string[];
}

export interface PrincipalStoreData {
  version: 1;
  principals: PrincipalRecord[];
}
```

Storage: `.alix`-equivalent user state dir, sibling to `auth-store.json`
(`<authStateDir>/principals.json`), `0o600`, atomic temp+rename, built on the
shared `writeJsonFileAtomicSync`/`readJsonFileSync` primitive (same discipline as
`auth-store.ts`).

### Lifecycle

- **Enroll** (`alix inspector auth create`): create `PrincipalRecord` (name,
  active) + first credential (`StoredToken.principalId = principal.id`) in one
  operation; if the credential write fails, roll back the principal (or leave an
  orphan principal with zero credentials and reconcile on next load — decide in
  plan; prefer atomic write of both files under one lock).
- **Rotate**: `rotateToken` reads the existing token's `principalId`, mints the
  new credential with the same `principalId`, updates `PrincipalRecord`
  credentialIds. Principal unchanged.
- **Revoke**: `revokeToken` marks the credential; updates `credentialIds`. If it
  was the last credential, principal survives (enroll another).
- **Disable**: new `disablePrincipal(id, reason)` → `status: "disabled"`,
  `disabledAt`. Auth rejects **any** credential whose principal is disabled.
- **Enable**: `enablePrincipal(id)` → `status: "active"`.

### Authentication-time status check

`verifyToken` / `verifyPrincipalStatus` (and thus `verifyTokenForRequest` and the
cookie path) additionally load the bound principal and fail closed unless
`status === "active"`. The principal status is read fresh from the store on every
authentication (never cached in the token/session), so a disable takes effect on
the next request across processes — mirroring the existing source-token
revalidation.

### Legacy-token migration

Tokens written before A′ have **no `principalId`**. Policy (proposed):

- Such a credential is **ineligible for remote decisions** (the approvals
  contract already requires explicit scope + active principal).
- For ordinary Inspector access it keeps working **only** if it is explicitly
  upgraded: `alix inspector auth migrate` binds legacy tokens to principals
  (one principal per legacy token id by default, or `--principal <id>` to adopt
  an existing principal). No silent auto-creation of principals at auth time.
- `verifyToken` returns `principal` only for bound, active principals; an unbound
  legacy token yields no `principalId` (so `alix_coordination`/state reads that
  do not need it are unaffected, but remote-decision eligibility denies).

## Test matrix (all must ship)

| Area | Cases |
| --- | --- |
| Enrollment | creates principal + first credential; atomic; audit record |
| Rotation | new credential keeps `principalId`; old credential still verifies in grace |
| Credential revocation | only that credential dies; principal usable via others |
| Principal disablement | every bound credential rejected (bearer + cookie); re-enable restores |
| Status freshness | disable from a **separate store instance** takes effect next request |
| Legacy tokens | unbound token: ordinary access per policy, remote-decision ineligible; no implicit principal |
| Migration | `auth migrate` binds legacy tokens; explicit `--principal` adoption |
| Cross-process | concurrent enroll/rotate/disable safe; restart persistence |
| Fail-closed | store unavailable → auth fails closed, no principal assumed |
| Context | `SecurityContext.principalId` populated on bearer + cookie transports |
| Parity | role × workspace scope × principal status table (broader than handler) |

## Migration & rollback

- Additive: existing stores load unchanged (missing `principalId` → unbound).
- Rollout: ships alongside A/B; the remote route (C) still requires A′ + explicit
  scope + active principal, and stays default-off.
- Rollback: removing A′ leaves credentials intact; unbound tokens revert to
  ordinary behaviour; no remote decisions were ever enabled.

## Out of scope

- The remote decision route (G3-C) and its parity table.
- Any second credential authority or secret store.
- Changing token hashing, roles, or workspace semantics.

## Open questions for the operator (resolve before coding)

1. Enrollment default: does `auth create` **always** create a new principal, or
   gain `--principal <id>` to bind to an existing one (recommended: yes)?
2. Principal store location: `<authStateDir>/principals.json` (recommended) vs a
   project-scoped `.alix/` file.
3. Legacy migration trigger: explicit command only (recommended) vs auto-bind on
   first successful auth.
4. Does `auth rotate` require the caller to name a principal, or infer it from the
   credential being rotated (recommended: infer, no operator input)?
