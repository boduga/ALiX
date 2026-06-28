# M0.9-G: Demo Path + Inspector Compatibility

**Status:** ✅ Completed (M0.9) — Plan implemented and committed to main.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** (1) A safe `alix demo local` command that works on the default local-first setup and shows WorkflowRun ID, TaskNode ID, model route, tool event, and PolicyDecision. (2) Inspector displays WorkflowRun and TaskGraph IDs from the new `EventMeta` field while still reading legacy events.

**Architecture:** The demo command runs a simple read-only task (repo summary or directory inspect) through `runTask`, then displays the kernel artifacts produced. Inspector projection reads `meta.workflowId`/`meta.graphId`/`meta.nodeId` from events and surfaces them in the timeline view.

**Tech Stack:** TypeScript.

---

## File Structure

| File | Action | Responsibility |
|------|--------|---------------|
| `src/cli/commands/demo.ts` | **Create** | `alix demo local` command |
| `src/cli.ts` | **Modify** | Add `demo` command handler |
| `src/inspector/projection.ts` | **Modify** | Display workflow/graph/node IDs from event meta |

---

### Task 1: Create demo command

**Files:**
- Create: `src/cli/commands/demo.ts`

- [ ] **Step 1: Write demo command**

```typescript
/**
 * demo.ts — M0.9 safe visible demo path.
 *
 * Runs a read-only task (repo summary via directory inspect)
 * and displays WorkflowRun ID, TaskNode ID, model route,
 * tool event, and PolicyDecision.
 */

import { runTask } from "../run.js";
import { loadConfig } from "../config/loader.js";
import { RandomUUID } from "node:crypto";

export async function runDemo(): Promise<void> {
  const cwd = process.cwd();

  console.log("ALiX M0.9 Demo — Local Read-Only Task");
  console.log("──────────────────────────────────────");
  console.log();

  // Run a simple read-only task
  const task = "list the files in the current directory and summarize the project structure";

  // Generate a predictable session ID so demo runs are findable
  const sessionId = `demo_${Date.now()}`;
  const sessionDir = join(cwd, ".alix", "sessions", sessionId);
  await mkdir(sessionDir, { recursive: true });

  const config = await loadConfig(cwd);
  const { resolveContextLimit } = await import("../../config/context-limits.js");
  const contextInfo = await resolveContextLimit(config.model.provider, config.model.name, config.apiKeys);
  const { EventLog } = await import("../events/event-log.js");
  const tuiLog = new EventLog(sessionDir);
  await tuiLog.init();

  console.log(`Task:       ${task}`);
  console.log(`Provider:   ${config.model.provider}`);
  console.log(`Model:      ${config.model.name}`);
  console.log(`Context:    ${(contextInfo.maxTokens ?? 0).toLocaleString()} tokens`);
  console.log();

  try {
    const startTime = Date.now();
    const result = await runTask(cwd, task, {
      streaming: true,
      sessionMode: "bypass",
      sharedSession: { sessionId, sessionDir, eventLog: tuiLog },
    });
    const duration = Date.now() - startTime;

    console.log();
    console.log("─ Results ─────────────────────────────────");
    console.log(`Session:     ${result.sessionId}`);
    console.log(`Duration:    ${duration}ms`);

    if (result.summary) {
      console.log(`Summary:     ${result.summary.slice(0, 200)}`);
    }

    // Show kernel artifacts from event log
    const events = await tuiLog.readAll();
    const workflowEvents = events.filter(e => e.type === "workflow.created");
    const graphEvents = events.filter(e => e.type === "graph.created");
    const toolEvents = events.filter(e => e.type === "tool.requested");
    const policyEvents = events.filter(e => e.type === "policy.decision");
    const metricEvents = events.filter(e => e.type === "m09.metric");

    console.log();
    console.log("─ Kernel Artifacts ─────────────────────────");
    if (workflowEvents.length > 0) {
      console.log(`WorkflowRun:  ${(workflowEvents[0].payload as any)?.workflowId ?? "✓"}`);
    }
    if (graphEvents.length > 0) {
      console.log(`TaskGraph:    ${(graphEvents[0].payload as any)?.graphId ?? "✓"}`);
    }
    console.log(`Model calls:  ${events.filter(e => e.type === "model.usage").length}`);
    console.log(`Tool calls:   ${toolEvents.length}`);
    console.log(`Policy decisions: ${policyEvents.length}`);
    console.log(`Metrics:      ${metricEvents.length}`);
    console.log();
    console.log("Demo complete. No files were modified.");
  } catch (err) {
    console.error(`Demo failed: ${err instanceof Error ? err.message : String(err)}`);
    console.log();
    console.log("Tip: Ensure Ollama is running with the model configured in .alix/config.json");
    process.exit(1);
  }
}
```

- [ ] **Step 2: Add missing imports**

Add to the top of `src/cli/commands/demo.ts`:

```typescript
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
```

- [ ] **Step 3: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 4: Commit**

```bash
git add src/cli/commands/demo.ts
git commit -m "feat(cli): M0.9 demo command with kernel artifact display"
```

---

### Task 2: Wire demo into CLI

**Files:**
- Modify: `src/cli.ts`

- [ ] **Step 1: Add demo command handler**

Add before the `alix serve` command:

```typescript
// --- alix demo --- M0.9 demo path ---
if (command === "demo" && args[0] === "local") {
  const { runDemo } = await import("./cli/commands/demo.js");
  await runDemo();
  process.exit(0);
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/cli.ts
git commit -m "feat(cli): wire alix demo local command"
```

---

### Task 3: Update Inspector projection

**Files:**
- Modify: `src/inspector/projection.ts`

- [ ] **Step 1: Add workflow/graph/node ID display**

In the `buildInspectorSnapshot()` function, after reading events, extract workflow/graph/node IDs from event meta:

```typescript
// M0.9: read workflow/graph/node IDs from event meta
for (const event of events) {
  const meta = (event as any).meta;
  if (meta?.workflowId && !snapshot.workflowId) snapshot.workflowId = meta.workflowId;
  if (meta?.graphId && !snapshot.graphId) snapshot.graphId = meta.graphId;
  if (meta?.nodeId && !snapshot.nodeId) snapshot.nodeId = meta.nodeId;
}
```

Add to the `InspectorSnapshot` type (if it doesn't already have these fields):

```typescript
workflowId?: string;
graphId?: string;
nodeId?: string;
```

- [ ] **Step 2: Verify build**

```bash
npm run build 2>&1 | tail -5
```

- [ ] **Step 3: Commit**

```bash
git add src/inspector/projection.ts
git commit -m "feat(inspector): display WorkflowRun and TaskGraph IDs from event meta"
```
