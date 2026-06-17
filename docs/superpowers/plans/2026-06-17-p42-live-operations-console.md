# P4.2 — Live Operations Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Elevate the Inspector UI to a polished live operations console with per-agent cards, token/context/cost meters, event category filters, search/auto-follow, approval/replan inbox, DAG visualization, and replay controls that match the screenshot parity.

**Architecture:** Enhance the existing vanilla JS Inspector (`src/ui/app.js`, `src/ui/index.html`) with new panel views and richer rendering. Add new API routes to `/api/` for per-run cost data, per-agent token usage, and replan proposal browsing. Leverage the existing SSE stream, session reader, and coordination routes. No framework swap — stay with vanilla JS.

**Tech Stack:** TypeScript (backend), Vanilla JS/HTML/CSS (frontend), existing SSE streams and API routes, `src/server/server.ts`

## Global Constraints

- No framework migration (keep vanilla JS for the Inspector UI)
- New API routes follow existing patterns in `src/server/server.ts`
- All backend tests use `node:test` + `node:assert/strict`
- All imports use `.js` extensions (NodeNext)
- The existing 15-panel tab layout is preserved and extended

---

### Task 1: Event category filters and unified search

**Files:**
- Modify: `src/ui/app.js` (event rendering, filter logic)
- Modify: `src/ui/index.html` (filter controls UI)
- Modify: `src/ui/styles.css` (filter bar styling)

Add an event filter bar above the timeline with toggle buttons for event categories:
- All | Tools | Messages | Context | Sessions | Subagents | Files | Patches | Runtime | Ownership

Implement unified search across the timeline:
- Search input filters visible events by text match on event type, payload content
- Search highlights matching events
- Clear search resets to full timeline

Add auto-follow toggle:
- When enabled, timeline auto-scrolls to latest event
- When user scrolls up manually, auto-follow pauses
- Resume button appears when paused

**Tests:** (frontend behavior tested via headless DOM or structural assertions on rendered HTML)

---

### Task 2: Per-agent cards with token/context/cost meters

**Files:**
- Modify: `src/ui/app.js` (agent card panel)
- Modify: `src/ui/index.html` (agent cards section)
- Create: `src/server/agent-routes.ts` (API routes for per-agent data)

Add an agent cards panel showing each active agent:
- Agent ID/role badge
- Token usage bar (input vs output tokens, cached vs fresh)
- Context usage bar (current context window %)
- Estimated cost (calculated from token usage * rate)
- Current status (running, waiting, completed, failed)
- Duration / elapsed time

Backend:
- `GET /api/agents/:agentId/usage` — returns token usage, cost estimate, context utilization
- `GET /api/agents/:agentId/status` — returns current agent status and duration
- Cost estimation uses simple per-model token rates (capped at $0 if unknown)

---

### Task 3: Approval and replan inbox

**Files:**
- Create: `src/server/replan-routes.ts` (replan API routes)
- Modify: `src/ui/app.js` (inbox panel)
- Modify: `src/ui/index.html` (inbox section)

Add an inbox panel showing:
- Pending approvals (from ApprovalStore.listPending())
- Awaiting_approval replan proposals (from ReplanProposalStore)
- Resolved/recent history (last 24h)

Each item shows:
- Type badge (approval | replan)
- Risk level badge
- Summary/reason
- Timestamp and age
- Status badge
- Action buttons (approve/deny/view details)

Backend:
- `GET /api/replan/proposals` — list proposals filtered by status
- `GET /api/replan/proposals/:id` — full proposal details including draft and impact
- (Reuse existing `/api/approvals` endpoint)

---

### Task 4: DAG and execution visualization

**Files:**
- Modify: `src/ui/app.js` (graph panel enrichment)
- Modify: `src/ui/index.html` (graph view section)
- Modify: `src/server/server.ts` (additional graph endpoints if needed)

Enrich the existing Graph panel with:
- Visual DAG view (directed graph of workers with dependency arrows)
- Worker status color coding (pending→gray, running→blue, completed→green, failed→red, blocked→orange)
- Click worker → show detail panel with goal, status, attempt, findings
- Revision history display (plan revisions with diff summaries)
- Failure chain visualization (trace from failed worker through dependents)

Backend: existing `/api/graphs/:id/projection` provides the graph data. Add worker-level detail route if missing.

---

### Task 5: Richer replay controls

**Files:**
- Modify: `src/ui/app.js` (replay enhancements)

The existing replay bar has start/step/play/end/speed. Enhance:
- Event counter at current position (e.g., "Event 47 / 312")
- Play indicator animates while replaying
- Speed display reflects current slider value
- Keyboard shortcuts: Space=play/pause, Left=step back, Right=step forward, Home=start, End=end

---

### Task 6: Live counters dashboard

**Files:**
- Modify: `src/ui/app.js` (dashboard strip)
- Modify: `src/ui/index.html` (header section)

Add a live counters strip below the masthead:
- Active agents count
- Pending approvals count
- Error count (last 5 min)
- API call count (last 5 min)
- Total tokens used (last 5 min)
- Each counter is a small badge that updates via SSE events

---

## Verification

1. `npm run build` — clean build
2. Existing tests pass
3. Inspector UI renders all new panels
4. Agent cards show correct token/context/cost data
5. Approval and replan proposals appear in inbox
6. DAG view renders workers with correct status colors
7. Replay controls respond to keyboard shortcuts
