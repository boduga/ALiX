# Inspector HTTP Server

## Overview

The HTTP surface of the ALiX Inspector: one Node `http` server that serves the web UI, JSON data APIs, server-sent event streams, and the two gated execution POSTs. Routing is a single linear dispatch chain in `server.ts`, and every request passes the same ordered gauntlet — HTTP limits, URL parse, Host validation, client-address resolution, baseline security headers, and the security middleware — before any handler runs `[server.ts:startServer]`.

The package's job is to keep one authorization answer across all of that surface. Route identity comes from `routeRegistry` descriptors in `src/governance/security/inspector/route-policy.ts`, and authentication, origin policy, remote access, rate limits, and permission checks all read from that one descriptor set rather than from per-handler logic `[security-middleware.ts:createSecurityMiddleware]`.

Workspace identity is server-derived: `startServer` canonicalizes its project root once through `canonicalWorkspaceId` and rejects startup if that fails; request headers, body, and query can never establish or override it `[server.ts:startServer]`.

## Interface

- `startServer(root, host, port, allowedHosts?, allowedOrigins?, trustedProxyCidrs?, authentication = "disabled-loopback-development", remoteDecisions?)` — resolves to `{ close, url }`; rejects unknown auth modes and rejects disabled auth on a non-loopback host `[server.ts:startServer]`.
- `VISIBLE_EVENTS` — the SSE allowlist for session streams (tool events, `agent.*`, `approval.*`, `file.created`, `patch.*`, `runtime.phase.*`, `model.usage`, `context.*`, plus legacy `subagent.*`) `[server.ts:VISIBLE_EVENTS]`.
- `createSecurityMiddleware(config)` — returns the async per-request middleware that yields a `SecurityContext` or `null` after already sending a denial `[security-middleware.ts:createSecurityMiddleware]`.
- `SecurityMiddlewareConfig` — host, allowed hosts/origins, route registry, secret detector, `enforceAuth`, auth service, target workspace, session store, pre/post-auth limiters, connection limiter, remote access config, trusted proxy CIDRs `[security-middleware.ts:SecurityMiddlewareConfig]`.
- `derivePermissions(role)` — closed-vocabulary role→permission map; every role starts with `health:read` `[security-middleware.ts:derivePermissions]`.
- `createSecureResponder(res, registry, detector, opts?)` → `SecureJsonResponder` with `ok(value, profileName?)` and `error(code, status, details?)` `[secure-response.ts:createSecureResponder]`.
- `createSecureSseConnection(res, ctx, limiter, opts?)` → `SecureSseConnection | null`; `null` means the connection limiter refused the slot and no SSE headers were applied `[secure-sse.ts:createSecureSseConnection]`.
- `SecureSseConnection` — `send(event, data, id?)`, idempotent `close()`, `onClose(cb)` `[secure-sse.ts:SecureSseConnection]`.
- `SecureSseOptions` — per-event bytes (64 KB), total buffer (1 MB), buffered events (1000), backpressure timeout (30 s), heartbeat interval (30 s), optional max lifetime `[secure-sse.ts:SecureSseOptions]`.
- `handleSessionExchange(req, res, responder, authService, sessionStore)` — `POST /api/auth/session` `[auth-routes.ts:handleSessionExchange]`.
- `handleLogout(req, res, responder, sessionStore, onAudit?)` — idempotent `POST /api/auth/logout` `[auth-routes.ts:handleLogout]`.
- `parseSessionCookie(req)` — the single cookie parser shared by the exchange handler and the middleware `[cookie-utils.ts:parseSessionCookie]`.
- `RemoteDecisionOptions` and `registerRemoteDecisionRoutes(...)` — default-off `POST /api/approvals/:id/decision` `[remote-decision-route.ts:RemoteDecisionOptions]`.
- `registerCoordinationRoutes(cwd, method, pathname, res, ctx?, responder?, req?)` — coordination GET views plus `POST /api/coordination/run` and `POST /api/coordination/:runId/cancel` `[coordination-routes.ts:registerCoordinationRoutes]`.
- `cancelAllBackgroundRuns()` and `resumeInspectorRuns(cwd)` — shutdown abort and startup reclaim/resume `[coordination-routes.ts:cancelAllBackgroundRuns]`.
- `handleEvidenceRoute(ctx)` — `/api/security/evidence*`, including the read-only `POST .../verify` `[evidence-routes.ts:handleEvidenceRoute]`.
- `SessionStreamHub` — `subscribe`, `unsubscribe`, `replay`, `stop`, `diagnostic`, with `maxTailers`/`idleGraceMs`/`maxReplayEvents` options `[session-stream-hub.ts:SessionStreamHub]`.
- `ObservabilityStreamHub` — `start`, `stop`, `subscribe`, `unsubscribe`, `replay`, ring-buffered in-memory event reuse `[observability-stream-hub.ts:ObservabilityStreamHub]`.
- `subscribeObservabilityStream(res, root)` — the direct, timer-driven legacy observability SSE writer `[observability-stream.ts:subscribeObservabilityStream]`.
- `assessSecurityHealth(ctx?)` → `SecurityHealthSnapshot`, `toSecurityStatusResponse(snapshot)`, `getAlerts()`, `resetAlerts()` `[security-alerts.ts:assessSecurityHealth]`.
- `AlertSeverity`, `AlertCategory`, `HealthStatus`, `SecurityAlert`, `SubsystemHealth`, `SecurityHealthSnapshot`, `HealthAssessmentContext` `[security-alerts.ts:SecurityAlert]`.
- `HttpLimitsConfig`, `HttpLimitValidationResult`, `buildServerOptions(config?)`, `validateHttpLimits(req, config?)`, `validateUrlLength`, `validateNoBodyOnReadMethods`, `validateAuthBodySize`, `headersReceived`, `elapsedMs` `[http-limits.ts:validateHttpLimits]`.
- Limits defaults: 16 KB max header size, 10 s headers timeout, 30 s request timeout, 5 s keep-alive, 100 requests/socket, 8 KB URL, 10 KB auth body `[http-limits.ts:DEFAULT_MAX_HEADER_SIZE]`.
- `BASE_SECURITY_HEADERS` / `applySecurityHeaders(res)` and `API_CACHE_HEADERS` `[security-headers.ts:BASE_SECURITY_HEADERS]`.

