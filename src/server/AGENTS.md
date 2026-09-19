# DOX — Inspector Server

**Purpose:** HTTP server for the Inspector web UI — serves static files, SSE event streams, JSON API endpoints.

**Ownership:**
- `server.ts` — Route dispatch + handlers: sessions (SSE, snapshot, comparison), graphs (list, projection), registry (agents, tools), policy (rules, eval), approvals, audit.
- `coordination-routes.ts` — Coordination API: read-only GET views plus the gated execution POSTs (run/cancel, background dispatch).

**Local Contracts:**
- Data API routes are read-only GET except for: the read-only evidence-integrity
  verification endpoint, and the coordination execution endpoints
  (`POST /api/coordination/run`, `POST /api/coordination/:runId/cancel`).
  Execution endpoints require the `coordination:execute` permission
  (authenticated routes); loopback development passes through per the global
  auth posture like every other authenticated route. Runs execute detached —
  the client polls the existing GET routes; a server restart drops in-flight
  execution (the daemon owns durable ticking). Ask-mode worker capabilities
  create approvals through the server-side ApprovalStore, visible in the
  approvals panel. Authentication session exchange/logout are the other
  POST routes; no other HTTP route may execute agent actions.
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
- SSE streams require authentication in required mode and serve session events
  with `Last-Event-ID` resume support.
- `VISIBLE_EVENTS` filter controls which event types stream to the browser.
- Graph routes: `/api/graphs` (list), `/api/graphs/{id}/projection` (detail).
- Policy routes: `/api/policy/rules`, `/api/policy/eval`.
- All data sourced from `.alix/` directory on disk.
- CORS is not set on API routes (same-origin in production).

**Work Guidance:**
- Adding a new API route means adding a new `if (url.pathname === ...)` block in `server.ts`, or a branch in `registerCoordinationRoutes()` for `/api/coordination/*` paths (plus a `route-policy.ts` descriptor — the coverage test enforces it).
- New read-only endpoints are preferred over write endpoints; new execution POSTs need the `coordination:execute`-style permission gate, not just a descriptor.
- Error responses use consistent JSON shape: `{ error: string }`.

**Verification:**
- `tests/server/server.test.ts` — HTTP smoke tests for registry, graph list, policy, approvals, audit endpoints.
- `tests/server/auth-routes.test.ts` — session exchange/logout plus required-mode
  Bearer, cookie, permission, SSE, route-registration, and revocation behavior.
- `tests/security/inspector/authorization.test.ts` and
  `tests/security/inspector/auth-service.test.ts` — authorization and token/session-principal validation.
