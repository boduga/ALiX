# DOX — Inspector Server

## Purpose

HTTP server for the Inspector web UI — serves static files, SSE event streams, JSON API endpoints.

## Ownership

- `server.ts` — Route dispatch + handlers: sessions (SSE, snapshot, comparison), graphs (list, projection), registry (agents, tools), policy (rules, eval), approvals, audit.
- `coordination-routes.ts` — Coordination API: read-only GET views plus the gated execution POSTs (run/cancel, background dispatch).

## Local Contracts

- Data API routes are read-only GET except for: the read-only evidence-integrity
  verification endpoint, and the coordination execution endpoints
  (`POST /api/coordination/run`, `POST /api/coordination/:runId/cancel`).
  Execution endpoints require the `coordination:execute` permission
  (authenticated routes); loopback development passes through per the global
  auth posture like every other authenticated route. Runs execute detached —
  the client polls the existing GET routes. Inspector-hosted runs persist
  `hostKind`/`sessionMode`; on startup the server reclaims through the single
  `shouldReclaimWorker` verdict (provably dead owner, or ownerless on a stale
  heartbeat) and resumes under the run's original approval mode; a still-live
  worker (including ownerless on a fresh heartbeat) blocks resume.
  `cancelAllBackgroundRuns()` runs on server close,
  aborting in-flight runs and their worker children. A run whose workers are
  all terminal is never resumed. Ask-mode worker capabilities
  create approvals through the server-side ApprovalStore, visible in the
  approvals panel. Authentication session exchange/logout are the other
  POST routes; no other HTTP route may execute agent actions.
- Sole non-execution governance mutation exception: default-off
  `POST /api/approvals/:id/decision`. It is bearer-only; requires
  `approvals:decide`, active persistent operator identity, explicit workspace and
  approval eligibility, trusted-proxy TLS validation, bounded idempotency
  evidence, and resolution through existing `ApprovalStore`. It cannot execute
  agent actions, create approvals, or broaden any other browser write surface.
- **Workspace identity is server-derived and host-local.** `startServer`
  canonicalizes its project root once through `canonicalWorkspaceId`
  (`src/governance/security/inspector/workspace-scope.ts`), using native realpath
  of the resolved path. Failure rejects startup before stores initialize. Project
  stores and middleware use that same root; request headers, body, and query
  cannot establish or override it. Absolute canonical paths are local filesystem
  identities, not portable workspace IDs across hosts.
- **Credential scope constrains ordinary Inspector access.** `allowsWorkspace`
  preserves undefined legacy scope, denies non-array or explicitly empty scope,
  and requires canonical membership for nonempty scope. Bearer validation uses
  `verifyTokenForRequest`; cookie requests re-read current source credentials
  through `verifyPrincipalStatus` and apply the same predicate. Missing source
  validation, revocation, expiry, and scope loss deny protected routes even in
  development mode; an invalid credential cannot downgrade to anonymous access.
  Public authentication/logout routes remain available for credential recovery.
  Anonymous ordinary development access and existing role permissions are
  unchanged. `SecurityContext.workspaceIds` preserves absent versus empty scope.
- **Future remote decisions require explicit nonempty scope.** Legacy unscoped
  access, cookie authentication, and anonymous development access grant no remote
  decision authority. The future route must enforce the owning approval contract;
  P3 adds no remote decision endpoint.
- `startServer` receives the configured Inspector authentication mode and must
  pass an explicit `enforceAuth` value to `createSecurityMiddleware`.
- With authentication required, every registered data and SSE route requires
  a valid principal plus its declared permission; unregistered `/api/*` routes
  fail closed.
- Browser cookie sessions are in-memory transports for a token identity. The
  source token record must be revalidated on every request so cross-process
  revocation, expiry, and role changes apply immediately.
- Inspector auth mutations are fail-closed on audit: token create/rotate/revoke
  return `audit_write_failed` and persist nothing when the audit append fails;
  the server counts such failures and alerts on stderr.
- **Operator principals (SRAP-1 G3-A′).** Authentication revalidates the
  credential's current operator principal on every request and applies this
  matrix: an **unbound legacy** credential keeps ordinary role/workspace access
  (and may never stand in for an operator principal); a **bound** credential
  whose principal is **active** behaves normally with `SecurityContext.principalId`
  set; a bound credential whose principal is **disabled, missing, or unreadable**,
  and any **revoked** credential, are denied **all** authentication — ordinary
  routes and cookies alike. This is the critical distinction between *no binding*
  and *a binding that cannot be verified*: a bound credential never falls back to
  ordinary access. Revocation removes authentication eligibility but **preserves
  `principalId`** for historical attribution. Principal and credential
  read-modify-writes are serialized by a shared cross-process lock
  (`principals` before `auth-store`, re-reading authoritative state **after**
  acquiring the lock, revision CAS); a held or stale lock fails the mutation
  closed with no write, and auth mutations stay write-ahead audited (a failed
  audit write is never reported as a successful mutation). Owner:
  `src/governance/security/inspector/AGENTS.md`.
- SSE streams require authentication in required mode and serve session events
  with `Last-Event-ID` resume support.
- `VISIBLE_EVENTS` filter controls which event types stream to the browser; it delivers the canonical vocabulary (including `agent.*` lifecycle and `approval.*`) so the Inspector sees the same reality as the TUI (R4/V10).
- Graph routes: `/api/graphs` (list), `/api/graphs/{id}/projection` (detail).
- Policy routes: `/api/policy/rules`, `/api/policy/eval`.
- All data sourced from `.alix/` directory on disk.
- CORS is not set on API routes (same-origin in production).

## Work Guidance

- Adding a new API route means adding a new `if (url.pathname === ...)` block in `server.ts`, or a branch in `registerCoordinationRoutes()` for `/api/coordination/*` paths (plus a `route-policy.ts` descriptor — the coverage test enforces it).
- New read-only endpoints are preferred over write endpoints; new execution POSTs need the `coordination:execute`-style permission gate, not just a descriptor.
- Error responses use consistent JSON shape: `{ error: string }`.

## Verification

- `tests/server/server.test.ts` — HTTP smoke tests for registry, graph list, policy, approvals, audit endpoints.
- `tests/server/workspace-authorization.test.ts` — bearer/cookie × role × scope ×
  auth-mode parity, current-credential revalidation, request spoofing, canonical
  server roots, and failed startup.
- `tests/server/auth-routes.test.ts` — session exchange/logout plus required-mode
  Bearer, cookie, permission, SSE, route-registration, and revocation behavior.
- `tests/security/inspector/authorization.test.ts` and
  `tests/security/inspector/auth-service.test.ts` — authorization and token/session-principal validation.

## Child DOX Index

None.
