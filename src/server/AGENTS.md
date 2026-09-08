# DOX — Inspector Server

**Purpose:** HTTP server for the Inspector web UI — serves static files, SSE event streams, JSON API endpoints.

**Ownership:**
- `server.ts` — All route handlers: sessions (SSE, snapshot, comparison), graphs (list, projection), registry (agents, tools), policy (rules, eval), approvals, audit.

**Local Contracts:**
- Data API routes are read-only GET. The only POST routes are authentication
  session exchange/logout; no HTTP route may execute agent actions.
- `startServer` receives the configured Inspector authentication mode and must
  pass an explicit `enforceAuth` value to `createSecurityMiddleware`.
- With authentication required, every registered data and SSE route requires
  a valid principal plus its declared permission; unregistered `/api/*` routes
  fail closed.
- Browser cookie sessions are in-memory transports for a token identity. The
  source token record must be revalidated on every request so cross-process
  revocation, expiry, and role changes apply immediately.
- SSE streams require authentication in required mode and serve session events
  with `Last-Event-ID` resume support.
- `VISIBLE_EVENTS` filter controls which event types stream to the browser.
- Graph routes: `/api/graphs` (list), `/api/graphs/{id}/projection` (detail).
- Policy routes: `/api/policy/rules`, `/api/policy/eval`.
- All data sourced from `.alix/` directory on disk.
- CORS is not set on API routes (same-origin in production).

**Work Guidance:**
- Adding a new API route means adding a new `if (url.pathname === ...)` block in `server.ts`.
- New read-only endpoints are preferred over write endpoints.
- Error responses use consistent JSON shape: `{ error: string }`.

**Verification:**
- `tests/server/server.test.ts` — HTTP smoke tests for registry, graph list, policy, approvals, audit endpoints.
- `tests/server/auth-routes.test.ts` — session exchange/logout plus required-mode
  Bearer, cookie, permission, SSE, route-registration, and revocation behavior.
- `tests/security/inspector/authorization.test.ts` and
  `tests/security/inspector/auth-service.test.ts` — authorization and token/session-principal validation.
