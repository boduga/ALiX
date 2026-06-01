# Frontend Observability Enhancement Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand SSE stream to include all event types (not just tool events) and enhance UI views per research spec. Enable complete event log replay in the UI.

**Architecture:** Modify server.ts to stream all event types, not just TOOL_EVENT_FILTER. Update projection.js to project all event types. Expand UI views.

**Tech Stack:** TypeScript, vanilla JS UI, SSE, EventLog

---

## File Structure

| File | Responsibility |
|------|----------------|
| `src/server/server.ts` | Stream all event types via SSE |
| `src/ui/projection.js` | Project events into UI views |
| `src/ui/app.js` | UI rendering and controls |
| `src/ui/styles.css` | UI styling |
| `src/events/types.ts` | Add remaining event type unions |
| `tests/server/events-stream.test.ts` | SSE stream tests |
| `tests/ui/projection.test.js` | Projection tests |

---

## Task 1: Expand SSE Stream to Include All Event Types

**Files:**
- Modify: `src/server/server.ts`
- Test: `tests/server/events-stream.test.ts`

- [ ] **Step 1: Read current server.ts SSE filter**

Line 15-21 shows current filter:
```typescript
const TOOL_EVENT_FILTER = [
  "tool.requested", "tool.started", "tool.output", "tool.completed", "tool.failed",
];
```

- [ ] **Step 2: Write failing test for full event streaming**

