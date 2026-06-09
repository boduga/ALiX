# DOX — Inspector Server

**Purpose:** HTTP server for the Inspector web UI — serves static files, SSE event streams, JSON API endpoints.

**Ownership:**
- `server.ts` — All route handlers: sessions (SSE, snapshot, comparison), graphs (list, projection), registry (agents, tools), policy (rules, eval), approvals, audit.

**Local Contracts:**
- All API routes are read-only GET. No POST/PUT/DELETE for execution.
- SSE stream serves session events with `Last-Event-ID` resume support.
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
