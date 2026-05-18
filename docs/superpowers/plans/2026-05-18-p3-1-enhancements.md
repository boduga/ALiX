# P3.1 Enhancement: Subagent Timeline + Intent Auto-Selection

> **For agentic workers:** Inline execution below.

**Goal:** Add subagent timeline to UI inspector and implement intent-based role auto-selection in TaskDelegator.

---

## Task 1: Intent-Based Role Auto-Selection

**Files:**
- Modify: `src/agents/task-delegator.ts` (or delegate-tool.ts since TaskDelegator is embedded there)

- [ ] **Step 1: Create role mapper function**

```typescript
// Add to delegate-tool.ts or create src/agents/role-mapper.ts

import type { TaskType } from "../task-classifier.js";
import type { SubagentRole } from "../config/schema.js";

export type RoleRecommendation = {
  role: SubagentRole;
  confidence: "high" | "medium" | "low";
  reason: string;
};

/**
 * Map task type and prompt to recommended subagent role.
 */
export function recommendRole(taskType: TaskType, prompt: string): RoleRecommendation {
  // Bugfix → worker (can apply fixes)
  if (taskType === "bugfix") {
    return { role: "worker", confidence: "high", reason: "bugfix tasks require write capability" };
  }

  // Feature → check if it mentions files (could be worker)
  if (taskType === "feature") {
    const mentionsFiles = /[\/\w]+\.(ts|js|py|go|rs)/i.test(prompt);
    if (mentionsFiles) {
      return { role: "worker", confidence: "medium", reason: "feature mentions existing files" };
    }
    return { role: "explorer", confidence: "medium", reason: "feature without file references" };
  }

  // Refactor → reviewer (analyze code quality)
  if (taskType === "refactor") {
    return { role: "reviewer", confidence: "high", reason: "refactor tasks benefit from code review" };
  }

  // Docs → docs_researcher
  if (taskType === "docs") {
    return { role: "docs_researcher", confidence: "high", reason: "documentation tasks" };
  }

  // Default → explorer (read-only exploration)
  return { role: "explorer", confidence: "low", reason: "no specific role match" };
}
```

- [ ] **Step 2: Update delegate-tool to accept optional role override**

Modify `createDelegateHandler` to add `recommendRole` import and allow role inference:

```typescript
import { recommendRole } from "./role-mapper.js";

export function createDelegateHandler(
  subagentManager: SubagentManager,
  buildTask: (opts: { role: SubagentRole; prompt: string; ownedPaths?: string[]; mode?: "read_only" | "write" }) => SubagentTask,
  onResult?: (result: SubagentResult) => void,
) {
  return async (args: Record<string, unknown>): Promise<ToolResult> => {
    let role = args.role as SubagentRole;
    const prompt = args.prompt as string;

    // If no role specified, infer from task content
    if (!role || role === "auto") {
      const { classifyTask } = await import("../task-classifier.js");
      const taskType = classifyTask(prompt);
      const recommendation = recommendRole(taskType, prompt);

      // Log recommendation for observability
      console.log(`[delegate] auto-role: ${recommendation.role} (${recommendation.confidence}) — ${recommendation.reason}`);

      role = recommendation.role;
    }

    // ... rest of existing logic
  };
}
```

- [ ] **Step 3: Update delegate tool schema to allow "auto" role**

In `delegate-tool.ts`, update the schema:

```typescript
role: {
  type: "string",
  enum: ["auto", "explorer", "reviewer", "test_investigator", "docs_researcher", "worker"],
  description: "The subagent role. Use 'auto' to infer role from task content.",
},
```

- [ ] **Step 4: Write tests**

```typescript
// tests/agents/role-mapper.test.ts
import test from "node:test";
import assert from "node:assert/strict";
import { recommendRole } from "../../src/agents/role-mapper.js";

test("bugfix → worker", () => {
  const result = recommendRole("bugfix", "fix the null pointer crash");
  assert.equal(result.role, "worker");
  assert.equal(result.confidence, "high");
});

test("refactor → reviewer", () => {
  const result = recommendRole("refactor", "extract this function");
  assert.equal(result.role, "reviewer");
  assert.equal(result.confidence, "high");
});

test("docs → docs_researcher", () => {
  const result = recommendRole("docs", "update the README");
  assert.equal(result.role, "docs_researcher");
  assert.equal(result.confidence, "high");
});

test("feature with files → worker", () => {
  const result = recommendRole("feature", "add new endpoint to src/api.ts");
  assert.equal(result.role, "worker");
  assert.equal(result.confidence, "medium");
});

test("feature without files → explorer", () => {
  const result = recommendRole("feature", "add support for OAuth");
  assert.equal(result.role, "explorer");
  assert.equal(result.confidence, "medium");
});

test("unknown → explorer", () => {
  const result = recommendRole("unknown", "check something");
  assert.equal(result.role, "explorer");
  assert.equal(result.confidence, "low");
});
```

