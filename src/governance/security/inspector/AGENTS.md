# DOX — Inspector Security (auth + principals)

**Purpose:** Inspector authentication and operator-identity primitives — token
(hash-only) storage, the operator principal store, the credential→principal
binding, session/context plumbing, and the shared cross-process store lock. No
secrets live here (see `../credentials/AGENTS.md`).

**Ownership:**
- `auth-store.ts` — `AuthStore`: hash-only token records (`StoredToken`) at
  `<authStateDir>/auth-store.json`. Owns credential verification/revocation **and
  is the single authority for the credential→principal binding**
  (`StoredToken.principalId`). Atomic temp+rename, `0o600`, `lstatSync` symlink
  rejection; mutations take the `auth-store` lock.
- `principal-store.ts` — `PrincipalStore`: `PrincipalRecord` (stable
  server-generated `prin_<12>` id, `active`/`disabled` status) at
  `<authStateDir>/principals.json`. Owns operator **identity/status only** — no
  secrets, no `credentialIds` (membership is derived by scanning tokens).
- `store-lock.ts` — `StoreLocks` / `withStoreLocks[Result]`: thin layer over
  `../audit/audit-lock.ts` with canonical lock order and a proof-of-hold
  capability.
- `auth-service.ts` — `AuthService`: enrollment, rotation, revocation, disable/
  enable/remove/migrate/reconcile, and the verification path (`verifyToken`,
  `verifyPrincipalStatus`, `verifyTokenForRequest`).
- `security-context.ts` — `SecurityContext` (`tokenId`, `principalId`, scope).
- `browser-session-store.ts`, `token-format.ts`, `workspace-scope.ts`,
  `rate-limiter.ts`, `connection-limiter.ts`, `route-policy.ts`,
  `client-address.ts`, `host-policy.ts`, `origin-policy.ts`,
  `remote-access-policy.ts`, `authorization.ts`, `auth-audit-store.ts` — as named.

**Local Contracts:**
- **Authentication matrix (normative).** Unbound legacy credential → ordinary
  access, no principal asserted; bound to an **active** principal → ordinary
  access with `principalId` on the context; bound to a **disabled / missing /
  unreadable** principal → deny **all** authentication; **revoked** → deny all.
  A bound credential never falls back to ordinary access. Status is read fresh
  on every request (bearer via `verifyTokenForRequest`, cookie via
  `verifyPrincipalStatus`).
- **Credential→principal binding has one authority** (`StoredToken.principalId`).
  Membership is derived; there is no reverse list to drift.
- **Revocation preserves `principalId`** for historical attribution; the revoked
  state is what denies access.
- **Cross-process serialization.** Every read-modify-write on either store runs
  under the shared lock; lock order is canonical `principals` → `auth-store`
  (never reversed); authoritative state is re-read **after** acquiring the lock;
  each mutation is a `revision` CAS. A held or stale lock **fails closed** with no
  write (`staleRecovery: "manual"`). Atomic rename alone is not update isolation.
- **Write-ahead audit.** Auth mutations append the audit intent first; a failed
  append persists nothing and is never acknowledged as success. No cross-file
  transaction is claimed: enrollment is ordered principal-then-credential so the
  only reachable partial state is an **inert orphan principal**.
- **Migration** binds only unbound, non-revoked, non-expired tokens; an adopted
  `--principal` is re-checked active under the lock; idempotent under concurrent
  migration; never resurrects a revoked credential.
- **`reconcile` reports, never deletes.** Removal is explicit
  (`principal remove`) and refuses while credentials remain bound.
- Store-only secret resolution and the fail-closed audit rule are owned by
  `src/interfaces/server/AGENTS.md` and `../credentials/AGENTS.md`.

**Work Guidance:**
- New auth mutations must take the locks (via the store methods or
  `withStoreLocks*`) and re-read inside them; never mutate a pre-lock snapshot.
- Adding a field to `StoredToken`/`PrincipalRecord` means updating the type, the
  normalizers, and the store snapshot versioning.
- Keep the authentication matrix and its parity test
  (`tests/security/inspector/principal-parity.test.ts`) in step.

**Verification:**
- `tests/security/inspector/auth-store.test.ts`, `auth-service.test.ts`,
  `authorization.test.ts` — store + service + authorization.
- `tests/security/inspector/principal-identity.test.ts` — lifecycle, authentication
  matrix, durability, migration, reconcile.
- `tests/security/inspector/principal-parity.test.ts` — credential-state ×
  transport parity table (broader than the handler).
- `tests/security/inspector/store-lock-concurrency.test.ts` — cross-process
  serialization, CAS, fail-closed on a held lock, lock order, concurrent
  migration.
- `tests/server/workspace-authorization.test.ts`, `tests/server/auth-routes.test.ts`
  — server-level bearer/cookie × scope × auth-mode parity.

**Child DOX Index:** none.
