# Inspector Web UI

## Overview
The browser-based Inspector: a static, no-build set of assets served from `dist/src/interfaces/ui/` for live event streaming (SSE), cursor-based replay, graph execution, policy/approval/audit read views, and the only two server-authorized execution actions (coordination run and cancel). All observation panels are read-only; approval decisions stay CLI-first ([AGENTS.md:Local Contracts], [app.js:renderAll]).

## Interface
- `index.html` — shell, connection panel, and 16 `button.tab[data-panel="X"]` tabs mapping to `section#panel-X` ([index.html:panel-timeline])
- `app.js` — main driver: tab switching, replay controls, SSE `connect(sessionId)`, `renderAll()`, and per-panel loaders/renderers ([app.js:connect], [app.js:renderAll])
- `app.js` execution actions: `POST /api/coordination/run` and `POST /api/coordination/{runId}/cancel` ([app.js:loadCoordRunDetail])
- `projection.js` — pure client projection: `buildUiProjection`, `createReplayState`, `visibleEventsForReplay`, `projectSubagentEvents`, plus exported lifecycle sets ([projection.js:buildUiProjection])
- `auth.js` — `window.ALiXAuth` with `init()`, `onFetchError()`, and an `isAuthenticated` getter ([auth.js:init])
- `styles.css` — dark-theme styling; not a contract surface ([AGENTS.md:Ownership])

## Invariants
- Event order is `seq`-ascending: both `buildUiProjection` and `createReplayState` sort a copy by `(seq ?? 0)` and never mutate the input array ([projection.js:buildUiProjection], [projection.js:createReplayState]).
- `visibleEventsForReplay` returns `events.slice(0, Math.max(0, cursor))`, so the replay cursor can never expose more events than were collected ([projection.js:visibleEventsForReplay]).
- The subagent timeline prefers canonical `agent.*` rows carrying `agentId`/`subagentId`; the main loop's identity-less `agent.state_changed` is excluded, and legacy `subagent.*` rows are used only when no canonical subagent row exists ([projection.js:projectSubagentEvents]).
- Context uses `context.bundle_compiled` with `context.bundle_created` as a legacy fallback only ([projection.js:buildContext]).
- A subagent row's `duration` is only computed when a terminal success/failure event can be matched back to a start event ([projection.js:projectSubagentEvents]).
- Every interpolated user-facing value passes through `escapeHtml`, which escapes `& < > " '` ([app.js:escapeHtml]).
- A coordination run detail stops polling once status is one of `completed`, `failed`, `cancelled`, and the cancel button is rendered only while non-terminal ([app.js:loadCoordRunDetail]).
- The runs poller is suppressed while the Runs panel is not active ([app.js:loadCoordRunDetail]).
- Run start clamps `maxConcurrency` to `1..8` and parses it as base-10, defaulting to 2 ([app.js:loadCoordRunDetail]).
- `auth.js` keeps the token only in the input element and clears it immediately on success; nothing is written to `localStorage`, `sessionStorage`, or the console ([auth.js:doLogin] file doc).
- Authentication state is best-effort: `probeAuth` treats an `ok` `/api/graphs` response as authenticated and every other outcome as unauthenticated ([auth.js:probeAuth]).
- A 401 on any `fetch` triggers `onFetchError()`, which only clears state when currently authenticated ([auth.js:onFetchError]).
- Tab activation is class-toggle based: `button.tab[data-panel="X"]` activates `section#panel-X` ([app.js:renderAll] tab wiring).

## Side Effects
- Opens an SSE `EventSource` at `/api/sessions/{sessionId}/events`, closing any prior stream first ([app.js:connect]).
- Issues `fetch` reads against `/api/*` GET routes (registry, graphs, coordination, policy, approvals, runtime, audit, daemon, state) and the two `POST` execution routes ([app.js:loadCoordRunDetail]).
- `auth.js` POSTs `/api/auth/session` on login and `/api/auth/logout` on logout, and wraps `window.fetch` to observe 401 responses ([auth.js:installFetchInterceptor]).
- Replay uses a `setInterval` timer cleared on pause/start/end; the runs panel uses its own 3-second polling interval ([app.js:connect] replay controls, [app.js:loadCoordRunDetail]).
- Graph rerun writes the command text to the clipboard via `navigator.clipboard`, falling back to a temporary textarea plus `execCommand("copy")` ([app.js:showRerunCommand]).
- DOM mutation only: panels are re-rendered via `innerHTML` and class toggles ([app.js:renderAll]).

## Verification
- Run: `pnpm test`
- Projection vocabulary parity: `tests/ui/projection.vitest.ts`; server API responses: `tests/server/server.test.ts` ([AGENTS.md:Verification]).