## Invariants

- Pipeline order is fixed: `validateHttpLimits` → URL parse → `validateHost` → `resolveClientAddress` → `applySecurityHeaders` → `securityMiddleware` → `createSecureResponder`; a failed step returns before any handler is reached `[server.ts:startServer]`.
- In `required` auth mode an `/api/` path with no registered route descriptor fails closed with `route_not_registered` (404), so a forgotten descriptor cannot expose a handler `[security-middleware.ts:createSecurityMiddleware]`.
- Tokens are never accepted from the query string: `token`, `access_token`, or `bearer` in the query yields `token_in_query_string` (400); multiple `Authorization` headers are rejected, and only `Bearer ` is accepted `[security-middleware.ts:extractBearerToken]`.
- `derivePermissions` is a closed vocabulary — `admin`, `operator`, and `readonly` are enumerated explicitly and unknown roles receive only `health:read` `[security-middleware.ts:derivePermissions]`.
- The decision route's workspace denial is mapped to 403 `workspace_scope_required`; every other authentication failure on that route maps to 401 `workspace_mismatch` `[security-middleware.ts:mapAuthenticationFailure]`.
- `api.approvals.decision` additionally requires an explicit, nonempty workspace scope that contains the canonical workspace `[security-middleware.ts:hasDecisionWorkspaceScope]`.
- SSE headers are set only after the connection limiter reserves a slot; a refused reservation returns `null` and leaves the response un-upgraded `[secure-sse.ts:createSecureSseConnection]`.
- SSE cleanup is idempotent through a single `cleanup()`: timers cleared, `drain` listeners removed, and the limiter token released exactly once `[secure-sse.ts:createSecureSseConnection]`.
- Oversized single SSE events are dropped rather than disconnecting the client; buffer overflow closes the connection with reason `buffer_overflow` `[secure-sse.ts:createSecureSseConnection]`.
- SSE event data is redacted before serialization, and payloads are framed as `event:` / `id:` / `data:` lines `[secure-sse.ts:createSecureSseConnection]`.
- `ok()` falls back to `error("ALIX_100", 500)` on serialization failure without exposing the original value, and error `details` are redacted under the `public` profile — when no detector is available, details are omitted entirely `[secure-response.ts:respondError]`.
- `applySecurityHeaders` never overwrites a header that a handler already set, which is what lets SSE keep its own `Cache-Control` `[security-headers.ts:applySecurityHeaders]`.
- Session exchange requires same-origin when `Origin`/`Referer` is present, caps the body at 10 KB, returns no `secure` cookie flag unless the transport is HTTPS (direct TLS or a forwarded HTTPS proto), and never echoes the token `[auth-routes.ts:handleSessionExchange]`.
- Session exchange is rate limited to 20 attempts per IP per 60 s, and the limiter map is bounded at 10 000 entries `[auth-routes.ts:isRateLimited]`.
- Logout is idempotent: it always returns `{ ok: true }` and always expires the cookie `[auth-routes.ts:handleLogout]`.
- A `pending` approval is eligible only while unexpired; a missing, empty, or unparsable `expiresAt` is corrupt authority and returns 409 `expired` `[remote-decision-route.ts:registerRemoteDecisionRoutes]`.
- Remote-decision authorization runs before any approval state is read; an exact retry (`principalId`, `nonce`, `decision`) returns 200, and any conflicting retry returns 409 with no state disclosure `[remote-decision-route.ts:registerRemoteDecisionRoutes]`.
- Remote-decision transport must be `direct-tls` or an unambiguous trusted-proxy `proxy-tls`; anything else is 403 `insecure_transport` `[remote-decision-route.ts:deriveRemoteTransport]`.
- If the evidence key is unavailable or the mandatory key-read audit cannot be written durably, the decision is not committed: 503 `evidence_unavailable` `[remote-decision-route.ts:registerRemoteDecisionRoutes]`.
- `resolveWithEvidence` counts as success only when *our* evidence landed in the committed record; a losing race is a 409 conflict, never a silent overwrite `[remote-decision-route.ts:registerRemoteDecisionRoutes]`.
- Session SSE rejects an unsubscribable session with 503 `too_many_tailers`, and a refused connection slot with 503 `connection_limit` `[server.ts:startServer]`.
- Session IDs are validated against path traversal before any snapshot, stream, or hub path construction; an invalid ID yields the `InvalidSessionIdError` rejection `[server.ts:startServer]`.
- `SessionStreamHub.subscribe` returns `false` for an invalid session ID or when the tailer cap is reached, and tailers are shared one-per-session across subscribers `[session-stream-hub.ts:SessionStreamHub]`.
- Replay is cursor-based: a `Last-Event-ID` below the first available event yields `replay.reset`, above latest yields no replay, and replay is bounded per reconnect `[session-stream-hub.ts:SessionStreamHub]`.
- GET/HEAD/DELETE/OPTIONS/TRACE requests must not declare a body (`content-length > 0` or any `transfer-encoding` is `body_not_allowed`, 400); only POST/PUT/PATCH may `[http-limits.ts:validateNoBodyOnReadMethods]`.
- URL length is capped at 8 KB by default and returns 414 `url_too_long` `[http-limits.ts:validateUrlLength]`.
- `assessSecurityHealth` is strictly passive — it reports status and never triggers verification, audits, signing, or tests; a subsystem with no evidence reports `unknown` rather than assuming health `[security-alerts.ts:assessSecurityHealth]`.
- The security-status response is deliberately narrow: overall status, per-subsystem status/summary, alert counts, and critical/warning alert ids and titles — never credentials, hashes, or addresses `[security-alerts.ts:toSecurityStatusResponse]`.