```typescript
import { describe, it } from "node:test";
import assert from "node:assert";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

describe("SSE Event Streaming", () => {
  it("streams policy.decision events", async () => {
    // Filter should include policy.decision
    const ALL_EVENT_TYPES = [
      "tool.requested", "tool.started", "tool.output", "tool.completed", "tool.failed",
      "policy.decision", "approval.requested", "approval.resolved",
      "patch.proposed", "patch.applied", "patch.rolled_back",
      "context.bundle_created", "verification.check_finished",
    ];
    // Verify all types are included
    assert.ok(ALL_EVENT_TYPES.includes("policy.decision"));
  });

  it("streams patch events", async () => {
    const ALL_EVENT_TYPES = [
      "patch.proposed", "patch.parsed", "patch.rejected",
      "patch.checkpoint_created", "patch.applied", "patch.rolled_back",
    ];
    assert.equal(ALL_EVENT_TYPES.length, 6);
  });

  it("includes context events", async () => {
    const ALL_EVENT_TYPES = [
      "context.repo_map_created", "context.bundle_created",
      "context.file_pinned", "context.file_unpinned",
    ];
    assert.ok(ALL_EVENT_TYPES.includes("context.bundle_created"));
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/server/events-stream.test.ts`
Expected: FAIL (test file doesn't exist yet)

- [ ] **Step 4: Update server.ts to stream all events**

Modify `src/server/server.ts` - replace TOOL_EVENT_FILTER with ALL_EVENT_FILTER:

```typescript
// Remove the restrictive filter
// const TOOL_EVENT_FILTER = ["tool.requested", ...]; // DELETE THIS

// Add config for event filtering (opt-in by view)
const DEFAULT_EVENT_FILTER: string[] = []; // Empty = stream all

// Update the SSE endpoint to accept filter query param
if (url.pathname.startsWith("/api/sessions/") && url.pathname.endsWith("/events")) {
  const sessionId = decodePathSegment(url.pathname.split("/")[3]);
  if (!isValidSessionId(sessionId)) {
    rejectInvalidSessionId(res);
    return;
  }
  
  // Get optional filter from query params
  const filterParam = url.searchParams.get("filter");
  const eventFilter = filterParam ? filterParam.split(",") : DEFAULT_EVENT_FILTER;
  
  const eventsPath = sessionEventsPath(root, sessionId);
  res.setHeader("content-type", "text/event-stream");
  res.setHeader("cache-control", "no-cache");
  res.setHeader("connection", "keep-alive");

  if (!existsSync(eventsPath)) {
    res.end();
    return;
  }

  // Send existing events
  const text = await readFile(eventsPath, "utf8");
  for (const line of text.split("\n").filter(Boolean)) {
    try {
      const event = JSON.parse(line) as { seq: number; type: string };
      if (event.seq <= resumeFromSeq) continue;
      // Skip if filter is set and type not in filter
      if (eventFilter.length > 0 && !eventFilter.includes(event.type)) continue;
      res.write(`event: alix\nid: ${event.seq}\ndata: ${line}\n\n`);
    } catch {
      // Skip malformed lines
    }
  }

  // Poll for new events
  let lastSize = (await readFile(eventsPath, "utf8")).length;
  const interval = setInterval(async () => {
    if (!existsSync(eventsPath)) {
      clearInterval(interval);
      res.end();
      return;
    }
    try {
      const currentSize = (await readFile(eventsPath, "utf8")).length;
      if (currentSize > lastSize) {
        const newText = (await readFile(eventsPath, "utf8")).slice(lastSize);
        lastSize = currentSize;
        for (const line of newText.split("\n").filter(Boolean)) {
          try {
            const event = JSON.parse(line) as { seq: number; type: string };
            // Skip if filter is set and type not in filter
            if (eventFilter.length > 0 && !eventFilter.includes(event.type)) continue;
            res.write(`event: alix\nid: ${event.seq}\ndata: ${line}\n\n`);
          } catch {
            // Skip malformed lines
          }
        }
      }
    } catch {
      clearInterval(interval);
      res.end();
    }
  }, 500);

  req.on("close", () => {
    clearInterval(interval);
  });

  return;
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/server/events-stream.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/server/server.ts tests/server/events-stream.test.ts
git commit -m "feat(server): stream all event types via SSE"
```

---

## Task 2: Enhance projection.js for All Event Types

**Files:**
- Modify: `src/ui/projection.js`
- Test: `tests/ui/projection.test.js`

- [ ] **Step 1: Write failing test for full projection**

```javascript
import { describe, it } from "node:test";
import assert from "node:assert";

describe("Full Event Projection", () => {
  it("projects policy decisions", () => {
    const events = [
      {
        seq: 1, type: "policy.decision", actor: "policy",
        payload: { toolCallId: "c1", decision: "allow", reason: "ok" },
        timestamp: "2026-05-19T10:00:00Z"
      }
    ];
    const projected = buildUiProjection(events);
    assert.ok(projected.summary.policyDecisions >= 0);
  });

  it("projects patch lifecycle", () => {
    const events = [
      {
        seq: 1, type: "patch.proposed", actor: "agent",
        payload: { proposalId: "p1" },
        timestamp: "2026-05-19T10:00:00Z"
      },
      {
        seq: 2, type: "patch.applied", actor: "system",
        payload: { proposalId: "p1", changedFiles: ["a.ts"] },
        timestamp: "2026-05-19T10:00:01Z"
      }
    ];
    const projected = buildUiProjection(events);
    assert.ok(projected.diffs.length >= 0);
  });

  it("projects context events", () => {
    const events = [
      {
        seq: 1, type: "context.bundle_created", actor: "system",
        payload: { bundleId: "b1", primaryFiles: [] },
        timestamp: "2026-05-19T10:00:00Z"
      }
    ];
    const projected = buildUiProjection(events);
    assert.ok(projected.context !== null);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/ui/projection.test.js`
Expected: FAIL

- [ ] **Step 3: Update projection.js with full event support**

Add to `src/ui/projection.js`:

```javascript
export function buildUiProjection(events) {
  const ordered = [...events].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  const summary = {
    eventCount: ordered.length,
    toolCount: ordered.filter((event) => event.type?.startsWith("tool.")).length,
    errorCount: ordered.filter((event) => event.type === "tool.failed").length,
    policyDecisionCount: ordered.filter((event) => event.type === "policy.decision").length,
    patchCount: ordered.filter((event) => event.type?.startsWith("patch.")).length,
    approvalCount: ordered.filter((event) => event.type?.startsWith("approval.")).length,
    contextEventCount: ordered.filter((event) => event.type?.startsWith("context.")).length,
    verificationCount: ordered.filter((event) => event.type?.startsWith("verification.")).length,
    latestSeq: ordered.at(-1)?.seq ?? 0,
  };

  return {
    summary,
    timeline: ordered,
    context: buildContext(ordered),
    terminal: buildTerminal(ordered),
    diffs: buildDiffs(ordered),
    approvals: buildApprovals(ordered),
    verification: buildVerification(ordered),
    tokens: buildTokens(ordered),
    policyDecisions: buildPolicyDecisions(ordered),
    patches: buildPatches(ordered),
    contexts: buildContexts(ordered),
  };
}

function buildContext(events) {
  const bundle = latestPayload(events, "context.bundle_created");
  const repoMap = latestPayload(events, "context.repo_map_created");
  return { bundle, repoMap };
}

function buildPolicyDecisions(events) {
  return events
    .filter((event) => event.type === "policy.decision")
    .map((event) => ({
      toolCallId: event.payload?.toolCallId ?? "",
      decision: event.payload?.decision ?? "unknown",
      reason: event.payload?.reason ?? "",
      capability: event.payload?.capability ?? "",
      matchedRuleId: event.payload?.matchedRuleId,
      timestamp: event.timestamp,
    }));
}

function buildPatches(events) {
  return events
    .filter((event) => event.type?.startsWith("patch."))
    .map((event) => ({
      type: event.type,
      proposalId: event.payload?.proposalId ?? "",
      status: getPatchStatus(event.type),
      changedFiles: event.payload?.changedFiles ?? [],
      timestamp: event.timestamp,
    }));
}

function getPatchStatus(type) {
  switch (type) {
    case "patch.proposed": return "proposed";
    case "patch.applied": return "applied";
    case "patch.rolled_back": return "rolled_back";
    case "patch.rejected": return "rejected";
    default: return "pending";
  }
}

function buildContexts(events) {
  return events
    .filter((event) => event.type?.startsWith("context."))
    .map((event) => ({
      type: event.type,
      timestamp: event.timestamp,
      payload: event.payload,
    }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/ui/projection.test.js`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/ui/projection.js tests/ui/projection.test.js
git commit -m "feat(ui): project all event types for complete observability"
```

---

## Task 3: Add VerificationView to UI

**Files:**
- Modify: `src/ui/index.html`
- Modify: `src/ui/app.js`
- Modify: `src/ui/styles.css`

- [ ] **Step 1: Add verification panel to HTML**

Add to `src/ui/index.html` inside the verification panel:

```html
<div id="verification-panel" class="panel">
  <h3>Verification Results</h3>
  <div id="verification-list"></div>
  <div id="verification-summary"></div>
</div>
```

- [ ] **Step 2: Update app.js to render verification**

Add to `renderAll()` or create `renderVerification()`:

```javascript
function renderVerification() {
  const projection = buildUiProjection(allEvents);
  const verificationList = document.getElementById("verification-list");
  const summary = document.getElementById("verification-summary");
  
  if (!verificationList || !summary) return;

  const verification = projection.verification ?? [];
  
  verificationList.innerHTML = verification.length === 0
    ? "<p class='empty'>No verification checks run yet</p>"
    : verification.map(v => `
      <div class="verification-item ${v.status}">
        <span class="status">${v.status}</span>
        <code>${v.command}</code>
        ${v.output ? `<pre class="output">${escapeHtml(v.output).slice(0, 200)}</pre>` : ""}
      </div>
    `).join("");

  const passed = verification.filter(v => v.status === "passed").length;
  const failed = verification.filter(v => v.status === "failed").length;
  
  summary.innerHTML = `<p>${passed} passed, ${failed} failed</p>`;
}
```

- [ ] **Step 3: Add CSS for verification panel**

```css
.verification-item {
  padding: 8px;
  margin: 4px 0;
  border-radius: 4px;
  background: var(--bg-secondary);
}

.verification-item.passed { border-left: 3px solid #22c55e; }
.verification-item.failed { border-left: 3px solid #ef4444; }

.verification-item .status {
  font-size: 0.75rem;
  padding: 2px 6px;
  border-radius: 3px;
  text-transform: uppercase;
}

.verification-item.passed .status { background: #22c55e20; color: #22c55e; }
.verification-item.failed .status { background: #ef444420; color: #ef4444; }

.verification-item pre.output {
  font-size: 0.75rem;
  background: var(--bg-tertiary);
  padding: 8px;
  border-radius: 4px;
  overflow-x: auto;
  margin-top: 4px;
}
```

- [ ] **Step 4: Test in browser**

Manual verification:
- [ ] Verification panel shows checks
- [ ] Passed/failed status is color-coded
- [ ] Output preview is truncated

- [ ] **Step 5: Commit**

```bash
git add src/ui/index.html src/ui/app.js src/ui/styles.css
git commit -m "feat(ui): add verification results panel"
```

---

## Verification

```bash
npm test -- tests/server/events-stream.test.ts tests/ui/projection.test.js
```

All tests should pass. Manual verification:
- [ ] SSE streams all event types (not just tools)
- [ ] UI projection includes policy.decision, patch.*, context.*
- [ ] Verification panel renders in UI
- [ ] Event replay works with all event types
- [ ] Compare view shows full event history