- [ ] **Step 5: Run tests and commit**

```bash
npm test 2>&1 | tail -5
git add src/agents/role-mapper.ts src/agents/delegate-tool.ts tests/agents/role-mapper.test.ts
git commit -m "feat(delegate): add intent-based role auto-selection"
```

---

## Task 2: Subagent Timeline in UI

**Files:**
- Modify: `src/inspector/projection.ts` (add subagent event projection)
- Modify: `src/ui/projection.js` (frontend rendering)
- Modify: `src/ui/app.js` (add subagent timeline panel)

- [ ] **Step 1: Add subagent event projection types**

In `src/inspector/projection.ts`, add:

```typescript
export type SubagentEvent = {
  type: "subagent.started" | "subagent.completed" | "subagent.failed";
  subagentId: string;
  role: string;
  timestamp: string;
  duration?: number;
  status?: "success" | "failed";
};

export function projectSubagentEvents(events: LogEvent[]): SubagentEvent[] {
  return events
    .filter(e => e.actor === "subagent" && e.type.startsWith("subagent."))
    .map(e => ({
      type: e.type as any,
      subagentId: e.payload?.subagentId ?? "",
      role: e.payload?.role ?? "",
      timestamp: e.timestamp,
      duration: e.type === "subagent.completed"
        ? new Date(e.timestamp).getTime() - new Date(events.find(x => x.type === "subagent.started" && x.payload?.subagentId === e.payload?.subagentId)?.timestamp ?? e.timestamp).getTime()
        : undefined,
      status: e.type === "subagent.completed" ? "success" : e.type === "subagent.failed" ? "failed" : undefined,
    }));
}
```

- [ ] **Step 2: Add subagent panel to UI**

In `src/ui/app.js`, add a subagent timeline section:

```javascript
// Add after existing panels
function renderSubagentTimeline(events) {
  const subagentEvents = projectSubagentEvents(events);

  if (subagentEvents.length === 0) {
    return '<div class="panel"><h3>Subagent Timeline</h3><p class="empty">No subagent activity</p></div>';
  }

  const items = subagentEvents.map(e => `
    <div class="timeline-item ${e.status ?? ''}">
      <span class="timestamp">${formatTime(e.timestamp)}</span>
      <span class="role badge ${e.role}">${e.role}</span>
      <span class="type">${e.type.replace('subagent.', '')}</span>
      ${e.duration ? `<span class="duration">${e.duration}ms</span>` : ''}
    </div>
  `).join('');

  return `
    <div class="panel" id="subagent-timeline">
      <h3>Subagent Timeline (${subagentEvents.length})</h3>
      <div class="timeline">${items}</div>
    </div>
  `;
}
```

- [ ] **Step 3: Update styles**

In `src/ui/styles.css`, add:

```css
#subagent-timeline {
  border-left: 3px solid var(--subagent-color, #9b59b6);
}

.timeline-item {
  display: flex;
  gap: 8px;
  padding: 4px 8px;
  border-radius: 4px;
  margin-bottom: 4px;
  background: var(--bg-secondary);
}

.timeline-item.success { border-left: 3px solid #27ae60; }
.timeline-item.failed { border-left: 3px solid #e74c3c; }

.badge {
  padding: 2px 6px;
  border-radius: 3px;
  font-size: 0.75em;
  font-weight: bold;
}
.badge.worker { background: #e67e22; color: white; }
.badge.explorer { background: #3498db; color: white; }
.badge.reviewer { background: #9b59b6; color: white; }
.badge.docs_researcher { background: #1abc9c; color: white; }
```

- [ ] **Step 4: Wire into main render**

In `src/ui/app.js`, add subagent timeline to the panels array:

```javascript
const panels = [
  // ... existing panels ...
  { id: 'subagent', render: (events) => renderSubagentTimeline(events) }
];
```

- [ ] **Step 5: Build and test**

```bash
npm run build
# Start alix and check UI at http://localhost:3456
# Run a session with subagents: alix agent explorer "..."
# Verify subagent timeline shows in UI
```

- [ ] **Step 6: Commit**

```bash
git add src/inspector/projection.ts src/ui/projection.js src/ui/app.js src/ui/styles.css
git commit -m "feat(inspector): add subagent timeline to UI"
```

---

## Verification

- [ ] Run full test suite

```bash
npm test 2>&1 | tail -10
```

Expected: All tests pass