## Side Effects

- Binds and listens on the requested host/port, returning the resolved URL, and on listen starts the observability hub, attempts one best-effort remote-decision audit projection, and resumes Inspector-hosted coordination runs `[server.ts:startServer]`.
- `close()` stops both SSE hubs, releases all connection-limiter slots, cancels every background coordination run, and only then closes the HTTP server `[server.ts:startServer]`.
- Auth mutations append JSONL audit records; an append failure increments `authAuditWriteFailures` and logs to stderr before rethrowing so the mutation fails closed `[server.ts:startServer]`.
- The auth store lives at `<authStateDir>/auth-store.json` and the auth audit at `<authStateDir>/audit.jsonl`; browser sessions are in-memory only and do not survive restart `[server.ts:startServer]`.
- `POST /api/coordination/run` plans and dispatches a detached background run; the handler returns a `runId` and the client polls the GET views `[coordination-routes.ts:handleStartRun]`.
- A live scheduler handle is retained per run id for cancellation; awaiting approval keeps the scheduler alive and re-ticks every 3 s rather than terminating `[coordination-routes.ts:runDetached]`.
- `resumeInspectorRuns` reclaims dead-owner workers, skips runs with no actionable worker or with a still-live worker, and resumes under the run's original approval mode `[coordination-routes.ts:resumeInspectorRuns]`.
- Cancelling an unknown run is an idempotent success, checked before loading config so it works in a fresh workspace `[coordination-routes.ts:handleCancelRun]`.
- Session tailers watch the session events JSONL via `fs.watch`, read incrementally from a byte offset, reset on truncation, and stop after an idle grace period with no subscribers `[session-stream-hub.ts:SessionTailer]`.
- The observability hub produces on a 2 s cycle and can `unref()` its interval so the process can still exit `[observability-stream-hub.ts:ObservabilityStreamHub]`.
- Security headers are applied to every response: CSP, `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `same-origin` CORP, HSTS, and `Cache-Control: no-store` `[security-headers.ts:BASE_SECURITY_HEADERS]`.
- The connection limiter is released on all SSE close, error, and backpressure paths, so a dropped client cannot leak a slot `[secure-sse.ts:createSecureSseConnection]`.
- Remote-decision attempts open the credential store, append a `credential.key_read` audit record, and then project remote decisions inline; a projection failure is logged but never changes the decision outcome `[remote-decision-route.ts:registerRemoteDecisionRoutes]`.

## Verification

- Run: `pnpm test`
