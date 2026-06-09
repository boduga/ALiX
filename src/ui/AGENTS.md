# DOX — Inspector Web UI

**Purpose:** Browser-based session inspector for live event streaming, replay, graph execution visibility, policy management, and approval tracking.

**Ownership:**
- `index.html` — HTML shell with 12 tab panels (Timeline, Context, Diffs, Terminal, Approvals, Verification, Tokens, Subagents, Compare, Registry, Graph, Policy, Approvals)
- `app.js` — Main driver: SSE connection, replay controls, rendering all panels
- `projection.js` — Client-side event projection (buildUiProjection, createReplayState, visibleEventsForReplay)
- `styles.css` — Dark-themed styling (~1100 lines)

**Local Contracts:**
- No build pipeline. Files are served statically by the server from `dist/src/ui/`.
- Tab switching: `button.tab[data-panel="X"]` activates `section#panel-X`.
- Replay: cursor-based, events sorted by seq, play/pause/step/speed controls.
- All data fetched from `/api/*` read-only endpoints.
- `escapeHtml()` always used for user-facing text.
- New tabs follow the same pattern: add button to nav, add panel section, add JS render function.

**Work Guidance:**
- The Inspector is read-only (observability). No browser write actions.
- Adding a new tab: (1) add button in index.html, (2) add panel section, (3) add load/render functions in app.js, (4) add CSS rules.
- SSE event types visible to the Inspector are controlled by `VISIBLE_EVENTS` in server.ts.
- Registry, Policy, Graph, and Approvals tabs load data on page load (no session needed).

**Verification:**
- Manual verification via `alix serve` and browser inspection.
- Server HTTP tests in `tests/server/server.test.ts` validate API responses.
