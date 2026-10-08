# DOX — Inspector Web UI

## Purpose

Browser-based session inspector for live event streaming, replay, graph execution visibility, policy management, and approval tracking.

## Ownership

- `index.html` — HTML shell and Inspector tab panels
- `app.js` — Main driver: SSE connection, replay controls, rendering all panels
- `projection.js` — Client-side event projection (buildUiProjection, createReplayState, visibleEventsForReplay, projectSubagentEvents); reads the canonical event vocabulary (R4/V10).
- `styles.css` — Dark-themed styling

## Local Contracts

- **Canonical vocabulary (R4/V10).** Event-derived panels read the same canonical events the TUI reads. Context comes from `context.bundle_compiled` (`context.bundle_created` is a legacy fallback only); the agent timeline reads the canonical `agent.*` lifecycle and falls back to legacy `subagent.*` only when no canonical lifecycle event exists. `VISIBLE_EVENTS` in `server.ts` must deliver the canonical events the UI projects.
- No build pipeline. Files are served statically by the server from `dist/src/ui/`.
- Tab switching: `button.tab[data-panel="X"]` activates `section#panel-X`.
- Replay: cursor-based, events sorted by seq, play/pause/step/speed controls.
- Read views fetch `/api/*` GET endpoints. Coordination run/cancel controls use only the server-authorized execution POST routes and poll GET routes for outcomes.
- `escapeHtml()` always used for user-facing text.
- New tabs follow the same pattern: add button to nav, add panel section, add JS render function.

## Work Guidance

- Observation panels remain read-only. Only coordination run/cancel controls may request agent execution; server authentication and permission gates remain authoritative. Approval decisions stay CLI-first.
- Adding a new tab: (1) add button in index.html, (2) add panel section, (3) add load/render functions in app.js, (4) add CSS rules.
- SSE event types visible to the Inspector are controlled by `VISIBLE_EVENTS` in server.ts.
- Registry, Policy, Graph, and Approvals tabs load data on page load (no session needed).

## Verification

- Manual verification via `alix serve` and browser inspection.
- Run `npx vitest run tests/ui/projection.vitest.ts` for the browser projection vocabulary (context, agent lifecycle, replay).
- Server HTTP tests in `tests/server/server.test.ts` validate API responses.

## Child DOX Index

None.
