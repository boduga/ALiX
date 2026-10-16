# SRAP-1 G3-A′ — persistent operator principal identity

Status: **PROPOSED design (rev 2) — for operator review before any code.** G3-C
(remote decision route) stays blocked until this lands and passes its own gate.

**Rev 2 resolves the conditional-approval findings:** cross-process
serialization, disablement-denies-all-authentication, mutation/audit durability,
and migration races. The approved identity model, ownership split, and
legacy-token policy are unchanged.

**Context:** G3 Workstreams A (HMAC `srap-evidence` lifecycle) and B (audit
projection) are merged (PR #959). C is blocked because the eligibility predicate
and evidence require a **stable `principalId` separate from credential
identity**, and no persistent operator/principal store exists.

**Owning contracts this must satisfy:** `src/governance/approvals/AGENTS.md`
(eligibility `activePrincipal`), `src/governance/security/credentials/AGENTS.md`
(no second secret authority), `src/interfaces/server/AGENTS.md` (canonical
workspace; credential revalidation; fail-closed auth mutations). G2-C review §3
is the origin.

## Problem

Inspector authentication today is **credential-only**:

- `StoredToken` (`src/governance/security/inspector/auth-store.ts`): `id`,
  `hash`, `name`, `role`, `workspaceIds?`, `createdAt`, `expiresAt?`,
  `rotatedFrom?`, `revocation?`, `schemaVersion`. There is no operator
  identity — `id` is the *credential* id. Its read-modify-write (`load → mutate →
  writeAll`) is **not serialized** across processes.
- `SecurityContext` (`src/governance/security/inspector/security-context.ts`):
  `tokenId`, `permissions`, `workspaceIds?` — no `principalId`.
- Rotation mints a **new token id**; nothing links old and new credential to one
  human. Revocation disables a credential; there is no way to disable a *person*.

Consequence: "who authorised this decision, durably, independent of which token
they held" cannot be answered. Using `tokenId` as `principalId` is rejected
(breaks identity continuity across rotation).

## Decision (proposed)

Add a **persistent operator-principal layer** that owns operator *identity and
lifecycle only*. The existing auth store keeps owning credential *verification
and revocation* and remains the **single authority** for the credential→principal
binding. No second secret authority; no token-hashing change.

### Core invariants (freeze before coding)

| Concern | Required behaviour |
| --- | --- |
| Principal identity | Stable, server-generated `principalId` (`prin_<12 base64url>`), never equal to a credential id |
| Credential binding | A credential record carries `principalId`; ≥1 credential per principal |
| Enrollment | Creates a principal **and** its first credential, ordered, under the store locks (see Durability) |
| Rotation | New credential inherits the **same** `principalId` |
| Credential revocation | Revokes only that credential; terminal (never resurrected); principal stays usable via others |
| Principal disablement | **Denies all authentication** for every bound credential — ordinary routes and cookies alike |
| Authorization | role + permissions + workspace + **current principal status** |
| Audit attribution | Durable `principalId`, with `credentialRef` where appropriate |
| Legacy tokens | Explicit migration/compat policy; **no implicit identity substitution**; ordinary access preserved |
| Concurrency | Every read-modify-write serialized by a shared cross-process lock; a monotonic `revision` CAS makes lost updates impossible |
| Status source of truth | Auth reads the **current** principal record every request; never a cached `enabled` flag |

### The legacy-token invariant (normative)

> **Absence of `principalId` is valid for legacy authentication but invalid
> anywhere an operator principal is required. No fallback from token identity
> to operator principal identity is permitted.**

```text
credential resolves
  ├─ principalId absent  → genuinely unbound legacy credential
  │                          → ordinary Inspector access (role/workspace); no principal
  └─ principalId present → load the CURRENT principal record
        ├─ status active                        → ordinary access + principalId on SecurityContext
        └─ disabled / missing / store unavailable → DENY ALL authentication (ordinary + cookie)
```

A **bound** credential whose principal is disabled, missing, or unreadable is
denied **everywhere** — a disabled operator cannot keep ordinary Inspector access
through a bound token. Only a **genuinely unbound legacy credential** receives
ordinary access. There is **no global authentication cutover**, and remote
decisions fail closed until a token is explicitly bound.

### Ownership boundaries

```text
src/governance/security/inspector/
  principal-store.ts        NEW — PrincipalRecord persistence + lifecycle.
                            Owns: id generation, status (active|disabled),
                            its own cross-process lock + revision CAS.
                            Does NOT own: token hashing, secret material, or the
                            credential→principal binding (that is StoredToken).
  auth-store.ts             CHANGE — StoredToken gains `principalId?` + `revision`.
                            Gains a cross-process lock around its read-modify-write.
                            The SINGLE authority for the credential→principal binding.
  auth-service.ts           CHANGE — enrollment/rotation/revocation/disable/enable
                            and migration run under the locks; write-ahead audit;
                            auth revalidates the current principal.
  security-context.ts       CHANGE — add `principalId?: string`.

src/interfaces/server/
  security-middleware.ts    CHANGE — populate ctx.principalId; deny bound
                            credentials whose principal is not active.
```

**Binding has one authority: `StoredToken.principalId`.** There is no
`PrincipalRecord.credentialIds`; membership is **derived** by scanning tokens, so
the two records cannot drift and `AuthStore.cleanup()` cannot leave dangling
membership.

**Rejected:** a second credential/token authority; copying principal status into
the token store; deriving `principalId` from `tokenId`; a separate secret store;
a **cross-file transaction** (none is claimed — see Durability).

**Naming note.** `AuthPrincipal` (`auth-service.ts`) uses `id` for the
**credential** id, and the connection-limiter keys `byPrincipal` by token id. The
new `PrincipalRecord.id` is the **operator** identity. `AuthPrincipal` gains a
separate `principalId`; the two ids are never interchangeable, and every operator-
identity call site uses `principalId`, never `id`.

## Concurrency and cross-process serialization (rev 2, item 1)

Atomic temp-file replacement prevents **torn files**; it does **not** prevent two
processes reading the same snapshot and overwriting each other (lost update).
Every read-modify-write on the principal store **and** the token store is
therefore serialized by the **shared cross-process file lock**
`src/governance/security/audit/audit-lock.ts` (`acquire(lockPath, opts)` →
`LockHandle` / `release`) — O_EXCL create, PID+host stale detection, bounded
exponential backoff. It is already a cross-subsystem primitive
(`security/evidence/evidence-store.ts`, `coordination/workflow/state-file.ts`,
`security/audit/audit-chain-writer.ts`); A′ reuses it rather than inventing one.
(If the reviewer prefers a neutral home, promoting it to
`src/runtime-state/storage/` is a mechanical follow-up, out of scope here.)

**Lock files:** `<authStateDir>/principals.lock`, `<authStateDir>/auth-store.lock`.

**Lock ordering (deadlock-free).** When an operation needs both stores it acquires
**principal first, then token**, and releases in reverse. No path ever acquires
token → principal.

| Operation | Locks held (acquire order) | Writes |
| --- | --- | --- |
| Enrollment | principal → token | principal, then credential |
| Rotation | token | credential (token file) |
| Revocation | token | credential (token file) |
| Disable / Enable | principal | principal |
| Migration | principal → token | principal (if creating), then credentials |
| Credential add/remove (existing) | token | credential (token file) |

- **All RMW writers** take the lock for the whole read-modify-write; the lock is
  held across the audit-intent append and the authoritative write, and released
  after.
- **Pure reads** (authentication verification) do **not** lock; atomic rename
  gives them the old or the new file, never a torn one.
- **Stale lock → fail closed.** `staleRecovery: "manual"`: a held or stale lock
  makes the mutation return a retryable error and write nothing. Never auto-break
  a security-mutation lock; recovery of a genuinely stale lock is an explicit
  operator action.
- **CAS revision (belt and braces).** Every `StoredToken` and `PrincipalRecord`
  carries a monotonic `revision`. Under the lock a writer re-reads the record,
  asserts the expected `revision`, and writes `revision + 1`; a mismatch is
  refused (stale snapshot). The lock makes lost updates impossible in practice;
  the revision makes one detectable and refused if a lock is ever bypassed.

## Disablement semantics (rev 2, item 2)

| Credential | Principal state | Outcome |
| --- | --- | --- |
| bound | active | ordinary role/permission/workspace checks; `SecurityContext.principalId` set |
| bound | disabled | **deny all authentication** (401), ordinary routes and cookies |
| bound | missing / store unavailable | **deny all authentication** (fail closed) |
| unbound (legacy) | n/a | ordinary Inspector access; no principal asserted; principal-required capabilities deny |

The principal record is read **fresh on every authentication** (bearer via
`verifyTokenForRequest`, cookie via `verifyPrincipalStatus`), so a disable takes
effect on the next request across processes — extending the existing "revalidate
the source token every request" rule.

## Mutation / audit durability contract (rev 2, item 3)

Auth mutations are **write-ahead audited**, extending the existing fail-closed
rule (`src/interfaces/server/AGENTS.md`: auth create/rotate/revoke "persist
nothing when the audit append fails"): the audit **intent** is appended first; if
it fails, the operation returns `audit_write_failed` and **nothing is written**.

For every operation: `acquire locks → audit intent → authoritative writes →
release`. The operation is **successful** only when all of its authoritative
writes complete; there is **no cross-file transaction** — the stores are
serialized, not atomic as a pair.

| Operation | Commit point (success) | Crash / failure between writes |
| --- | --- | --- |
| Enroll | principal **and** first credential durable | principal-only → **incomplete enrollment** (inert orphan, zero credentials) |
| Rotate | credential durable | credential unchanged (audit intent discarded) |
| Revoke | credential marked revoked | credential unchanged |
| Disable / Enable | principal status durable | status unchanged |
| Migrate | per-token: credential binding durable | already-bound tokens stay bound; remainder unbound; resumable |

- **No unaudited mutation can exist** (audit precedes the write). The accepted
  cost — same as today's #685 design — is a **discarded audit intent** when a
  crash lands between the audit append and the write. That is recorded, not
  treated as a committed fact.
- **Incomplete-enrollment reconciliation.** `alix inspector auth reconcile` (and
  load-time reporting) identifies principals with **zero bound credentials** as
  incomplete enrollments, and lists bound credentials whose principal is missing
  or disabled. It **reports; it never silently deletes**. The principal record and
  its audit intent are durable evidence. Removal is explicit
  (`alix inspector auth principal remove`).
- **Enrollment ordering.** Principal is written **before** the credential, so the
  only reachable partial state (crash after principal, before credential) is an
  inert orphan (no credential resolves to it). The reverse order — a credential
  pointing at a nonexistent principal — is unreachable.

## Migration races (rev 2, item 4)

Migration acquires **principal → token** locks for the batch, so it serializes
against rotation, revocation, and disablement (which take those same locks).
Inside the lock, for each candidate token it **re-reads** and binds only when:

- `principalId` is absent (idempotent: an already-bound token is skipped), and
- the token is **not revoked** (revocation is terminal — never resurrected), and
- the token is **not expired**, and
- when `--principal <id>` is given, that principal **exists and is active**,
  re-checked *after* the lock (never a stale snapshot).

The binding write asserts the token's `revision` (CAS). Deterministic outcomes:

| Race | Outcome |
| --- | --- |
| Migration vs disablement | serialized on the principal lock; a disable does not let migration bind to a now-disabled principal (re-check under lock) |
| Migration vs rotation | serialized on the token lock; only token ids present at lock time are considered; a superseded/expired token is never bound |
| Migration vs revocation | a revoked token is skipped; migration never un-revokes or re-binds a terminal credential |

Migration never un-disables a principal, un-revokes a credential, or overwrites
an existing `principalId`.

## Test matrix (all must ship)

| Area | Cases |
| --- | --- |
| Identity / enrollment | creates principal + first credential; ordered; principal-only partial write is inert and reported as incomplete |
| Rotation | inherits `principalId`; grace window; unbound token stays unbound |
| Revocation | only that credential dies; terminal; principal usable via others |
| Disablement | bound + disabled → **all** authentication denied (bearer + cookie); missing/unavailable principal denied; re-enable restores; unbound legacy token unaffected |
| Status freshness | disable from a **separate store instance** takes effect next request |
| Legacy tokens | ordinary access continues; principal-required denied; no implicit principal |
| Migration | binds unbound; `--principal` adoption idempotent; not-found/disabled/unavailable fail with no change; partial batch resumable; **revoked/expired skipped (no resurrection)** |
| **Concurrency** | two writers → no lost update (lock); CAS revision mismatch refused; **lock order principal→token, no deadlock** under interleaved enrollment+migration+disable; stale lock fails closed with no write |
| Durability | audit-intent failure → nothing written (`audit_write_failed`); crash between principal and credential → inert orphan + reconcile report; reconcile never deletes |
| Fail-closed | principal store unavailable → bound credentials denied everywhere; unbound legacy still ordinary |
| Context | `SecurityContext.principalId` populated on bearer + cookie |
| Parity | role × workspace scope × principal status, broader than the handler (mirrors `tests/ownership/path-scope.test.ts`) |

**Auth audit** for enroll/rotate/revoke/disable/enable/migrate goes through the
existing `AuthAuditStore`. This is **not** the SRAP audit projection (workstream
B) and does not touch it.

## Normative contracts to update (forward contracts; A′ unimplemented)

- `src/interfaces/server/AGENTS.md` — add a forward contract: a **bound**
  credential whose principal is disabled/missing/unreadable is denied all
  authentication; only a genuinely unbound legacy credential gets ordinary access;
  auth mutations are serialized by a cross-process lock and remain fail-closed on
  audit and on a stale lock.
- `src/interfaces/cli/commands/security/AGENTS.md` — the new `alix inspector auth`
  subcommands (`migrate`, `principal disable|enable|remove`, `reconcile`),
  write-ahead audit, and the lock/ordering rule.
- Root `AGENTS.md` — only if a durable rule (e.g. lock reuse) becomes repo-wide.

These are documented as **forward contracts** (the repo already uses that form,
e.g. the "Future remote decisions" bullet), never as implemented behaviour, until
A′ lands.

## Migration & rollback

- Additive and compatible: existing stores load unchanged (missing `principalId`
  → unbound/legacy). Ordinary access unchanged for unbound tokens.
- Rollout: ships alongside A/B; the remote route (C) still requires A′ + explicit
  scope + active principal, and stays default-off.
- Rollback: removing A′ leaves credentials intact; unbound tokens keep ordinary
  access.

## Out of scope

- The remote decision route (G3-C) and its parity table.
- Any second credential authority or secret store.
- Changing token hashing, roles, or workspace semantics.
- A cross-file transaction layer; promoting the shared lock to a new home.

## Open questions — RESOLVED before coding

1. Enrollment default → `auth create` always creates a new principal; `--principal <id>` binds to an existing one.
2. Principal store location → `<authStateDir>/principals.json` (sibling to `auth-store.json`).
3. Legacy migration trigger → explicit command only; no auto-bind.
4. `auth rotate` principal → inferred from the rotated credential.
5. Lock primitive → reuse `src/governance/security/audit/audit-lock.ts`; order principal → token; stale lock fails closed.
